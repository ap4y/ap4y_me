+++
title = "Live streaming with Rails application"
date = 2013-11-03
+++

> Data streaming is a very useful content delivery strategy for some web applications. While live streaming was possible in Rails applications for quite a while, in most cases integrating such strategy into existing stack can be a trial task. 

The project that I'm working on right now has a live dashboard page, couple days ago we decided to refine it, so I started thinking about possible solution. This page has a simple requirements:

- It should present new data points and aggregated information collected by Rails application;
- It should use existing authorisation system;
- It should use minimal amount of the server resources. Obviously it should not block connection.

Currently this page uses [juggernaut](https://github.com/maccman/juggernaut) in order to avoid blocking connections. Juggernaut is a Node.js web socket application with Redis for message queuing. It also provides simple API for Rails applications. Unfortunately, it was deprecated and was hard to integrate into authorisation system (which is based on Devise and CanCan).

## Streaming options overview

As it follows from the requirements dashboard page does not require duplex channel. Using raw web sockets involves implementing messaging protocol which wasn't an option. We could use something like [faye](http://faye.jcoglan.com/) to get a message channels, but it could bring unnecessary complexity during [deployment](https://github.com/faye/faye/wiki/Deploy-Best-Practices) and [authentication](http://faye.jcoglan.com/security.html). So I would prefer to use HTTP transport if possible.

AJAX based pooling strategy was a possible option, but [Server-Sent Events](http://dev.w3.org/html5/eventsource/) option looked more interesting, since browser will handle many edge cases like connects and disconnects. So I felt like SSE satisfies all requirements and it was a lightweight solution.

## Long lasting connections in Ruby applications

While we could implement any streaming strategy in Rails application, it was obvious that it will bring blocking IO. Ruby provides several possible solutions to blocking IO:

- Concurrent IO. This is a common solution for Ruby applications. You can use processes or threads to increase amount of blocking IO that you handle. This approach is limited by amount workers available in your application. Proper threaded solution with Rubinius/JRuby can perform quite well, especially if you use significant amount of system resources in streaming workers.

- Non-blocking IO. This solution is good for lightweight streaming operations. For such operations you will be able to handle more connections than with concurrent IO, will use less resources and it works quite well with MRI. On the other hand, it requires special frameworks and web servers.

We are using open source Passenger with MRI in production, so I knew that in order to get decent concurrent IO we had to change this stack to Passenger Enterprise or Puma with potentially different interpreter. Due to this fact and assumption that we will be sending small json documents to the client application without additional processing, I decided to take approach with non-blocking IO.

There is no much options for non-blocking IO in Ruby application, so my obvious choice was [EventMachine](https://github.com/eventmachine/eventmachine).

> EventMachine is an event-driven I/O and lightweight concurrency library for Ruby. It provides event-driven I/O using the Reactor pattern.

As I mentioned, it requires different web server, I decided to use [Thin](http://code.macournoyer.com/thin/) which is based on EventMachine, so I won't have to start run loop manually.

Implementing SSE with EventMachine

So far architecture decisions do not require changes to the existing Rails application. Eventmachine will be a standalone application, that needs some sort of enqueueing layer. Simple [PubSub](http://en.wikipedia.org/wiki/Publish/subscribe) implementation should be enough for such operation. We already had Redis installed on our servers for Sidekiq and other operations, so I decided to use Redis `PUBLISH` and `SUBSCRIBE` commands.

### Implementing EventMachine entry point

I started with simple EventMachine based application.

{{< highlight ruby >}}
require 'thin'
require 'eventmachine'

EM.run do
  EM.add_periodic_timer(1) do
  end

  Signal.trap("INT")  { EM.stop }
  Signal.trap("TERM") { EM.stop }
end
{{< /highlight >}}

Here I started EventMachine run loop with `EM.run`. In block I subscribed with `Signal.trap` to the system signals in order to stop run loop. Also I created a timer (`EM.add_periodic_timer`) with 1 second interval, which will be used for simulating messages.

### Simple PubSub with Redis

After that I implemented simple PubSub wrapper. Since I used EvenMachine, I decided to go with non-blocking IO operations for Redis too. I did that with [em-synchrony](https://github.com/igrigorik/em-synchrony), `redis` gem already has support for `em-synchrony`.

{{< highlight ruby >}}
require 'redis'
require 'em-synchrony'

class PubSub
  def initialize(channel)
    @client  = Redis.new
    @channel = channel
  end

  def publish(message)
    EM.synchrony do
      @client.publish(@channel, message)
    end
  end

  def subscribe(&b)
    return unless block_given?
    EM.synchrony do
      @client.subscribe(@channel) do |on|
        on.message do |channel, message|
          yield(message)
        end
      end
    end
  end

  def unsubscribe
    EM.synchrony do
      @client.unsubscribe(@channel)
    end
  end
end
{{< /highlight >}}

This is a simple class with 3 methods: `publish`, `subscribe`, `unsubscribe`. I also wrapped all commands in `EM.synchrony` block in order to perform non-blocking operations.

### Integrating Sinatra into EventMachine

The only thing left is the actual SSE handling code. It should response to the connections on the specific path. Once client connected it should subscribe to the specified Redis channel and write received message until connection is closed. While I could do that with EvenMachine, this process could be quite tedious, I wanted to have higher level API for connection buffers and request lifecycle. I knew that [Sinatra](http://sinatrarb.com/) had such API and it integrated well with Rails and EventMachine, so I decided to use it for SSE.

{{< highlight ruby >}}
require 'sinatra/base'
require './pub_sub'

class SSE < Sinatra::Base
  disable :run

  get '/stream/test' do
    erb :index
  end

  get '/stream/:channel' do
    channel = params[:channel]
    pub_sub = PubSub.new(channel)

    content_type 'text/event-stream'
    stream :keep_open do |out|
      pub_sub.subscribe do |message|
        if out.closed?
          pub_sub.unsubscribe
          next
        end

        out << "event: #{channel}\n\n"
        out << "data: #{message}\n\n"
      end
    end
  end
end

__END__
@@ index
<article id="log"></article>
<script>
  var source = new EventSource('/stream/channel_1');
  source.addEventListener('message', function (event) {
    log.innerText += '\n' + event.data;
  }, false);
</script>
{{< /highlight >}}

I created new `Sinatra::Base` application and disabled auto run (`disable :run`), since I will start this application from EventMachine. I defined `/stream/:channel` route, which will create a new PubSub client for the specified channel and will start streaming (`stream :keep_open`). Once connection is closed it will close PubSub connection. I also defined `/stream/test` route in order to test application. The only part left is to start application from EventMachine.

{{< highlight ruby >}}
require 'thin'
require 'eventmachine'
require './pub_sub'
require './sse'

pub_sub = PubSub.new('channel_1')
EM.run do
  EM.add_periodic_timer(1) do
    pub_sub.publish("foo#{rand(10)}")
  end

  Thin::Server.start(SSE, '0.0.0.0', 4567)

  Signal.trap("INT")  { EM.stop }
  Signal.trap("TERM") { EM.stop }
end
{{< /highlight >}}

I started Thin server with application on port 4567 and also added simple random data output `pub_sub.publish("foo#{rand(10)}")` for `channel_1`.

## Integrating into Rails application. The simple case.

All things that I did so far were outside of the Rails application. There are 2 ways to integrate this solution into existing application. Using Thin in production is one of them and this case is really simple. I will test authorisation with [Devise example application](https://github.com/jayshepherd/devise_example), which is a simple Rails 4 application.

Since Sinatra is just a Rake compatible engine, I can mount it in router:

{{< highlight ruby >}}
require 'see'

authenticate :user do
  mount SSE => '/stream'
end
{{< /highlight >}}

This route will be only available for authenticated users, I could leverage Warden or CanCan checks with the similar way. I could also simulate data with PubSub and non-blocking Redis client, I will demonstrate that with custom initialiser:

{{< highlight ruby >}}
require 'pub_sub'

pub_sub = PubSub.new('channel_1')
EM.next_tick do
  EM.add_periodic_timer(1) do
    pub_sub.publish("foo#{rand(10)}")
  end
end
{{< /highlight >}}

I used `EM.next_tick` instead of `EM.run`, since Thin will start EventMachine for me.

Unfortunately, using Thin in production is not always an option. We won't be able integrate EventMachine based application into other stacks so easy, but there is still a way to do that. I will cover that in my next post.
