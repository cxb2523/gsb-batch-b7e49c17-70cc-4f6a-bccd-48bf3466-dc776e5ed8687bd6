# Behind a proxy and going public

A few optional settings decide how an instance faces the internet. An instance with none of them set behaves like a single private server.

## Tell CanvHQ about your proxy

If a reverse proxy sits in front of CanvHQ, every request arrives from the proxy's address. CanvHQ uses a visitor's address for its request limits and its sign-up limit, so it has to know which address to trust.

- `TRUST_PROXY=false` (the default): use the address the connection came from. Right when nothing sits in front.
- `TRUST_PROXY=1`: one proxy sits in front; trust the address it reports. Use `2` for two proxies, and so on.
- `TRUST_PROXY=10.0.0.0/8,172.16.0.0/12`: trust forwarded addresses only from these proxies.

With the setting off, an address a visitor sends in a header is ignored, so a visitor cannot choose which address CanvHQ counts. With it on, make sure only your proxy can reach the container: the production compose file publishes the container on `127.0.0.1` for that reason. If you must reach it directly from another machine, set `BIND_ADDRESS=0.0.0.0` and keep the container behind a firewall.

> [!WARNING]
> If you upgrade from a version before these settings existed: an instance behind a proxy now needs `TRUST_PROXY=1`, and an instance that was reached directly on a public address now needs `BIND_ADDRESS=0.0.0.0`.

## Keep the live notification stream open

The bell in the header is updated from a connection the browser keeps open to `/api/notifications/stream`. It sends a small message about every 25 seconds so it stays alive. If your proxy buffers responses or closes quiet connections after a short time, the bell still works, but it only updates when the person returns to the tab. To make it live, turn response buffering off for that path and allow connections to stay open for a few minutes. In nginx that is `proxy_buffering off;` and a `proxy_read_timeout` of 300s or more for `/api/notifications/stream`. Caddy and Traefik pass it through without changes.

This stream is held in the memory of one CanvHQ process. If you run several copies behind a load balancer, a person is only told instantly about things that happened on the copy they are connected to. The rest appear when they next open the tab.

## Close the door

- `ALLOW_SIGNUPS=false`: only people with an invitation can create an account. The first account is still allowed, so you can set the instance up.
- `FIRST_ACCOUNT_EMAIL=you@example.org`: while there are no accounts, only this verified address may register, so a stranger is refused if they try to register first while you set up. It works with or without the line above. Once any account exists it does nothing.

The first person to sign in becomes the Owner of their own workspace. There is no instance administrator: the Owner invites everyone else.

## Limits

All optional, and counted against the Owner of a workspace.

- `LIMIT_SIGNUPS_PER_IP` and `LIMIT_SIGNUPS_WINDOW_SECONDS`: accounts one address may create in a window (an hour by default).
- `LIMIT_WORKSPACES_PER_ACCOUNT`, `LIMIT_BOARDS_PER_ACCOUNT`, `LIMIT_STORAGE_MB_PER_ACCOUNT`: what one person may own.

When a limit stops someone, they see a message that names the limit and tells them to ask you. A save that makes a canvas smaller is not blocked by a storage limit. Limits are checked just before the work is saved, so two actions at the very same moment can pass the limit by one. Canvases saved before you set a limit count only their images until they are saved again.

## A public demo

`DEMO_MODE=true` shows one button, "Try the demo". Each visitor gets a throwaway account, and a banner says that everything is deleted nightly. No sign-in provider is needed.

CanvHQ does not delete anything by itself. You schedule the wipe: run `node scripts/demo-wipe.mjs` inside the container (the image contains it) once a night. It empties every table except the migration history and **every object in the configured bucket**, so use a bucket and a database that hold nothing you want to keep. It refuses to run unless `DEMO_MODE=true`.

## Say who runs it

`OPERATOR_NAME` and `OPERATOR_CONTACT` appear on the Privacy and Terms pages. If you leave them empty, those pages say the operator has not published contact details.

If you use analytics (`UMAMI_WEBSITE_ID`), the Privacy page already says it is off unless the operator turns it on. It is not loaded on canvas or shared-link pages.

The browser's content security policy is built from your settings: it allows scripts and connections to the analytics host only when analytics is configured, and to the address in `AUTH_URL`. Nothing else is loaded from another site, including fonts.
