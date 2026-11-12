-- Date range defaults to 2015-01-01 -> 2035-12-31. Override via dim_date_start/dim_date_end
-- vars in dbt_project.yml, or pass start_date/end_date directly to the macro below.
{{ optimist.build_dim_date() }}
