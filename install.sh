#!/usr/bin/env bash
# Install Datavloot and open the Crows Nest on the NOAA demo, in one command:
#
#   curl -LsSf https://datavloot.nl/install.sh | bash
#
# No Python, git or admin rights needed. The script:
#   1. installs uv (https://docs.astral.sh/uv/) for the current user, if missing
#   2. creates the demo project in ~/optimist-demo with `datavloot demo`
#   3. gives it its own Python and packages (`uv sync`), and runs `dbt deps` and `dbt parse`
#   4. starts Dagster and the Crows Nest, opens http://localhost:8080 and, the
#      first time, starts the run that downloads the demo data and builds the models
#
# Running it again starts the existing project; it never overwrites one.
#
# Settings, as environment variables (`curl ... | DATAVLOOT_DIR=~/demo bash`):
#   DATAVLOOT_PROJECT  a project of your own instead of the demo: its GitHub or GitLab
#                      repository, e.g. https://gitlab.com/group/name (`datavloot new --from`)
#   DATAVLOOT_REF      with DATAVLOOT_PROJECT: the tag to install (default: the latest version)
#   DATAVLOOT_PATH     with DATAVLOOT_PROJECT: the project's folder in the repository,
#                      when it cannot be found by itself
#   DATAVLOOT_DIR      where the project goes (default: ~/optimist-demo, or
#                      ~/<repository name> with DATAVLOOT_PROJECT)
#   DATAVLOOT_VERSION  a toolkit version, e.g. 0.4.0 (default: the latest release)
#   DATAVLOOT_FROM     install the toolkit from here instead of PyPI, e.g. a checkout
#
# Written for the bash 3.2 that macOS ships.

set -euo pipefail

PYTHON_VERSION=3.12
DAGSTER_PORT=3000
CROWSNEST_PORT=8080

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mError: %s\033[0m\n' "$1" >&2; exit 1; }

run_step() {
    local what="$1"; shift
    step "$what"
    "$@" || fail "$what failed (exit code $?). The output above says why."
}

is_project() { [ -f "$1/dbt_project.yml" ] && [ -f "$1/pyproject.toml" ]; }

port_user() {
    # Who listens on the port; empty when it is free.
    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$1" -sTCP:LISTEN -Fc 2>/dev/null | sed -n 's/^c//p' | head -n 1
    elif (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then
        echo "another program"
    fi
}

main() {
    # With DATAVLOOT_PROJECT, a project of your own from its repository
    # (`datavloot new --from`) instead of the demo.
    local project="${DATAVLOOT_PROJECT:-}" default_name=optimist-demo
    if [ -n "$project" ]; then
        printf '\033[36mDatavloot: installing the toolkit and %s\033[0m\n' "$project"
        # The repository's name: https://gitlab.com/group/name(.git)(/-/tree/main)
        default_name="${project%%/-/*}"; default_name="${default_name%/}"
        default_name="${default_name%.git}"; default_name="${default_name##*/}"
    else
        printf '\033[36mDatavloot: installing the toolkit and the NOAA demo\033[0m\n'
    fi

    local dir="${DATAVLOOT_DIR:-$HOME/$default_name}"
    case "$dir" in "~"*) dir="$HOME${dir#\~}" ;; esac
    local existing=false
    if [ -e "$dir" ]; then
        if is_project "$dir"; then
            existing=true
        elif [ -d "$dir" ] && [ -z "$(ls -A "$dir")" ]; then
            rmdir "$dir"   # empty: `datavloot demo` wants to create it itself
        else
            fail "'$dir' already exists and is not a Datavloot project. Nothing in it was changed. Set DATAVLOOT_DIR to another folder and run this again."
        fi
    fi

    curl -fsSI --max-time 20 https://pypi.org/simple/datavloot/ >/dev/null 2>&1 \
        || fail "Cannot reach pypi.org. Check the internet connection. Behind a proxy, set HTTPS_PROXY (for example export HTTPS_PROXY=http://proxy:8080) and run this again."

    if ! command -v uv >/dev/null 2>&1; then
        if [ ! -x "$HOME/.local/bin/uv" ]; then
            # uv's own installer, for the current user: no admin rights.
            run_step "Installing uv" sh -c "curl -LsSf https://astral.sh/uv/install.sh | sh"
        fi
        export PATH="$HOME/.local/bin:$PATH"
        command -v uv >/dev/null 2>&1 \
            || fail "uv was installed but is not found in ~/.local/bin. Open a new terminal and run this again."
    fi
    echo "uv: $(uv --version)"

    if $existing; then
        printf '\nFound the project in %s; its files stay as they are.\n' "$dir"
    else
        local from
        if [ -n "${DATAVLOOT_FROM:-}" ]; then
            from="$DATAVLOOT_FROM"
        elif [ -n "${DATAVLOOT_VERSION:-}" ]; then
            from="datavloot[optimist]==$DATAVLOOT_VERSION"
        else
            from="datavloot[optimist]@latest"
        fi
        # DATAVLOOT_INSTALLER: `datavloot demo` and `new` leave out the steps this script takes itself.
        if [ -n "$project" ]; then
            # Fetches the latest tag (or DATAVLOOT_REF), asks for a token when the
            # repository is private and for the settings in .env.example, and runs
            # uv sync, dbt deps and dbt parse itself. Its questions read the
            # terminal: under curl | bash, this script's own stdin is the script.
            set -- --python "$PYTHON_VERSION" --from "$from" datavloot new "$dir" --from "$project"
            if [ -n "${DATAVLOOT_REF:-}" ]; then set -- "$@" --ref "$DATAVLOOT_REF"; fi
            if [ -n "${DATAVLOOT_PATH:-}" ]; then set -- "$@" --path "$DATAVLOOT_PATH"; fi
            step "Installing $project in $dir"
            env DATAVLOOT_INSTALLER=1 uvx "$@" </dev/tty \
                || fail "Installing $project failed (exit code $?). The output above says why."
        else
            run_step "Creating the demo project in $dir" \
                env DATAVLOOT_INSTALLER=1 uvx --python "$PYTHON_VERSION" --from "$from" datavloot demo "$dir"
        fi
    fi

    cd "$dir"
    # `new --from` has just done these steps. Otherwise they repair a project an
    # earlier attempt left halfway, and are quick when nothing is missing.
    if $existing || [ -z "$project" ]; then
        # An installed project gets exactly the versions its maintainer locked.
        local locked=""
        if [ -f uv.lock ] && [ -f .datavloot/install.json ]; then locked="--locked"; fi
        run_step "Installing Python $PYTHON_VERSION and the project's packages" \
            uv sync --python "$PYTHON_VERSION" $locked
        if [ ! -d dbt_packages ]; then
            run_step "Installing the dbt packages" uv run --no-sync dbt deps
        fi
        run_step "Compiling the dbt project" uv run --no-sync dbt parse
    fi

    local port name user
    for port in "$CROWSNEST_PORT" "$DAGSTER_PORT"; do
        if [ "$port" = "$CROWSNEST_PORT" ]; then name="the Crows Nest"; else name="Dagster"; fi
        user="$(port_user "$port")"
        if [ -n "$user" ]; then
            fail "Port $port, which $name needs, is in use by $user. If Datavloot is already running, open http://localhost:$CROWSNEST_PORT. Otherwise close that program and run this again."
        fi
    done

    step "Starting Dagster and the Crows Nest"
    echo "The Crows Nest opens at http://localhost:$CROWSNEST_PORT. Keep this terminal open;"
    echo "closing it or pressing Ctrl+C stops Datavloot. To start it again later:"
    # The project's own datavloot rather than `uv run`: a terminal opened before
    # uv was installed does not have uv on its PATH yet.
    printf '\033[33m    cd "%s" && .venv/bin/datavloot start\033[0m\n' "$dir"
    if [ "$(uname -s)" = "Darwin" ]; then
        echo "Or have it start at every login, with an app in ~/Applications:"
        printf '\033[33m    cd "%s" && .venv/bin/datavloot autostart on\033[0m\n' "$dir"
        echo "Or only the app, without starting at login:"
        printf '\033[33m    cd "%s" && .venv/bin/datavloot shortcut on\033[0m\n' "$dir"
    fi
    if ! $existing && [ -n "$project" ]; then
        # No run of its own: a project usually reads files that are not in its
        # repository, and a run before they are there only fails.
        echo "No run has started yet. First put the project's input files in place, usually in"
        printf '\033[33m    %s/data\033[0m\n' "$dir"
        echo "(its data folder says what goes there), then click Materialize all in the Crows Nest's"
        echo "Pipelines panel."
    elif ! $existing; then
        echo "The first run downloads the demo's AIS data (41 MB) and builds the models;"
        echo "follow it in the Crows Nest's Pipelines panel."
    fi
    echo
    # The demo fetches its own data, so it can run straight away.
    if $existing || [ -n "$project" ]; then
        exec uv run --no-sync datavloot start
    else
        exec uv run --no-sync datavloot start --run
    fi
}

# Everything is inside main, so a download cut off halfway runs nothing.
main "$@"
