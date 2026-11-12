# Deploying on Coolify

Coolify can run CanvHQ from a Docker Compose file. This page has that file, the settings you have to fill in and the ones you can leave alone. For how Coolify itself works, use its own documentation: this page only covers what is specific to CanvHQ.

## What you need first

- A Coolify server with a domain you can point at it.
- S3-compatible object storage and a key for it. See [Storage](/docs/storage).
- A Google sign-in client. See [Sign in with Google](/docs/sign-in-providers).

## Steps

1. In Coolify, add a resource and choose **Docker Compose Empty**.
2. Paste the compose file below.
3. Open the `canvhq` service and set its **domain** to the address people will use, with `https://`, for example `https://canvas.example.org`. CanvHQ listens on port 3000 and the file already tells Coolify that.
4. Open the **Environment Variables** tab and fill in the settings under "Must be set" below. The deploy stops until they are filled in.
5. Deploy, then open `https://your-address/api/health`. It answers when the app, the database and the storage are all up.

## The compose file

```yaml
# CanvHQ for Coolify (Add Resource -> Docker Compose Empty), paste this file in.
#
# Coolify reads three things from this file:
#   - SERVICE_URL_CANVHQ_3000   gives the app a domain and points its proxy at port 3000.
#                               The address (with https://) is then available as ${SERVICE_URL_CANVHQ}.
#   - SERVICE_PASSWORD_*        a generated secret, kept stable between deploys.
#   - ${NAME:-default}          shows NAME in the Environment Variables tab with that default.
#     ${NAME:?}                 shows NAME as required: the deploy stops until you fill it in.
#
# Ports, container names and networks are left out on purpose: Coolify manages them.
services:
  canvhq:
    image: ghcr.io/qaribhaider/canvhq:${CANVHQ_IMAGE_TAG:-latest}
    restart: unless-stopped
    environment:
      - SERVICE_URL_CANVHQ_3000
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=postgresql://${SERVICE_USER_POSTGRES}:${SERVICE_PASSWORD_POSTGRES}@db:5432/${POSTGRES_DB:-canvhq}?schema=public

      # Signing secret (64 generated characters; the app needs at least 32)
      - AUTH_SECRET=${SERVICE_PASSWORD_64_AUTH}
      # Both must be a full address with https://. Set your domain on the canvhq service in Coolify.
      - AUTH_URL=${SERVICE_URL_CANVHQ}
      - FRONTEND_URL=${SERVICE_URL_CANVHQ}
      # Coolify's proxy is one hop in front of the app
      - TRUST_PROXY=${TRUST_PROXY:-1}
      - ENABLE_DEV_LOGIN=false

      # Sign in with Google
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:?}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:?}

      # Object storage: any S3-compatible service
      - S3_ENDPOINT=${S3_ENDPOINT:?}
      - S3_BUCKET_NAME=${S3_BUCKET_NAME:-canvhq-boards}
      - S3_ACCESS_KEY_ID=${S3_ACCESS_KEY_ID:?}
      - S3_SECRET_ACCESS_KEY=${S3_SECRET_ACCESS_KEY:?}
      - S3_REGION=${S3_REGION:-us-east-1}
      - S3_FORCE_PATH_STYLE=${S3_FORCE_PATH_STYLE:-true}

      # Who may sign up, and what the Privacy and Terms pages show
      - ALLOW_SIGNUPS=${ALLOW_SIGNUPS:-true}
      - FIRST_ACCOUNT_EMAIL=${FIRST_ACCOUNT_EMAIL:-}
      - OPERATOR_NAME=${OPERATOR_NAME:-}
      - OPERATOR_CONTACT=${OPERATOR_CONTACT:-}

      # Optional limits per account (empty means no limit)
      - LIMIT_SIGNUPS_PER_IP=${LIMIT_SIGNUPS_PER_IP:-}
      - LIMIT_SIGNUPS_WINDOW_SECONDS=${LIMIT_SIGNUPS_WINDOW_SECONDS:-}
      - LIMIT_WORKSPACES_PER_ACCOUNT=${LIMIT_WORKSPACES_PER_ACCOUNT:-}
      - LIMIT_BOARDS_PER_ACCOUNT=${LIMIT_BOARDS_PER_ACCOUNT:-}
      - LIMIT_STORAGE_MB_PER_ACCOUNT=${LIMIT_STORAGE_MB_PER_ACCOUNT:-}

      # Optional Umami analytics
      - UMAMI_WEBSITE_ID=${UMAMI_WEBSITE_ID:-}
      - UMAMI_HOST_URL=${UMAMI_HOST_URL:-}
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 30s

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${SERVICE_USER_POSTGRES}
      - POSTGRES_PASSWORD=${SERVICE_PASSWORD_POSTGRES}
      - POSTGRES_DB=${POSTGRES_DB:-canvhq}
    volumes:
      - canvhq-pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 5s

volumes:
  canvhq-pg-data:
```

## Must be set

| Variable | What to put |
| :--- | :--- |
| Domain of the `canvhq` service | The public address with `https://`. CanvHQ uses it for `AUTH_URL` and `FRONTEND_URL`, and both need a full address, not just a host name. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From your Google OAuth client. Its callback address is your domain followed by `/api/auth/callback/google`. |
| `S3_ENDPOINT` | The address of your object storage, with `https://` and no trailing slash. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | A key that can list, read, write and delete objects in the bucket. |

Coolify fills in the rest for you: the database user and password, and a 64-character `AUTH_SECRET` that stays the same between deploys. Keep that secret. If it changes, everyone is signed out.

## Good to know

- `S3_BUCKET_NAME` defaults to `canvhq-boards`. If the bucket does not exist, CanvHQ tries to create it on start, which needs a key that is allowed to. Otherwise create it yourself first.
- `S3_REGION` and `S3_FORCE_PATH_STYLE` suit most self-hosted storage. Change them only if your provider says so. See [Storage](/docs/storage).
- `TRUST_PROXY` is `1` because Coolify's proxy is the one hop in front of the app. See [Going public](/docs/going-public).
- `CANVHQ_IMAGE_TAG` defaults to `latest`. Set it to a version such as `0.1.1` to stay on that version until you change it. Read [Upgrading](/docs/upgrading) before you move to a new one.

## Optional settings

All of these can be left empty.

| Variable | What it does |
| :--- | :--- |
| `ALLOW_SIGNUPS` | `false` means only people with an invitation can create an account. |
| `FIRST_ACCOUNT_EMAIL` | While there are no accounts, only this verified address can register. Use it with `ALLOW_SIGNUPS=false` for a private instance. |
| `OPERATOR_NAME`, `OPERATOR_CONTACT` | Who runs this instance, shown on the Privacy and Terms pages. |
| `LIMIT_SIGNUPS_PER_IP`, `LIMIT_SIGNUPS_WINDOW_SECONDS` | How many accounts one address may create in a window (an hour by default). |
| `LIMIT_WORKSPACES_PER_ACCOUNT`, `LIMIT_BOARDS_PER_ACCOUNT`, `LIMIT_STORAGE_MB_PER_ACCOUNT` | What one person may own. Counted against the Owner of a workspace. |
| `UMAMI_WEBSITE_ID`, `UMAMI_HOST_URL` | Page-view analytics. Set them together. |

[Going public](/docs/going-public) explains the limits and the sign-up settings in more detail, and [Environment variables](/docs/environment-variables) lists every setting.

## Backups

Back up the database and the bucket together: canvases and images live in the bucket, and the database alone cannot open them. See [Backups and restore](/docs/backups-and-restore).
