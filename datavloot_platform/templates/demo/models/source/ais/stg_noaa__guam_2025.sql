{{ config(unique_key=['mmsi', 'base_date_time']) }}
{{
    optimist.stage_source(
        'noaa',
        'guam_2025',
        deduplicate_by=['mmsi', 'base_date_time'],
        order_by='base_date_time desc',
        incremental_column='base_date_time'
    )
}}
