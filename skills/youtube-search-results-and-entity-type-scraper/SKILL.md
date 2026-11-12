---
name: youtube-search-results-and-entity-type-scraper
description: "Search YouTube by keyword for videos, Shorts, channels, or playlists, with view counts, duration, and channel details, filterable by upload date, duration, sort order, and region. Output fields: title, channelName, viewCount, publishedAt, publishedTimeText and more, as JSON rows. Use it for requests like \"YouTube search results scraper\", or a CSV/JSON export of public YouTube data."
---

# YouTube Search Results & Entity Type Scraper

Search YouTube by keyword for videos, Shorts, channels, or playlists, with view counts, duration, and channel details, filterable by upload date, duration, sort order, and region.

- Actor: https://apify.com/vexaloom-labs/youtube-search-results-and-entity-type-scraper (ID `vexaloom-labs~youtube-search-results-and-entity-type-scraper`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/youtube-search-results-and-entity-type-scraper.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- YouTube search results scraper
- a repeatable export of public YouTube data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `videoId`: Video ID
- `title`: Title
- `channelName`: Channel
- `viewCount`: Views
- `publishedAt`: Published At
- `publishedTimeText`: Published
- `duration`: Duration
- `url`: URL

All 42 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `searchQueries` | array | yes |  | One or more YouTube search terms. Each query is scraped separately and its results are combined in the dataset. |
| `maxResults` | integer | no | 20 | Maximum number of results per query. YouTube may serve fewer rows for a given query, entity type, session, or IP; the run reports the requested and actual counts and whether the… |
| `scrapeAllResults` | boolean | no | false | Keep loading pages until YouTube stops offering results. This ignores Max Results Per Query and can take longer on broad searches. |
| `sortBy` | string | no | relevance | Order of the search results. YouTube currently supports relevance and popularity (view count). |
| `uploadDate` | string | no |  | Only return results uploaded in the selected period. Applies to videos and Shorts. |
| `type` | string | no |  | Restrict results to one entity type. Legacy plural value shorts is accepted and mapped to Shorts. |
| `duration` | string | no |  | Filter videos by length. Applies to video and Shorts searches. |
| `features` | array | no | [] | Filter videos by features. Multiple selections are combined. Legacy aliases cc, location, and purchased are accepted for saved tasks; cc maps to subtitles and the other two are… |
| `market` | string | no | US | Country used for YouTube's search context (gl). Results and labels follow this market. |
| `language` | string | no | auto | Language for YouTube labels and search text (hl). Auto follows the selected market. |
| `includeVideoDetails` | boolean | no | false | Fetch each video's public detail payload to add exact publish date, views, likes, category, tags, and full description. Adds one request per video and makes runs slower. |

Example (`references/example-input.json`):

```json
{
  "searchQueries": [
    "apify"
  ],
  "maxResults": 25,
  "type": "video"
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxResults` = 25, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/vexaloom-labs~youtube-search-results-and-entity-type-scraper/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/vexaloom-labs~youtube-search-results-and-entity-type-scraper/runs" \
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
