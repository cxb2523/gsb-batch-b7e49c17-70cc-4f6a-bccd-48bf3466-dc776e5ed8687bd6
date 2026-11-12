# Environment variables

CanvHQ checks its settings when it starts. If a required one is missing or wrong, it stops and says which. An empty value counts as not set, so a compose file can pass every variable through without breaking the ones you leave blank.

## The server

| Variable | Required | Default | What it does |
| :--- | :---: | :---: | :--- |
| `NODE_ENV` | No | `development` | `production` for a real instance. In production the app needs a sign-in provider, or demo mode. |
| `PORT` | No | `3000` | The port the app listens on. |
| `AUTH_URL` | No | `http://localhost:3000` | The public address of the app, as people type it. Sign-in uses it. |
| `FRONTEND_URL` | No | `http://localhost:5173` | The address of the web app, used for invitation links and for which sites may call the API. In the single-container image it is the same as `AUTH_URL`. |
| `STATIC_DIR` | No | — | Where the built web app is served from. The image sets this itself. |
| `TRUST_PROXY` | No | `false` | How many reverse proxies sit in front of the app: `false`, a number such as `1`, or a list of proxy addresses. See [Behind a proxy and going public](/docs/going-public). |

## The database

| Variable | Required | Default | What it does |
| :--- | :---: | :---: | :--- |
| `DATABASE_URL` | **Yes** | — | The PostgreSQL connection string, for example `postgresql://user:password@host:5432/canvhq?schema=public`. |
| `DATABASE_POOL_SIZE` | No | `10` | How many database connections the app keeps open. |

## Sign-in

| Variable | Required | Default | What it does |
| :--- | :---: | :---: | :--- |
| `AUTH_SECRET` | **Yes** | — | A long random value (at least 32 characters) that signs session cookies. Keep it private and do not change it casually: everyone is signed out when it changes. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | In production, unless `DEMO_MODE=true` | — | Sign in with Google. |
| `ALLOW_SIGNUPS` | No | `true` | Set to `false` so that only people with an invitation can create an account. The very first account is still allowed, so you can set the instance up. |
| `FIRST_ACCOUNT_EMAIL` | No | — | While there are no accounts, only this verified email address may register, whatever `ALLOW_SIGNUPS` says. Once any account exists this does nothing. |
| `ENABLE_DEV_LOGIN` | No | `false` | A one-click test account for local development. Not allowed in production. |
| `DEMO_MODE` | No | `false` | A public demo: no sign-in provider, one-click throwaway accounts. See [Going public](/docs/going-public). Not allowed with `ENABLE_DEV_LOGIN` or `FIRST_ACCOUNT_EMAIL`. |

In production you need the Google client ID and secret, unless `DEMO_MODE=true`. See [Sign in with Google](/docs/sign-in-providers).

## Storage

| Variable | Required | Default | What it does |
| :--- | :---: | :---: | :--- |
| `S3_BUCKET_NAME` | **Yes** | — | The bucket that holds encrypted canvases and images. |
| `S3_ACCESS_KEY_ID` | **Yes** | — | The access key for the bucket. |
| `S3_SECRET_ACCESS_KEY` | **Yes** | — | The secret for that key. |
| `S3_ENDPOINT` | No | — | The address of your storage service, if it is not the default of the S3 library. |
| `S3_REGION` | No | `us-east-1` | The region your storage service expects. |
| `S3_FORCE_PATH_STYLE` | No | detected | `true` or `false`. Many self-hosted stores need `true`. |

See [Storage](/docs/storage).

## Limits per account

All optional. If a variable is not set there is no limit. A limit is counted against the workspace Owner, so work done by other members in a workspace counts against its Owner. The size of one canvas stays capped at 50 MB regardless.

| Variable | Default | What it does |
| :--- | :---: | :--- |
| `LIMIT_SIGNUPS_PER_IP` | — | How many accounts one address may create within the window. |
| `LIMIT_SIGNUPS_WINDOW_SECONDS` | `3600` | The length of that window. |
| `LIMIT_WORKSPACES_PER_ACCOUNT` | — | How many workspaces one person may own. |
| `LIMIT_BOARDS_PER_ACCOUNT` | — | How many canvases across the workspaces one person owns. |
| `LIMIT_STORAGE_MB_PER_ACCOUNT` | — | Megabytes of canvases and images across the workspaces one person owns. |

## Rate limiting

| Variable | Default | What it does |
| :--- | :---: | :--- |
| `RATE_LIMIT_ENABLED` | `true` | Set to `false` to turn request limits off, for example in automated tests. With it on, sign-in is also limited to 3 attempts per 10 seconds from one address. |
| `RATE_LIMIT_TTL` | `60` | The window, in seconds. |
| `RATE_LIMIT_LIMIT` | `100` | How many requests one address may make in the window. |

## About the operator and analytics

| Variable | Default | What it does |
| :--- | :---: | :--- |
| `OPERATOR_NAME` | — | Who runs this instance. Shown on the Privacy and Terms pages. |
| `OPERATOR_CONTACT` | — | An email address or a web address people can use to reach the operator. |
| `UMAMI_WEBSITE_ID` | — | Turns on page-view analytics with an Umami site. Off when empty. See the Privacy page and Umami's own documentation. |
| `UMAMI_HOST_URL` | — | The address of the Umami server to send page views to. Set it together with the website ID. |

## Compose-only

`BIND_ADDRESS` (default `127.0.0.1`) and `PORT` in `docker-compose.prod.yml` decide which address and port the container is published on. They are read by Docker, not by the app. See [Run with Docker Compose](/docs/run-with-docker-compose).
