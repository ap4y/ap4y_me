FROM caddy:2.7.6-builder AS caddy_builder

RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM jojomi/hugo:0.85.0 as builder

COPY . /blog
WORKDIR /blog
RUN hugo

FROM caddy:2.7.6

COPY --from=caddy_builder /usr/bin/caddy /usr/bin/caddy
COPY --from=builder /blog/public /usr/share/caddy
