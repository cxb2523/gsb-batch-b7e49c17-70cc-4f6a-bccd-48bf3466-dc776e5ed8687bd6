"""Local tests for the CSV -> dashboard pipeline.

Run from the repository root:

    python -m pytest tests -q

The tests use the small hand-written CSVs under ``tests/fixtures`` so they do not
need the (git-submodule) JHU data directory or network access.
"""

import csv
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

import main as dashboard  # noqa: E402


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def read_back(path):
    with open(path, newline="") as csv_data:
        return list(csv.DictReader(csv_data))


@pytest.fixture
def merged(tmp_path):
    """Merge the synthetic sources and return the written rows."""
    output = tmp_path / "merged.csv"
    rows = dashboard.combine_csvs(
        [
            FIXTURES / "confirmed_global.csv",
            FIXTURES / "deceased_global_stopped.csv",
            FIXTURES / "recovered_global.csv",
            FIXTURES / "critical_unknown.csv",
        ],
        "Greece",
        "Country/Region",
        ["Province/State", "Country/Region", "Lat", "Long"],
        "Date",
        list(dashboard.SOURCE_COLUMNS),
        output,
    )
    return rows, read_back(output)


def test_merge_orders_dates_chronologically_not_as_strings(merged):
    rows, _ = merged
    assert [row["Date"] for row in rows] == ["1/2/20", "1/9/20", "1/10/20", "1/11/20"]


def test_merge_never_writes_minus_one_as_a_count(merged):
    rows, written = merged
    for row in written:
        for column in dashboard.SOURCE_COLUMNS:
            assert row[column] != "-1", "sentinel leaked into {}".format(column)


def test_missing_source_date_becomes_unknown_not_minus_one(merged):
    _, written = merged
    last = written[-1]
    assert last["Date"] == "1/11/20"
    # Deceased source stopped at 1/10/20.
    assert last["Deceased Cases"] == dashboard.UNKNOWN


def test_unknown_cells_are_marked_in_the_merged_csv(merged):
    _, written = merged
    by_date = {row["Date"]: row for row in written}
    assert by_date["1/9/20"]["Critical Cases"] == dashboard.UNKNOWN
    assert by_date["1/10/20"]["Critical Cases"] == dashboard.UNKNOWN


def test_dates_with_different_spelling_join(merged):
    rows, _ = merged
    first = rows[0]
    assert first["Date"] == "1/2/20"
    # critical_unknown.csv spells the same day "1/02/20".
    assert first["Critical Cases"] == "0"


def test_statistics_carry_forward_unknown_critical(merged):
    rows, _ = merged
    stats = dashboard.compute_statistics(rows)
    series = stats["series"]
    assert series[1]["CRITICAL"] == 0  # unknown on 1/9/20, last known 0
    assert series[2]["CRITICAL"] == 0  # still unknown on 1/10/20
    assert series[3]["CRITICAL"] == 2  # source reports 2 again on 1/11/20


def test_statistics_use_last_valid_row_for_cards(merged):
    rows, _ = merged
    stats = dashboard.compute_statistics(rows)
    assert stats["totals"] == {
        "total": 8,
        "active": 5,
        "deceased": 1,
        "recovered": 2,
        "critical": 2,
    }


def test_statistics_active_cases_ignore_unknown_columns(merged):
    rows, _ = merged
    stats = dashboard.compute_statistics(rows)
    last = stats["series"][-1]
    # 8 confirmed - 1 deceased (carried from 1/10/20) - 2 recovered = 5
    assert last["ACTIVE CASES"] == 5
    assert all(row["ACTIVE CASES"] >= 0 for row in stats["series"])


def test_zero_previous_value_yields_stable_percentage(merged):
    rows, _ = merged
    stats = dashboard.compute_statistics(rows)
    assert dashboard.format_percent(stats["diffs"]["total"]) == "166.67"
    # A zero-valued first row must not raise ZeroDivisionError.
    zero = dashboard.compute_statistics([dict(row) for row in read_back(FIXTURES / "all_zero_days.csv")])
    assert dashboard.format_percent(zero["diffs"]["total"]) == "0.00"
    assert dashboard.format_percent(zero["diffs"]["active"]) == "0.00"
    assert dashboard.format_percent(zero["diffs"]["deceased"]) == "0.00"


def test_percentage_change_handles_missing_and_zero_denominator():
    assert dashboard.percentage_change(None, 10) is None
    assert dashboard.percentage_change(10, None) is None
    assert dashboard.percentage_change(10, 0) is None
    assert dashboard.format_percent(None) == "0.00"
    assert dashboard.format_percent(-0.001) == "0.00"


def test_critical_never_known_is_unknown_not_zero():
    rows = read_back(FIXTURES / "critical_never_known.csv")
    stats = dashboard.compute_statistics(rows)
    assert all(row["CRITICAL"] is None for row in stats["series"])
    assert stats["totals"]["critical"] is None
    assert dashboard.format_percent(stats["diffs"]["critical"]) == "0.00"


def test_parse_helpers():
    assert dashboard.parse_count("-1") is None
    assert dashboard.parse_count("2,612") == 2612
    assert dashboard.parse_count("unknown") is None
    assert dashboard.parse_count("") is None
    assert dashboard.parse_date("1/9/21") > dashboard.parse_date("1/2/20")
    assert dashboard.parse_date("8/31/30").year == 2030


@pytest.mark.parametrize(
    "source_csv",
    [FIXTURES / "all_zero_days.csv", FIXTURES / "critical_never_known.csv"],
)
def test_first_day_zero_does_not_crash(tmp_path, source_csv):
    rows = read_back(source_csv)
    html = dashboard.build_page(
        rows=rows,
        age_csv=FIXTURES / "age_distribution.csv",
        gender_csv=FIXTURES / "cases_by_gender.csv",
        template_dir=REPO_ROOT / "templates",
    )
    assert "<html" in html
    assert "0.00%" in html


def chart_rows(html):
    """Return the JS data rows of the cases chart, as written into the page."""
    start = html.index("['DATE', 'ACTIVE CASES'")
    end = html.index("]);", start)
    return [line.strip() for line in html[start:end].splitlines() if line.strip().startswith('["')]


def test_rendered_page_matches_rules(merged):
    rows, _ = merged
    html = dashboard.build_page(
        rows=rows,
        age_csv=FIXTURES / "age_distribution.csv",
        gender_csv=FIXTURES / "cases_by_gender.csv",
        template_dir=REPO_ROOT / "templates",
    )
    # Cards read the last valid row.
    assert '<p class="stat-value">8</p>' in html  # total
    assert '<p class="stat-value">5</p>' in html  # active
    assert '<p class="stat-value">1</p>' in html  # deceased
    assert '<p class="stat-value">2</p>' in html  # discharged
    # Chart rows render numbers and null placeholders, never the string "None".
    assert '"1/11/20", 5, 5, 2, 1, 0' in html
    assert "None" not in html
    # No sentinel value (-1) may reach the chart data.
    data_rows = chart_rows(html)
    assert len(data_rows) == 4
    for line in data_rows:
        assert "-1" not in line, line



def test_command_line_build(tmp_path):
    output_csv = tmp_path / "merged.csv"
    output_html = tmp_path / "index.html"
    exit_code = dashboard.main(
        [
            "--confirmed", str(FIXTURES / "confirmed_global.csv"),
            "--deceased", str(FIXTURES / "deceased_global_stopped.csv"),
            "--recovered", str(FIXTURES / "recovered_global.csv"),
            "--critical", str(FIXTURES / "critical_unknown.csv"),
            "--output-csv", str(output_csv),
            "--output-html", str(output_html),
            "--no-print",
        ]
    )
    assert exit_code == 0
    assert output_csv.exists()
    assert output_html.read_text(encoding="utf-8").startswith("<!doctype html>")


def test_source_that_stops_early_and_restarts_keeps_known_value(tmp_path):
    """A date with no cell from any source must not fabricate a count."""
    path = tmp_path / "gappy.csv"
    path.write_text(
        "Date,Confirmed Cases,Deceased Cases,Recovered Cases,Critical Cases\n"
        "1/2/20,0,0,0,0\n"
        "1/3/20,5,1,0,\n"
        "1/4/20,6,1,1,\n"
        "1/5/20,9,2,1,3\n",
        encoding="utf-8",
    )
    stats = dashboard.compute_statistics(read_back(path))
    # Critical carried forward 0, 0, then 3; no -1 or zero cliff from fillers.
    assert [row["CRITICAL"] for row in stats["series"]] == [0, 0, 0, 3]
    # The empty cell did not reset the active count.
    assert [row["ACTIVE CASES"] for row in stats["series"]] == [0, 4, 4, 6]


def test_entirely_unknown_row_renders_placeholder_cards():
    rows = [
        {
            "Date": "1/2/20",
            "Confirmed Cases": "-1",
            "Deceased Cases": "",
            "Recovered Cases": "n/a",
            "Critical Cases": "-1",
        }
    ]
    html = dashboard.build_page(
        rows=rows,
        age_csv=FIXTURES / "age_distribution.csv",
        gender_csv=FIXTURES / "cases_by_gender.csv",
        template_dir=REPO_ROOT / "templates",
    )
    assert '<p class="stat-value">—</p>' in html
    assert '<meta charset="utf-8">' in html
    assert "null" in html
    assert "ZeroDivisionError" not in html


def test_real_repository_data_still_builds():
    csv_file = REPO_ROOT / "time_series_data_grc.csv"
    if not csv_file.exists():
        pytest.skip("repository time series CSV is missing")
    rows = dashboard.load_rows(csv_file)
    stats = dashboard.compute_statistics(rows)
    html = dashboard.build_page(
        rows=rows,
        age_csv=REPO_ROOT / "static_data" / "covid19_greece_age_distribution.csv",
        gender_csv=REPO_ROOT / "static_data" / "covid19_greece_cases_by_gender.csv",
        template_dir=REPO_ROOT / "templates",
    )
    assert stats["totals"]["total"] == 5548487
    assert stats["totals"]["active"] == 5513708
    for line in chart_rows(html):
        assert "-1" not in line, line

    # Regression: the critical-cases source spells dates like "5/01/20" while
    # the primary series uses "5/1/20".  The join must be on the parsed date,
    # otherwise these values are silently lost.
    critical_source = dashboard.read_csv(
        REPO_ROOT / "static_data" / "covid19_greece_critical_cases.csv",
        "Greece",
        "Country/Region",
        ["Province/State", "Country/Region", "Lat", "Long"],
    )
    assert critical_source["5/01/20"] == "36"
    by_date = {row["Date"]: row for row in rows}
    assert by_date["5/1/20"]["Critical Cases"] == "36"
    assert by_date["5/2/20"]["Critical Cases"] == "37"
    # A typo'd future column ("8/31/30") must not create a 2030 data point.
    assert by_date["8/15/21"]["Critical Cases"] == "241"
    assert max(dashboard.parse_date(row["Date"]) for row in rows).year == 2023
