FROM jojomi/hugo as builder

COPY . /blog
WORKDIR /blog
RUN hugo

FROM caddy/caddy

COPY --from=builder /blog/public /usr/share/caddy
