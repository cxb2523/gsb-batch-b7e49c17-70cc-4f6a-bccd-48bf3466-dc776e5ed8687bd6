---
name: unsplash-photo-search-by-topic-collection-and-creator
description: "Searches Unsplash by keyword or browses a curated topic, numbered collection, or photographer's portfolio, returning photo dimensions, orientation, license, and photographer credit. Output fields: title, photographerName, orientation, width, likes and more, as JSON rows. Use it for requests like \"Unsplash photo search\", or a CSV/JSON export of public Unsplash data."
---

# Unsplash Photo Search by Topic, Collection & Creator

Searches Unsplash by keyword or browses a curated topic, numbered collection, or photographer's portfolio, returning photo dimensions, orientation, license, and photographer credit.

- Actor: https://apify.com/dataspryva/unsplash-photo-search-by-topic-collection (ID `dataspryva~unsplash-photo-search-by-topic-collection`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/unsplash-photo-search-by-topic-collection-and-creator.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- Unsplash photo search
- a repeatable export of public Unsplash data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `title`: Title
- `photographerName`: Photographer Name
- `orientation`: Orientation
- `width`: Width
- `height`: Height
- `likes`: Likes
- `imageUrl`: Image Url

All 8 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mode` | string | yes | search | What to scrape. Each mode has its own list field below. |
| `searchQueries` | array | no | ["nature"] | One or more keywords, e.g. `nature`, `coffee shop`, `minimal workspace`. Each query is searched separately. |
| `topicSlugs` | array | no | [] | One or more curated Unsplash photo topics. |
| `collectionIds` | array | no | [] | Collection IDs or collection URLs, e.g. `1065396` or `https://unsplash.com/collections/1065396/...`. |
| `usernames` | array | no | [] | Photographer usernames with or without `@`, or profile URLs, e.g. `v2osk` or `https://unsplash.com/@v2osk`. |
| `photoIds` | array | no | [] | Unsplash photo IDs, slugs, or photo page URLs, e.g. `fWBZ9r4vO9M`. Used as lookup targets in byPhoto and as seed photos in byRelated. |
| `startUrls` | array | no | [] | Any mix of supported Unsplash search, topic, collection, photographer, or photo URLs. |
| `orientation` | string | no | any | Only keep photos of this orientation. The filter is exact and works in every mode. |
| `color` | string | no | any | Filter keyword searches by Unsplash's dominant-colour tag. Not supported on topic, collection, or portfolio feeds. |
| `freeOnly` | boolean | no | false | Exclude Unsplash+ (paid/locked) photos. Their full-size files require a separate Unsplash+ plan. |
| `searchOrderBy` | string | no | relevant | Sort keyword search results by best match or newest first. |
| `userOrderBy` | string | no | pinned | Sort a photographer's photos. Pinned matches the order shown on their Unsplash profile. |
| `includePhotoDetails` | boolean | no | false | Add tags, camera EXIF, geolocation, topics, and view/download counts. Costs extra requests per photo and is slower. |
| `includePhotographerStats` | boolean | no | false | Add each photographer's lifetime view and download totals. One extra request per photographer. |

1 more optional field on the Actor's Input tab.

Example (`references/example-input.json`):

```json
{
  "maxItems": 25,
  "mode": "search"
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxItems` = 25, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~unsplash-photo-search-by-topic-collection/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~unsplash-photo-search-by-topic-collection/runs" \
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
