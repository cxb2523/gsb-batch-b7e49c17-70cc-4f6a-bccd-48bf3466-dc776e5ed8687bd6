{%- set dim_source -%}
source_model: stg_noaa__guam_2025
{%- endset -%}

{{ optimist.build_dimension(fromyaml(dim_source)) }}
