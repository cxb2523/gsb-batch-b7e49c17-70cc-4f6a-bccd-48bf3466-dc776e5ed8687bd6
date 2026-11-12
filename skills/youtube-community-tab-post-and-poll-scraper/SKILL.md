---
name: youtube-community-tab-post-and-poll-scraper
description: "Read a YouTube channel's Community tab and get structured records for every text post, image, poll, and shared video, with vote counts and optional comment threads. Output fields: channelName, contentText, publishedAt, likeCount, commentCount and more, as JSON rows. Use it for requests like \"YouTube community tab post scraper\", or a CSV/JSON export of public YouTube data."
---

# YouTube Community Tab Post & Poll Scraper

Read a YouTube channel's Community tab and get structured records for every text post, image, poll, and shared video, with vote counts and optional comment threads.

- Actor: https://apify.com/dataspryva/youtube-community-tab-post-and-poll-scraper (ID `dataspryva~youtube-community-tab-post-and-poll-scraper`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/youtube-community-tab-post-and-poll-scraper.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- YouTube community tab post scraper
- a repeatable export of public YouTube data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `postId`: Post ID
- `postType`: Type
- `channelName`: Channel
- `contentText`: Text
- `publishedAt`: Published
- `likeCount`: Likes
- `commentCount`: Comments

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mode` | string | no | channelPosts | Choose channel posts, one post per URL/ID, or comments from post URLs/IDs. |
| `urls` | array | no |  | Channel URLs, @handles or channel IDs when mode=channelPosts. Post URLs or post IDs when mode=postDetails/postComments. |
| `maxPosts` | integer | no | 100 | Maximum posts per channel, or per run in the post modes. The run also accepts at most this many channel/post inputs. YouTube exposes at most 200 posts per channel. |
| `postTypes` | array | no | [] | In channelPosts mode, only return these post types. Leave empty to include every type. The post modes return the post URLs/IDs you give them. |
| `keyword` | string | no |  | In channelPosts mode, only keep posts whose text contains this phrase. Case-insensitive. Leave empty for all posts. |
| `publishedAfter` | string | no |  | In channelPosts mode, keep posts published on or after this date. Uses YouTube's exact publish date, so details are fetched when set. |
| `publishedBefore` | string | no |  | In channelPosts mode, keep posts published on or before this date. Uses YouTube's exact publish date, so details are fetched when set. |
| `includeDetails` | boolean | no | true | In channelPosts mode, fill the exact publish date, exact like count, comment count and a 3-comment preview. Adds one detail and one comment request per post. |
| `includeComments` | boolean | no | false | Return comment threads on each post (up to Maximum comments) in channelPosts and postDetails modes. postComments always returns comments. |
| `maxComments` | integer | no | 100 | Maximum top-level comments to keep per post when comments are included. Replies are counted separately. |
| `includeReplies` | boolean | no | false | Also fetch replies under each comment when comments are included. |
| `maxRepliesPerComment` | integer | no | 10 | Maximum replies to keep per comment when replies are included. |
| `commentSort` | string | no | top | Show YouTube's featured comments first, or the newest comments first, when comments are returned. |
| `market` | string | no | US | Country used to render YouTube's localized labels and relative times. |

1 more optional field on the Actor's Input tab.

Example (`references/example-input.json`):

```json
{
  "urls": [
    "https://www.youtube.com/@MrBeast"
  ],
  "maxPosts": 25,
  "includeDetails": false,
  "keyword": "coffee shop",
  "maxComments": 25
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxPosts` = 25, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~youtube-community-tab-post-and-poll-scraper/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~youtube-community-tab-post-and-poll-scraper/runs" \
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
