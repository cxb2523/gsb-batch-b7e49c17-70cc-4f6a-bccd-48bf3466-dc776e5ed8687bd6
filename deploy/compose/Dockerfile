# One image for every Falcon service: Dagster (webserver and daemon), the
# Crows Nest and Marimo. Built from this checkout, with the versions in uv.lock,
# so the VM runs exactly what CI tested. Build context: the repository root.

FROM python:3.12-slim

# git: dbt deps fetches the optimist dbt package from a git repository.
# tini: forwards signals, so `docker compose stop` stops Dagster cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git tini \
 && rm -rf /var/lib/apt/lists/*

# 0.13.4 or later: older uv trusts the compromised eMudhra emSign CAs when it
# downloads the packages below.
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /usr/local/bin/uv

# The same uid and gid as the owner of the project directory on the host, so the
# services can write to it and files they create stay the owner's (see .env).
ARG FALCON_UID=1000
ARG FALCON_GID=1000
RUN groupadd --gid "$FALCON_GID" falcon \
 && useradd --create-home --uid "$FALCON_UID" --gid "$FALCON_GID" falcon

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1

WORKDIR /src
COPY pyproject.toml uv.lock README.md LICENSE ./
COPY datavloot_platform ./datavloot_platform
RUN uv sync --locked --extra optimist --no-dev --no-editable \
 && rm -rf /root/.cache

COPY deploy/compose/prepare.sh /usr/local/bin/falcon-prepare
RUN chmod 0755 /usr/local/bin/falcon-prepare \
 && install -d -o falcon -g falcon /dagster_home /srv/falcon

USER falcon

# DuckDB downloads extensions on first use; do it now, so a running service
# never stalls on a download (see datavloot_platform/extensions.py).
RUN python -c "import duckdb; from datavloot_platform import extensions; \
failures = extensions.install(duckdb.connect()); assert not failures, failures"

ENV DAGSTER_HOME=/dagster_home
WORKDIR /srv/falcon

ENTRYPOINT ["tini", "--"]
