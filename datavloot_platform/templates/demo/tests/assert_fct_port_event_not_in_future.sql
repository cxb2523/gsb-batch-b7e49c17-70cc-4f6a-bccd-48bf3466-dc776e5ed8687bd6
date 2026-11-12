-- Fails if any port event is timestamped in the future.
-- AIS broadcasts are historical; a future timestamp indicates bad source data.
select *
from {{ ref('fct_port_event') }}
where event_time > current_timestamp
