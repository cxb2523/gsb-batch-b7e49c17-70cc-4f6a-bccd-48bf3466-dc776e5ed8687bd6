# Backups and restore

An instance has two stores: the **database** (PostgreSQL) and the **bucket** (object storage). A backup needs both, taken at about the same time. A database without its bucket has canvases that point at nothing; a bucket without its database cannot be opened.

> [!WARNING]
> The database holds every person's wrapped keys, and those keys are what open the canvases in the bucket. A backup is as sensitive as the instance itself: keep it somewhere only you can reach, and do not share it. And a backup does not replace anyone's passphrase: if a person has lost theirs, no backup brings their canvases back.

## Back up

**The database.** Take a dump in PostgreSQL's custom format:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U postgres -Fc canvhq > canvhq-$(date +%F).dump
```

Use the user and database name from your `.env` if they are not the defaults.

**The bucket.** Copy it with your storage service's own tools, or a general tool such as `rclone`, to a second bucket or to a disk. Many services can also keep old versions of objects; look for that setting in your provider's documentation.

Do both from a schedule, and keep several generations, not only the last one.

CanvHQ also saves a database dump every time the container starts, before it applies migrations, into `/app/backups` inside the container (or the folder named by the `BACKUP_DIR` variable). That is a safety net for upgrades, not a backup: it lives on the container's disk, and one file is written per start, so they pile up. To keep them, mount a volume there (for example `- canvhq_backups:/app/backups` under the `app` service) and delete old ones yourself.

These start-up dumps are plain SQL files, not the custom format above, so restore them with `psql` instead of `pg_restore`:

```bash
docker compose -f docker-compose.prod.yml exec -T db psql -U postgres -d canvhq < canvhq_backup_20260101_120000.sql
```

Restore into an empty database.

## Restore

1. Stop the app: `docker compose -f docker-compose.prod.yml stop app`.
2. Make sure the database you restore into is the one the app will use. For a fresh machine, start only the database first: `docker compose -f docker-compose.prod.yml up -d db`.
3. Restore the dump:

   ```bash
   docker compose -f docker-compose.prod.yml exec -T db \
     pg_restore -U postgres -d canvhq --clean --if-exists --no-owner < canvhq-2026-01-01.dump
   ```

   `--clean --if-exists` replaces what is there. Use an empty database if you are unsure.
4. Put the bucket back from the copy that matches the dump.
5. Start the app: `docker compose -f docker-compose.prod.yml up -d`. It checks the database, applies any migrations it is missing and starts.
6. Sign in and open a canvas that has an image. If it opens, the database and the bucket agree.

Try a restore on a spare machine before you need one.

## Demo instances

`scripts/demo-wipe.mjs` deletes the database tables and every object in the bucket on purpose. Never point it at an instance you want to keep. See [Going public](/docs/going-public).
