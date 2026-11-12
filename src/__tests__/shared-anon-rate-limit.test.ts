import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:sockets", () => ({
  connect: vi.fn(),
}));

import worker from "../index";
import {
  RATE_LIMIT_ANON_BATCH_PER_WINDOW,
  RATE_LIMIT_ANON_CONVERT_PER_WINDOW,
  RATE_LIMIT_ANON_PER_DAY,
} from "../config";
import { localRateCounters } from "../runtime-state";
import { mockCtx } from "./test-helpers";
import type { Env } from "../types";

const NOW = new Date("2026-09-29T12:00:00.000Z");

/**
 * Minimal sqlite-backed D1 with only the rate_limits table; every other query
 * (auth lookups, conversion events, ...) resolves to an empty result, which
 * makes unauthenticated requests resolve to the anonymous tier.
 */
function createRateLimitD1(): { raw: DatabaseSync; db: D1Database } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL
    );
  `);
  const db = {
    prepare(statement: string) {
      const stmt = raw.prepare(statement);
      return {
        bind(...params: Array<string | number | null>) {
          return {
            first: async () => {
              try {
                return stmt.get(...params) ?? null;
              } catch {
                return null;
              }
            },
            all: async () => {
              try {
                return { results: stmt.all(...params) };
              } catch {
                return { results: [] };
              }
            },
            run: async () => {
              const info = stmt.run(...params);
              return { success: true, meta: { changes: Number(info.changes) } };
            },
          };
        },
      };
    },
    batch: async (items: Array<{ run: () => Promise<unknown> }>) =>
      Promise.all(items.map((item) => item.run())),
  };
  return { raw, db: db as unknown as D1Database };
}

function batchRequest(ip: string): Request {
  return new Request("https://md.example.com/api/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify({ urls: ["https://example.com/a"] }),
  });
}

function streamRequest(ip: string): Request {
  return new Request(
    "https://md.example.com/api/stream?url=" + encodeURIComponent("https://example.com/a"),
    { headers: { "cf-connecting-ip": ip } },
  );
}

describe("shared anonymous rate limit across isolates (worker routes)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    localRateCounters.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("enforces the anonymous batch minute cap even when every request lands on a fresh isolate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# hello from source", {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        }),
      ),
    );
    const { raw, db } = createRateLimitD1();
    const env = { AUTH_DB: db } as Env;
    const ip = "198.51.100.7";

    let last: Response | null = null;
    for (let i = 0; i < RATE_LIMIT_ANON_BATCH_PER_WINDOW + 1; i++) {
      // Simulate a cold isolate for every request: no in-memory counters exist.
      localRateCounters.clear();
      last = await worker.fetch(batchRequest(ip), env, mockCtx());
    }

    expect(last).not.toBeNull();
    expect(last!.status).toBe(429);
    const body = await last!.json() as { error?: string; message?: string };
    expect(body.message).toContain("Too many requests");
    expect(body.message).not.toContain("/portal/");
    expect(last!.headers.get("Retry-After")).toBeTruthy();

    const keys = raw
      .prepare("SELECT key FROM rate_limits WHERE key LIKE ?")
      .all(`anon-rl:batch:${ip}:%`) as Array<{ key: string }>;
    expect(keys).toHaveLength(1);
    const row = raw.prepare("SELECT count FROM rate_limits WHERE key = ?").get(keys[0].key) as {
      count: number;
    };
    expect(row.count).toBe(RATE_LIMIT_ANON_BATCH_PER_WINDOW + 1);
  });

  it("shares the daily cap between stream and batch and explains the daily block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# hello from source", {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        }),
      ),
    );
    const { raw, db } = createRateLimitD1();
    const env = { AUTH_DB: db } as Env;
    const ip = "198.51.100.8";
    const day = NOW.toISOString().slice(0, 10);
    // Daily budget already spent on other routes earlier today.
    raw.prepare("INSERT INTO rate_limits (key, count, expires_at) VALUES (?, ?, ?)").run(
      `anon-daily:${ip}:${day}`,
      RATE_LIMIT_ANON_PER_DAY,
      "2026-09-30T00:00:00.000Z",
    );

    localRateCounters.clear();
    const blocked = await worker.fetch(batchRequest(ip), env, mockCtx());

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe(String(12 * 3600));
    const body = await blocked.json() as { message?: string };
    expect(body.message).toContain("daily");
    expect(body.message).toContain(String(RATE_LIMIT_ANON_PER_DAY));
    expect(body.message).toContain("/portal/");

    // The same IP is also blocked on the stream route until UTC midnight.
    localRateCounters.clear();
    const blockedOnStream = await worker.fetch(streamRequest(ip), env, mockCtx());
    expect(blockedOnStream.status).toBe(429);
    expect(blockedOnStream.headers.get("Retry-After")).toBe(String(12 * 3600));
  });

  it("does not rate limit requests without a client IP and leaves other IPs alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# hello from source", {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        }),
      ),
    );
    const { raw, db } = createRateLimitD1();
    const env = { AUTH_DB: db } as Env;

    // No cf-connecting-ip / x-forwarded-for: the limiter never judges the request.
    const noIp = new Request("https://md.example.com/api/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: ["https://example.com/no-ip"] }),
    });
    for (let i = 0; i < RATE_LIMIT_ANON_CONVERT_PER_WINDOW + 5; i++) {
      localRateCounters.clear();
      const res = await worker.fetch(noIp.clone(), env, mockCtx());
      expect(res.status).not.toBe(429);
    }
    const counterRows = raw.prepare("SELECT COUNT(*) AS n FROM rate_limits").get() as { n: number };
    expect(counterRows.n).toBe(0);

    // A different IP still gets the full anonymous allowance.
    const fresh = await worker.fetch(batchRequest("198.51.100.9"), env, mockCtx());
    expect(fresh.status).not.toBe(429);
  });

  it("fails open when the D1 counter store is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("# hello from source", {
          status: 200,
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        }),
      ),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      AUTH_DB: {
        prepare: () => {
          throw new Error("D1 unavailable");
        },
      },
    } as unknown as Env;

    for (let i = 0; i < RATE_LIMIT_ANON_CONVERT_PER_WINDOW + 5; i++) {
      localRateCounters.clear();
      const res = await worker.fetch(batchRequest("198.51.100.10"), env, mockCtx());
      expect(res.status, `request ${i + 1}`).not.toBe(429);
    }
    expect(warn).toHaveBeenCalled();
  });
});
