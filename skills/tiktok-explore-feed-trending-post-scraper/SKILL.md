---
name: tiktok-explore-feed-trending-post-scraper
description: "Collect trending posts from TikTok's Explore feed across one or more content categories, with engagement stats, author snapshot, sound and video details. Can also try to discover category IDs. Output fields: rank, marketRegion, playCount, likeCount, playsPerHour and more, as JSON rows. Use it for requests like \"TikTok explore feed trending post scraper\", or a CSV/JSON export of public TikTok data."
---

# TikTok Explore Feed Trending Post Scraper

Collect trending posts from TikTok's Explore feed across one or more content categories, with engagement stats, author snapshot, sound and video details. Can also try to discover category IDs.

- Actor: https://apify.com/nimbryxo-studio/tiktok-explore-feed-trending-post-scraper (ID `nimbryxo-studio~tiktok-explore-feed-trending-post-scraper`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/tiktok-explore-feed-trending-post-scraper.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- TikTok explore feed trending post scraper
- a repeatable export of public TikTok data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `rank`: Rank
- `marketRegion`: Market
- `categoryName`: Category
- `categoryId`: Category ID
- `itemCategoryName`: Item Category
- `feedType`: Feed Type
- `postId`: Post ID
- `caption`: Caption
- `playCount`: Plays
- `likeCount`: Likes
- `engagementRate`: Engagement Rate
- `ageHours`: Age (hours)
- `playsPerHour`: Plays / Hour
- `createdAt`: Created At
- `postUrl`: Post URL
- `mediaRehosted`: Media Rehosted
- `mediaRehostedAll`: All Media Rehosted
- `rehostStatus`: Rehost Status

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `categories` | array | yes | ["All"] | Categories to collect. Accepts names, numeric IDs, or legacy {id,name} objects. All=120; topics 100-119: Anime & Comics, Shows, Beauty Care, Games, Comedy, Daily Life, Family… |
| `maxItemsPerCategory` | integer | no | 3 | Hard cap on emitted posts per category. The cap is applied before any page is pushed, so a 30-item page never overshoots. |
| `maxItems` | integer | no |  | Legacy alias for maxItemsPerCategory. It is used when maxItemsPerCategory is absent or exactly the default 3; an explicitly non-default maxItemsPerCategory wins. |
| `categoryId` | integer | no |  | Legacy shorthand for one category. It replaces the categories list. 100-120 are accepted; 123 maps to 120; other values are skipped with a warning. |
| `autoDiscoverCategories` | boolean | no | false | When true, an empty or All-only selection expands to all 21 verified Explore categories. If specific categories are selected, the missing categories are appended. |
| `countries` | array | no | [] | Optional ISO 3166-1 alpha-2 markets. Empty means the actor's current egress and no proxy. Each selected country uses a per-country Apify proxy (AUTO first, residential only after… |
| `country` | string | no |  | Single-country shorthand. Ignored when countries is non-empty. |
| `postedWithin` | string | no | any | Client-side filter on createTime relative to the run start. |
| `minViews` | integer | no | 0 | Drop posts with fewer playCount views. Missing stats fail a positive threshold. |
| `minLikes` | integer | no | 0 | Drop posts with fewer likes. Missing stats fail a positive threshold. |
| `minComments` | integer | no | 0 | Drop posts with fewer comments. Missing stats fail a positive threshold. |
| `minShares` | integer | no | 0 | Drop posts with fewer shares. Missing stats fail a positive threshold. |
| `onlyNew` | boolean | no | false | Emit only posts that were not present in the named state store. State is read and written only when this is true. |
| `stateKey` | string | no |  | Optional key-value store key for onlyNew. When empty, a deterministic key is derived from categories, countries and filters. |

3 more optional fields on the Actor's Input tab.

Example (`references/example-input.json`):

```json
{
  "rehostVideo": false,
  "categories": [
    "All"
  ],
  "maxItems": 50
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxItems` = 50, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/nimbryxo-studio~tiktok-explore-feed-trending-post-scraper/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/nimbryxo-studio~tiktok-explore-feed-trending-post-scraper/runs" \
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
