"""Tests for the read-only SQL guard used by the SQL workspace."""
import sqlite3

import pandas as pd
import pytest

from core import sqlguard


@pytest.fixture()
def con():
    """In-memory SQLite with a small sales-like table."""
    connection = sqlite3.connect(":memory:")
    df = pd.DataFrame({
        "id": range(1, 6),
        "region": ["North", "South", "East", "West", "North"],
        "note": ["ok", "please delete me", "ok", "ok", "ok"],
        "revenue": [100.0, 200.0, 300.0, 400.0, 500.0],
    })
    df.to_sql("sales", connection, index=False)
    yield connection
    connection.close()


# --- accepted read-only queries -------------------------------------------

def test_select_returns_data(con):
    result = sqlguard.run_query(con, "SELECT region, revenue FROM sales ORDER BY id")
    assert result.status == "ok"
    assert result.truncated is False
    assert result.rows == 5
    assert len(result.df) == 5
    assert list(result.df.columns) == ["region", "revenue"]
    assert result.df["revenue"].iloc[0] == 100.0
    assert result.message  # human readable note is present


def test_with_query_is_allowed(con):
    result = sqlguard.run_query(
        con, "WITH totals AS (SELECT region, revenue FROM sales) "
             "SELECT * FROM totals WHERE revenue > 150")
    assert result.ok
    assert result.rows == 4


def test_string_literal_containing_delete_is_not_rejected(con):
    result = sqlguard.run_query(con, "SELECT * FROM sales WHERE note LIKE 'please delete me'")
    assert result.ok, result.message
    assert result.rows == 1
    assert result.df.iloc[0]["note"] == "please delete me"


def test_keywords_inside_comments_are_ignored(con):
    sql = ("-- do not drop anything\n"
           "SELECT /* DELETE is a word here */ id FROM sales")
    result = sqlguard.run_query(con, sql)
    assert result.ok, result.message
    assert result.rows == 5


def test_trailing_semicolon_allowed(con):
    result = sqlguard.run_query(con, "SELECT id FROM sales LIMIT 2;")
    assert result.ok
    assert result.rows == 2


def test_identifier_containing_keyword_is_allowed(con):
    # A column named "delete_flag" must not trip the delete keyword filter.
    con.execute("CREATE TEMP TABLE flags (delete_flag INTEGER)")
    con.execute("INSERT INTO flags VALUES (1), (0)")
    result = sqlguard.run_query(con, "SELECT delete_flag FROM flags")
    assert result.ok, result.message
    assert result.rows == 2


# --- rejected statements --------------------------------------------------

@pytest.mark.parametrize("sql, keyword", [
    ("INSERT INTO sales (id) VALUES (99)", "INSERT"),
    ("UPDATE sales SET revenue = 0", "UPDATE"),
    ("DELETE FROM sales", "DELETE"),
    ("DROP TABLE sales", "DROP"),
    ("ALTER TABLE sales ADD COLUMN x INTEGER", "ALTER"),
    ("CREATE TABLE evil (x INTEGER)", "CREATE"),
    ("ATTACH DATABASE ':memory:' AS other", "ATTACH"),
    ("PRAGMA table_info(sales)", "PRAGMA"),
])
def test_write_statements_are_rejected(con, sql, keyword):
    result = sqlguard.run_query(con, sql)
    assert result.rejected
    assert result.df.empty
    assert result.rows == 0
    assert result.truncated is False
    assert keyword in result.message.upper()
    # The underlying table must be untouched.
    assert con.execute("SELECT COUNT(*) FROM sales").fetchone()[0] == 5


def test_multiple_statements_are_rejected(con):
    result = sqlguard.run_query(con, "SELECT 1; SELECT 2")
    assert result.rejected
    assert "多条" in result.message
    assert result.df.empty


def test_multiple_statements_with_trailing_semicolon_text(con):
    result = sqlguard.run_query(con, "SELECT id FROM sales; DROP TABLE sales")
    assert result.rejected
    assert con.execute("SELECT COUNT(*) FROM sales").fetchone()[0] == 5


def test_semicolons_inside_literal_do_not_split(con):
    result = sqlguard.run_query(con, "SELECT 'a;b' AS v FROM sales LIMIT 1")
    assert result.ok, result.message
    assert result.rows == 1


def test_non_select_statement_is_rejected(con):
    result = sqlguard.run_query(con, "EXPLAIN SELECT 1")
    assert result.rejected


def test_empty_query_is_rejected(con):
    result = sqlguard.run_query(con, "   ")
    assert result.rejected
    assert result.message


# --- truncation ------------------------------------------------------------

def test_oversized_result_is_truncated(con):
    result = sqlguard.run_query(con, "SELECT * FROM sales", max_rows=3)
    assert result.ok
    assert result.truncated is True
    assert result.rows == 3
    assert len(result.df) == 3
    assert "截断" in result.message
    assert "LIMIT" in result.message


def test_default_limit_is_1000(con):
    big = pd.DataFrame({"n": range(1200)})
    big.to_sql("big", con, index=False, if_exists="replace")
    result = sqlguard.run_query(con, "SELECT n FROM big")
    assert result.truncated is True
    assert result.rows == sqlguard.DEFAULT_MAX_ROWS == 1000


def test_exactly_at_limit_is_not_truncated(con):
    result = sqlguard.run_query(con, "SELECT * FROM sales", max_rows=5)
    assert result.truncated is False
    assert result.rows == 5


def test_limit_alias_and_none_disables_cap(con):
    assert sqlguard.run_query(con, "SELECT * FROM sales", limit=2).rows == 2
    result = sqlguard.run_query(con, "SELECT * FROM sales", max_rows=None)
    assert result.rows == 5 and result.truncated is False


# --- errors are reported, not raised --------------------------------------

def test_bad_sql_returns_error_without_raising(con):
    result = sqlguard.run_query(con, "SELECT * FROM sales WHERE")
    assert result.status == "error"
    assert result.error
    assert result.df.empty
    assert result.rows == 0
    assert result.truncated is False
    assert result.message


def test_missing_table_returns_error_without_raising(con):
    result = sqlguard.run_query(con, "SELECT * FROM no_such_table")
    assert result.error
    assert "no_such_table" in result.message
    assert result.df.empty


def test_tuple_unpacking_contract(con):
    df, truncated, rows, message = sqlguard.run_query(con, "SELECT id FROM sales LIMIT 2")
    assert isinstance(df, pd.DataFrame) and len(df) == 2
    assert truncated is False and rows == 2
    assert isinstance(message, str) and message
