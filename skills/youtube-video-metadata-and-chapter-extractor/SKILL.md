---
name: youtube-video-metadata-and-chapter-extractor
description: "Get full metadata for any YouTube video or Short: channel info, chapters, endscreen elements, caption track list, related videos and comments, from a URL or video ID. Output fields: url, title, viewCount, likeCount, commentCount and more, as JSON rows. Use it for requests like \"YouTube video metadata scraper\", or a CSV/JSON export of public YouTube data."
---

# YouTube Video Metadata & Chapter Extractor

Get full metadata for any YouTube video or Short: channel info, chapters, endscreen elements, caption track list, related videos and comments, from a URL or video ID.

- Actor: https://apify.com/vexaloom-labs/youtube-video-metadata-and-chapter-extractor (ID `vexaloom-labs~youtube-video-metadata-and-chapter-extractor`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/youtube-video-metadata-and-chapter-extractor.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- YouTube video metadata scraper
- a repeatable export of public YouTube data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `videoId`: Video ID
- `url`: URL
- `title`: Title
- `channelName`: Channel
- `viewCount`: Views
- `likeCount`: Likes
- `commentCount`: Comments
- `durationSeconds`: Duration (s)
- `publishedDate`: Published
- `publishedAt`: Published at
- `category`: Category
- `playabilityStatus`: Playability Status
- `isPlayable`: Is Playable
- `isAgeGated`: Age Gated
- `commentsDisabled`: Comments Disabled
- `success`: Success

All 60 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `videoUrls` | array | yes |  | YouTube watch, youtu.be, Shorts, embed or live links, or 11-character video IDs. Duplicates are removed. |
| `maxComments` | integer | no | 0 | Maximum comment texts to collect per video. Set to 0 to skip comments. The display comment count is extracted separately. |
| `includeChapters` | boolean | no | true | Extract manual and automatic chapters with title, start, end and source. |
| `includeHeatmap` | boolean | no | false | Add the Most replayed heatmap segments and labels when YouTube provides them. |
| `includeEndscreen` | boolean | no | true | Extract endscreen elements shown at the end of the video. |
| `includeCards` | boolean | no | false | Extract interactive info cards embedded in the video. |
| `includeTranscriptMetadata` | boolean | no | true | List available caption tracks with language and manual or auto-generated status. |
| `includeTranscript` | boolean | no | true | Download the transcript when a caption track is available. Adds one request per video. |
| `includeRelatedVideos` | integer | no | 0 | Number of related videos to extract from the watch page sidebar. 0 skips them. |

Example (`references/example-input.json`):

```json
{
  "videoUrls": [
    "jNQXAC9IVRw",
    "dQw4w9WgXcQ",
    "M7lc1UVf-VE"
  ],
  "includeEndscreen": false,
  "includeTranscript": false
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxComments` = 0, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/vexaloom-labs~youtube-video-metadata-and-chapter-extractor/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/vexaloom-labs~youtube-video-metadata-and-chapter-extractor/runs" \
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
