# Run with Docker Compose

This starts CanvHQ and its database on one machine. The app and the web pages come from one container, on one port.

You need Docker with Compose, a place to keep files, S3-compatible object storage (see [Storage](/docs/storage)) and a Google sign-in client (see [Sign in with Google](/docs/sign-in-providers)).

## Steps

1. Get the code: `git clone` the repository and open its folder.
2. Create a file called `.env` next to `docker-compose.prod.yml`. Start from `.env.example` and set at least `AUTH_SECRET`, `AUTH_URL`, `FRONTEND_URL`, `POSTGRES_PASSWORD` (the compose file has a placeholder default, so choose your own), the `S3_*` values and `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
3. Make a secret for `AUTH_SECRET`: `openssl rand -base64 48`.
4. Start it: `docker compose -f docker-compose.prod.yml up -d`.
5. Open the address you set in `AUTH_URL`, sign in, and set your passphrase.

The first account you create becomes the Owner of its own workspace. CanvHQ has no separate instance administrator.

## What to know

- **The container only listens on `127.0.0.1`.** That is on purpose: put a reverse proxy with TLS in front of it (see [Deploying on a server](/docs/deploying-on-a-server)). Set `BIND_ADDRESS=0.0.0.0` only if you really want to reach the container directly from other machines.
- **Behind a proxy, set `TRUST_PROXY=1`.** Otherwise every visitor looks like the proxy's address to the app's limits. See [Going public](/docs/going-public).
- **Your data lives in two places:** the `canvhq_pg_data` volume (PostgreSQL) and your bucket. Back up both. See [Backups and restore](/docs/backups-and-restore).
- **Updates run migrations on start**, after saving a database dump. See [Upgrading](/docs/upgrading).

## The compose file

This is `docker-compose.prod.yml` from the repository.

```yaml
name: canvhq-prod

services:
  db:
    image: postgres:16-alpine
    container_name: canvhq-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgrespassword}
      POSTGRES_DB: ${POSTGRES_DB:-canvhq}
    volumes:
      - canvhq_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-canvhq}"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 5s
    networks:
      - canvhq-network

  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: ghcr.io/qaribhaider/canvhq:latest
    container_name: canvhq-app
    restart: unless-stopped
    ports:
      - "${BIND_ADDRESS:-127.0.0.1}:${PORT:-3000}:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgrespassword}@db:5432/${POSTGRES_DB:-canvhq}?schema=public
      
      # Core Auth
      AUTH_SECRET: ${AUTH_SECRET}
      AUTH_URL: ${AUTH_URL:-http://localhost:3000}
      FRONTEND_URL: ${FRONTEND_URL:-http://localhost:3000}
      ENABLE_DEV_LOGIN: "${ENABLE_DEV_LOGIN:-false}"

      # Who may sign up, and what runs in front of the app
      ALLOW_SIGNUPS: "${ALLOW_SIGNUPS:-true}"
      FIRST_ACCOUNT_EMAIL: ${FIRST_ACCOUNT_EMAIL:-}
      TRUST_PROXY: "${TRUST_PROXY:-false}"
      DEMO_MODE: "${DEMO_MODE:-false}"

      # Shown on the Privacy and Terms pages
      OPERATOR_NAME: ${OPERATOR_NAME:-}
      OPERATOR_CONTACT: ${OPERATOR_CONTACT:-}

      # Optional limits per account (empty means no limit)
      LIMIT_SIGNUPS_PER_IP: ${LIMIT_SIGNUPS_PER_IP:-}
      LIMIT_SIGNUPS_WINDOW_SECONDS: ${LIMIT_SIGNUPS_WINDOW_SECONDS:-}
      LIMIT_WORKSPACES_PER_ACCOUNT: ${LIMIT_WORKSPACES_PER_ACCOUNT:-}
      LIMIT_BOARDS_PER_ACCOUNT: ${LIMIT_BOARDS_PER_ACCOUNT:-}
      LIMIT_STORAGE_MB_PER_ACCOUNT: ${LIMIT_STORAGE_MB_PER_ACCOUNT:-}

      # Object storage: any S3-compatible service
      S3_BUCKET_NAME: ${S3_BUCKET_NAME}
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
      S3_ENDPOINT: ${S3_ENDPOINT:-}
      S3_REGION: ${S3_REGION:-auto}
      S3_FORCE_PATH_STYLE: "${S3_FORCE_PATH_STYLE:-true}"

      # Sign-in with Google
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}

      # Optional Umami Analytics
      UMAMI_WEBSITE_ID: ${UMAMI_WEBSITE_ID:-}
      UMAMI_HOST_URL: ${UMAMI_HOST_URL:-}
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 15s
    networks:
      - canvhq-network

volumes:
  canvhq_pg_data:
    name: canvhq_pg_data

networks:
  canvhq-network:
    name: canvhq-network
    driver: bridge
```
