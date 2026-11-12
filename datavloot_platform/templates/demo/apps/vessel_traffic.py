import marimo

__generated_with = "0.24.2"
app = marimo.App(width="full", app_title="Vessel traffic — Guam 2025")


@app.cell
def _():
    # An app: this notebook is in apps/, so the Crows Nest's Dashboards tab runs
    # it with `marimo run`, showing its output and not its code. Explore in
    # notebooks/explore_noaa.py; put here what others should read.
    import altair as alt
    import marimo as mo
    from pathlib import Path
    from datavloot_platform import storage

    # Read-only, so the app can stay open while a pipeline writes.
    PROJECT_DIR = Path(__file__).parent.parent
    con = storage.connect(PROJECT_DIR, read_only=True)

    # Two series (arrivals, departures) and a sequential ramp, from a palette
    # checked for colour blindness and contrast.
    ARRIVALS, DEPARTURES = "#2a78d6", "#eb6834"
    RAMP = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#104281"]
    return ARRIVALS, DEPARTURES, RAMP, alt, con, mo


@app.cell
def _(con):
    # One row per port event, with what the filters and charts need. Small
    # enough to keep in memory, so every filter change is instant.
    events = con.sql("""
        SELECT
            f.event_time,
            CASE WHEN f.is_departure THEN 'Departure' ELSE 'Arrival' END AS event,
            p.port_name,
            v.mmsi,
            COALESCE(v.vessel_name, 'MMSI ' || v.mmsi) AS vessel_name,
            -- AIS ship type codes (ITU-R M.1371), grouped the way a harbour
            -- master would. A seed would be the place for this once it grows.
            CASE
                WHEN v.vessel_type BETWEEN 70 AND 79 THEN 'Cargo'
                WHEN v.vessel_type BETWEEN 80 AND 89 THEN 'Tanker'
                WHEN v.vessel_type BETWEEN 60 AND 69 THEN 'Passenger'
                WHEN v.vessel_type = 30 THEN 'Fishing'
                WHEN v.vessel_type IN (31, 32, 52) THEN 'Tug and towing'
                WHEN v.vessel_type IN (36, 37) THEN 'Sailing and pleasure'
                WHEN v.vessel_type IN (35, 55) THEN 'Military and law enforcement'
                WHEN v.vessel_type IS NULL THEN 'Unknown'
                ELSE 'Other'
            END AS vessel_category,
            COALESCE(s.label, 'No weather data') AS sea_state,
            COALESCE(s.min_wind_speed_kn, 999) AS sea_state_order
        FROM noaa_business.fct_port_event f
        JOIN noaa_business.dim_port p USING (port_key)
        LEFT JOIN noaa_business.dim_vessel v USING (vessel_key)
        LEFT JOIN noaa_business.dim_sea_state s USING (sea_state_key)
    """).df()
    return (events,)


@app.cell
def _(events, mo):
    port = mo.ui.dropdown(
        options=["All ports", *events["port_name"].value_counts().index],
        value="All ports",
        label="Port",
    )
    categories = mo.ui.multiselect(
        options=sorted(events["vessel_category"].unique()),
        label="Vessel category (none = all)",
    )
    months = mo.ui.range_slider(start=1, stop=12, value=[1, 12], label="Months", show_value=True)

    mo.vstack([
        mo.md(
            "# Vessel traffic around Guam, 2025\n"
            "Arrivals and departures derived from AIS position broadcasts (NOAA), "
            "with the sea state at the time from Open-Meteo."
        ),
        mo.hstack([port, categories, months], justify="start", gap=2),
    ])
    return categories, months, port


@app.cell
def _(categories, events, months, port):
    _rows = events[events["event_time"].dt.month.between(*months.value)]
    if port.value != "All ports":
        _rows = _rows[_rows["port_name"] == port.value]
    if categories.value:
        _rows = _rows[_rows["vessel_category"].isin(categories.value)]
    selection = _rows
    return (selection,)


@app.cell
def _(mo, selection):
    _arrivals = selection[selection["event"] == "Arrival"]
    _by_hour = _arrivals["event_time"].dt.hour.value_counts()
    _busiest = f"{_by_hour.idxmax():02d}:00 UTC" if len(_by_hour) else "–"
    mo.hstack(
        [
            mo.stat(f"{len(_arrivals):,}", label="Arrivals"),
            mo.stat(f"{(selection['event'] == 'Departure').sum():,}", label="Departures"),
            mo.stat(f"{selection['mmsi'].nunique():,}", label="Vessels"),
            mo.stat(_busiest, label="Busiest arrival hour"),
        ],
        widths="equal",
        gap=1,
    )
    return


@app.cell
def _(ARRIVALS, DEPARTURES, alt, mo, selection):
    _monthly = (
        selection.assign(month=selection["event_time"].dt.to_period("M").dt.to_timestamp())
        .groupby(["month", "event"])
        .size()
        .reset_index(name="events")
    )
    _chart = (
        alt.Chart(_monthly)
        # Plain rectangles with a gap between the pair: rounded corners and bars
        # that touch are drawn as paths whose edges leave white specks on the
        # canvas at some zoom levels and widths.
        .mark_bar()
        .encode(
            x=alt.X("month(month):O", title=None),
            xOffset=alt.XOffset("event:N", scale=alt.Scale(paddingInner=0.08)),
            y=alt.Y("events:Q", title="Port events"),
            color=alt.Color(
                "event:N",
                title=None,
                scale=alt.Scale(domain=["Arrival", "Departure"], range=[ARRIVALS, DEPARTURES]),
                legend=alt.Legend(orient="top"),
            ),
            tooltip=[
                alt.Tooltip("month(month):O", title="Month"),
                alt.Tooltip("event:N", title="Event"),
                alt.Tooltip("events:Q", title="Events", format=","),
            ],
        )
        .properties(width="container", height=260)
    )
    mo.vstack([mo.md("## Arrivals and departures per month"), _chart])
    return


@app.cell
def _(RAMP, alt, mo, selection):
    _arrivals = selection[selection["event"] == "Arrival"]
    _grid = (
        _arrivals.assign(
            weekday=_arrivals["event_time"].dt.day_name(),
            hour=_arrivals["event_time"].dt.hour,
        )
        .groupby(["weekday", "hour"])
        .size()
        .reset_index(name="arrivals")
    )
    _days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    _chart = (
        alt.Chart(_grid)
        .mark_rect(cornerRadius=2)
        .encode(
            x=alt.X("hour:O", title="Hour of day (UTC)", axis=alt.Axis(labelAngle=0)),
            y=alt.Y("weekday:N", title=None, sort=_days),
            color=alt.Color("arrivals:Q", title="Arrivals", scale=alt.Scale(range=RAMP)),
            tooltip=[
                alt.Tooltip("weekday:N", title="Day"),
                alt.Tooltip("hour:O", title="Hour (UTC)"),
                alt.Tooltip("arrivals:Q", title="Arrivals"),
            ],
        )
        .properties(width="container", height=220)
    )
    mo.vstack([mo.md("## When vessels arrive"), _chart])
    return


@app.cell
def _(ARRIVALS, alt, mo, selection):
    def _bars(counts, field, title, sort):
        return (
            alt.Chart(counts)
            .mark_bar(color=ARRIVALS, cornerRadiusEnd=3, size=16)
            .encode(
                x=alt.X("events:Q", title="Port events"),
                y=alt.Y(f"{field}:N", title=None, sort=sort, axis=alt.Axis(labelLimit=220)),
                tooltip=[alt.Tooltip(f"{field}:N", title=title), alt.Tooltip("events:Q", title="Events", format=",")],
            )
            .properties(width="container", height=alt.Step(26))
        )

    _by_category = selection.groupby("vessel_category").size().reset_index(name="events")
    _by_sea = (
        selection.groupby(["sea_state", "sea_state_order"]).size().reset_index(name="events")
        .sort_values("sea_state_order")
    )
    mo.hstack(
        [
            mo.vstack([mo.md("## By vessel category"), _bars(_by_category, "vessel_category", "Category", "-x")]),
            mo.vstack([
                mo.md("## By sea state"),
                _bars(_by_sea, "sea_state", "Sea state", list(_by_sea["sea_state"])),
            ]),
        ],
        widths="equal",
        gap=2,
        align="start",
    )
    return


@app.cell
def _(mo, selection):
    _busiest = (
        selection.groupby(["vessel_name", "vessel_category"])
        .agg(
            arrivals=("event", lambda e: int((e == "Arrival").sum())),
            departures=("event", lambda e: int((e == "Departure").sum())),
            last_seen=("event_time", "max"),
        )
        .reset_index()
        .sort_values("arrivals", ascending=False)
        .head(10)
        .assign(last_seen=lambda t: t["last_seen"].dt.strftime("%Y-%m-%d %H:%M"))
        .reset_index(drop=True)
        .rename(columns={"vessel_name": "Vessel", "vessel_category": "Category", "arrivals": "Arrivals",
                         "departures": "Departures", "last_seen": "Last event (UTC)"})
    )
    mo.vstack([
        mo.md("## Most frequent visitors"),
        mo.ui.table(_busiest, selection=None, show_column_summaries=False, show_data_types=False, pagination=False),
    ])
    return


if __name__ == "__main__":
    app.run()
