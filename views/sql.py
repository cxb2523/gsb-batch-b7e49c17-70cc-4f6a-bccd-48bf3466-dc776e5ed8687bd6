import sqlite3

import streamlit as st

from core import auth, db, sqlguard, state
from core.theme import page_header

page_header("SQL Workspace", "Query your in-memory datasets with real SQL.", "🖥️")
if not state.require_data():
    st.stop()


def connection():
    """Register every loaded dataset as a SQLite table."""
    con = sqlite3.connect(":memory:")
    for name, d in st.session_state["datasets"].items():
        table = "".join(ch if ch.isalnum() else "_" for ch in name).strip("_").lower() or "t"
        d.to_sql(table, con, index=False, if_exists="replace")
    return con


tables = {}
for name in state.names():
    tables["".join(ch if ch.isalnum() else "_" for ch in name).strip("_").lower()] = name

c1, c2 = st.columns([3, 1])
with c2:
    st.markdown("##### Tables")
    for t, orig in tables.items():
        d = st.session_state["datasets"][orig]
        with st.expander(f"`{t}`"):
            st.caption(f"{len(d):,} rows")
            st.code("\n".join(f"{c} : {d[c].dtype}" for c in d.columns), language="text")

    st.markdown("##### Saved queries")
    saved = db.recent("queries", auth.current_user(), 10)
    for _, r in saved.iterrows():
        if st.button(f"↩ {r['name']}", key=f"q_{r['id']}", use_container_width=True):
            st.session_state["_sql_text"] = r["sql"]
            st.rerun()

with c1:
    default = f"SELECT *\nFROM {list(tables)[0]}\nLIMIT 100;" if tables else "SELECT 1;"
    sql = st.text_area("SQL editor", st.session_state.get("_sql_text", default),
                       height=220, key="sql_editor")
    b1, b2, b3 = st.columns([1, 1, 2])
    run = b1.button("▶ Run query", type="primary", use_container_width=True)
    qname = b3.text_input("Save as", placeholder="Monthly revenue by region",
                          label_visibility="collapsed")
    if b2.button("💾 Save", use_container_width=True) and qname:
        db.save_query(auth.current_user(), qname, sql)
        st.success("Query saved.")

    if run:
        con = connection()
        result = sqlguard.run_query(con, sql, max_rows=1000)
        con.close()
        if result.rejected or result.error:
            # Never let a rejected/failed statement reach the result area.
            st.session_state.pop("_sql_res", None)
            st.session_state.pop("_sql_truncated", None)
            st.error(result.message)
        else:
            st.session_state["_sql_res"] = result.df
            st.session_state["_sql_truncated"] = result.truncated
            st.session_state["_sql_msg"] = result.message
            db.log(auth.current_user(), "sql_query", sql[:200])

res = st.session_state.get("_sql_res")
if res is not None:
    st.divider()
    st.subheader(f"Result — {len(res):,} rows × {res.shape[1]} columns")
    if st.session_state.get("_sql_truncated"):
        st.warning(st.session_state.get("_sql_msg") or
                   "结果已截断。请在查询末尾加上 LIMIT 以获取精确结果。")
    st.dataframe(res, use_container_width=True, height=420)
    d1, d2, d3 = st.columns(3)
    d1.download_button("⬇ CSV", res.to_csv(index=False), "query_result.csv", "text/csv",
                       use_container_width=True)
    from core.reports import build_excel
    d2.download_button("⬇ Excel", build_excel({"Query result": res}), "query_result.xlsx",
                       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                       use_container_width=True)
    if d3.button("➕ Save as dataset", use_container_width=True):
        state.register("query_result", res)
        st.rerun()
