# Optimist architecture (single node)

> **Status: proposed.** This describes the target architecture, not the current implementation: scaffolded projects currently write to a single DuckDB file, without a DuckLake catalog or maintenance jobs. The decision is recorded in an ADR (to be added).

The Optimist is the single-node vessel, aimed at an organisation with a data team of one: technically multi-client, organisationally single-writer. Everything lives on one host; the full state is one directory. The next vessel, the Valk, runs the same project on an SRDP stack (see `docs/valk.md`, not yet merged); the Optimist's VM mode deliberately uses the same building blocks so that moving up is adding services, not rebuilding.

## 1. Component overview

```mermaid
flowchart LR
    subgraph SRC["External sources"]
        S_API["APIs"]
        S_DB[("Databases")]
        S_FILES["Files"]
    end

    subgraph HOST["Single host: laptop or VM"]
        subgraph ORCH["Dagster (only production writer)"]
            DLT["dlt: ingest"]
            DBT["dbt: transform + test, Elementary: data quality"]
            MAINT["Maintenance: compaction, snapshot expiry"]
        end

        subgraph LAKE["DuckLake (one directory)"]
            CAT[("Catalog: metadata.sqlite")]
            PQ["Parquet files in DATA_PATH"]
        end

        DEV["dbt dev target (separate schema)"]
        MARIMO["Marimo (read-only)"]
        CROWSNEST["Crows Nest: dashboard + query API (read-only)"]
    end

    USERS["Organisation: consumers"]

    S_API --> DLT
    S_DB --> DLT
    S_FILES --> DLT
    DLT --> LAKE
    DBT --> LAKE
    MAINT --> LAKE
    DEV -.-> LAKE
    LAKE --> MARIMO
    LAKE --> CROWSNEST
    MARIMO --> USERS
    CROWSNEST --> USERS
```

## 2. How a write works

The heavy work (writing Parquet) happens outside the catalog. The catalog lock is held only for the short metadata commit, which is why several local processes can write side by side.

```mermaid
sequenceDiagram
    participant W as Writer (Dagster run)
    participant P as Parquet files (DATA_PATH)
    participant C as Catalog (SQLite)
    participant R as Reader (Marimo / Crows Nest)

    R->>C: Read current snapshot
    C-->>R: List of files for snapshot N
    R->>P: Read those files
    W->>P: Write new Parquet files (no lock)
    W->>C: Commit: register files as snapshot N+1 (short lock)
    alt Conflict on same table
        C-->>W: Conflict
        W->>C: Retry or report
    else No conflict
        C-->>W: Committed
    end
    Note over R: Keeps seeing snapshot N until it re-reads
```

## 3. Two ways of running, one artifact

```mermaid
flowchart TB
    PKG["PyPI package datavloot[optimist] (one codebase, one config schema)"]

    subgraph LAPTOP["Laptop mode"]
        L1["pip install datavloot[optimist]"]
        L2["datavloot start: Dagster + Crows Nest, plus Marimo"]
        L3["localhost only, no auth"]
    end

    subgraph VM["VM mode"]
        V1["Docker image built from the package"]
        V2["Docker Compose: Dagster, Crows Nest, Marimo"]
        V3["Traefik + optional oauth2-proxy"]
    end

    DIR["Same directory: catalog + Parquet (relative paths)"]

    PKG --> L1 --> L2 --> L3
    PKG --> V1 --> V2 --> V3
    L2 --- DIR
    V2 --- DIR
    DIR -. "move directory" .-> V2
```

## 4. Access on the VM

Access to the site, not access policy on data; per-user roles belong to the Valk. The Dagster UI and Marimo have no authentication of their own, so every service sits behind Traefik.

The setup mirrors the Valk: same Traefik static configuration (Docker provider, `exposedByDefault: false`, HTTP to HTTPS redirect, dashboard off), same hostnames (`crowsnest.`, `dagster.`, `marimo.<domain>`, plus `apps.<domain>` for the project's apps) and the same ForwardAuth middleware to oauth2-proxy. The difference is the identity provider: the customer's own IdP instead of Zitadel. Without an IdP, Traefik's built-in `basicAuth` middleware replaces oauth2-proxy. TLS comes from Let's Encrypt through Traefik's ACME resolver.

Open: the Crows Nest validates access tokens itself rather than trusting the proxy's headers. Pointing its OIDC mode at the customer's IdP, with `reader` as default role, is the likely route; it has not been tested against Entra ID or Google Workspace.

```mermaid
flowchart LR
    U["User in the organisation"] --> TR["Traefik (TLS, port 443)"]
    TR -- "ForwardAuth" --> OP["oauth2-proxy (optional)"]
    OP <--> IDP["Customer IdP: Entra ID / Google Workspace"]
    TR --> APPS["crowsnest. / dagster. / marimo.#lt;domain#gt;"]
    TR -. "fallback" .-> BA["Traefik basicAuth middleware, or VPN"]
```

## 5. Backup

Copy the catalog first, then the files. Parquet files are never modified after they are written, so every file the copied catalog refers to already exists; files written after the catalog copy are harmless extras. Cleanup of old files must not run during the backup, or it can delete a file the copied catalog still references. Writers can keep running.

```mermaid
flowchart LR
    JOB["Backup job (no cleanup of old files while it runs)"] --> CATCOPY["1. Catalog: SQLite backup API"]
    CATCOPY --> FILECOPY["2. Parquet files"]
    FILECOPY --> SNAP["Consistent copy of the directory"]
    SNAP --> LOCAL["Local backup"]
    SNAP -. "optional" .-> BUCKET["S3-compatible bucket (restic / rclone)"]
```

## 6. Upgrade path to the Valk

Set `vessel: valk` in `datavloot.yml`, move the catalog and the data; project code (dlt, dbt, Dagster assets) stays the same. The Valk is built as a client project on SRDP, which supplies Traefik, oauth2-proxy with Zitadel, and the Postgres that holds the DuckLake catalog.

```mermaid
flowchart LR
    subgraph OPT["Optimist"]
        O1[("SQLite catalog")]
        O2["Parquet on local disk"]
        O3["Traefik + oauth2-proxy, customer IdP"]
    end

    subgraph VALK["Valk (on SRDP)"]
        F1[("PostgreSQL catalog")]
        F2["Parquet on a volume or in S3-compatible storage"]
        F3["Traefik + oauth2-proxy, Zitadel with roles"]
    end

    O1 -- "migrate metadata" --> F1
    O2 -- "copy files, update data path" --> F2
    O3 -- "switch identity provider" --> F3
```

## Component summary

| Component | Optimist | Valk |
|---|---|---|
| Ingest | dlt | dlt |
| Catalog | DuckLake + SQLite | DuckLake + PostgreSQL |
| Data storage | Parquet on local disk | Parquet on a volume or in S3-compatible storage |
| Transform & test | dbt | dbt |
| Data quality | Elementary | Elementary |
| Orchestration | Dagster, concurrency limit on writing jobs | Dagster webserver, daemon and code server as separate containers |
| Writers | Multiple local processes, one production path | One project per stack, writes through Dagster |
| Dashboard | Crows Nest, read-only | Crows Nest, roles `reader` / `writer` / `admin` |
| Analysis | Marimo, read-only | Marimo (SRDP's service) |
| Reverse proxy | Traefik (VM mode only) | Traefik (from SRDP) |
| Access | oauth2-proxy with the customer's IdP, or Traefik basic auth | oauth2-proxy with Zitadel, per-user roles |
| Secrets | `.env` on the host | `.env` in `deploy/valk/` |
| Backup | Copy of the directory, optional off-site bucket | Not yet defined |
| Runtime | Laptop (pip) or single VM (Compose) | Docker Compose: SRDP stack plus the project's overlay |
