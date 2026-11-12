# Canadian Municipal GitHub Rankings

To motivate us to continuously improve our GitHub presence,
the table below shows how [The City of Sault Ste. Marie](https://saultstemarie.ca)
compares to other Canadian cities, towns, regions, and counties
that are releasing their open source code on GitHub.

[View the Table](https://cityssm.github.io/municipal-github-rankings)

## Missing Another Active Canadian City or Town?

[Create an issue](https://github.com/cityssm/municipal-github-rakings/issues/new)
with the municipality's account handle.

## Helpful Links

-   [Government of Canada's Open Resource Exchange](https://code.open.canada.ca/en/index.html)
-   [Other Government Agencies on GitHub](https://government.github.com/community/)

## How It Works

`build.js` fetches each municipality's public repositories from GitHub
and writes the results to `data.json`, which `index.html` (table) and
`map.html` (map) render.

Every municipality is classified one of three ways:

-   **Success with repositories** — aggregated stars, forks, issues and languages.
-   **Success with zero repositories** — still included in the ranking,
    with zero stars and a blank quality ratio.
-   **Failure** — the request errored, or the response was not an array.
    Failed municipalities are excluded from totals and sorting, and recorded
    separately in `data.json` under `failedOrganizations` with their
    `handle`, `municipality` and failure `error`. The table and map show
    how many fetches failed and name the affected municipalities instead
    of silently presenting them as cities with no public code.

## Building and Testing

Install dependencies, then:

```bash
npm run build   # fetch from GitHub and write data.json (set GH_TOKEN to avoid rate limits)
npm test        # run the automated test suite (no network access required)
```

### Offline fixture data source

For local verification without calling GitHub, set `RANKINGS_FIXTURE_FILE`
to a JSON fixture keyed by organization handle. Each entry either lists
`repos` (use `[]` for a zero-repository city) or provides an `error`
string to simulate a failed request. A non-array `repos` value simulates
a malformed response.

```bash
RANKINGS_FIXTURE_FILE=./test/fixtures/partial-failure.json \
RANKINGS_OUTPUT_FILE=./data.json \
npm run build
```

Ready-made fixtures covering the partial-failure, all-failure and
zero-repository scenarios live in [`test/fixtures/`](./test/fixtures),
and the tests under [`test/`](./test) assert all three.
