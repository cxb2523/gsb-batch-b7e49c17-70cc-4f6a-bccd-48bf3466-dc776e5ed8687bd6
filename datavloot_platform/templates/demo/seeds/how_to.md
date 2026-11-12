# Seeds

Seeds are CSV files checked into the repository and loaded into the warehouse by dbt.
Use them for small, (near-)static reference data that gives context to processed data.

---

## When to use a seed

| Use case | Example |
|---|---|
| Code → label mappings | Raw status codes (`1`, `2`, `3`) → `Active`, `Suspended`, `Closed` |
| Lookup tables | Country ISO codes → country names and regions |
| Business-defined categories | Priority levels with sort order and urgency flags |
| Fiscal calendar overrides | Public holidays that override `is_weekend`/`is_weekday` in `dim_date` |
| Threshold or rule tables | SLA targets per product tier |

The common thread: the data is **defined by the business**, not extracted from a source system,
and it changes rarely enough that a git commit is the right change mechanism.

---

## When not to use a seed

- **Large data** — seeds are loaded in full on every `dbt seed`. Keep them under a few thousand rows.
- **Frequently changing data** — if it changes more than a few times a year, use a source table instead.
- **Data that already exists in a source system** — use `source()` + `stage_source()`.
- **Sensitive or PII data** — seeds live in git; never put personal data or credentials here.

---

## How to add a seed

1. Add a CSV file to this `seeds/` directory: `<seed_name>.csv`
2. Add an entry to `_seeds.yml` with a description and column docs
3. Reference it in a dimension config with `source_seed: <seed_name>`
4. Run `dbt seed` to load it, then `dbt run` to build dependent models

---

## Using a seed as a dimension source

```yaml
# models/business/dimensions/_dim_configs.yml
- name: dim_priority
  description: "Priority level dimension sourced from the priority_levels seed."
  meta:
    source_seed: priority_levels
    surrogate_key:
      columns: [priority_id]
    columns:
      - priority_id
      - priority_label
      - priority_order
      - is_urgent
```

```sql
-- models/business/dimensions/dim_priority.sql
{{ optimist.build_dimension() }}
```
