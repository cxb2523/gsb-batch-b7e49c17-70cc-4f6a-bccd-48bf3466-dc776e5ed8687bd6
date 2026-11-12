---
name: x-broadcast-viewer-history-and-replay-link-scraper
description: "Get a public X broadcast's title, state, start/end times, viewer counts over time, thumbnail, broadcaster profile, and an optional replay stream link, resolved from a broadcast link or ID. Output fields: title, state, broadcaster.username, viewersNow, viewersTotal and more, as JSON rows. Use it for requests like \"X broadcast viewer history scraper\", or a CSV/JSON export of public X data."
---

# X Broadcast Viewer History & Replay Link Scraper

Get a public X broadcast's title, state, start/end times, viewer counts over time, thumbnail, broadcaster profile, and an optional replay stream link, resolved from a broadcast link or ID.

- Actor: https://apify.com/dataspryva/x-broadcast-viewer-history-and-replay-link-scraper (ID `dataspryva~x-broadcast-viewer-history-and-replay-link-scraper`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/x-broadcast-viewer-history-and-replay-link-scraper.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- X broadcast viewer history scraper
- a repeatable export of public X data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `title`: Title
- `state`: State
- `broadcaster.username`: Broadcaster.username
- `viewersNow`: Viewers Now
- `viewersTotal`: Viewers Total
- `startedAt`: Started At
- `url`: Url

All 8 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `broadcastIds` | array | yes |  | Paste broadcast links such as `https://x.com/i/broadcasts/1YGNrbPLejQGw,` bare broadcast IDs, post links that announce a broadcast, or legacy Periscope links (/v/ or //). |
| `includeViewerStats` | boolean | no | true | Include current/total viewers, the viewer-history graph when X exposes it, and derived peak/average viewers. Turn off for a lighter output. |
| `includeViewerTimeline` | boolean | no | false | Push one "viewer timeline point" row per point of the broadcast's viewer-history graph. No rows are emitted when X provides no graph. |
| `maxViewerTimelinePoints` | integer | no | 0 | Maximum timeline rows per broadcast. 0 means all points. When capped, points are evenly sampled across the full broadcast and each row keeps its original index. |
| `includeReplayVideo` | boolean | no | false | Resolve the HLS playback URL and stream status. For a live broadcast the URL is the live stream; for an ended broadcast it is the replay. |
| `includeChatHistory` | boolean | no | false | Collect text messages from the broadcast's public chat replay after it ends. Live chat and private chats are not collected. |
| `maxChatMessages` | integer | no | 1000 | Maximum public chat text messages per broadcast. Older events and join/heart events are not counted. |
| `includeThumbnail` | boolean | no | true | Store the broadcast cover image in the run's key-value store and return its stable URL plus the original X image URL. |
| `includeBroadcasterProfile` | boolean | no | true | Add the broadcaster's public profile (followers, bio, location, account creation date, pinned posts). Falls back to the compact broadcaster record if the profile is unavailable. |

Example (`references/example-input.json`):

```json
{
  "broadcastIds": [
    "https://x.com/i/broadcasts/1YGNrbPLejQGw"
  ],
  "maxChatMessages": 100
}
```

The input passes the Actor's input schema (checked at every publish). The run size follows the number of inputs you pass.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~x-broadcast-viewer-history-and-replay-link-scraper/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~x-broadcast-viewer-history-and-replay-link-scraper/runs" \
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
