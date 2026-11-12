{%- set dim_source -%}
source_seed: ports
{%- endset -%}

{{ optimist.build_dimension(fromyaml(dim_source)) }}
