---
name: lowe-s-price-stock-and-specification-scraper
description: "Search Lowe's products by keyword, browse a category, or fetch details by item ID or URL. Get price, original price, discount percent, stock status, ratings, model number, and full specifications for each product. Output fields: title, brand, price, originalPrice, rating and more, as JSON rows. Use it for requests like \"Lowe's price, stock scraper\", or a CSV/JSON export of public Lowe's data."
---

# Lowe's Price, Stock & Specification Scraper

Search Lowe's products by keyword, browse a category, or fetch details by item ID or URL. Get price, original price, discount percent, stock status, ratings, model number, and full specifications for each product.

- Actor: https://apify.com/dataspryva/lowes-price-stock-and-specification-scraper (ID `dataspryva~lowes-price-stock-and-specification-scraper`)
- n8n workflow for the same Actor: https://github.com/bolvein-firex/scraping-n8n-workflows/blob/main/docs/lowe-s-price-stock-and-specification-scraper.md
- Example input: `references/example-input.json`
- Input schema: `references/input-schema.json`
- Output fields: `references/output-fields.json`

## When to use

Use this skill when the user wants:

- Lowe's price, stock scraper
- a repeatable export of public Lowe's data as CSV or JSON

Do not use it for private, login-protected or paywalled data.

## What it returns

One JSON row per result. Columns from the Actor's dataset schema:

- `title`: Title
- `brand`: Brand
- `price`: Price
- `originalPrice`: Original Price
- `inStock`: In Stock
- `storeNumber`: Store Number
- `storeQuantity`: Store Quantity
- `rating`: Rating
- `reviewCount`: Review Count
- `url`: Url

## Inputs

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `mode` | string | yes | productDetails | What to look up. |
| `searchQueries` | array | no | ["power drill"] | Keywords to search for (mode=search). Each query adds its own discovery results. |
| `category` | string | no | tools | Lowe's department to browse (mode=byCategory). |
| `itemIds` | array | no | [] | Lowe's item numbers (for example 5013207487) or /pd/ product URLs. Used by mode=productDetails. |
| `startUrls` | array | no | [] | Lowe's product, search, or /pl/ category URLs. Used by mode=byUrl, and category URLs are also accepted by mode=byCategory. |
| `storeId` | string | no | 0208 | Four-digit Lowe's store number used for price and stock context. Default 0208 (La Quinta, CA). |
| `zipCode` | string | no | 92253 | Five-digit ZIP code used with the store number for price and stock context. Default 92253. |
| `sortBy` | string | no | featured | How to order the products found in this run. |
| `inStockOnly` | boolean | no | false | Only emit products with at least one fulfilment method available. |
| `onSaleOnly` | boolean | no | false | Only emit products with a current was/sale price. |
| `onShelfOnly` | boolean | no | false | Only emit products with pickup quantity above zero at the selected store. |
| `minPrice` | integer | no |  | Drop products priced below this value. Products without a price are skipped when a price filter is set. |
| `maxPrice` | integer | no |  | Drop products priced above this value. Products without a price are skipped when a price filter is set. |
| `minRating` | number | no |  | Drop products rated below this value. Products without a rating are skipped when this filter is set. |

2 more optional fields on the Actor's Input tab.

Example (`references/example-input.json`):

```json
{
  "itemIds": [
    "5013207487"
  ],
  "includeDetails": false,
  "maxItems": 25,
  "mode": "productDetails"
}
```

The input passes the Actor's input schema (checked at every publish). First run: `maxItems` = 25, small enough for the 300-second sync wait; raise it once the rows look right.

## Run it

Set `APIFY_TOKEN`, then call the synchronous endpoint for small and medium runs (it waits up to 300 seconds):

```bash
curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~lowes-price-stock-and-specification-scraper/run-sync-get-dataset-items" \
  -H "Authorization: Bearer $APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @references/example-input.json > output.json
```

Or with Node 18+: `node scripts/run.mjs [input.json]`.

For large runs, start an async run and read its dataset when it finishes:

```bash
RUN=$(curl -s -X POST "https://api.apify.com/v2/acts/dataspryva~lowes-price-stock-and-specification-scraper/runs" \
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
