-- Fails if any broadcast has a Speed Over Ground outside the valid AIS range (0–102.3 knots).
-- Values above 102.3 are not valid AIS SOG readings and indicate corrupt data.
select *
from {{ ref('stg_noaa__guam_2025') }}
where sog is not null
  and (sog < 0 or sog > 102.3)
