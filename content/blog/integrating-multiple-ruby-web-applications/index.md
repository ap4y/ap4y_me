+++
title =  "Integrating Multiple Ruby Web Applications"
date = 2013-11-04
+++

> Using multiple Ruby application stacks in production environment can be useful. Following simple steps will introduce one possible approach to do that. 

In my previous article I discussed a ways to implement a live streaming with Server-Sent Events and EventMachine. Unfortunately, if we are not using EventMachine compatible application server, we could not integrate this solution into Rails application. Starting applications on separate ports/domains will violate CORS policy in browser. Additionally, sharing cookie authorisation will not be possible too.

Assume SSE example from previous article. I have a Rails application with cookie based authorisation (implemented with Devise) hosted on Unicorn, port 8080. I also have Sinatra application hosted on Thin, port 4567. I want to issues streaming request to the Sinatra application from Rails template. I also want to prevent this request in Sinatra if user is not authorised in Rails application.

## Using Nginx as reverse proxy

I knew that I can use reverse proxy to avoid issues with different domains. This will also open possibilities to share encrypted cookies and sessions between applications.

Nginx probably is the most popular reverse proxy implementation. Using `proxy_pass` directive you can redirect request to the specific application server. For our case I will do the following Nginx configuration:

{{< highlight nginx >}}
http {
    upstream railsapp {
      server 127.0.0.1:8080;
    }

    upstream sinatra {
      server 127.0.0.1:4567;
    }

    server {
        listen       8081;
        server_name  localhost;

        location / {
            proxy_pass http://railsapp;
        }

        location /stream {
            proxy_pass http://sinatra;
        }
    }
}
{{< /highlight >}}

In configuration file I defined `railsapp` and `sinatra` endpoints with `upstream` directive. I mapped `/stream` routes to the Sinatra application and all other routes to the Rails application. Two things I want to mention:

- Unix sockets are preferred in production for upstream definition.
- Nginx will not start application servers.

Once started Nginx will be available with non-blocking SSE application on the port 8081. Another thing to mention, it won't probably work since Nginx uses connection buffering by [default](http://wiki.nginx.org/X-accel#X-Accel-Buffering), thus it is required to turn off buffering by applying correct header value in Sinatra application:

{{< highlight ruby >}}
get '/stream/:channel' do
  channel = params[:channel]
  pub_sub = PubSub.new(channel)

  content_type 'text/event-stream'
  response.header['X-Accel-Buffering'] = 'no'

  stream :keep_open do |out|
    # PubSub code
  end
end
{{< /highlight >}}

After restart Sinatra application will able to handle SSE requests from Rails application. Along with initial request Nginx will pass cookies from the Rails application, so it will be possible to manipulate them in Sinatra.

## Sharing encrypted cookies between applications

Sharing cookie between Sinatra and Rails 3 application is [an easy task](http://labnote.beedesk.com/sinatra-warden-rails-devise), since they are using `Rack::Session::Cookie`. Situation is different for Rails 4 application, since it uses `ActionDispatch::Session::CookieStore`. I have found the [article](http://stderr.timfischbach.de/2013/09/14/rails-4-and-sinatra-session-sharing.html) with possible solution for mounted Sinatra application, but unfortunately it will not work for us.

Quickly scanning through the sources, I thought that it is possible to decrypt cookie with `ActionDispatch::Cookies::EncryptedCookieJar`. It requires `parent_jar` and `key_generator` as constructor parameters. So I did a minimal implementation to check this idea by using `secret_key_base` from Rails initialiser. This code worked, so I decided to wrap it into Rack middleware. My Rack/Sinatra skills are not that great, so I expect this implementation can be a bit ugly:

{{< highlight ruby >}}
require 'action_dispatch'

class RailsCookieMiddleware
  def initialize(app, options)
    @app = app
    @key = options[:key]
    @secret = options[:secret]

    parent_key_generator = ActiveSupport::KeyGenerator.new(@secret, iterations: 1000)
    key_generator = ActiveSupport::CachingKeyGenerator.new(parent_key_generator)

    @parent_jar = ActionDispatch::Cookies::CookieJar.new(key_generator, nil, false)

    @cookie_jar = ActionDispatch::Cookies::EncryptedCookieJar.new(@parent_jar, key_generator, {
      encrypted_cookie_salt:         'encrypted cookie',
      encrypted_signed_cookie_salt:  'signed encrypted cookie'
    })
  end

  def call(env)
    cookie = CGI::Cookie::parse(env['HTTP_COOKIE'])
    if cookie[@key]
      session_cookie = { @key => cookie[@key].first }
      @parent_jar.update(session_cookie)
      env[@key] = @cookie_jar[@key]
    end

    @app.call(env)
  end
end
{{< /highlight >}}

This code is basically extraction from the Rails sources. It requires `secret_key_base` and `session_store_key` from Rails initialiser. It uses `ActionDispatch` cookie jar and `ActiveSupport` implementations so I added `actionpack` to the Gemfile.

After that I changed Sinatra application to use this middleware and to check if session contains user data. This data is stored under the Warden key with path `warden.user.user.key`.

{{< highlight ruby >}}
class SSE < Sinatra::Base
  use RailsCookieMiddleware,
    key: '_devise_example_session',
    secret: 'your_secret_key_base'

  get '/stream/:channel' do
    session = env['_devise_example_session']
    return unless session['warden.user.user.key']

    # code for authorised user
  end
end
{{< /highlight >}}

I could also implement another authorisation strategy, like using CanCan or assigning some token to the user's session.

With this relatively simple steps I was able to implement non-blocking SSE application using separate Ruby web stack. At the same time main Rails application provides authorisation mechanism for the streaming application and has a Redis based message channel to publish arbitrary data at the arbitrary time intervals. More importantly I'm not exhausting Rails application during streaming and I did not have to change my current production stack.

Full application code with example Nginx configuration can be found in my github [repository](https://github.com/ap4y/eventmachine-sinatra-ss://github.com/ap4y/eventmachine-sinatra-sse).

Updated 2013-11-03:

I have spent some time reviewing my initial approach with middleware, and found a better solution. I will present it as a part of Rack up file:

{{< highlight ruby >}}
require 'warden'
require './app'

@secret_key_base = 'your secret key'
def key_generator
  @caching_key_generator ||= begin
    key_generator = ActiveSupport::KeyGenerator.new(@secret_key_base, iterations: 1000)
    ActiveSupport::CachingKeyGenerator.new(key_generator)
  end
end

use Rack::Config do |env|
  env['action_dispatch.key_generator'] = key_generator
  env['action_dispatch.secret_key_base'] = @secret_key_base
  env['action_dispatch.signed_cookie_salt'] = 'signed cookie'
  env['action_dispatch.encrypted_cookie_salt'] = 'encrypted cookie'
  env['action_dispatch.encrypted_signed_cookie_salt'] = 'signed encrypted cookie'
end

use ActionDispatch::Session::CookieStore,
  key: '_devise_example_session',
  secret: @secret_key_base

use Warden::Manager do |manager|
  manager.failure_app = App
  manager.default_scope = :user
end

run App
{{< /highlight >}}



This is again just a piece of Rails source codes. But instead of using custom middleware I included `ActionDispatch::Session::CookieStore`. I also added Warden middleware to get some helpers like `authenticated?` (Warden is available in Sinatra from environment variables, `env['warden']`)
