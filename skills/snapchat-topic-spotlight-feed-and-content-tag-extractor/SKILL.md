---
name: snapchat-topic-spotlight-feed-and-content-tag-extractor
description: "Reads a Snapchat topic's public Spotlight feed and returns each video with creator, engagement counts, AI-generated title/keywords, and related content-classification tags. Output fields: creatorUsername, viewCount, uploadedAt, snapUrl and more, as JSON rows. Use it for requests like \"Snapchat topic spotlight feed scraper\", or a CSV/JSON export of public Snapchat data."
---

# Snapchat Topic Spotlight Feed & Content Tag Extractor

Reads a Snapchat topic's public Spotlight feed and returns each video with creator, engagement counts, AI-generated title/keywords, and related content-classification tags.

- Actor: https://apify.com/dataspryva/snapchat-topic-spotlight-feed-and-content-tag (ID `dataspryva~snapchat-topic-spotlight-feed-and-content-tag`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/snapchat-topic-spotlight-feed-and-content-tag-extractor.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- Snapchat topic spotlight feed scraper
- a repeatable export of public Snapchat data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `topicId`: Topic
- `snapId`: Snap
- `creatorUsername`: Creator
- `viewCount`: Views
- `uploadedAt`: Uploaded
- `snapUrl`: Spotlight

All 52 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mode` | string | no | topicFeed | Choose what to collect: videos for topics/tags, topics for search keywords, or the current Spotlight feed. |
| `topics` | array | no | [] | Topic names, hashtags, or Snapchat URLs. Examples: food, #travel, `https://www.snapchat.com/tag/food,` `https://www.snapchat.com/topic/cappuccino-foam-technique.` |
| `maxResultsPerTopic` | integer | no | 50 | Maximum videos to keep for each topic after combining its topic/tag page with Explore results. Snapchat serves 19-32 videos per page and the combined pool is usually 40-54. |
| `includeRelatedTags` | boolean | no | true | Include Snapchat's scene-to-interest (S2I) tags for each video when the page provides them. Coverage is partial, so the field is omitted when unavailable. |
| `searchQueries` | array | no | [] | Keywords or phrases used to discover topics, such as coffee, new york, or taylor swift. |
| `maxTopicsPerQuery` | integer | no | 50 | Maximum topic rows to keep for each search query, including related topics when expansion is enabled. |
| `includeRelatedTopics` | boolean | no | false | Add one hop of related topics found on each discovered topic's topic, tag, or Explore page. This follows public page links; it does not recurse further. |
| `enrichVideos` | boolean | no | false | Visit each video's Spotlight page to fill missing AI title, comment/recommend counts, language, S2I tags and sound, and each creator's profile once for subscriberCount. |
| `maxItems` | integer | no | 1000 | Maximum rows to save across the whole run. |

Example (`references/example-input.json`):

```json
{
  "topics": [
    "food"
  ],
  "maxResultsPerTopic": 3,
  "includeRelatedTags": false,
  "maxItems": 25
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxItems` = 25, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~snapchat-topic-spotlight-feed-and-content-tag/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~snapchat-topic-spotlight-feed-and-content-tag/runs" \
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
