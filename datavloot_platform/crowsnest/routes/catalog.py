"""
Catalog route — builds a data catalog from Elementary's warehouse tables.

Every table in the lakehouse that dbt knows of: its models, its seeds (the CSVs
in seeds/) and its sources (what the ingestion loads). A table from another dbt
package, such as Elementary's own, is metadata; the frontend folds those away.
"""

import json

from fastapi import APIRouter, HTTPException
import duckdb

from datavloot_platform import storage
from datavloot_platform.crowsnest.config import get_config
from datavloot_platform.crowsnest.db import get_conn

router = APIRouter()

# Where each kind of table is listed, and the column with its name in the lake.
_KINDS = (
    ("model", "dbt_models", "alias"),
    ("seed", "dbt_seeds", "alias"),
    ("source", "dbt_sources", "identifier"),
)


def _schema() -> str:
    return get_config().elementary_schema


def _records(df) -> list:
    """Convert a DataFrame to a JSON-safe list of dicts."""
    return json.loads(df.to_json(orient="records", date_format="iso", default_handler=str))


def _root_package() -> str | None:
    """The project's own dbt package; its tables are the business tables."""
    project = storage.find_project_dir()
    if project is None:
        return None
    try:
        return storage.project_name(project)
    except (OSError, ValueError):
        return None


def _is_metadata(package: str | None, root: str | None) -> bool:
    if root:
        return package != root
    return package == "elementary"


@router.get("/models")
def get_models(search: str | None = None):
    conn = None
    try:
        conn = get_conn(read_only=True)
        root = _root_package()
        models = []
        found_any = False
        for kind, table, name_column in _KINDS:
            try:
                df = conn.execute(
                    f"""
                    SELECT unique_id, {name_column} AS table_name, schema_name, database_name,
                           description, owner, tags, package_name, path
                    FROM {_schema()}.{table}
                    """
                ).fetchdf()
            except duckdb.CatalogException:
                continue  # an older Elementary without seeds or sources
            found_any = True
            for r in _records(df):
                models.append({
                    "unique_id": r.get("unique_id"),
                    "name": r.get("table_name"),
                    "kind": kind,
                    "schema": r.get("schema_name"),
                    "database": r.get("database_name"),
                    "description": r.get("description"),
                    "owner": r.get("owner"),
                    "tags": r.get("tags"),
                    "package": r.get("package_name"),
                    "path": r.get("path"),
                    "metadata": _is_metadata(r.get("package_name"), root),
                })
        if not found_any:
            return _fallback_models(conn, search)

        if search:
            needle = search.lower()
            models = [
                m for m in models
                if needle in (m["name"] or "").lower() or needle in (m["description"] or "").lower()
            ]
        models.sort(key=lambda m: (m["metadata"], m["schema"] or "", m["name"] or ""))
        business = sum(1 for m in models if not m["metadata"])
        return {"models": models, "total": len(models), "business_total": business}

    except HTTPException:
        return {"models": [], "total": 0, "error": "Database unavailable — another process may be using the DuckDB file"}
    except Exception:
        return {"models": [], "total": 0, "error": "Elementary catalog tables not found"}
    finally:
        if conn is not None:
            conn.close()


def _find_table(conn, name: str) -> dict | None:
    """A model, seed or source by its name in the lake, as Elementary lists it."""
    for kind, table, name_column in _KINDS:
        try:
            df = conn.execute(
                f"SELECT *, {name_column} AS table_name FROM {_schema()}.{table} "
                f"WHERE {name_column} = ? LIMIT 1",
                [name],
            ).fetchdf()
        except duckdb.CatalogException:
            continue
        if not df.empty:
            return {**_records(df)[0], "kind": kind}
    return None


@router.get("/models/{model_name}")
def get_model_detail(model_name: str):
    conn = None
    try:
        conn = get_conn(read_only=True)
        model_data = _find_table(conn, model_name)
        if model_data is None:
            raise HTTPException(404, f"Table '{model_name}' not found")

        # Build column list from information_schema (always complete + real warehouse types).
        is_columns: dict = {}
        try:
            is_df = conn.execute(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = ? AND table_name = ?
                ORDER BY ordinal_position
                """,
                [model_data.get("schema_name"), model_data.get("table_name")],
            ).fetchdf()
            for _, r in is_df.iterrows():
                is_columns[r["column_name"]] = {
                    "column_name": r["column_name"],
                    "data_type": r["data_type"],
                    "description": "",
                }
        except Exception:
            pass

        # Enrich with descriptions from dbt_columns where Elementary has them.
        if model_data.get("unique_id"):
            try:
                col_df = conn.execute(
                    f"SELECT * FROM {_schema()}.dbt_columns WHERE parent_unique_id = ?",
                    [model_data.get("unique_id")],
                ).fetchdf()
                for r in _records(col_df):
                    col_name = r.get("name") or r.get("column_name") or ""
                    if col_name:
                        if col_name in is_columns:
                            is_columns[col_name]["description"] = r.get("description") or ""
                        else:
                            is_columns[col_name] = {
                                "column_name": col_name,
                                "data_type": r.get("data_type") or "",
                                "description": r.get("description") or "",
                            }
            except Exception:
                pass

        column_list = sorted(is_columns.values(), key=lambda c: c["column_name"])

        try:
            test_df = conn.execute(
                f"""
                SELECT
                    test_name,
                    MIN(column_name) AS column_name,
                    COUNT(*) FILTER (WHERE status = 'pass') AS pass,
                    COUNT(*) FILTER (WHERE status = 'fail') AS fail,
                    COUNT(*) FILTER (WHERE status = 'warn') AS warn,
                    COUNT(*) FILTER (WHERE status = 'error') AS error,
                    MAX(detected_at) AS last_run
                FROM {_schema()}.elementary_test_results
                WHERE table_name = ?
                GROUP BY test_name
                ORDER BY test_name
                """,
                [model_name],
            ).fetchdf()
            test_list = _records(test_df)
        except Exception:
            test_list = []

        # Last run from model_run_results (actual dbt run timestamp, not test timestamp).
        last_run = None
        if model_data.get("unique_id"):
            try:
                lr_df = conn.execute(
                    f"""
                    SELECT MAX(generated_at) AS last_run
                    FROM {_schema()}.model_run_results
                    WHERE unique_id = ?
                    """,
                    [model_data.get("unique_id")],
                ).fetchdf()
                if not lr_df.empty:
                    last_run = _records(lr_df)[0].get("last_run")
            except Exception:
                pass

        return {
            "model": {
                "name": model_data.get("table_name"),
                "kind": model_data.get("kind"),
                "unique_id": model_data.get("unique_id"),
                "schema": model_data.get("schema_name"),
                "database": model_data.get("database_name"),
                "description": model_data.get("description"),
                "tags": model_data.get("tags"),
                "last_run": last_run,
            },
            "columns": column_list,
            "recent_tests": test_list,
        }

    except Exception as exc:
        if isinstance(exc, HTTPException) and exc.status_code != 503:
            raise
        raise HTTPException(404, "Elementary catalog tables not found")
    finally:
        if conn is not None:
            conn.close()


@router.get("/sources")
def get_sources():
    conn = get_conn(read_only=True)
    try:
        df = conn.execute(
            f"""
            SELECT unique_id, source_name, name, schema_name, database_name, description, owner, tags
            FROM {_schema()}.dbt_sources
            ORDER BY source_name, name
            """
        ).fetchdf()
        return {"sources": _records(df)}
    except duckdb.CatalogException:
        return {"sources": [], "error": "Elementary source tables not found"}
    finally:
        conn.close()


@router.get("/search")
def search_catalog(q: str):
    conn = get_conn(read_only=True)
    results = []

    try:
        models = conn.execute(
            f"""
            SELECT 'model' as type, alias as name, description
            FROM {_schema()}.dbt_models
            WHERE alias ILIKE ? OR description ILIKE ?
            LIMIT 20
            """,
            [f"%{q}%", f"%{q}%"],
        ).fetchall()
        results.extend([{"type": t, "name": n, "description": d} for t, n, d in models])
    except duckdb.CatalogException:
        pass

    try:
        sources = conn.execute(
            f"""
            SELECT 'source' as type, name, description
            FROM {_schema()}.dbt_sources
            WHERE name ILIKE ? OR description ILIKE ?
            LIMIT 20
            """,
            [f"%{q}%", f"%{q}%"],
        ).fetchall()
        results.extend([{"type": t, "name": n, "description": d} for t, n, d in sources])
    except duckdb.CatalogException:
        pass

    conn.close()
    return {"query": q, "results": results}


def _fallback_models(conn, search: str | None = None):
    """List tables from information_schema when Elementary is not available."""
    try:
        query = """
            SELECT table_schema as schema_name, table_name as name, table_type as type
            FROM information_schema.tables
            WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
        """
        if search:
            query += f" AND table_name ILIKE '%{search}%'"
        query += " ORDER BY table_schema, table_name"

        results = conn.execute(query).fetchall()
        models = [
            {"name": name, "schema": schema, "type": ttype, "description": None, "source": "information_schema"}
            for schema, name, ttype in results
        ]
        return {"models": models, "total": len(models), "source": "information_schema"}
    except Exception:
        return {"models": [], "total": 0}
