import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSources,
  MAX_SOURCE_REDIRECTS,
} from "./source-normalizer";

/**
 * All "hosts" here are public IP literals (8.8.8.8, 93.184.216.34, …), so
 * assertPublicHttpUrl needs no DNS. Every network call is answered by this
 * in-memory router — no real outbound traffic.
 */
type Route = { status?: number; location?: string; reject?: Error };

function installFetchRouter(routes: Record<string, Route>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(url);
    const route = routes[url];
    if (!route) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    if (route.reject) throw route.reject;
    const headers = new Headers();
    if (route.location) headers.set("location", route.location);
    return new Response(null, {
      status: route.status ?? 200,
      headers,
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("a short link redirecting to a public address merges with the direct address into one entry", async () => {
  const router = installFetchRouter({
    "http://8.8.8.8/s": {
      status: 302,
      location: "https://93.184.216.34/report",
    },
    "https://93.184.216.34/report": { status: 200 },
  });
  try {
    const result = await normalizeSources([
      "http://8.8.8.8/s",
      "https://93.184.216.34/report",
    ]);
    assert.deepEqual(result.sources, ["https://93.184.216.34/report"]);
    assert.equal(result.dropped.total, 0);
    // The short link was actually resolved, not just string-compared.
    assert.ok(
      router.calls.includes("http://8.8.8.8/s"),
      "short link should be fetched and followed",
    );
  } finally {
    router.restore();
  }
});

test("http and https spellings of one final address keep a single https entry", async () => {
  const router = installFetchRouter({
    "http://93.184.216.34/page": { status: 200 },
    "https://93.184.216.34/page": { status: 200 },
  });
  try {
    const result = await normalizeSources([
      "http://93.184.216.34/page",
      "https://93.184.216.34/page",
    ]);
    assert.deepEqual(result.sources, ["https://93.184.216.34/page"]);
    assert.equal(result.dropped.total, 0);
  } finally {
    router.restore();
  }
});

test("tracking parameters and fragments do not split one source into two", async () => {
  const router = installFetchRouter({
    "https://93.184.216.34/a?utm_source=newsletter": { status: 200 },
    "https://93.184.216.34/a?gclid=abc123": { status: 200 },
  });
  try {
    const result = await normalizeSources([
      "https://93.184.216.34/a?utm_source=newsletter#frag",
      "https://93.184.216.34/a?gclid=abc123",
    ]);
    assert.deepEqual(result.sources, ["https://93.184.216.34/a"]);
  } finally {
    router.restore();
  }
});

test("a redirect landing on 169.254.169.254 is rejected and counted as non_public", async () => {
  const router = installFetchRouter({
    "http://8.8.8.8/meta": {
      status: 302,
      location: "http://169.254.169.254/latest/meta-data/",
    },
  });
  try {
    const result = await normalizeSources(["http://8.8.8.8/meta"]);
    assert.deepEqual(result.sources, []);
    assert.equal(result.dropped.total, 1);
    assert.equal(result.dropped.nonPublic, 1);
    // The private target must never have been fetched.
    assert.ok(
      !router.calls.some((u) => u.includes("169.254.169.254")),
      "private redirect target must not be requested",
    );
  } finally {
    router.restore();
  }
});

test("a redirect landing on localhost is rejected and counted as non_public", async () => {
  const router = installFetchRouter({
    "http://8.8.8.8/local": {
      status: 302,
      location: "http://localhost:8080/admin",
    },
  });
  try {
    const result = await normalizeSources(["http://8.8.8.8/local"]);
    assert.deepEqual(result.sources, []);
    assert.equal(result.dropped.total, 1);
    assert.equal(result.dropped.nonPublic, 1);
  } finally {
    router.restore();
  }
});

test("a source pointing straight at a private address is rejected as non_public", async () => {
  const router = installFetchRouter({});
  try {
    const result = await normalizeSources(["http://10.0.0.5/internal"]);
    assert.deepEqual(result.sources, []);
    assert.equal(result.dropped.nonPublic, 1);
    assert.equal(router.calls.length, 0, "private URL must not be fetched");
  } finally {
    router.restore();
  }
});

test("exactly three redirects resolve; a fourth is rejected as too_many_redirects", async () => {
  const router = installFetchRouter({
    // 3 hops: /r0 -> /r1 -> /r2 -> /final (allowed)
    "http://8.8.8.8/r0": { status: 301, location: "http://8.8.8.8/r1" },
    "http://8.8.8.8/r1": { status: 302, location: "http://8.8.8.8/r2" },
    "http://8.8.8.8/r2": { status: 302, location: "https://8.8.8.8/final" },
    "https://8.8.8.8/final": { status: 200 },
    // 4 hops: /c0 -> /c1 -> /c2 -> /c3 -> /final (rejected)
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
      location: "http://93.184.216.34/end",
    },
  });
  try {
    assert.equal(MAX_SOURCE_REDIRECTS, 3);
    const ok = await normalizeSources(["http://8.8.8.8/r0"]);
    assert.deepEqual(ok.sources, ["https://8.8.8.8/final"]);
    assert.equal(ok.dropped.total, 0);

    const rejected = await normalizeSources(["http://93.184.216.34/c0"]);
    assert.deepEqual(rejected.sources, []);
    assert.equal(rejected.dropped.total, 1);
    assert.equal(rejected.dropped.tooManyRedirects, 1);
  } finally {
    router.restore();
  }
});

test("non-http values from structured citation fields are dropped as non_http", async () => {
  const router = installFetchRouter({
    "https://93.184.216.34/ok": { status: 200 },
  });
  try {
    const result = await normalizeSources([
      "https://93.184.216.34/ok",
      "ftp://files.example.com/data.csv",
      "mailto:team@example.com",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "urn:isbn:1234567890",
      "",
      42,
      null,
      { url: "https://93.184.216.34/obj" }, // objects are unwrapped upstream; a raw object is not a URL value
    ]);
    assert.deepEqual(result.sources, ["https://93.184.216.34/ok"]);
    assert.equal(result.dropped.nonHttp, 9);
    assert.equal(result.dropped.total, 9);
  } finally {
    router.restore();
  }
});

test("unparseable strings and failed fetches are counted as resolve_failed", async () => {
  const router = installFetchRouter({
    "https://93.184.216.34/dead": {
      reject: new Error("connect ECONNREFUSED"),
    },
  });
  try {
    const result = await normalizeSources([
      "not a url at all",
      "https://93.184.216.34/dead",
    ]);
    assert.deepEqual(result.sources, []);
    assert.equal(result.dropped.resolveFailed, 2);
    assert.equal(result.dropped.total, 2);
  } finally {
    router.restore();
  }
});

test("a redirect with a malformed Location is counted as resolve_failed", async () => {
  const router = installFetchRouter({
    "http://8.8.8.8/badloc": { status: 302, location: "http://[::1/" },
  });
  try {
    const result = await normalizeSources(["http://8.8.8.8/badloc"]);
    assert.deepEqual(result.sources, []);
    assert.equal(result.dropped.resolveFailed, 1);
  } finally {
    router.restore();
  }
});

test("a redirect response with no Location header fails closed as resolve_failed", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(null, { status: 302 })) as typeof fetch;
  try {
    const result = await normalizeSources(["http://8.8.8.8/opaque"]);
    assert.deepEqual(result.sources, []);
    assert.equal(result.dropped.resolveFailed, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("an all-rejected candidate list returns an empty array with full stats, never throws", async () => {
  const router = installFetchRouter({
    "http://8.8.8.8/meta": {
      status: 302,
      location: "http://169.254.169.254/",
    },
  });
  try {
    const result = await normalizeSources([
      "http://8.8.8.8/meta",
      "ftp://example.com/x",
      "garbage",
    ]);
    assert.deepEqual(result.sources, []);
    assert.equal(result.dropped.total, 3);
    assert.deepEqual(result.dropped, {
      total: 3,
      tooManyRedirects: 0,
      nonPublic: 1,
      resolveFailed: 1,
      nonHttp: 1,
    });
  } finally {
    router.restore();
  }
});
