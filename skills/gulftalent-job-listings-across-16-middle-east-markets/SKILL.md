---
name: gulftalent-job-listings-across-16-middle-east-markets
description: "Search GulfTalent by keyword, category, industry, job type or nationality preference, or browse one employer's careers page, and get salary, description and preference details. Output fields: title, companyName, salaryMin, salaryMax, salaryCurrency and more, as JSON rows. Use it for requests like \"GulfTalent job listings across 16 middle east markets\", or a CSV/JSON export of public GulfTalent data."
---

# GulfTalent Job Listings Across 16 Middle East Markets

Search GulfTalent by keyword, category, industry, job type or nationality preference, or browse one employer's careers page, and get salary, description and preference details.

- Actor: https://apify.com/vexaloom-labs/gulftalent-job-listings-across-16-middle-east (ID `vexaloom-labs~gulftalent-job-listings-across-16-middle-east`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/gulftalent-job-listings-across-16-middle-east-markets.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- GulfTalent job listings across 16 middle east markets
- a repeatable export of public GulfTalent data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `title`: Title
- `companyName`: Company Name
- `country`: Country
- `city`: City
- `salaryMin`: Salary Min
- `salaryMax`: Salary Max
- `salaryCurrency`: Salary Currency
- `median`: Median
- `sampleSize`: Sample Size
- `postedAt`: Posted At

All 12 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mode` | string | yes | search | What to collect: job search, one employer, pasted URLs, or salary benchmarks. |
| `searchQueries` | array | no | ["accountant"] | One or more job-title keywords. Each query is paginated in full and results are de-duplicated. Leave empty to browse all jobs that match the filters. |
| `country` | string | no | uae | Restrict jobs to one of GulfTalent's 38 markets. |
| `city` | string | no |  | Restrict jobs to a city. Selecting a city also selects its country. |
| `category` | string | no |  | Job function such as Accounting, Software or Logistics. |
| `industry` | string | no |  | The hiring company's industry sector. |
| `careerLevel` | string | no |  | Seniority required by the posting. |
| `employmentTypes` | array | no | [] | Any of: full-time, part-time, contract, temporary, internship. Leave empty for all types. |
| `nationality` | string | no |  | Only jobs aimed at this Gulf nationality. |
| `remoteOnly` | boolean | no | false | Keep only postings GulfTalent flags as remote. |
| `easyApplyOnly` | boolean | no | false | Keep only jobs that can be applied for on GulfTalent. |
| `exclusiveOnly` | boolean | no | false | Keep only GulfTalent-exclusive postings. |
| `postedWithinDays` | integer | no | 0 | Only jobs posted in the last N days. 0 means any age. |
| `includeKeywords` | array | no | [] | Keep only jobs whose title, description or job function contains any of these terms (case-insensitive). |

10 more optional fields on the Actor's Input tab.

Example (`references/example-input.json`):

```json
{
  "fetchFullDetails": false,
  "maxItems": 25,
  "mode": "search"
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxItems` = 25, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/vexaloom-labs~gulftalent-job-listings-across-16-middle-east/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/vexaloom-labs~gulftalent-job-listings-across-16-middle-east/runs" \
  -H "Authorization: Bearer $APIFY_TOKEN" -H "Content-Type: application/json" \
  -d @references/example-input.json)
RUN_ID=$(echo "$RUN" | jq -r '.data.id'); DATASET=$(echo "$RUN" | jq -r '.data.defaultDatasetId')
curl -s "https://api.apify.com/v2/actor-runs/$RUN_ID?waitForFinish=60" -H "Authorization: Bearer $APIFY_TOKEN" | jq -r '.data.status'
curl -s "https://api.apify.com/v2/datasets/$DATASET/items?format=json" -H "Authorization: Bearer $APIFY_TOKEN" > output.json
```

## Cost and limits

- Apify bills the Actor's usage on your account; the Actor's Pricing tab shows the current price.
- Keep the limit in the input small for a first run.

## Guardrails

- Public data only. Do not pass cookies, sessions or private account data.
- Do not use the output for spam, harassment or unlawful discrimination.
- Check the target site's terms and local law before running at scale.
