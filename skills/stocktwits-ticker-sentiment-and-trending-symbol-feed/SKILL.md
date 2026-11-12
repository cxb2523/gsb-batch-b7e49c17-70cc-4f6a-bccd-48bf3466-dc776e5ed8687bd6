---
name: stocktwits-ticker-sentiment-and-trending-symbol-feed
description: "Reads StockTwits' public message stream for any ticker or user, the market-wide trending-symbols list with trend summaries, and ticker search, including each post's self-tagged sentiment. Output fields: symbol, title, sentimentScore, priceLast, pricePercentChange and more, as JSON rows. Use it for requests like \"StockTwits ticker sentiment\", or a CSV/JSON export of public StockTwits data."
---

# StockTwits Ticker Sentiment & Trending Symbol Feed

Reads StockTwits' public message stream for any ticker or user, the market-wide trending-symbols list with trend summaries, and ticker search, including each post's self-tagged sentiment.

- Actor: https://apify.com/dataspryva/stocktwits-ticker-sentiment-and-trending-symbol (ID `dataspryva~stocktwits-ticker-sentiment-and-trending-symbol`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/stocktwits-ticker-sentiment-and-trending-symbol-feed.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- StockTwits ticker sentiment
- a repeatable export of public StockTwits data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `symbol`: Symbol
- `title`: Title
- `sentiment`: Sentiment
- `sentimentScore`: Sentiment Score
- `priceLast`: Price Last
- `pricePercentChange`: Price Percent Change
- `body`: Body
- `username`: Username
- `rank`: Rank
- `createdAt`: Created At
- `stocktwitsUrl`: Stocktwits Url

All 12 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mode` | string | yes | symbolMessages | What to fetch from StockTwits. |
| `symbols` | array | no | ["AAPL"] | Tickers to fetch, e.g. AAPL, TSLA, BTC.X, BRK.B, SHOP.TSX. Accepts $cashtags and StockTwits symbol URLs. Use .X for crypto. |
| `usernames` | array | no | [] | StockTwits usernames without @, or profile URLs, e.g. KirRoyalTrader, `https://stocktwits.com/Fibonaccino.` |
| `searchQueries` | array | no | [] | Company names, tickers, or trader names to search for, e.g. tesla, apple, TraderLion. |
| `searchType` | string | no | all | What to return from each query. |
| `streamFilter` | string | no | all | All = newest first, Top = StockTwits ranking, Trending = curated high-engagement posts for the ticker (up to 100). |
| `contentFilter` | string | no | all | Keep only messages with this attachment. Videos are rare; All keeps every message. |
| `sentimentFilter` | string | no | any | Keep posts by the author's self-tagged sentiment. Most posts are untagged; Any keeps all. |
| `onlyPriceTargets` | boolean | no | false | Keep only messages where the author attached a StockTwits price prediction (price target). |
| `feedType` | string | no | trending | Trending = market-wide trending posts; Suggested = posts from StockTwits' curated suggested traders; All = public market-wide firehose (deep, chronological). |
| `trendingAssetClass` | string | no | all | Which trending instruments to keep. All includes stocks, ETFs, crypto, ADRs, commodities, and other classes. |
| `sentimentRange` | string | no | now | Now = current sentiment across 15m, 24h, now, 1D–ALL. Other values return the daily/intraday history for that window. |
| `chartZoom` | string | no | 1M | Intraday windows use 5-minute (1D) or 30-minute (1W) bars; other windows use daily/weekly bars. |
| `includeUserProfile` | boolean | no | false | Add one profile record per username before that trader's posts. |

5 more optional fields on the Actor's Input tab.

Example (`references/example-input.json`):

```json
{
  "maxItems": 25,
  "mode": "symbolMessages"
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxItems` = 25, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~stocktwits-ticker-sentiment-and-trending-symbol/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~stocktwits-ticker-sentiment-and-trending-symbol/runs" \
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
