"""Build the COVID-19 Greece dashboard and its merged time series.

Pipeline: wide JHU-style source CSVs -> merged long CSV (``time_series_data_grc.csv``)
-> Flask/Jinja template -> ``docs/index.html``.

The data sources can misbehave in a number of ways: a source can stop publishing
dates, individual cells can use ``-1`` (or another sentinel) for "unknown", and the
very first day is often all zeroes.  The rules implemented here are:

* A date is parsed into a real calendar date before it is used for sorting or
  joining, so ``1/9/21`` sorts before ``1/10/21`` and ``5/1/20`` joins with
  ``5/01/20``.
* Unknown cells are written as an empty string (``UNKNOWN``) in the merged CSV.
  The value ``-1`` and other sentinels are never copied through as if they were a
  count.
* When a column is unknown it is filled with the most recent known value
  ("last observation carried forward") and does not participate in arithmetic.
  If there is no known value yet, the metric is left unknown and that row is
  skipped for the metric instead of fabricating a number.
* Percentage changes are undefined when the previous value is zero or unknown;
  they render as a stable ``0.00`` placeholder instead of raising
  ``ZeroDivisionError``.
* The summary cards use the last row with a valid value for each metric.

The module no longer performs work at import time; run it with ``python src/main.py``
or import its functions from tests.  Rendering is split from printing so tests can
assert on the HTML without capturing stdout.
"""

import argparse
import csv
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import flask
from flask import render_template

# Marker used in the merged CSV for "this value is unknown".
UNKNOWN = ""
_UNKNOWN_TEXT = {"", "-1", "na", "n/a", "unknown", "null", "none", "-", "nan"}

DATE_FORMATS = ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d")

CONFIRMED = "Confirmed Cases"
DECEASED = "Deceased Cases"
RECOVERED = "Recovered Cases"
CRITICAL = "Critical Cases"
SOURCE_COLUMNS = (CONFIRMED, DECEASED, RECOVERED, CRITICAL)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_CSV = REPO_ROOT / "time_series_data_grc.csv"
DEFAULT_CRITICAL_CSV = REPO_ROOT / "static_data" / "covid19_greece_critical_cases.csv"
DEFAULT_AGE_CSV = REPO_ROOT / "static_data" / "covid19_greece_age_distribution.csv"
DEFAULT_GENDER_CSV = REPO_ROOT / "static_data" / "covid19_greece_cases_by_gender.csv"
DEFAULT_TEMPLATE_DIR = REPO_ROOT / "templates"
DATA_DIR = REPO_ROOT / "data"

# Dates far outside the primary source's reporting window are almost certainly
# typos (the real critical-cases file contains an ``8/31/30`` column).  Allow one
# year of slack on either side before ignoring a date from a secondary source.
DATE_WINDOW_SLACK = timedelta(days=366)


def warn(message):
    print("warning: {}".format(message), file=sys.stderr)


def is_unknown(value):
    """Return True when ``value`` is a missing/sentinel cell, not a real count."""
    if value is None:
        return True
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return value < 0
    return str(value).strip().lower() in _UNKNOWN_TEXT


def parse_count(value):
    """Parse a non-negative integer count, or return ``None`` when unknown.

    ``-1`` is the sources' historical "unknown" sentinel, but any negative value
    is rejected as a count.  Non-numeric text is treated as unknown rather than
    crashing the whole dashboard.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        return int(value) if value >= 0 and value.is_integer() else None

    text = str(value).strip()
    if text.lower() in _UNKNOWN_TEXT:
        return None
    text = text.replace(",", "")
    try:
        number = int(text)
    except ValueError:
        try:
            number_float = float(text)
        except ValueError:
            return None
        if not number_float.is_integer():
            return None
        number = int(number_float)
    return number if number >= 0 else None


def normalize_count_cell(value):
    """Return a CSV-safe count: a decimal string, or ``UNKNOWN``."""
    number = parse_count(value)
    return UNKNOWN if number is None else str(number)


def parse_date(value):
    """Parse a source date into :class:`datetime.date`, or ``None`` if invalid."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    for date_format in DATE_FORMATS:
        try:
            return datetime.strptime(text, date_format).date()
        except ValueError:
            continue
    return None


def order_rows_by_date(rows, date_key="Date"):
    """Sort rows by parsed calendar date, dropping rows with unparseable dates."""
    parsed = []
    for row in rows:
        row_date = parse_date(row.get(date_key))
        if row_date is None:
            warn("ignoring row with unparseable date {!r}".format(row.get(date_key)))
            continue
        parsed.append((row_date, row))
    # ``sorted`` is stable, so rows for the same date keep their input order.
    parsed.sort(key=lambda item: item[0])
    return [row for _, row in parsed]


def read_csv(csv_file, selected_key, selection_key, ignore_keys=()):
    """Read the single row matching ``selection_key == selected_key``.

    Returns the non-ignored columns of that row.  A missing file or a missing
    matching row yields an empty mapping; callers treat that as "this source
    contributes no dates" rather than crashing the whole pipeline.
    """
    ignore = set(ignore_keys)
    try:
        with open(csv_file, newline="") as csv_data:
            reader = csv.DictReader(csv_data)
            keys = [fieldname for fieldname in (reader.fieldnames or []) if fieldname not in ignore]
            for row in reader:
                if row.get(selection_key) == selected_key:
                    return {key: row[key] for key in keys if key in row}
    except OSError as error:
        warn("could not read {!r}: {}".format(str(csv_file), error))
        return {}
    warn("no row with {}={!r} in {!r}".format(selection_key, selected_key, str(csv_file)))
    return {}


def transpose_row(row_dict, key_colname, value_colname):
    return [
        {"{}".format(key_colname): key, "{}".format(value_colname): value}
        for key, value in row_dict.items()
    ]


def write_to_csv(csv_file, rows, fieldnames):
    with open(csv_file, "w", newline="") as csv_out:
        writer = csv.DictWriter(csv_out, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def combine_series(csv_filenames, selected_key, selection_key, ignore_keys, common_key, output_keys):
    """Merge wide per-source CSVs into one date-ordered list of long rows.

    Sources are joined on a parsed calendar date rather than on the literal date
    string.  Dates present in any source are included, provided they fall inside
    the primary (first) source's reporting window; a source that lacks a date
    contributes ``UNKNOWN`` for that column.
    """
    if len(csv_filenames) != len(output_keys):
        raise ValueError("expected one output key per source CSV")

    per_source = []      # parsed date -> normalized cell
    raw_date_names = []  # parsed date -> date spelling used by that source

    for csv_filename in csv_filenames:
        source = read_csv(csv_filename, selected_key, selection_key, ignore_keys)
        values_by_date = {}
        spellings_by_date = {}
        for raw_date, value in source.items():
            parsed = parse_date(raw_date)
            if parsed is None:
                warn("ignoring date {!r} in {!r}".format(raw_date, str(csv_filename)))
                continue
            if parsed in values_by_date:
                warn("duplicate date {!r} in {!r}; keeping the later value".format(raw_date, str(csv_filename)))
            values_by_date[parsed] = normalize_count_cell(value)
            spellings_by_date[parsed] = raw_date
        per_source.append(values_by_date)
        raw_date_names.append(spellings_by_date)

    all_dates = sorted({parsed for values in per_source for parsed in values})
    if not all_dates:
        return []

    primary = next((values for values in per_source if values), {})
    if primary:
        window_start = min(primary) - DATE_WINDOW_SLACK
        window_end = max(primary) + DATE_WINDOW_SLACK
        kept_dates = []
        for parsed in all_dates:
            if window_start <= parsed <= window_end:
                kept_dates.append(parsed)
            else:
                warn("ignoring date {} outside the primary series window".format(parsed))
        all_dates = kept_dates

    merged_rows = []
    for parsed in all_dates:
        display_date = None
        for spellings in raw_date_names:
            if parsed in spellings:
                display_date = spellings[parsed]
                break
        if display_date is None:
            display_date = "{}/{}/{}".format(
                parsed.month, parsed.day, parsed.strftime("%y")
            )
        merged_row = {common_key: display_date}
        for index, output_key in enumerate(output_keys):
            merged_row[output_key] = per_source[index].get(parsed, UNKNOWN)
        merged_rows.append(merged_row)
    return merged_rows


def combine_csvs(csv_filenames, selected_key, selection_key, ignore_keys, common_key, output_keys, csv_out_filename):
    rows = combine_series(
        csv_filenames, selected_key, selection_key, ignore_keys, common_key, output_keys
    )
    if not rows:
        warn("merge produced no rows; writing a header-only {!r}".format(str(csv_out_filename)))
    write_to_csv(csv_out_filename, rows, [common_key] + list(output_keys))
    return rows


def percentage_change(current, previous):
    """Day-over-day percent change, or ``None`` when it is undefined."""
    if current is None or previous is None or previous == 0:
        return None
    return (current - previous) / previous * 100.0


def format_percent(value):
    """Format a percentage, using ``0.00`` as the stable placeholder."""
    if value is None:
        return "0.00"
    text = "{:.2f}".format(value)
    if text == "-0.00":
        text = "0.00"
    return text


def compute_statistics(rows, date_key="Date"):
    """Turn long merged rows into chart series, summary totals and deltas.

    Each of the four source columns is carried forward independently.  A metric
    that has never been known stays ``None``; it is never replaced by ``-1``.
    """
    ordered_rows = order_rows_by_date(rows, date_key)
    last_known = {column: None for column in SOURCE_COLUMNS}
    previous_effective = {column: None for column in SOURCE_COLUMNS}
    series = []

    for row in ordered_rows:
        provided = {column: parse_count(row.get(column)) for column in SOURCE_COLUMNS}
        for column, value in provided.items():
            if value is not None:
                last_known[column] = value

        effective = dict(last_known)
        confirmed = effective[CONFIRMED]
        deceased = effective[DECEASED]
        recovered = effective[RECOVERED]
        critical = effective[CRITICAL]

        if confirmed is None or deceased is None or recovered is None:
            active = None
        else:
            active = confirmed - deceased - recovered
            if active < 0:
                # Known values can disagree after a source revision; a negative
                # active count is not meaningful, so report it and floor it.
                warn(
                    "active cases for {} would be negative ({}); using 0".format(
                        row.get(date_key), active
                    )
                )
                active = 0

        def day_change(current, previous):
            """Difference from the previous known value.

            Before any value is known the baseline is zero, so the first day
            reports its cumulative total, preserving the original dashboard
            semantics while never subtracting an unknown value.
            """
            if current is None:
                return None
            return current - (previous if previous is not None else 0)

        series.append(
            {
                "DATE": row.get(date_key, ""),
                "ACTIVE CASES": active,
                "REPORTED": day_change(confirmed, previous_effective[CONFIRMED]),
                "CRITICAL": critical,
                "RECOVERED": day_change(recovered, previous_effective[RECOVERED]),
                "DECEASED": day_change(deceased, previous_effective[DECEASED]),
                # Internal level fields used for the summary cards; the template
                # only reads the keys above.
                "_CONFIRMED": confirmed,
                "_DECEASED": deceased,
                "_RECOVERED": recovered,
            }
        )
        previous_effective = effective

    metric_fields = (
        ("total", "_CONFIRMED"),
        ("active", "ACTIVE CASES"),
        ("deceased", "_DECEASED"),
        ("recovered", "_RECOVERED"),
        ("critical", "CRITICAL"),
    )
    totals = {}
    diffs = {}
    for metric, field in metric_fields:
        last_index = None
        for index in range(len(series) - 1, -1, -1):
            if series[index][field] is not None:
                last_index = index
                break
        if last_index is None:
            totals[metric] = None
            diffs[metric] = None
            continue
        totals[metric] = series[last_index][field]
        previous_value = series[last_index - 1][field] if last_index > 0 else None
        diffs[metric] = percentage_change(totals[metric], previous_value)

    return {"series": series, "totals": totals, "diffs": diffs}


def load_rows(csv_file):
    with open(csv_file, newline="") as csv_data:
        return [dict(row) for row in csv.DictReader(csv_data)]


def load_age_data(csv_file):
    age_data = []
    try:
        with open(csv_file, newline="") as csv_data:
            for row in csv.DictReader(csv_data):
                try:
                    float(row.get("Count", ""))
                except (TypeError, ValueError):
                    warn("ignoring age row with non-numeric count: {!r}".format(row))
                    continue
                age_data.append(row)
    except OSError as error:
        warn("could not read age data {!r}: {}".format(str(csv_file), error))
    return age_data


def load_gender_data(csv_file, total_cases):
    gender_data = []
    try:
        with open(csv_file, newline="") as csv_data:
            for row in csv.DictReader(csv_data):
                try:
                    share = float(row.get("Cases by Gender", ""))
                except (TypeError, ValueError):
                    warn("ignoring gender row with non-numeric share: {!r}".format(row))
                    continue
                gender_data.append(
                    {
                        "Gender": row.get("Gender", ""),
                        "Cases by Gender": int(share * total_cases),
                    }
                )
    except OSError as error:
        warn("could not read gender data {!r}: {}".format(str(csv_file), error))
    return gender_data


def display_value(value):
    """Number for the cards, or an em dash when nothing is known."""
    return "—" if value is None else value


def js_number(value):
    """Render a chart number, using ``null`` for unknown so the chart shows a gap."""
    if value is None:
        return "null"
    return str(value)


def build_page(
    rows=None,
    data_csv=DEFAULT_OUTPUT_CSV,
    age_csv=DEFAULT_AGE_CSV,
    gender_csv=DEFAULT_GENDER_CSV,
    template_dir=DEFAULT_TEMPLATE_DIR,
):
    """Render the dashboard HTML and return it.

    ``rows`` may be supplied directly (used by tests and by ``main`` after a
    merge); otherwise they are loaded from ``data_csv``.  Nothing is printed here.
    """
    if rows is None:
        rows = load_rows(data_csv)

    stats = compute_statistics(rows)
    totals = stats["totals"]
    diffs = stats["diffs"]
    total_for_shares = totals["total"] if totals["total"] is not None else 0
    age_data = load_age_data(age_csv)
    gender_data = load_gender_data(gender_csv, total_for_shares)

    app = flask.Flask("covid19-greece", template_folder=str(template_dir))
    app.add_template_filter(js_number, "js_number")
    with app.app_context():
        rendered = render_template(
            "stats.html",
            total_cases=display_value(totals["total"]),
            total_cases_diff=format_percent(diffs["total"]),
            active_cases=display_value(totals["active"]),
            active_cases_diff=format_percent(diffs["active"]),
            deceased_cases=display_value(totals["deceased"]),
            deceased_cases_diff=format_percent(diffs["deceased"]),
            recovered_cases=display_value(totals["recovered"]),
            recovered_cases_diff=format_percent(diffs["recovered"]),
            gender_data=gender_data,
            age_data=age_data,
            case_data=stats["series"],
        )
    return rendered


def default_csv_files():
    time_series_dir = DATA_DIR / "csse_covid_19_data" / "csse_covid_19_time_series"
    return [
        time_series_dir / "time_series_covid19_confirmed_global.csv",
        time_series_dir / "time_series_covid19_deaths_global.csv",
        time_series_dir / "time_series_covid19_recovered_global.csv",
        DEFAULT_CRITICAL_CSV,
    ]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the COVID-19 Greece dashboard")
    parser.add_argument("--confirmed", default=str(default_csv_files()[0]))
    parser.add_argument("--deceased", default=str(default_csv_files()[1]))
    parser.add_argument("--recovered", default=str(default_csv_files()[2]))
    parser.add_argument("--critical", default=str(default_csv_files()[3]))
    parser.add_argument("--output-csv", default=str(DEFAULT_OUTPUT_CSV))
    parser.add_argument("--data-csv", default=None, help="merged CSV to render (defaults to --output-csv)")
    parser.add_argument("--output-html", default=None, help="also write the rendered HTML here")
    parser.add_argument("--skip-merge", action="store_true", help="render the existing merged CSV only")
    parser.add_argument("--no-print", action="store_true", help="do not print HTML to stdout")
    args = parser.parse_args(argv)

    data_csv = args.data_csv or args.output_csv
    rows = None
    if not args.skip_merge:
        rows = combine_series(
            [args.confirmed, args.deceased, args.recovered, args.critical],
            "Greece",
            "Country/Region",
            ["Province/State", "Country/Region", "Lat", "Long"],
            "Date",
            SOURCE_COLUMNS,
        )
        if rows and any(parse_count(row.get(CONFIRMED)) is not None for row in rows):
            write_to_csv(args.output_csv, rows, ["Date"] + list(SOURCE_COLUMNS))
        else:
            warn("no usable confirmed data after merge; keeping the existing merged CSV")
            rows = None

    if rows is None and not Path(data_csv).exists():
        warn("merged CSV {!r} does not exist".format(str(data_csv)))
        return 1

    rendered = build_page(rows=rows, data_csv=data_csv)
    if args.output_html:
        Path(args.output_html).write_text(rendered, encoding="utf-8")
    if not args.no_print:
        print(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
