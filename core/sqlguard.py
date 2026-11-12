"""Guard user-supplied SQL before it is handed to an in-memory SQLite database.

The SQL workspace lets users type arbitrary SQL against datasets that were
registered as SQLite tables.  Handing that text straight to ``sqlite3`` means a
missing ``LIMIT`` can pull an entire table into memory and a stray ``DELETE``
can mutate the data behind the UI.  This module keeps the normal SELECT/WITH
experience but:

* rejects everything that is not a single, read-only statement;
* ignores keywords that only appear inside comments or string literals;
* caps the number of rows materialised and reports the truncation;
* turns SQLite errors into a readable message instead of an exception.

The public entry point is :func:`run_query`, which returns a four-tuple
``(DataFrame, truncated, rows, message)`` (also available as attributes).  The
extra ``status`` attribute distinguishes normal results from rejected or
failed queries so callers can react without parsing the message.
"""
from __future__ import annotations

import re
import sqlite3

import pandas as pd

DEFAULT_MAX_ROWS = 1000

# Statements/keywords that mutate data or the database itself.  Matching is
# performed on a copy of the SQL where comments and string literals have been
# blanked out, so text such as 'please delete me' is not mistaken for a
# DELETE statement.  Word boundaries keep column names like ``delete_flag`` or
# ``update_time`` usable as identifiers.
FORBIDDEN_KEYWORDS = re.compile(
    r"\b(?:"
    r"INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|"
    r"VACUUM|REINDEX|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|"
    r"TRUNCATE|MERGE|GRANT|REVOKE|REPLACE\s+INTO|"
    r"load_extension|writefile|readfile"
    r")\b",
    re.IGNORECASE,
)

_FIRST_WORD = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\b")

_ALLOWED_LEADING = ("SELECT", "WITH")


class SqlResult(tuple):
    """Immutable query outcome.

    It behaves like a tuple of ``(df, truncated, rows, message)`` so it can be
    unpacked directly, while also exposing named attributes plus a ``status``
    value of ``"ok"``, ``"rejected"`` or ``"error"``.
    """

    def __new__(cls, df: pd.DataFrame, truncated: bool, rows: int, message: str,
                status: str = "ok"):
        obj = super().__new__(cls, (df, truncated, rows, message))
        obj.status = status
        obj.df = df
        obj.truncated = truncated
        obj.rows = rows
        obj.message = message
        return obj

    # Convenience aliases so callers can pick whichever name reads best.
    @property
    def dataframe(self) -> pd.DataFrame:
        return self.df

    @property
    def row_count(self) -> int:
        return self.rows

    @property
    def note(self) -> str:
        return self.message

    @property
    def truncated_flag(self) -> bool:
        return self.truncated

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    @property
    def rejected(self) -> bool:
        return self.status == "rejected"

    @property
    def error(self) -> bool:
        return self.status == "error"


def _result(df: pd.DataFrame, truncated: bool, rows: int, message: str,
            status: str = "ok") -> SqlResult:
    return SqlResult(df, truncated, rows, message, status)


def _reject(reason: str) -> SqlResult:
    return _result(pd.DataFrame(), False, 0, f"查询被拒绝：{reason}", "rejected")


def _failure(reason: str) -> SqlResult:
    return _result(pd.DataFrame(), False, 0, f"查询失败：{reason}", "error")


def _blank_comments_and_literals(sql: str) -> str:
    """Return *sql* with comments and quoted sections replaced by spaces.

    Semicolons and keywords inside literals therefore disappear from the
    guarded copy, while the overall character length/layout is preserved well
    enough to split statements on real semicolons.
    """
    out: list[str] = []
    i, n = 0, len(sql)

    def blank(ch: str) -> str:
        return "\n" if ch in "\r\n" else " "

    while i < n:
        ch = sql[i]

        # -- line comment ---------------------------------------------------
        if ch == "-" and i + 1 < n and sql[i + 1] == "-":
            out.append("  ")
            i += 2
            while i < n and sql[i] not in "\r\n":
                out.append(" ")
                i += 1
            continue

        # /* block comment */ -------------------------------------------------
        if ch == "/" and i + 1 < n and sql[i + 1] == "*":
            out.append("  ")
            i += 2
            while i < n:
                if sql[i] == "*" and i + 1 < n and sql[i + 1] == "/":
                    out.append("  ")
                    i += 2
                    break
                out.append(blank(sql[i]))
                i += 1
            continue

        # '...' string, "..." identifier/string, `...` identifier ----------
        if ch in ("'", '"', "`"):
            quote = ch
            out.append(" ")
            i += 1
            while i < n:
                cur = sql[i]
                if cur == quote:
                    # A doubled quote is an escaped quote inside the literal.
                    if i + 1 < n and sql[i + 1] == quote:
                        out.append("  ")
                        i += 2
                        continue
                    out.append(" ")
                    i += 1
                    break
                out.append(blank(cur))
                i += 1
            continue

        # [bracketed identifier] ---------------------------------------------
        if ch == "[":
            out.append(" ")
            i += 1
            while i < n:
                cur = sql[i]
                if cur == "]":
                    out.append(" ")
                    i += 1
                    break
                out.append(blank(cur))
                i += 1
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def validate_sql(sql: str) -> tuple[bool, str]:
    """Validate a SQL string without executing it.

    Returns ``(ok, reason)``.  ``reason`` is empty when the statement may run,
    otherwise it is a user-facing explanation.
    """
    if not sql or not sql.strip():
        return False, "查询为空，请输入一条以 SELECT 或 WITH 开头的只读查询。"

    clean = _blank_comments_and_literals(sql)
    statements = [part.strip() for part in clean.split(";") if part.strip()]
    if not statements:
        return False, "查询为空，请输入一条以 SELECT 或 WITH 开头的只读查询。"
    if len(statements) > 1:
        return False, "检测到多条以分号拼接的 SQL 语句；只允许执行单条只读查询。"

    first = _FIRST_WORD.search(statements[0])
    if not first or first.group(1).upper() not in _ALLOWED_LEADING:
        found = first.group(1) if first else "未知内容"
        return False, (f"只允许 SELECT 或 WITH 开头的只读查询，"
                       f"当前语句以 {found} 开头。")

    match = FORBIDDEN_KEYWORDS.search(clean)
    if match:
        keyword = " ".join(match.group(0).split()).upper()
        if keyword == "REPLACE INTO":
            keyword = "REPLACE INTO"
        return False, (f"检测到不允许的写/管理关键字 {keyword}；"
                       f"SQL 工作台只接受只读查询。")

    return True, ""


def _fetch(connection, sql: str, max_rows: int | None, params) -> SqlResult:
    cursor = connection.cursor()
    try:
        if params is None:
            cursor.execute(sql)
        else:
            cursor.execute(sql, params)

        description = cursor.description
        if description is None:
            return _failure("该语句没有返回结果集，只允许执行只读查询。")

        columns = [col[0] for col in description]
        if max_rows is None:
            rows = cursor.fetchall()
            truncated = False
        else:
            rows = cursor.fetchmany(max_rows + 1)
            truncated = len(rows) > max_rows
            if truncated:
                rows = rows[:max_rows]

        df = pd.DataFrame.from_records(rows, columns=columns)
        count = len(df)
        if truncated:
            message = (f"结果超过 {max_rows} 行上限，已截断为 {count} 行；"
                       f"建议在查询末尾添加 LIMIT 以精确控制返回行数。")
        else:
            message = f"查询成功，返回 {count} 行。"
        return _result(df, truncated, count, message)

    finally:
        try:
            cursor.close()
        except Exception:
            pass


def run_query(connection, sql: str, max_rows: int | None = DEFAULT_MAX_ROWS,
              limit: int | None = None, params=None) -> SqlResult:
    """Run one read-only SQL statement and return a guarded result.

    Parameters
    ----------
    connection:
        A DB-API connection (an ``sqlite3.Connection`` for the SQL workspace).
    sql:
        The user-supplied statement.
    max_rows:
        Row cap, default :data:`DEFAULT_MAX_ROWS` (1000).  ``None`` disables it.
    limit:
        Alias for ``max_rows``; when given it takes precedence.
    params:
        Optional DB-API parameter sequence.

    Returns
    -------
    SqlResult
        A tuple-like object ``(df, truncated, rows, message)`` with an extra
        ``status`` attribute.  Rejected and failed queries return an empty
        DataFrame, ``truncated=False``, ``rows=0`` and a readable ``message``
        — SQL errors never propagate as exceptions.
    """
    if limit is not None:
        max_rows = limit
    if max_rows is not None:
        try:
            max_rows = int(max_rows)
        except (TypeError, ValueError):
            return _failure("行数上限 max_rows 必须是正整数。")
        if max_rows < 1:
            return _failure("行数上限 max_rows 必须是正整数。")

    ok, reason = validate_sql(sql)
    if not ok:
        return _reject(reason)

    try:
        return _fetch(connection, sql, max_rows, params)
    except sqlite3.Error as exc:
        return _failure(f"SQL 语法或对象错误 — {exc}")
    except Exception as exc:  # connection problems, unsupported cursor, ...
        return _failure(f"执行 SQL 时出错 — {exc}")


# Friendly aliases — the module is small enough that several spellings are
# reasonable entry points for callers/tests.
execute_query = run_query
execute_sql = run_query
run_sql = run_query
execute = run_query
