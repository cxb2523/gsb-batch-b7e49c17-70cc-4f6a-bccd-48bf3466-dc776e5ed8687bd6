-- Arrival/departure events derived from AIS position broadcasts,
-- enriched with marine weather conditions at the time of each event.
--
-- Detection logic:
--   1. Parse lon/lat out of the geometry string (WKT POINT format).
--   2. Restrict to ports near Guam (lat 12–15, lon 143–146) to keep the
--      cross-join small before computing full Haversine distances.
--   3. For each (vessel, port) pair ordered by time, flag broadcasts within
--      1.5 nautical miles of the port as "at port".
--   4. A state change from NOT-at-port → at-port = arrival.
--      A state change from at-port → NOT-at-port = departure.
--
-- Weather enrichment:
--   5. Join Open-Meteo hourly conditions at the truncated event hour.
--   6. Range-join sea_state_categories on wind speed to resolve sea_state_code
--      (thresholds defined once in the seed; no duplication here).

-- depends_on: {{ ref('dim_vessel') }}
-- depends_on: {{ ref('dim_port') }}
-- depends_on: {{ ref('dim_date') }}
-- depends_on: {{ ref('dim_time') }}
-- depends_on: {{ ref('dim_sea_state') }}

{% set source_config %}
source_cte: port_events
{% endset %}

with

-- imports
broadcasts_raw as (

    select * from {{ ref('stg_noaa__guam_2025') }}

),

ports_raw as (

    select * from {{ ref('ports') }}

),

weather_raw as (

    select * from {{ ref('stg_open_meteo__guam_atmo_hourly') }}

),

sea_state_categories as (

    select * from {{ ref('sea_state_categories') }}

),

-- transform
broadcasts as (

    select
        mmsi,
        base_date_time,
        sog,
        status,
        cast(regexp_extract(geometry, 'POINT \(([0-9.\-]+) [0-9.\-]+\)', 1) as double) as longitude,
        cast(regexp_extract(geometry, 'POINT \([0-9.\-]+ ([0-9.\-]+)\)', 1) as double) as latitude
    from broadcasts_raw

),

guam_ports as (

    select
        port_index_number,
        latitude  as port_lat,
        longitude as port_lon
    from ports_raw
    where latitude  between 12.0 and 15.0
      and longitude between 143.0 and 146.0

),

proximity as (

    select
        b.mmsi,
        b.base_date_time,
        b.sog,
        b.status,
        p.port_index_number,
        2 * 3440.065 * asin(sqrt(
            power(sin(radians((p.port_lat - b.latitude)  / 2)), 2) +
            cos(radians(b.latitude)) * cos(radians(p.port_lat)) *
            power(sin(radians((p.port_lon - b.longitude) / 2)), 2)
        )) as distance_nm
    from broadcasts b
    cross join guam_ports p
    where b.latitude  is not null
      and b.longitude is not null

),

classified as (

    select
        mmsi,
        base_date_time,
        sog,
        status,
        port_index_number,
        distance_nm <= 1.5 as is_at_port
    from proximity

),

transitions as (

    select
        mmsi,
        base_date_time,
        sog,
        status,
        port_index_number,
        is_at_port,
        coalesce(
            lag(is_at_port) over (
                partition by mmsi, port_index_number
                order by base_date_time
            ),
            false
        ) as prev_is_at_port
    from classified

),

port_events_base as (

    select
        mmsi,
        base_date_time                                      as event_time,
        date_trunc('hour', base_date_time)                  as event_hour,
        cast(date_trunc('minute', base_date_time) as time)  as event_time_minute,
        port_index_number,
        sog,
        -- degenerate dimension: AIS status codes have ~20 values but are sparse
        -- and operator-entered; a full dim_status table would add noise without value.
        status,
        (prev_is_at_port = true and is_at_port = false)     as is_departure
    from transitions
    where
        (prev_is_at_port = false and is_at_port = true)
        or (prev_is_at_port = true  and is_at_port = false)

),

weather as (

    select
        cast(timestamp as timestamp) as weather_hour,
        wind_speed_10m_kn
    from weather_raw

),

port_events as (

    select
        e.mmsi,
        e.event_time,
        e.event_time_minute,
        e.port_index_number,
        e.sog,
        e.status,
        e.is_departure,
        s.sea_state_code
    from port_events_base e
    left join weather w
        on e.event_hour = w.weather_hour
    left join sea_state_categories s
        on  w.wind_speed_10m_kn >= s.min_wind_speed_kn
        and w.wind_speed_10m_kn <  s.max_wind_speed_kn

)

{{ optimist.build_fact(fromyaml(source_config)) }}
