-- Grain defaults to 'minute' (1 440 rows). For second-level granularity (86 400 rows),
-- set dim_time_grain: 'second' in dbt_project.yml vars, or pass grain='second' below.
{{ optimist.build_dim_time() }}
