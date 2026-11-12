---
name: youtube-trending-feed-extractor-by-category-and-market
description: "Get video lists for YouTube's Gaming, Music, News, Movies and Trending sections in any of 31 regional markets, with views, duration and channel details; rows from a fallback search are labeled. Output fields: sourceName, title, channelName, chartViewCount, viewCount and more, as JSON rows. Use it for requests like \"YouTube trending feed scraper\", or a CSV/JSON export of public YouTube data."
---

# YouTube Trending Feed Extractor by Category & Market

Get video lists for YouTube's Gaming, Music, News, Movies and Trending sections in any of 31 regional markets, with views, duration and channel details; rows from a fallback search are labeled.

- Actor: https://apify.com/nimbryxo-studio/youtube-trending-feed-extractor-by-category (ID `nimbryxo-studio~youtube-trending-feed-extractor-by-category`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/youtube-trending-feed-extractor-by-category-and-market.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- YouTube trending feed scraper
- a repeatable export of public YouTube data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `sourceName`: Source
- `title`: Title
- `channelName`: Channel
- `chartViewCount`: Chart Views
- `viewCount`: Lifetime Views
- `countryCode`: Country
- `chartType`: Chart
- `url`: URL
- `status`: Status

All 70 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mode` | string | yes | charts | What to read. 'charts' uses YouTube's official music, trailer and podcast charts. 'hubs' uses YouTube's category pages such as Gaming trending, News, Sports, Learning and Courses. |
| `charts` | array | no | ["trendingVideos"] | One or more YouTube charts. Trending music videos is the official replacement for the retired general Trending page. |
| `categories` | array | no | ["gaming"] | One or more category pages. Gaming trending and Gaming live return up to 50 videos. News reads the selected news sections. |
| `newsSections` | array | no | ["top"] | Which News tabs to read. 'Top stories' is the main /news page; the other sections are direct news-destination feeds. Available sections vary by country. |
| `countries` | array | no | ["US"] | One or more markets. The 68 YouTube Charts markets are supported; 'global' is supported only for charts that publish a global ranking (top videos, top songs, top artists, Shorts… |
| `period` | string | no | daily | Daily or weekly ranking. Weekly-only charts automatically use weekly. Current-only charts such as Trending music videos and Trending movie trailers ignore this setting. |
| `date` | string | no |  | Historical chart date in YYYY-MM-DD format. Leave empty for the latest chart. Supported by Top music videos, Top songs, Top artists and Shorts songs; current-only charts ignore it. |
| `maxItems` | integer | no | 100 | Total data rows to return across all charts, categories and countries. |
| `maxItemsPerChart` | integer | no | 100 | Rows to take from each chart/country or category/country combination. Source ceilings still apply. |
| `includeVideoDetails` | boolean | no | true | Fetch exact lifetime views, likes, upload dates and descriptions for every video. YouTube category, tags, Shorts eligibility and family-safe flags are filled when YouTube's player… |
| `maxConcurrency` | integer | no | 5 | How many exact-detail requests may run in parallel. |
| `onlyNew` | boolean | no | false | Skip rows already emitted by a previous run with the same monitor name. |
| `monitorName` | string | no | default | Separate only-new histories by monitor name. |

Example (`references/example-input.json`):

```json
{
  "maxItems": 25,
  "maxItemsPerChart": 3,
  "includeVideoDetails": false,
  "maxConcurrency": 3,
  "mode": "charts"
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxItems` = 25, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/nimbryxo-studio~youtube-trending-feed-extractor-by-category/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/nimbryxo-studio~youtube-trending-feed-extractor-by-category/runs" \
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
