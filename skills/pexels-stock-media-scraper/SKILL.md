---
name: pexels-stock-media-scraper
description: "Scrape free stock photos and videos from Pexels. Search by keyword, browse curated/popular media, a photographer's portfolio, or a curated collection. Get direct image and video file URLs, photographer credit, tags, colors, and more. Output fields: title, photographerName, width, height, orientation and more, as JSON rows. Use it for requests like \"Pexels stock media scraper\", or a CSV/JSON export of public Pexels data."
---

# Pexels Stock Media Scraper

Scrape free stock photos and videos from Pexels. Search by keyword, browse curated/popular media, a photographer's portfolio, or a curated collection. Get direct image and video file URLs, photographer credit, tags, colors, and more.

- Actor: https://apify.com/nimbryxo-studio/pexels-stock-media-scraper-2 (ID `nimbryxo-studio~pexels-stock-media-scraper-2`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/pexels-stock-media-scraper.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

Short video breakdown:
- [Build the SEO image sheet without page hopping](https://www.youtube.com/shorts/8eZdJt-fTS0)

## When to use

Use this skill when the user wants:

- Pexels stock media scraper
- a repeatable export of public Pexels data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `photoId`: Photo Id
- `videoId`: Video Id
- `title`: Title
- `photographerName`: Photographer Name
- `width`: Width
- `height`: Height
- `orientation`: Orientation
- `durationSeconds`: Duration Seconds
- `license`: License
- `attribution`: Attribution
- `downloadUrl`: Download Url
- `pageUrl`: Page Url

All 13 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mode` | string | yes | search | What to fetch from Pexels. Use Search by keyword for discovery, Look up media by ID/URL for exact assets, Photographer portfolio or Collection for a catalog, Similar media for… |
| `searchQueries` | array | no | [] | One or more keywords for mode=search, one per line. Each query is searched separately and duplicates are removed. Example: `nature`, `city skyline`, `coffee`. |
| `mediaType` | string | no | photos | Photos, videos, or both. `all` searches photos and videos and merges the results. Exact ID/URL lookups return the requested media type regardless of this setting. |
| `startUrls` | array | no | [] | Pexels search, photo, video, photographer, collection, image-file, or video-file URLs for mode=byUrl. Search URLs keep their orientation, size, color, people, and page filters. |
| `orientation` | string | no | all | Filter by media orientation. Applies to search, profile, and collection modes. |
| `size` | string | no | all | Pexels minimum-size filter. Photos: large is 24 MP, medium is 12 MP, small is 4 MP. Videos: large is 4K, medium is Full HD, small is HD. |
| `color` | string | no | all | Filter photos by dominant color. Use Color hex instead for an exact hex value. Photos only. |
| `colorHex` | string | no |  | Optional hex color such as `#2563eb` or `#fff`. Overrides the Color dropdown when set. Photos only. |
| `peopleCount` | string | no | all | Filter by how many people appear in the media. Applies to photos and videos. |
| `peopleAge` | string | no | all | Filter by the age of people in the media. Applies to photos and videos. |
| `locale` | string | no | en-US | Pexels locale for titles, descriptions, and search results. Search terms are used as typed. |
| `minWidth` | integer | no | 0 | Only return media at least this wide. 0 disables the filter. Enforced on each returned record. |
| `minHeight` | integer | no | 0 | Only return media at least this tall. 0 disables the filter. Enforced on each returned record. |
| `minFps` | integer | no | 0 | Only return videos with at least this many frames per second (for example 60). 0 disables the filter. Photos always pass. |

11 more optional fields on the Actor's Input tab.

Example (`references/example-input.json`):

```json
{
  "searchQueries": [
    "nature"
  ],
  "mediaIds": [
    "18872916"
  ],
  "username": "alex-ivanov-773258579",
  "collectionSlug": "aquatic-aesthetic-bw7dkse",
  "maxItems": 25,
  "mode": "search"
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxItems` = 25, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/nimbryxo-studio~pexels-stock-media-scraper-2/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/nimbryxo-studio~pexels-stock-media-scraper-2/runs" \
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
