#!/bin/sh
set -e

# If a custom command is provided, execute it directly
if [ $# -gt 0 ]; then
  exec "$@"
fi

echo "🚀 [CanvHQ] Starting CanvHQ unified container..."

# Validate environment before database connections or migrations
node dist/config/validate-env.js

# Run automated database backup and migrations if DATABASE_URL is configured
if [ -n "$DATABASE_URL" ]; then
  max_retries=15
  count=0

  # Strip Prisma-specific query parameter (?schema=... / &schema=...) which libpq tools (pg_isready, pg_dump) reject
  PG_CONN_URL=$(echo "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*(&|$)/\1/; s/[?&]$//')

  echo "⏳ [CanvHQ] Checking database availability..."
  until pg_isready -d "$PG_CONN_URL" > /dev/null 2>&1 || [ $count -ge $max_retries ]; do
    echo "⏳ [CanvHQ] Database not ready yet. Retrying in 2 seconds ($count/$max_retries)..."
    sleep 2
    count=$((count + 1))
  done

  if [ $count -ge $max_retries ]; then
    echo "❌ [CanvHQ] Failed to connect to database after $max_retries attempts."
    exit 1
  fi
  echo "✅ [CanvHQ] Database is reachable."

  BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
  mkdir -p "$BACKUP_DIR"
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  BACKUP_FILE="${BACKUP_DIR}/canvhq_backup_${TIMESTAMP}.sql"

  echo "📦 [CanvHQ] Creating pre-migration database backup at $BACKUP_FILE..."
  if ! (umask 077 && pg_dump "$PG_CONN_URL" -f "$BACKUP_FILE"); then
    echo "❌ [CanvHQ] Database backup failed. Aborting boot to protect data integrity."
    exit 1
  fi
  chmod 600 "$BACKUP_FILE"
  echo "✅ [CanvHQ] Pre-migration backup created successfully ($BACKUP_FILE)."

  echo "🔄 [CanvHQ] Applying database migrations with Prisma..."
  if ! pnpm exec prisma migrate deploy; then
    echo "❌ [CanvHQ] Prisma migration failed. Aborting boot."
    exit 1
  fi
  echo "✅ [CanvHQ] Database migrations applied successfully."
fi

echo "✨ [CanvHQ] Launching unified application server on port ${PORT:-3000}..."
exec node dist/main.js
