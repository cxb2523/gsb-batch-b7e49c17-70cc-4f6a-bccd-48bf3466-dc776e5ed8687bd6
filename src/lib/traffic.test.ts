// OFFLINE CONTRACT TESTS for the Traffic Vault READ path (src/lib/traffic.ts).
//
// These tests replace BOTH external boundaries with in-memory fakes:
//   - the PRIVATE Vercel Blob (`@vercel/blob.get`) is a Map of fake keys;
//   - `next/cache` is an identity wrapper, so the read runs every time;
//   - the collector's real blob key layout and the real rename registry
//     (mission.aliases.json: santifer/career-ops -> career-ops-hq/career-ops)
//     are used unchanged, because those are the contract under test.
//
// No network, no BLOB_READ_WRITE_TOKEN value with any authority, no GitHub
// token. A green run here proves the READER's arithmetic and merge rules; it
// does NOT prove the production Blob/GitHub chain (the deploy verifier and the
// collector's live run do that). The fixtures are crafted payloads, never
// copies of production data.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  blobs: new Map<string, string>(),
  failingKeys: new Set<string>(),
}));

vi.mock("next/cache", () => ({
  // the cache is not part of this contract: call the reader directly
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock("@vercel/blob", () => ({
  get: vi.fn(async (key: string) => {
    if (fake.failingKeys.has(key)) throw new Error(`fake blob read failed: ${key}`);
    if (!fake.blobs.has(key)) return { statusCode: 404 };
    return { statusCode: 200, stream: new Response(fake.blobs.get(key)).body };
  }),
}));

import { loadTrafficVault } from "./traffic";

const CANONICAL = "career-ops-hq/career-ops";
const OLD_NAME = "santifer/career-ops";

const vaultKey = (repo: string) => `traffic/${repo.toLowerCase().replace("/", "--")}.json`;
const ciKey = (repo: string) => `ci-checkouts/${repo.toLowerCase().replace("/", "--")}.json`;

interface FakeVault {
  repo: string;
  views?: Record<string, { c: number; u: number }>;
  clones?: Record<string, { c: number; u: number }>;
  referrers?: { r: string; c: number; u: number }[];
  referrersAt?: string | null;
  updatedAt?: string | null;
  uniq14?: { cloners: number | null; visitors: number | null; at: string };
}

const putVault = (repo: string, over: Partial<FakeVault> = {}) =>
  fake.blobs.set(
    vaultKey(repo),
    JSON.stringify({
      repo,
      views: {},
      clones: {},
      referrers: [],
      referrersAt: null,
      updatedAt: null,
      ...over,
    }),
  );

const putCi = (
  repo: string,
  days: Record<string, { runs: number; checkouts: number }>,
  range = { low: 1, high: 5 },
) => fake.blobs.set(ciKey(repo), JSON.stringify({ repo, range, days }));

const dayOf = (res: Awaited<ReturnType<typeof loadTrafficVault>>, d: string) =>
  res?.days.find((x) => x.d === d);

beforeEach(() => {
  fake.blobs.clear();
  fake.failingKeys.clear();
  // A token must be PRESENT for readVault to attempt a read; the mock ignores
  // its value, so this grants no access to anything real.
  process.env.BLOB_READ_WRITE_TOKEN = "offline-test-token-not-a-credential";
});

describe("uniq14: the top-level deduplicated headcount", () => {
  it("passes through the latest stored reading WITH its date, never a sum of daily uniques", async () => {
    // Per-day u values sum to 45 cloners / 150 visitors. GitHub's own 14-day
    // deduplicated reading is 41 / 138. The panel must publish 41 / 138.
    putVault(CANONICAL, {
      views: {
        "2026-10-19": { c: 10, u: 60 },
        "2026-10-20": { c: 20, u: 90 },
      },
      clones: {
        "2026-10-19": { c: 5, u: 20 },
        "2026-10-20": { c: 7, u: 25 },
      },
      uniq14: { cloners: 41, visitors: 138, at: "2026-10-21" },
    });

    const res = await loadTrafficVault(CANONICAL);

    expect(res?.uniq14).toEqual({ cloners: 41, visitors: 138, at: "2026-10-21" });
    expect(res?.uniq14?.cloners).not.toBe(45); // sum of days[].clonesU
    expect(res?.uniq14?.visitors).not.toBe(150); // sum of days[].viewsU
    // the date travels with the figure; it is what makes a stale reading visible
    expect(res?.uniq14?.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res?.newestDay).toBe("2026-10-20");
  });

  it("a vault written before uniq14 existed keeps null, and never falls back to summing days", async () => {
    putVault(CANONICAL, {
      views: { "2026-10-19": { c: 10, u: 60 }, "2026-10-20": { c: 20, u: 90 } },
      clones: { "2026-10-19": { c: 5, u: 20 }, "2026-10-20": { c: 7, u: 25 } },
    });

    const res = await loadTrafficVault(CANONICAL);

    expect(res).not.toBeNull();
    expect(res?.uniq14).toBeNull(); // "unmeasured", not 45 and not 150
    expect(res?.days.map((d) => d.clonesU)).toEqual([20, 25]); // per-day data is still readable
  });
});

describe("ciBand: the clone series split, per counted day", () => {
  it("is null on a clone day with no CI record; counted days give three parts summing to that day's clones", async () => {
    putVault(CANONICAL, {
      views: { "2026-10-19": { c: 1, u: 1 }, "2026-10-20": { c: 1, u: 1 }, "2026-10-21": { c: 1, u: 1 } },
      clones: {
        "2026-10-19": { c: 100, u: 10 },
        "2026-10-20": { c: 250, u: 20 }, // clone count present, CI not counted that day
        "2026-10-21": { c: 1000, u: 30 },
      },
    });
    // d2 is deliberately absent: a missing record is "not counted", not 0 CI.
    putCi(CANONICAL, {
      "2026-10-19": { runs: 10, checkouts: 20 },
      "2026-10-21": { runs: 50, checkouts: 100 },
    });

    const res = await loadTrafficVault(CANONICAL);

    expect(dayOf(res, "2026-10-20")?.clones).toBe(250);
    expect(dayOf(res, "2026-10-20")?.ciBand).toBeNull();

    const d1 = dayOf(res, "2026-10-19");
    expect(d1?.ciBand).toEqual({ ciMin: 20, unsure: 80, notCiMin: 0 });
    expect((d1?.ciBand?.ciMin ?? 0) + (d1?.ciBand?.unsure ?? 0) + (d1?.ciBand?.notCiMin ?? 0)).toBe(
      d1?.clones,
    );

    const d3 = dayOf(res, "2026-10-21");
    // at least CI = checkouts x1, at most CI = checkouts x5 (the ceiling above
    // every observed clones-per-checkout slope), the rest is at least not CI
    expect(d3?.ciBand).toEqual({ ciMin: 100, unsure: 400, notCiMin: 500 });
    expect((d3?.ciBand?.ciMin ?? 0) + (d3?.ciBand?.unsure ?? 0) + (d3?.ciBand?.notCiMin ?? 0)).toBe(
      d3?.clones,
    );

    // the CI note covers exactly the days that were counted
    expect(res?.ci).toEqual({ low: 1, high: 5, from: "2026-10-19", to: "2026-10-21" });
  });
});

describe("renames: old and new names merge day by day", () => {
  it("merges vault and CI days under every historical name; the canonical name wins overlaps", async () => {
    putVault(OLD_NAME, {
      views: { "2026-10-19": { c: 111, u: 1 }, "2026-10-20": { c: 222, u: 2 } },
      clones: { "2026-10-19": { c: 11, u: 1 }, "2026-10-20": { c: 22, u: 2 } },
      updatedAt: "2026-10-22T00:00:00.000Z",
      uniq14: { cloners: 900, visitors: 901, at: "2026-10-21" },
    });
    putVault(CANONICAL, {
      views: { "2026-10-20": { c: 333, u: 3 }, "2026-10-22": { c: 444, u: 4 } },
      clones: { "2026-10-20": { c: 33, u: 3 }, "2026-10-22": { c: 44, u: 4 } },
      updatedAt: "2026-10-24T00:00:00.000Z",
      uniq14: { cloners: 41, visitors: 138, at: "2026-10-24" },
    });

    putCi(OLD_NAME, {
      "2026-10-19": { runs: 10, checkouts: 10 },
      "2026-10-20": { runs: 20, checkouts: 20 },
    });
    putCi(CANONICAL, {
      // 5 checkouts on the overlap day: clearly different from the old
      // archive's 20, so "canonical wins" is observable in the band
      "2026-10-20": { runs: 5, checkouts: 5 },
      "2026-10-22": { runs: 30, checkouts: 30 },
    });

    // ask by BOTH names: the public route may still carry the old one
    const res = await loadTrafficVault(CANONICAL);
    const resViaOldName = await loadTrafficVault(OLD_NAME);

    for (const r of [res, resViaOldName]) {
      const days = new Map(r?.days.map((d) => [d.d, d]));
      expect(days.get("2026-10-19")?.views).toBe(111); // only the old archive has it
      expect(days.get("2026-10-20")?.views).toBe(333); // overlap: canonical wins
      expect(days.get("2026-10-20")?.clones).toBe(33); // overlap: canonical wins
      expect(days.get("2026-10-22")?.clones).toBe(44); // only the new archive has it
      // CI days merge the same way, canonical winning the overlap (5
      // checkouts, not the old archive's 20)
      expect(days.get("2026-10-20")?.ciBand).toEqual({ ciMin: 5, unsure: 20, notCiMin: 8 });
      // fresh point-in-time snapshot (newest updatedAt) supplies the headcount
      expect(r?.uniq14).toEqual({ cloners: 41, visitors: 138, at: "2026-10-24" });
    }
    expect(resViaOldName).toEqual(res);
  });

  it("an alias read failure costs only that alias's data; the canonical vault and CI still render", async () => {
    putVault(CANONICAL, {
      views: { "2026-10-20": { c: 333, u: 3 } },
      clones: { "2026-10-20": { c: 100, u: 3 } },
      updatedAt: "2026-10-24T00:00:00.000Z",
      uniq14: { cloners: 41, visitors: 138, at: "2026-10-24" },
    });
    putCi(CANONICAL, { "2026-10-20": { runs: 10, checkouts: 20 } });
    // the rename alias is unreadable (deleted blob, 500, network): it must be
    // skipped, not turn the whole panel into "no data"
    fake.failingKeys.add(vaultKey(OLD_NAME));
    fake.failingKeys.add(ciKey(OLD_NAME));

    const res = await loadTrafficVault(CANONICAL);

    expect(res).not.toBeNull();
    expect(res?.days).toHaveLength(1);
    expect(dayOf(res, "2026-10-20")?.clones).toBe(100);
    expect(dayOf(res, "2026-10-20")?.ciBand).toEqual({ ciMin: 20, unsure: 80, notCiMin: 0 });
    expect(res?.uniq14).toEqual({ cloners: 41, visitors: 138, at: "2026-10-24" });
  });

  it("a failing alias VAULT read does not discard that alias's CI record", async () => {
    putVault(CANONICAL, {
      clones: { "2026-10-20": { c: 100, u: 3 } },
      updatedAt: "2026-10-24T00:00:00.000Z",
    });
    putCi(OLD_NAME, { "2026-10-20": { runs: 10, checkouts: 20 } });
    fake.failingKeys.add(vaultKey(OLD_NAME));

    const res = await loadTrafficVault(CANONICAL);

    expect(dayOf(res, "2026-10-20")?.clones).toBe(100); // canonical vault
    expect(dayOf(res, "2026-10-20")?.ciBand).toEqual({ ciMin: 20, unsure: 80, notCiMin: 0 });
  });

  it("a failing alias CI read does not discard the alias vault's days", async () => {
    putVault(OLD_NAME, {
      clones: { "2026-10-19": { c: 11, u: 1 } },
      updatedAt: "2026-10-22T00:00:00.000Z",
    });
    putVault(CANONICAL, {
      clones: { "2026-10-20": { c: 33, u: 3 } },
      updatedAt: "2026-10-24T00:00:00.000Z",
    });
    fake.failingKeys.add(ciKey(OLD_NAME));

    const res = await loadTrafficVault(CANONICAL);

    expect(res?.days.map((d) => d.d)).toEqual(["2026-10-19", "2026-10-20"]);
    expect(dayOf(res, "2026-10-19")?.clones).toBe(11); // only the alias archive has it
    expect(dayOf(res, "2026-10-19")?.ciBand).toBeNull(); // its CI record was the failed read
  });
});
