// OFFLINE CONTRACT TESTS for the Traffic Vault WRITE path (collector/traffic.mjs).
//
// The collector is a side-effecting script, so this test runs it exactly as
// production does — but with BOTH external boundaries faked:
//   - `@vercel/blob` get/put are an in-memory Map (no Blob, no credential);
//   - global fetch answers the three GitHub traffic URLs from a fixture
//     (no api.github.com call, no TRAFFIC_TOKEN with any authority).
// The real rename registry (mission.aliases.json) and the real blob key
// layout are used unchanged, because those are the contract under test.
//
// This proves what the collector WRITES for a given response. It does not
// prove GitHub answered, that the token is authorized, or that production
// Blob holds the bytes: those need the live run. Fixtures are synthetic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  blobs: new Map(),
  failingKeys: new Set(),
}));

vi.mock("@vercel/blob", () => ({
  get: vi.fn(async (key) => {
    if (fake.failingKeys.has(key)) throw new Error(`fake blob read failed: ${key}`);
    if (!fake.blobs.has(key)) return { statusCode: 404 };
    return { statusCode: 200, stream: new Response(fake.blobs.get(key)).body };
  }),
  put: vi.fn(async (key, body) => {
    fake.blobs.set(key, body);
    return { url: `fake://${key}` };
  }),
}));

const CANONICAL = "career-ops-hq/career-ops";
const OLD_NAME = "santifer/career-ops";
const vaultKey = (repo) => `traffic/${repo.toLowerCase().replace("/", "--")}.json`;
const CANONICAL_KEY = vaultKey(CANONICAL);
const OLD_KEY = vaultKey(OLD_NAME);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// The exact three endpoints collector/traffic.mjs calls (ghTraffic), answered
// from a fixture. Any other URL is a test bug, not a silent empty answer.
function stubGithubTraffic(fixture) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith("/traffic/views?per=day")) return json(fixture.views);
      if (u.endsWith("/traffic/clones?per=day")) return json(fixture.clones);
      if (u.endsWith("/traffic/popular/referrers")) return json(fixture.referrers ?? []);
      throw new Error(`unexpected fetch: ${u}`);
    }),
  );
}

const stored = (key) => JSON.parse(fake.blobs.get(key));

const seed = (key, obj) => fake.blobs.set(key, JSON.stringify(obj));

const baseVault = (repo, over = {}) => ({
  repo,
  views: {},
  clones: {},
  referrers: [],
  referrersAt: null,
  updatedAt: null,
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  fake.blobs.clear();
  fake.failingKeys.clear();
  // Presence, not authority: the mocked @vercel/blob ignores the value.
  process.env.BLOB_READ_WRITE_TOKEN = "offline-test-token-not-a-credential";
  process.env.TRAFFIC_TOKEN = "offline-test-token-not-a-credential";
  delete process.env.TRAFFIC_TOKENS;
  // Pin the collector's `at` stamp so "the reading carries its date" is
  // deterministically asserted. Only Date is faked; no timers here.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T08:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("collector/traffic.mjs: top-level uniq14", () => {
  it("writes the LATEST reading and its date, replacing the previous one instead of accumulating", async () => {
    seed(
      CANONICAL_KEY,
      baseVault(CANONICAL, {
        views: { "2026-11-10": { c: 40, u: 20 } },
        clones: { "2026-11-10": { c: 7, u: 3 } },
        updatedAt: "2026-11-10T00:00:00.000Z",
        uniq14: { cloners: 100, visitors: 200, at: "2026-11-10" },
      }),
    );

    stubGithubTraffic({
      // per-day rows (c/u) are NOT the deduplicated headcount: uniques 120/220
      // are. A sum would publish 220 cloners / 420 visitors; a truthful vault
      // publishes 120 / 220.
      views: {
        count: 900,
        uniques: 220,
        views: [{ timestamp: "2026-11-11T00:00:00Z", count: 42, uniques: 9 }],
      },
      clones: {
        count: 300,
        uniques: 120,
        clones: [{ timestamp: "2026-11-11T00:00:00Z", count: 11, uniques: 4 }],
      },
    });

    await import("./traffic.mjs");
    const vault = stored(CANONICAL_KEY);

    expect(vault.uniq14).toEqual({ cloners: 120, visitors: 220, at: "2026-11-11" });
    expect(vault.uniq14.cloners).not.toBe(220); // 100 + 120
    expect(vault.uniq14.visitors).not.toBe(420); // 200 + 220
    // daily counts still merge by date: an untouched old day survives, the
    // just-read day is written
    expect(vault.clones["2026-11-10"]).toEqual({ c: 7, u: 3 });
    expect(vault.clones["2026-11-11"]).toEqual({ c: 11, u: 4 });
    expect(vault.views["2026-11-11"]).toEqual({ c: 42, u: 9 });
  });

  it("a second run keeps only the newest reading too (no 14-day windows added together)", async () => {
    seed(
      CANONICAL_KEY,
      baseVault(CANONICAL, {
        clones: { "2026-11-10": { c: 7, u: 3 } },
        uniq14: { cloners: 120, visitors: 220, at: "2026-11-11" },
      }),
    );
    stubGithubTraffic({
      views: { count: 0, uniques: 221, views: [] },
      clones: { count: 0, uniques: 130, clones: [] },
    });

    await import("./traffic.mjs");

    const vault = stored(CANONICAL_KEY);
    expect(vault.uniq14).toEqual({ cloners: 130, visitors: 221, at: "2026-11-11" });
    expect(vault.uniq14.cloners).not.toBe(250); // 120 + 130 across two runs
  });
});

describe("collector/traffic.mjs: rename survival on write", () => {
  it("seeds the canonical key from the old name so the old history is not restarted", async () => {
    seed(
      OLD_KEY,
      baseVault(OLD_NAME, {
        views: { "2026-11-09": { c: 5, u: 2 } },
        clones: { "2026-11-09": { c: 2, u: 1 } },
        updatedAt: "2026-11-10T00:00:00.000Z",
        uniq14: { cloners: 10, visitors: 20, at: "2026-11-10" },
      }),
    );
    stubGithubTraffic({
      views: {
        count: 1,
        uniques: 21,
        views: [{ timestamp: "2026-11-11T00:00:00Z", count: 3, uniques: 1 }],
      },
      clones: {
        count: 1,
        uniques: 11,
        clones: [{ timestamp: "2026-11-11T00:00:00Z", count: 1, uniques: 1 }],
      },
    });

    await import("./traffic.mjs");

    // the collector writes under the CURRENT name, carrying the old archive
    const vault = stored(CANONICAL_KEY);
    expect(vault.repo).toBe(CANONICAL);
    expect(vault.clones["2026-11-09"]).toEqual({ c: 2, u: 1 });
    expect(vault.clones["2026-11-11"]).toEqual({ c: 1, u: 1 });
    expect(vault.uniq14).toEqual({ cloners: 11, visitors: 21, at: "2026-11-11" });
  });

  it("a failed read of one historical name falls through to the next instead of aborting the repo", async () => {
    // canonical read fails transiently; the old-name vault is still readable,
    // so the write proceeds seeded from it (no data loss, no skipped repo)
    fake.failingKeys.add(CANONICAL_KEY);
    seed(OLD_KEY, baseVault(OLD_NAME, { clones: { "2026-11-09": { c: 2, u: 1 } } }));
    stubGithubTraffic({
      views: { count: 0, uniques: 21, views: [] },
      clones: { count: 0, uniques: 11, clones: [] },
    });

    await import("./traffic.mjs");

    const vault = stored(CANONICAL_KEY);
    expect(vault.clones["2026-11-09"]).toEqual({ c: 2, u: 1 });
    expect(vault.uniq14).toEqual({ cloners: 11, visitors: 21, at: "2026-11-11" });
  });
});
