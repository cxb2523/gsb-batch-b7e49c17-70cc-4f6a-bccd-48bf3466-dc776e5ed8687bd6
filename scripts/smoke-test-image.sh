#!/usr/bin/env bash
# Boots a built CanvHQ image through its real entrypoint (environment check, database dump,
# migrations, server) against a throwaway PostgreSQL and S3-compatible store, in demo mode so it
# needs no sign-in provider. Exits non-zero if the app does not come up healthy or does not send
# its content security policy.
#
#   scripts/smoke-test-image.sh <image>          e.g. scripts/smoke-test-image.sh canvhq:test
set -euo pipefail

IMAGE="${1:?usage: smoke-test-image.sh <image>}"
SUFFIX="$$"
NETWORK="canvhq-smoke-${SUFFIX}"
APP_PORT="${SMOKE_PORT:-3199}"
WAIT_SECONDS=120

cleanup() {
  docker logs "canvhq-smoke-app-${SUFFIX}" 2>&1 | tail -40 || true
  docker rm -f "canvhq-smoke-app-${SUFFIX}" "canvhq-smoke-db-${SUFFIX}" "canvhq-smoke-s3-${SUFFIX}" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NETWORK" >/dev/null

docker run -d --name "canvhq-smoke-db-${SUFFIX}" --network "$NETWORK" --network-alias db \
  -e POSTGRES_PASSWORD=smoke -e POSTGRES_DB=canvhq postgres:16-alpine >/dev/null

docker run -d --name "canvhq-smoke-s3-${SUFFIX}" --network "$NETWORK" --network-alias storage \
  -e RUSTFS_ACCESS_KEY=smokekey -e RUSTFS_SECRET_KEY=smokesecret \
  -e RUSTFS_ADDRESS=0.0.0.0:9000 \
  rustfs/rustfs@sha256:9ca9559533b537d10482fe923288b676ad08f92a7069d9a17327fbae3cab688b >/dev/null

docker run -d --name "canvhq-smoke-app-${SUFFIX}" --network "$NETWORK" -p "127.0.0.1:${APP_PORT}:3000" \
  -e NODE_ENV=production -e PORT=3000 -e DEMO_MODE=true -e RATE_LIMIT_ENABLED=false \
  -e AUTH_SECRET=smoke-test-secret-smoke-test-secret-0123456789 \
  -e AUTH_URL="http://localhost:${APP_PORT}" -e FRONTEND_URL="http://localhost:${APP_PORT}" \
  -e DATABASE_URL='postgresql://postgres:smoke@db:5432/canvhq?schema=public' \
  -e S3_BUCKET_NAME=smoke -e S3_ACCESS_KEY_ID=smokekey -e S3_SECRET_ACCESS_KEY=smokesecret \
  -e S3_ENDPOINT=http://storage:9000 -e S3_FORCE_PATH_STYLE=true \
  "$IMAGE" >/dev/null

echo "Waiting up to ${WAIT_SECONDS}s for the app to answer on /api/health..."
for _ in $(seq 1 "$WAIT_SECONDS"); do
  if [ "$(docker inspect -f '{{.State.Running}}' "canvhq-smoke-app-${SUFFIX}")" != "true" ]; then
    echo "FAIL: the container stopped before it became healthy" >&2
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null || { echo "FAIL: /api/health never answered" >&2; exit 1; }

policy="$(curl -fsSI "http://127.0.0.1:${APP_PORT}/login" | tr -d '\r' | grep -i '^content-security-policy:' || true)"
case "$policy" in
  *"default-src 'self'"*) ;;
  *) echo "FAIL: the app did not send its content security policy" >&2; exit 1 ;;
esac

# The responses are read into variables first: `grep -q` closing a pipe early would make curl fail.
config="$(curl -fsS "http://127.0.0.1:${APP_PORT}/api/auth/config")"
case "$config" in
  *'"demoMode":true'*) ;;
  *) echo "FAIL: /api/auth/config does not report demo mode" >&2; exit 1 ;;
esac

licences="$(curl -fsS "http://127.0.0.1:${APP_PORT}/THIRD_PARTY_LICENSES.txt")"
case "$licences" in
  *"Third-party software"*) ;;
  *) echo "FAIL: THIRD_PARTY_LICENSES.txt is not served" >&2; exit 1 ;;
esac

echo "OK: the image booted through its entrypoint and passed its checks."
