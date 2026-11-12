# Deploying on a server

CanvHQ runs the same way on a rented server, a machine at home or a platform that runs Docker Compose. This page lists what the host needs. Follow your hosting provider's own documentation for creating the server and for DNS.

## What you need

- A machine that runs Docker with Compose, with enough disk for the database. Canvases and images live in your bucket, not on the machine.
- A domain name that points at it.
- **TLS in front of CanvHQ.** The app speaks plain HTTP on port 3000 and expects a reverse proxy (any proxy you like) to add HTTPS. Sign-in cookies are marked secure in production, so people cannot sign in over plain HTTP.
- S3-compatible object storage and a Google sign-in client.

## Steps

1. Install Docker on the machine (see Docker's documentation).
2. Follow [Run with Docker Compose](/docs/run-with-docker-compose). Set `AUTH_URL` and `FRONTEND_URL` to your public address, for example `https://canvas.example.org`.
3. Point your proxy at `127.0.0.1:3000` and make it forward the original client address in `X-Forwarded-For`.
4. Set `TRUST_PROXY=1`, one for the one proxy in front. See [Going public](/docs/going-public).
5. Check `https://your-address/api/health`. It answers when the app and database are up.

## Reverse proxy examples

Both examples send a domain to `127.0.0.1:3000`. Replace `canvas.example.org` with your own address.

### Caddy

Caddy gets and renews the certificate itself, adds `X-Forwarded-For` and keeps the notification stream open without extra settings.

```
canvas.example.org {
	reverse_proxy 127.0.0.1:3000
}
```

### nginx

This assumes a certificate from Let's Encrypt (for example through `certbot`). Two lines matter more than the rest:

- `client_max_body_size 16m` lets a canvas be saved. nginx stops requests above 1 MB by default, and a canvas can be up to 15 MB.
- The `/api/notifications/stream` block turns response buffering off and allows a long read timeout, so the bell updates live. See [Going public](/docs/going-public).

```
server {
    listen 80;
    server_name canvas.example.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name canvas.example.org;

    ssl_certificate     /etc/letsencrypt/live/canvas.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/canvas.example.org/privkey.pem;

    client_max_body_size 16m;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    location / {
        proxy_pass http://127.0.0.1:3000;
    }

    location /api/notifications/stream {
        proxy_pass http://127.0.0.1:3000;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
```

With either proxy, keep `TRUST_PROXY=1`.

## Platforms that run Compose files

The repository has a compose file for platforms that fill in some variables for you: `docker-compose.coolify.yml`. It is written for Coolify, and [Deploying on Coolify](/docs/deploying-on-coolify) walks through it. Other platforms can use `docker-compose.prod.yml`.

## After it is running

- Back up the database and the bucket together: [Backups and restore](/docs/backups-and-restore).
- Read [Upgrading](/docs/upgrading) before you pull a new version.
- Decide whether you want limits or a private instance: [Going public](/docs/going-public).
