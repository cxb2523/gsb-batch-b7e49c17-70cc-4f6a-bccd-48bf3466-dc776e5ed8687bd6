---
title: News Aggregator to CSV
description: Return news headlines from a selection of URLs and save the results to a CSV file.
updated: 2025-03-05
---

# Example script: News Aggregator to CSV

This is an example shows how to return news headlines from a selection of URLs and save the results to a CSV file.

## Run the script

- [Install AgentQL SDK](https://docs.agentql.com/installation/sdk-installation)
- Save this python file locally as **main.py**
- Run the following command from the project's folder:

```bash
python3 main.py
```

## Run the tests offline

The CSV write/dedupe logic is covered by `test_news_aggregator.py`, which uses
fake fetch results instead of a real browser. It needs no AgentQL
credentials and makes no network calls:

```bash
python -m unittest test_news_aggregator -v
```

The tests cover two sites fetched concurrently, duplicate URLs (across sites
and within one site), empty results, a failing fetch, and a pre-existing CSV:
they assert the final line count, that the header appears once on the first
line, the `Posted | Entry | URL | Platform | Author` column order, and the
exact records written.

## Play with the query

Install the [AgentQL Debugger Chrome extension](https://docs.agentql.com/installation/chrome-extension-installation) to play with the AgentQL query. [Learn more about the AgentQL query language](https://docs.agentql.com/agentql-query/query-intro)
