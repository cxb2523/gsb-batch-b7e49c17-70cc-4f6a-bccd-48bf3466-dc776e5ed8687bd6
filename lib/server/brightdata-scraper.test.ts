import { test } from "node:test";
import assert from "node:assert/strict";
import { runAiScraper } from "./brightdata-scraper";

function mockFetch(body: unknown) {
  const original = globalThis.fetch;
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls++;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { state, restore: () => (globalThis.fetch = original) };
}

/**
 * Routes both the Bright Data dataset call and source-resolution calls through
 * one stub. Source URLs use public IP literals so assertPublicHttpUrl needs no
 * DNS, and every redirect is answered in-memory — no real outbound traffic.
 */
function mockScrapeWithSourceRouter(
  scrapeBody: unknown,
  sourceRoutes: Record<
    string,
    { status?: number; location?: string; reject?: Error }
  >,
) {
  const original = globalThis.fetch;
  const state = { scrapeCalls: 0, sourceCalls: [] as string[] };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.includes("api.brightdata.com")) {
      state.scrapeCalls++;
      return new Response(JSON.stringify(scrapeBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    state.sourceCalls.push(url);
    const route = sourceRoutes[url];
    if (!route) throw new Error(`unexpected source fetch: ${url}`);
    if (route.reject) throw route.reject;
    const headers = new Headers();
    if (route.location) headers.set("location", route.location);
    return new Response(null, {
      status: route.status ?? 200,
      headers,
    });
  }) as typeof fetch;
  return { state, restore: () => (globalThis.fetch = original) };
}

function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const prevKey = process.env.BRIGHT_DATA_KEY;
  process.env.BRIGHT_DATA_KEY = "test-key";
  return fn().finally(() => {
    if (prevKey === undefined) delete process.env.BRIGHT_DATA_KEY;
    else process.env.BRIGHT_DATA_KEY = prevKey;
  });
}

test("an error record is never turned into an answer, and is not cached", async () => {
  const prevKey = process.env.BRIGHT_DATA_KEY;
  process.env.BRIGHT_DATA_KEY = "test-key";
  const prompt = "best crm for small agencies in 2026";
  const mock = mockFetch([
    {
      input: { url: "https://chatgpt.com/", prompt, index: 1 },
      error: "Request timed out while waiting for the answer",
      error_code: "timeout",
    },
  ]);
  try {
    const request = { provider: "chatgpt" as const, prompt };
    await assert.rejects(runAiScraper(request), /error record.*timeout/);
    await assert.rejects(runAiScraper(request), /error record/);
    assert.equal(mock.state.calls, 2, "failed results are not cached");
  } finally {
    mock.restore();
    if (prevKey === undefined) delete process.env.BRIGHT_DATA_KEY;
    else process.env.BRIGHT_DATA_KEY = prevKey;
  }
});

test("a record with no answer field throws instead of echoing the input", async () => {
  const prevKey = process.env.BRIGHT_DATA_KEY;
  process.env.BRIGHT_DATA_KEY = "test-key";
  const prompt = "which analytics tool has the best dashboards";
  const mock = mockFetch([
    { input: { url: "https://gemini.google.com/", prompt, index: 1 }, url: "https://gemini.google.com/" },
  ]);
  try {
    await assert.rejects(
      runAiScraper({ provider: "gemini", prompt }),
      /no answer field/,
    );
  } finally {
    mock.restore();
    if (prevKey === undefined) delete process.env.BRIGHT_DATA_KEY;
    else process.env.BRIGHT_DATA_KEY = prevKey;
  }
});

test("a record with answer_text still resolves", async () => {
  const prevKey = process.env.BRIGHT_DATA_KEY;
  process.env.BRIGHT_DATA_KEY = "test-key";
  const mock = mockFetch([
    { input: { prompt: "ok prompt here" }, answer_text: "Acme is a solid pick." },
  ]);
  try {
    const out = await runAiScraper({ provider: "perplexity", prompt: "ok prompt here two" });
    assert.equal(out.answer, "Acme is a solid pick.");
  } finally {
    mock.restore();
    if (prevKey === undefined) delete process.env.BRIGHT_DATA_KEY;
    else process.env.BRIGHT_DATA_KEY = prevKey;
  }
});

test("sources are normalized: short link and direct address merge into one verified entry", async () => {
  const prompt = "short link merge prompt alpha";
  const mock = mockScrapeWithSourceRouter(
    [
      {
        input: { prompt, index: 1 },
        answer_text:
          "See the report at http://8.8.8.8/short and the same page directly.",
        citations: [
          { url: "http://8.8.8.8/short" },
          "https://93.184.216.34/report",
        ],
      },
    ],
    {
      "http://8.8.8.8/short": {
        status: 302,
        location: "https://93.184.216.34/report",
      },
      "https://93.184.216.34/report": { status: 200 },
    },
  );
  try {
    const out = await withKey(() =>
      runAiScraper({ provider: "chatgpt", prompt }),
    );
    assert.deepEqual(out.sources, ["https://93.184.216.34/report"]);
    assert.equal(out.cached, false);
    assert.deepEqual(out.sourceDrops, {
      total: 0,
      tooManyRedirects: 0,
      nonPublic: 0,
      resolveFailed: 0,
      nonHttp: 0,
    });
    assert.ok(
      mock.state.sourceCalls.includes("http://8.8.8.8/short"),
      "the short link must be resolved, not only string-compared",
    );
  } finally {
    mock.restore();
  }
});

test("sources redirecting to 169.254.169.254 or localhost are dropped as non_public, answer still returns", async () => {
  const prompt = "private redirect prompt beta";
  const mock = mockScrapeWithSourceRouter(
    [
      {
        input: { prompt, index: 1 },
        answer_text:
          "Metadata at http://8.8.8.8/to-meta and local at http://8.8.8.8/to-local.",
        sources: ["http://8.8.8.8/to-meta", "http://8.8.8.8/to-local"],
      },
    ],
    {
      "http://8.8.8.8/to-meta": {
        status: 302,
        location: "http://169.254.169.254/latest/meta-data/",
      },
      "http://8.8.8.8/to-local": {
        status: 302,
        location: "http://localhost:9000/secret",
      },
    },
  );
  try {
    const out = await withKey(() =>
      runAiScraper({ provider: "perplexity", prompt }),
    );
    assert.equal(
      out.answer.includes("Metadata at"),
      true,
      "answer text is returned even when every source is rejected",
    );
    assert.deepEqual(out.sources, []);
    assert.equal(out.sourceDrops.total, 4);
    assert.equal(out.sourceDrops.nonPublic, 4);
    assert.ok(
      !mock.state.sourceCalls.some(
        (u) => u.includes("169.254.169.254") || u.includes("localhost"),
      ),
      "private redirect targets must never be fetched",
    );
  } finally {
    mock.restore();
  }
});

test("redirect chains over 3 hops are dropped and counted", async () => {
  const prompt = "long redirect chain prompt gamma";
  const mock = mockScrapeWithSourceRouter(
    [
      {
        input: { prompt, index: 1 },
        answer_text: "Chained link: http://93.184.216.34/c0.",
      },
    ],
    {
      "http://93.184.216.34/c0": {
        status: 302,
        location: "http://93.184.216.34/c1",
      },
      "http://93.184.216.34/c1": {
        status: 302,
        location: "http://93.184.216.34/c2",
      },
      "http://93.184.216.34/c2": {
        status: 302,
        location: "http://93.184.216.34/c3",
      },
      "http://93.184.216.34/c3": {
        status: 302,
        location: "http://93.184.216.34/c4",
      },
    },
  );
  try {
    const out = await withKey(() =>
      runAiScraper({ provider: "gemini", prompt }),
    );
    assert.deepEqual(out.sources, []);
    assert.equal(out.sourceDrops.total, 1);
    assert.equal(out.sourceDrops.tooManyRedirects, 1);
  } finally {
    mock.restore();
  }
});

test("non-http values in structured citation fields are dropped and counted as non_http", async () => {
  const prompt = "structured junk prompt delta";
  const mock = mockScrapeWithSourceRouter(
    [
      {
        input: { prompt, index: 1 },
        answer_text: "Only one usable citation here.",
        citations: [
          "https://93.184.216.34/good",
          "ftp://files.example.com/dump.csv",
          "mailto:ops@example.com",
          { url: "file:///var/secret" },
          404,
          null,
        ],
      },
    ],
    {
      "https://93.184.216.34/good": { status: 200 },
    },
  );
  try {
    const out = await withKey(() =>
      runAiScraper({ provider: "google_ai", prompt }),
    );
    assert.deepEqual(out.sources, ["https://93.184.216.34/good"]);
    // ftp/mailto strings, the object-wrapped file: URL, the number and the
    // null all reach the normalizer and are counted as non-http rejections.
    assert.equal(out.sourceDrops.total, 5);
    assert.equal(out.sourceDrops.nonHttp, 5);
  } finally {
    mock.restore();
  }
});

test("a cache hit returns the same verified sources and identical drop statistics", async () => {
  const prompt = "cache consistency prompt epsilon";
  const request = { provider: "chatgpt" as const, prompt };
  const mock = mockScrapeWithSourceRouter(
    [
      {
        input: { prompt, index: 1 },
        answer_text:
          "Short http://8.8.8.8/s plus a junk citation and a dead one.",
        citations: [
          "http://8.8.8.8/s",
          "tel:+15550100",
          "https://93.184.216.34/dead",
        ],
      },
    ],
    {
      "http://8.8.8.8/s": {
        status: 302,
        location: "https://93.184.216.34/final",
      },
      "https://93.184.216.34/final": { status: 200 },
      "https://93.184.216.34/dead": {
        reject: new Error("connect ECONNREFUSED"),
      },
    },
  );
  try {
    const first = await withKey(() => runAiScraper(request));
    assert.equal(first.cached, false);
    assert.deepEqual(first.sources, ["https://93.184.216.34/final"]);
    assert.deepEqual(first.sourceDrops, {
      total: 2,
      tooManyRedirects: 0,
      nonPublic: 0,
      resolveFailed: 1,
      nonHttp: 1,
    });
    const sourceCallsAfterFirst = mock.state.sourceCalls.length;

    const second = await withKey(() => runAiScraper(request));
    assert.equal(second.cached, true, "second call is served from cache");
    assert.deepEqual(second.sources, first.sources);
    assert.deepEqual(
      second.sourceDrops,
      first.sourceDrops,
      "drop statistics must survive the cache",
    );
    assert.equal(
      mock.state.scrapeCalls,
      1,
      "cache hit must not call Bright Data again",
    );
    assert.equal(
      mock.state.sourceCalls.length,
      sourceCallsAfterFirst,
      "cache hit must not re-resolve sources",
    );
  } finally {
    mock.restore();
  }
});

test("when every source is rejected, sources is an empty array rather than an error", async () => {
  const prompt = "all rejected prompt zeta";
  const mock = mockScrapeWithSourceRouter(
    [
      {
        input: { prompt, index: 1 },
        answer_text: "Answer with only internal links http://10.1.2.3/secret.",
      },
    ],
    {},
  );
  try {
    const out = await withKey(() =>
      runAiScraper({ provider: "perplexity", prompt }),
    );
    assert.equal(out.answer.includes("Answer with only internal"), true);
    assert.deepEqual(out.sources, []);
    assert.equal(out.sourceDrops.nonPublic, 1);
    assert.equal(out.sourceDrops.total, 1);
  } finally {
    mock.restore();
  }
});
