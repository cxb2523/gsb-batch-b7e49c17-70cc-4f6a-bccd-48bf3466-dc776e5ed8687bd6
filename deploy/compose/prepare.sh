#!/bin/sh
# Runs once before the services start (the `prepare` service): makes sure the
# project exists, and does what `dagster dev` does on a laptop before loading it.
set -eu

: "${PROJECT_DIR:?PROJECT_DIR is not set}"

if [ ! -f "$PROJECT_DIR/dbt_project.yml" ]; then
    if [ "${FALCON_DEMO:-0}" = "1" ]; then
        # Docker creates the other services' working directory, empty, before
        # this runs; `datavloot demo` refuses a directory that exists.
        rmdir "$PROJECT_DIR" 2>/dev/null || true
        datavloot demo "$PROJECT_DIR"
    else
        echo "No dbt project at $PROJECT_DIR. Put the project there, or set FALCON_DEMO=1 for the NOAA demo." >&2
        exit 1
    fi
fi

cd "$PROJECT_DIR"

# The apps service serves apps/; a project without apps has an empty one.
mkdir -p apps

# The project's instance settings (the lake pool, see dagster.yaml) only apply
# from DAGSTER_HOME.
cp dagster.yaml "$DAGSTER_HOME/dagster.yaml"

# Create Dagster's SQLite storage here, in one process, before the webserver, the
# daemon and the code server start. On an empty DAGSTER_HOME they would each
# create it at the same moment and stamp its schema version twice, and the next
# process to start then fails with "alembic_version has more than one head" (#45).
# On an existing instance this does nothing, or migrates it after a Dagster upgrade.
dagster instance migrate

# Dagster loads the dbt assets from target/manifest.json; outside `dagster dev`
# nothing builds it on the fly.
dbt deps
dbt parse --target prod
