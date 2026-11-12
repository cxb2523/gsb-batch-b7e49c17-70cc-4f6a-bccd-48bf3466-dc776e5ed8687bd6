#!/usr/bin/env bash
#
# One-time bootstrap for the @wreq-js/binding-* platform packages.
#
# npm cannot configure a trusted publisher for a package that does not exist
# yet ("Package must exist" — https://docs.npmjs.com/cli/v12/commands/npm-trust),
# so the release workflow's OIDC publish has nothing to authenticate against
# until each name has been claimed once. This script claims all eight names
# with an empty 0.0.0 placeholder and then points them at the release workflow.
#
# Run it once, locally, from a logged-in npm account with 2FA enabled. Every
# release after that is handled entirely by .github/workflows/build.yml.
#
# Usage: scripts/bootstrap-platform-packages.sh [--dry-run]

set -euo pipefail

REPO="sqdshguy/wreq-js"
WORKFLOW="build.yml"
PLACEHOLDER_VERSION="0.0.0"

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
fi

cd "$(dirname "$0")/.."

if [[ ! -d npm ]]; then
  echo "npm/ not found. Run 'npm run npm:dirs' first." >&2
  exit 1
fi

# npm 11 advertises --allow-publish in `npm trust github --help` but never
# defines the flag, so it fails to parse; and since May 2026 the registry
# requires a trusted publisher to name at least one allowed action, which
# npm 11 cannot send. Fail early rather than half-way through the loop.
npm_major=$(npm --version | cut -d. -f1)
if [[ -z "$DRY_RUN" && "$npm_major" -lt 12 ]]; then
  echo "npm $(npm --version) cannot configure trusted publishing (needs 11.15+ with a" >&2
  echo "working --allow-publish, i.e. npm 12 or later)." >&2
  echo "Upgrade with: npm install -g npm@latest" >&2
  exit 1
fi

echo "Bootstrapping platform packages for $REPO (workflow: $WORKFLOW)"
echo "npm user: $(npm whoami)"
echo

for dir in npm/*/; do
  name=$(node -p "require('./${dir}package.json').name")
  echo "==> $name"

  if npm view "$name" version >/dev/null 2>&1; then
    # A name that exists was claimed by an earlier run of this script, which
    # configured its trusted publisher in the same pass. There is no cheap way
    # to re-verify that: `npm trust list` needs an OTP, and `npm trust github`
    # on an already-configured package burns an interactive browser auth only
    # to fail with 409 "trusted publisher config already exists". So leave
    # existing names alone; this script is for claiming new ones.
    #
    # If a name was ever published by hand rather than by this script, it may
    # be missing its trusted publisher. Fix that one with:
    #   npm trust github <name> --file build.yml --repo sqdshguy/wreq-js \
    #     --allow-publish --yes
    echo "    already on the registry, leaving it alone"
    continue
  fi

  # Publish from a copy so the working tree keeps the real version.
  staging=$(mktemp -d)
  cp "${dir}package.json" "$staging/"
  if [[ -f "${dir}README.md" ]]; then
    cp "${dir}README.md" "$staging/"
  fi
  (cd "$staging" && npm pkg set version="$PLACEHOLDER_VERSION" >/dev/null)

  # The guard above reads the registry through npm, which can lag a publish by
  # minutes on a cold CDN edge. A second run started inside that window sees the
  # name as missing, tries to claim it again, and npm answers
  #
  #   npm error 403 You cannot publish over the previously published versions: 0.0.0.
  #
  # which under `set -e` kills the run before any remaining name is reached.
  # Re-ask the registry instead: a name that is there now was claimed by the run
  # that raced us, and the publish below is the only thing that needed doing.
  # Deliberately not captured, so npm keeps its TTY.
  if ! npm publish "$staging" --access public $DRY_RUN; then
    if npm view "$name" version --prefer-online >/dev/null 2>&1; then
      echo "    already claimed by an earlier run, continuing"
      rm -rf "$staging"
      continue
    fi
    rm -rf "$staging"
    exit 1
  fi

  rm -rf "$staging"
  echo "    claimed at $PLACEHOLDER_VERSION"

  if [[ -z "$DRY_RUN" ]]; then
    # Deliberately not captured or piped. npm needs a TTY to run its browser
    # auth flow; behind a pipe it cannot prompt and fails with EOTP instead.
    npm trust github "$name" \
      --file "$WORKFLOW" \
      --repo "$REPO" \
      --allow-publish \
      --yes
    echo "    trusted publisher configured"
  fi

  # npm rate-limits back-to-back trust calls; the 2FA skip window covers these.
  sleep 2
done

echo
echo "Done. Verify on the web (npm trust list needs an OTP):"
echo "  https://www.npmjs.com/package/@wreq-js/binding-win32-arm64-msvc/access"
