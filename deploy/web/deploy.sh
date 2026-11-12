#!/usr/bin/env bash
# The ONLY command the GitHub Actions deploy key may run (authorized_keys "command=" on the server).
# The workflow sends the image tag as the ssh command and a short-lived GitHub token on stdin:
#   printf '%s\n' "$GITHUB_TOKEN" | ssh deploy-host "<tag>"
# Pulls that image, restarts the web container, and rolls back to the previous tag if the new one
# never becomes healthy and reachable through Cloudflare.
set -euo pipefail
umask 077
cd "$(dirname "$0")"
# A dropped ssh connection must not leave a half-finished deploy behind.
trap '' HUP PIPE

repo=ghcr.io/rishilahoti/ashby-job-scraper-web
tag="${SSH_ORIGINAL_COMMAND:-}"
[[ "$tag" =~ ^[A-Za-z0-9._-]{1,100}$ ]] || { echo "refusing: bad image tag" >&2; exit 2; }
IFS= read -r token
# set_tag rewrites .env, so refuse to touch one that has lost the tunnel token.
grep -q '^TUNNEL_TOKEN=.' .env || { echo "refusing: .env has no TUNNEL_TOKEN" >&2; exit 2; }

# One deploy at a time: a second run's logout would pull the first one's credentials mid-pull.
exec 9>.deploy.lock
flock -n 9 || { echo "refusing: another deploy is running" >&2; exit 3; }

printf '%s\n' "$token" | docker login ghcr.io -u rishilahoti --password-stdin >/dev/null
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

previous="$(grep -E '^WEB_TAG=' .env | cut -d= -f2- || true)"
set_tag() { grep -v '^WEB_TAG=' .env > .env.tmp || true; printf 'WEB_TAG=%s\n' "$1" >> .env.tmp; mv .env.tmp .env; }

# Pull before touching .env: a failed pull then leaves the running tag recorded.
WEB_TAG="$tag" docker compose pull web
set_tag "$tag"
# Compose itself fails when the web container is unhealthy; the check below decides what to do.
docker compose up -d --remove-orphans || echo "compose up reported a problem, checking health" >&2

# Healthy is not enough: a failed `compose up` can leave the old container running (and healthy), and
# loopback can answer while Cloudflare can't reach the container. /api/health is never cached.
live() {
  [ "$(docker inspect --format '{{.State.Health.Status}} {{.Config.Image}}' ashby-web-web-1 2>/dev/null)" = "healthy $repo:$1" ] \
    && curl -fsS --max-time 10 -o /dev/null https://jobs.whatrunsindia.com/api/health
}
wait_live() { for _ in $(seq 1 30); do live "$1" && return 0; sleep 5; done; return 1; }

if wait_live "$tag"; then
  # Keep this tag and the previous one (the rollback target); drop older ones of this image only.
  docker images --format '{{.Tag}}' "$repo" | grep -vxF -e "$tag" -e "${previous:-none}" \
    | xargs -r -I{} docker rmi "$repo:{}" >/dev/null 2>&1 || true
  echo "deployed $tag"
  exit 0
fi

echo "new image never became healthy and reachable; going back to '${previous:-none}'" >&2
docker compose logs --tail 40 web >&2 || true
[ -n "$previous" ] || exit 1
set_tag "$previous"
docker compose up -d --remove-orphans || true
if wait_live "$previous"; then
  echo "rolled back to $previous" >&2
else
  echo "ROLLBACK FAILED: $previous is not healthy and reachable either, the site needs a look" >&2
fi
exit 1
