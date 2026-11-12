---
name: op-gg-league-of-legends-tier-list-and-win-rate-tracker
description: "Reads OP.GG's League of Legends champion tier lists for any lane and returns tier, win rate, pick rate, ban rate, and patch version per champion. Output fields: championName, tier, tierNumber, tierRank, rankChange and more, as JSON rows. Use it for requests like \"OP.GG league of legends tier list\", or a CSV/JSON export of public OP.GG data."
---

# OP.GG League of Legends Tier List & Win Rate Tracker

Reads OP.GG's League of Legends champion tier lists for any lane and returns tier, win rate, pick rate, ban rate, and patch version per champion.

- Actor: https://apify.com/dataspryva/op-gg-league-of-legends-tier-list-and-win-rate (ID `dataspryva~op-gg-league-of-legends-tier-list-and-win-rate`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/op-gg-league-of-legends-tier-list-and-win-rate-tracker.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- OP.GG league of legends tier list
- a repeatable export of public OP.GG data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `championName`: Champion Name
- `tier`: Tier
- `tierNumber`: Tier Number
- `tierRank`: Tier Rank
- `rankChange`: Rank Change
- `winRate`: Win Rate
- `pickRate`: Pick Rate
- `banRate`: Ban Rate
- `region`: Region
- `rankTier`: Rank Tier
- `queueType`: Queue Type
- `patch`: Patch

All 22 declared fields: `references/output-fields.json`.

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mode` | string | yes | tierList | What to fetch: a champion tier list, champion statistics, or every matchup for selected champions. `byPosition` is a legacy alias for a position-scoped tier list. |
| `queueType` | string | no | ranked | Queue to read. Classic applies to tierList and fullCounters; ARAM applies to championStats. |
| `region` | string | no | global | Server to read. Global combines every server OP.GG tracks. |
| `rankTier` | string | no | emerald_plus | Only include games from this rank. Champion stats mode uses the base tier for plus tiers (e.g. Emerald+ → Emerald). |
| `position` | string | no | ALL | Lane to read. ALL returns every lane; in fullCounters it uses each champion's primary lane. |
| `champions` | array | no |  | Champion names, keys, or OP.GG build URLs to fetch every matchup for (mode=fullCounters). Example: Ahri, jinx, `https://op.gg/lol/champions/ahri/build/mid.` |
| `patch` | string | no | latest | Tier-list and fullCounter patch. OP.GG keeps the latest and previous patch; Classic has no patch history. |
| `minTier` | string | no | all | Tier-list cutoff. OP is the strongest, then 1 through 5. Lower numbers keep stronger champions. |
| `period` | string | no | month | Time window for champion statistics (mode=championStats). |
| `maxItems` | integer | no | 100 | Hard cap on emitted records. OP.GG returns at most 271 tier rows or 173 stat rows per filter. |

Example (`references/example-input.json`):

```json
{
  "maxItems": 20,
  "mode": "tierList"
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxItems` = 20, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~op-gg-league-of-legends-tier-list-and-win-rate/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~op-gg-league-of-legends-tier-list-and-win-rate/runs" \
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
