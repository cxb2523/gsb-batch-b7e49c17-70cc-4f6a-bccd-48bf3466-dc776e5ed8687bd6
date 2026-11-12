import marimo

__generated_with = "0.23.9"
app = marimo.App(width="medium", app_title="Explore — <project_name>")


@app.cell
def _():
    import marimo as mo
    import altair as alt
    from pathlib import Path
    from datavloot_platform import storage

    # Read-only, so the notebook can stay open while a pipeline writes. On
    # DuckDB's default connection, so SQL cells find the lake on either engine
    # Marimo offers: "con" or its own "DuckDB (in-memory)".
    PROJECT_DIR = Path(__file__).parent.parent
    con = storage.connect(PROJECT_DIR, read_only=True, default=True)
    mo.md(f"Connected to the lake in `{storage.lake_dir(PROJECT_DIR)}`")
    return PROJECT_DIR, alt, con, mo


@app.cell
def _(con, mo):
    # current_database(): the lake, not DuckLake's own metadata tables
    tables = con.sql("""
        SELECT table_schema AS schema, table_name AS table, table_type AS type
        FROM information_schema.tables
        WHERE table_catalog = current_database()
        ORDER BY table_schema, table_name
    """).df()
    mo.vstack([
        mo.md("## Available tables"),
        mo.ui.table(tables),
    ])
    return (tables,)


@app.cell
def _(con, mo):
    # Replace with your fact table and business schema name
    SCHEMA = "<project_name>_business"
    FACT   = "fct_<event>"

    df = con.sql(f"SELECT * FROM {SCHEMA}.{FACT} LIMIT 100").df()
    mo.vstack([
        mo.md(f"## Preview — `{SCHEMA}.{FACT}`"),
        mo.ui.table(df),
    ])
    return FACT, SCHEMA, df


@app.cell
def _(FACT, SCHEMA, con, mo):
    # Edit the GROUP BY column to match a dimension in your fact table
    GROUP_BY = "<dimension_column>"

    summary = con.sql(f"""
        SELECT {GROUP_BY}, COUNT(*) AS events
        FROM {SCHEMA}.{FACT}
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 20
    """).df()
    mo.vstack([
        mo.md(f"## Events by `{GROUP_BY}`"),
        mo.ui.table(summary),
    ])
    return GROUP_BY, summary


if __name__ == "__main__":
    app.run()
