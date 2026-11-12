import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function withClient(fn) {
  const client = new Client({ name: "sitemap-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "./tests/sitemap-fixture.mjs", "build/index.js"],
    env: { ...process.env, STRING_AI_API_KEY: "synthetic-test-key" },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    await fn(client);
  } finally {
    await client.close();
  }
}

const call = (client, args) => client.callTool({ name: "web_access_sitemap", arguments: args });

test("approve treats a 409 partial_state as a recoverable handoff, not an error", async () => {
  await withClient(async (client) => {
    const repaired = await call(client, { action: "approve", jobId: "partial" });
    assert.ok(!repaired.isError, JSON.stringify(repaired));
    assert.equal(repaired.content.length, 2);
    assert.match(repaired.content[0].text, /partial_state/);
    assert.match(repaired.content[0].text, /approval handoff incomplete/i);
    assert.match(repaired.content[0].text, /approve again/);
    assert.deepEqual(JSON.parse(repaired.content[1].text), { jobId: "partial", status: "partial_state" });

    // Any other 4xx/5xx still surfaces as a failed tool call.
    const broken = await call(client, { action: "approve", jobId: "broken" });
    assert.equal(broken.isError, true, JSON.stringify(broken));
    assert.match(broken.content[0].text, /500/);

    // A normal approve still reports the running job.
    const ok = await call(client, { action: "approve", jobId: "job-ok" });
    assert.ok(!ok.isError, JSON.stringify(ok));
    assert.deepEqual(JSON.parse(ok.content[1].text), { jobId: "job-ok", status: "running" });
  });
});

test("results rejects illegal paging locally and forwards legal boundaries", async () => {
  await withClient(async (client) => {
    const illegal = [
      { limit: 0 },
      { limit: -1 },
      { limit: 1.5 },
      { limit: 5001 },
      { offset: -1 },
      { offset: -100 },
      { offset: 2.5 },
    ];
    for (const paging of illegal) {
      const result = await call(client, { action: "results", jobId: "job-1", ...paging });
      assert.equal(result.isError, true, `${JSON.stringify(paging)} was accepted`);
      if (paging.limit !== undefined) {
        assert.match(result.content[0].text, /limit must be an integer between 1 and 5000/, result.content[0].text);
      } else {
        assert.match(result.content[0].text, /offset must be a non-negative integer/, result.content[0].text);
      }
    }

    // Lower and upper boundaries, including offset 0, are forwarded verbatim.
    const smallest = await call(client, { action: "results", jobId: "job-1", limit: 1, offset: 0 });
    assert.ok(!smallest.isError, JSON.stringify(smallest));
    assert.deepEqual(JSON.parse(smallest.content[1].text).echo, { limit: "1", offset: "0" });

    const largest = await call(client, { action: "results", jobId: "job-1", limit: 5000, offset: 2500 });
    assert.ok(!largest.isError, JSON.stringify(largest));
    assert.deepEqual(JSON.parse(largest.content[1].text).echo, { limit: "5000", offset: "2500" });

    // Omitting paging still works and reaches the API with no query parameters.
    const plain = await call(client, { action: "results", jobId: "job-1" });
    assert.ok(!plain.isError, JSON.stringify(plain));
    assert.deepEqual(JSON.parse(plain.content[1].text).echo, { limit: null, offset: null });
  });
});

test("list enforces the same lower bounds at its own maximum and forwards legal boundaries", async () => {
  await withClient(async (client) => {
    const illegal = [
      { limit: 0 },
      { limit: -5 },
      { limit: 0.25 },
      { limit: 101 },
      { offset: -1 },
      { offset: 3.75 },
    ];
    for (const paging of illegal) {
      const result = await call(client, { action: "list", ...paging });
      assert.equal(result.isError, true, `${JSON.stringify(paging)} was accepted`);
      if (paging.limit !== undefined) {
        assert.match(result.content[0].text, /limit must be an integer between 1 and 100/, result.content[0].text);
      } else {
        assert.match(result.content[0].text, /offset must be a non-negative integer/, result.content[0].text);
      }
    }

    const smallest = await call(client, { action: "list", limit: 1, offset: 0 });
    assert.ok(!smallest.isError, JSON.stringify(smallest));
    assert.deepEqual(JSON.parse(smallest.content[1].text).echo, { limit: "1", offset: "0" });

    const largest = await call(client, { action: "list", limit: 100, offset: 50 });
    assert.ok(!largest.isError, JSON.stringify(largest));
    assert.deepEqual(JSON.parse(largest.content[1].text).echo, { limit: "100", offset: "50" });

    const plain = await call(client, { action: "list" });
    assert.ok(!plain.isError, JSON.stringify(plain));
    assert.deepEqual(JSON.parse(plain.content[1].text).echo, { limit: null, offset: null });
  });
});

test("status never relays an inlined URL list and still handles partial_state", async () => {
  await withClient(async (client) => {
    const warm = await call(client, { action: "status", jobId: "warm" });
    assert.ok(!warm.isError, JSON.stringify(warm));
    const payload = JSON.parse(warm.content[1].text);
    assert.equal(payload.urls, undefined, "the inlined URL list leaked into the poll result");
    assert.equal(payload.status, "completed");
    assert.equal(payload.pagesProcessed, 3, "the inline URL count should be exposed instead");
    assert.match(warm.content[0].text, /3 pages processed/);

    const detail = await call(client, { action: "status", jobId: "detail" });
    assert.ok(!detail.isError, JSON.stringify(detail));
    assert.equal(JSON.parse(detail.content[1].text).urls, undefined);
    assert.match(detail.content[0].text, /pending 4, processed 6/);

    const interrupted = await call(client, { action: "status", jobId: "partial" });
    assert.ok(!interrupted.isError, JSON.stringify(interrupted));
    assert.match(interrupted.content[0].text, /partial_state/);
    assert.deepEqual(JSON.parse(interrupted.content[1].text), { jobId: "partial", status: "partial_state" });
  });
});

test("submit and cancel still round-trip through the same fetch double", async () => {
  await withClient(async (client) => {
    const quote = await call(client, { action: "submit", url: "https://example.com", maxPages: 200 });
    assert.ok(!quote.isError, JSON.stringify(quote));
    assert.deepEqual(JSON.parse(quote.content[1].text), {
      jobId: "job-submit",
      status: "awaiting_approval",
      estimatedCostUsd: "0.0042",
      estimatedPages: 200,
    });

    const canceled = await call(client, { action: "cancel", jobId: "job-1" });
    assert.ok(!canceled.isError, JSON.stringify(canceled));
    assert.deepEqual(JSON.parse(canceled.content[1].text), { jobId: "job-1", status: "canceled" });
  });
});
