---
title: Perform sentiment analysis
description: Perform sentiment analysis on YouTube comments with AgentQL and OpenAI's GPT-3.5 model.
updated: 2025-03-05
---

# Example script: perform sentiment analysis with AgentQL

This is an example shows how to return news headlines from a selection of URLs and save the results to a CSV file.

## Run the script

- [Install AgentQL SDK](https://docs.agentql.com/javascript-sdk/installation)
- Save this JavaScript file locally as **main.js**
- Run the following command from the project's folder:

```bash
node main.js
```

## Run the tests offline

The CSV write/dedupe logic is covered by `test/main.test.js` using Node's
built-in test runner. It replaces the browser with fake fetch results, so it
needs no `npm install`, no AgentQL credentials, and no network access:

```bash
node --test test/main.test.js
```

The tests cover two sites fetched concurrently, duplicate URLs (across sites
and within one site), empty results, a failing fetch, and a pre-existing CSV:
they assert the final line count, that the header appears once on the first
line, the `Posted | Entry | URL | Platform | Author` column order, and the
exact records written.

## Play with the query

Install the [AgentQL Debugger Chrome extension](https://docs.agentql.com/installation/chrome-extension-installation) to play with the AgentQL query. [Learn more about the AgentQL query language](https://docs.agentql.com/agentql-query/query-intro)
