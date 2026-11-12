{%- set dim_source -%}
source_seed: sea_state_categories
{%- endset -%}

{{ optimist.build_dimension(fromyaml(dim_source)) }}
