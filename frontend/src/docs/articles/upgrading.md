# Upgrading

1. **Back up** the database and the bucket ([Backups and restore](/docs/backups-and-restore)).
2. Read the release notes for anything marked as a change to settings.
3. Pull the new image (or rebuild) and start it: `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`. Published images are tagged with the release version and the commit; the `latest` tag exists only once a release has been published, so until then build the image from the repository instead (`docker compose -f docker-compose.prod.yml up -d --build`).

On start the container saves a database dump, then applies the migrations it is missing, then launches the app. If the dump or a migration fails, it stops instead of starting on a half-changed database.

## Things to know

- **A newer database server than the container's tools.** The image carries the PostgreSQL 16 client. `pg_dump` refuses to dump a server with a newer major version, and the container then stops at start. Use PostgreSQL 16, or build an image with a newer client.
- **A database that was not created by migrations.** If a database was filled by another tool (for example `prisma db push`), `migrate deploy` stops with error P3005. Start from an empty database and restore a dump instead. Never use `db push` or `--accept-data-loss` on a real instance.
- **Before launch, the saved format changed.** Canvases saved by early development builds cannot be opened by newer ones. A released version will say so in its notes if that ever happens again.
- **Settings.** An instance behind a proxy needs `TRUST_PROXY=1`, and an instance that must be reached directly needs `BIND_ADDRESS=0.0.0.0`. See [Going public](/docs/going-public).
- **After a member is removed.** The canvases they could open are saved again under a new key, by an administrator's browser, when an administrator opens the workspace page. A removal is not finished until that has happened. See [Keys and roles](/docs/keys-and-roles).

## For developers

Local Node installs that ship corepack 0.34 cannot start pnpm 12. Use a newer corepack or install pnpm another way, and do not run `corepack enable` there.
