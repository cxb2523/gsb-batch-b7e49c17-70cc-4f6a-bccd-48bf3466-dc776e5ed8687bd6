---
marp: true
theme: gaia
paginate: true
---

<!-- _class: lead -->

# Building a dbt project from a conversation

**optimist-toolkit × Claude**
*A demo of the captain & crew model*

---

## The toolkit

**optimist-toolkit** is a shared dbt package that provides:

- Standardised macros (`stage_source`, `build_dimension`, `build_fact`)
- Conventions and naming rules
- A scaffold for new projects to copy

It is designed to be used by **AI agents** (crew) following instructions from a **human** (captain).

> *Captain* — describes what they want to understand or measure
> *Crew* — translates that into working dbt models

---

## The ask

> "I am now your captain, and I don't know much about data engineering.
> I simply wish to create a dbt project with NOAA data."

**Goals set by the captain:**
- Arrivals and departures of vessels at ports
- Filter by port, vessel, date and time
- Questions like: *"How many vessels arrived at port X in November 2025?"*

---

<!-- _class: lead -->

## Step 0 — Pre-departure

*Before writing a single file, the data-instructions.md requires the crew to ask four questions*

---

## Pre-departure checklist

| # | Question | Why it matters |
|---|---|---|
| 1 | What business process or data? | Scopes the project |
| 2 | What source systems? | Determines the source layer |
| 3 | What questions to answer? | Drives which dims and facts to build |
| 4 | What is the grain of each fact? | Defines the row-level contract |

The captain answered by sharing two CSV files.

---

## The data

**`guam_2025.csv`** — NOAA Marine Cadastre AIS data

| Column | Description |
|---|---|
| `mmsi` | Vessel ID (like a phone number for ships) |
| `base_date_time` | UTC timestamp of each broadcast |
| `sog` | Speed Over Ground (knots) |
| `status` | Navigational status (0=underway, 5=moored…) |
| `geometry` | `POINT (lon lat)` — vessel position |

**`ports.csv`** — NGA World Port Index, 3,804 global ports with lat/lon

---

## The key insight

AIS data is **position broadcasts** — not events.

Every few seconds, each vessel transmits its GPS coordinates.
There are no "arrival" or "departure" rows in the raw data.

→ We have to *detect* port calls from movement patterns.

---

## Detection approach

1. Parse `POINT (lon lat)` → extract longitude and latitude
2. Cross-join broadcasts with nearby Guam ports
3. Calculate Haversine distance for each broadcast
4. Flag broadcasts within **1.5 nautical miles** as *at port*
5. Detect state transitions using `lag()` over time

outside → inside = **arrival** · inside → outside = **departure**

---

<!-- _class: lead -->

## What got built

*Seven steps, in order — each depending on the previous*

---

## Project structure

```
seeds/
└── ports.csv               ← 3,804 ports (11 clean columns)
models/
├── source/
│   ├── _sources.yml        ← raw.guam_2025 source definition
│   ├── _schema.yml         ← staging model docs + tests
│   └── stg_noaa__guam_2025.sql
└── business/
    ├── dimensions/
    │   ├── dim_vessel.sql  ← one row per unique MMSI
    │   └── dim_port.sql    ← one row per port
    └── facts/
        └── fct_port_event.sql  ← one row per arrival or departure
tests/
├── assert_fct_port_event_not_in_future.sql
└── assert_stg_noaa_sog_in_range.sql
```

---

## Step 1–2 — Source & staging

**`_sources.yml`** — tells dbt where the raw data lives:
```yaml
sources:
  - name: noaa
    schema: raw
    tables:
      - name: guam_2025
```

**`stg_noaa__guam_2025.sql`** — one line, does everything:
```sql
{{ config(materialized='view') }}
{{ optimist.stage_source('noaa', 'guam_2025',
     deduplicate_by=['mmsi', 'base_date_time'],
     order_by='base_date_time desc') }}
```

`view` because the data is static · deduplication handles duplicate AIS broadcasts

---

## Step 3 — Dimensions: `dim_vessel`

One row per unique vessel, most recent attributes kept:
```yaml
meta:
  source_model: stg_noaa__guam_2025
  surrogate_key:
    columns: [mmsi]
  deduplicate:
    partition_by: [mmsi]
    order_by: base_date_time desc
```

SQL: `{{ optimist.build_dimension() }}`

---

## Step 3 — Dimensions: `dim_port`

One row per port, straight from the seed:
```yaml
meta:
  source_seed: ports
  surrogate_key:
    columns: [port_index_number]
    # alias omitted -> defaults to port_key
```

SQL: `{{ optimist.build_dimension() }}`

---

## Step 4 — The fact model

```sql
with broadcasts as (
    -- parse lon/lat from POINT (lon lat)
    cast(regexp_extract(geometry, 'POINT \(([0-9.\-]+) …', 1) as double) as longitude,
    …
),
guam_ports as (
    -- only ports within lat 12–15, lon 143–146
    …
),
proximity as (
    -- Haversine distance in nautical miles
    2 * 3440.065 * asin(sqrt(…)) as distance_nm
    from broadcasts cross join guam_ports
),
classified as ( distance_nm <= 1.5 as is_at_port … ),
transitions as ( lag(is_at_port) over (partition by mmsi, port_index_number
                                        order by base_date_time) … ),
port_events as (
    where (prev = false and now = true)   -- arrival
       or (prev = true  and now = false)  -- departure
)

{{ optimist.build_fact() }}   ← macro takes it from here
```

---

## Step 4 — Fact config

```yaml
- name: fct_port_event
  meta:
    source_cte: port_events       ← macro continues from our last CTE
    surrogate_key:
      columns: [mmsi, port_index_number, event_time]
      alias: fct_port_event_key
    dimensions:
      - dim: dim_vessel            fk: mmsi
      - dim: dim_port              fk: port_index_number
      - dim: dim_date              fk: event_time   fk_cast: date
      - dim: dim_time              fk: event_time_minute
    columns:
      - event_time
      - is_departure
      - sog
      - status
```

---

## A last-minute addition

> "I'd like a relationship with `dim_time` as well"

**The problem:** `dim_time` keys on `time_of_day` (TIME at **minute** precision).
A simple `cast(event_time as time)` keeps the seconds — every join would miss.

**The fix:** add one computed column to `port_events`:

```sql
cast(date_trunc('minute', base_date_time) as time) as event_time_minute
```

Then join `dim_time` on `event_time_minute → time_of_day`.

Now you can group arrivals/departures by `hour`, `period_of_day`, `is_business_hours`.

---

## Step 7 — Data quality tests

**YAML tests** (in config files, run automatically):
- `not_null` + `unique` on every surrogate and natural key
- `relationships` from fact FK columns to their dims
- `not_null` on `is_departure`, `event_time`

**Singular tests** (custom SQL, fails if any rows returned):
```sql
-- assert_fct_port_event_not_in_future.sql
select * from {{ ref('fct_port_event') }}
where event_time > current_timestamp

-- assert_stg_noaa_sog_in_range.sql
select * from {{ ref('stg_noaa__guam_2025') }}
where sog is not null and (sog < 0 or sog > 102.3)
```

---

## Data lineage

```
seeds/ports.csv
    └──▶ dim_port ──────────────────────────────────┐
                                                     │
raw.guam_2025 (DuckDB)                               ▼
    └──▶ stg_noaa__guam_2025                   fct_port_event
              ├──▶ dim_vessel ────────────────────────┤
              └──────────────────────────────────────┘
                                                     │
                                   dim_date ─────────┤
                                   dim_time ─────────┘
```

---

<!-- _class: lead -->

## Demo

*Let's run it*

---

## Running the project

```bash
# 1. Install dependencies
pip install -e ".[dev]"

# 2. Install the optimist-toolkit package
dbt deps

# 3. Start Dagster (ingests data, seeds, builds models, runs tests)
dagster dev
```

---

<!-- _class: lead -->

# Thank you

**optimist-toolkit** — github.com/datavloot/datavloot-toolkit

*Built in a single conversation between a captain who doesn't know data engineering
and a crew who asked the right questions first.*
