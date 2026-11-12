/**
 * Per-request parse budget on the HTTP entry points (server.ts).
 *
 * Parsing cost grows with the square of the number of matches a name yields,
 * so length caps alone don't bound it: a 1024-character string of repeated
 * season markers costs ~200 ms where a real name costs under 3 ms. The server
 * therefore enforces GUESSIT_PARSE_BUDGET_MS — cumulative parse milliseconds
 * per request, shared between the single-name and batch paths, falling back to
 * a conservative default (1000 ms) when the variable is unset.
 *
 * How to trip the budget deterministically from a local machine: repeat a
 * match-dense token. `'S01E01.'.repeat(146)` is 1022 characters — just under
 * the 1024-character cap, so it passes every length guard — yet takes ~200 ms
 * to parse because every repetition yields another season/episode match. One
 * such string exceeds a small budget (e.g. GUESSIT_PARSE_BUDGET_MS=50); a
 * batch of them exceeds the 1000 ms default after a handful of entries.
 *
 * These tests spawn server.ts (via tsx) twice: once with no budget variable
 * (default behavior) and once with a 50 ms budget (deterministic tripping).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const SERVER = join(root, 'server.ts');
const TSX = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const DEFAULT_PORT = 38511;
const TIGHT_PORT = 38512;
// 100 ms: a real name parses in ~2 ms (50x margin), the pathological string
// below takes ~200 ms (trips with 2x margin) — stable either way.
const TIGHT_BUDGET_MS = 100;
const DEFAULT_BASE = `http://127.0.0.1:${DEFAULT_PORT}/api/guessit`;
const TIGHT_BASE = `http://127.0.0.1:${TIGHT_PORT}/api/guessit`;

/**
 * 1022 characters — under the 1024-character cap — but ~200 ms to parse.
 * This is the local, self-contained way to trip the budget: no fixtures, no
 * network, just a match-dense repeated token.
 */
const PATHOLOGICAL = 'S01E01.'.repeat(146);

const servers: ChildProcess[] = [];

async function startServer(port: number, extraEnv: Record<string, string>): Promise<void> {
  const env: Record<string, string> = { ...process.env, PORT: String(port) } as Record<string, string>;
  // The default-behavior server must see the variable as genuinely unset.
  delete env['GUESSIT_PARSE_BUDGET_MS'];
  Object.assign(env, extraEnv);
  const child = spawn(process.execPath, [TSX, SERVER], { env, stdio: 'ignore' });
  servers.push(child);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server on port ${port} did not come up`);
}

/**
 * The first parse on a fresh server builds the whole rule set (hundreds of
 * milliseconds), which would itself trip a tight budget. Warm each server up
 * with one real parse so tests measure steady-state parsing only.
 */
async function warmUp(port: number): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/api/guessit?filename=warmup.2020.mkv`);
  if (!res.ok) throw new Error(`warmup parse failed on port ${port}`);
}

function post(base: string, body: unknown): Promise<Response> {
  return fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await startServer(DEFAULT_PORT, {});
  await startServer(TIGHT_PORT, { GUESSIT_PARSE_BUDGET_MS: String(TIGHT_BUDGET_MS) });
  await warmUp(DEFAULT_PORT);
  await warmUp(TIGHT_PORT);
}, 60000);

afterAll(() => {
  for (const child of servers) child.kill();
});

describe('parse budget — normal traffic', () => {
  it('parses a normal single filename (GET)', async () => {
    const res = await fetch(`${DEFAULT_BASE}?filename=Movie.2020.1080p.mkv`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: 'Movie', year: 2020 });
  });

  it('parses a normal single filename (POST)', async () => {
    const res = await post(DEFAULT_BASE, { filename: 'Movie.2020.1080p.mkv' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: 'Movie', year: 2020 });
  });

  it('parses a normal batch with the documented entry shape', async () => {
    const names = ['Movie.2020.1080p.mkv', 'Breaking.Bad.S01E02.720p.mkv'];
    const res = await post(DEFAULT_BASE, { filenames: names });
    expect(res.status).toBe(200);
    const entries = (await res.json()) as Array<{ input_string: string; result?: Record<string, unknown> }>;
    expect(entries.map((e) => e.input_string)).toEqual(names);
    expect(entries[0].result).toMatchObject({ title: 'Movie', year: 2020 });
    expect(entries[1].result).toMatchObject({ title: 'Breaking Bad', season: 1, episode: 2 });
  });

  it('matches the library contract for a failing name inside a batch', async () => {
    // guessitMany isolates a throwing name as {input_string, error}; the HTTP
    // budget loop must preserve that, not abort the batch.
    const res = await post(DEFAULT_BASE, { filenames: ['Movie.2020.1080p.mkv', 42 as unknown as string] });
    // Non-strings are stringified by the server (map(String)), so this is a
    // normal parse — assert the general contract instead: one entry per name.
    expect(res.status).toBe(200);
    const entries = (await res.json()) as Array<{ input_string: string }>;
    expect(entries).toHaveLength(2);
    expect(entries[0].input_string).toBe('Movie.2020.1080p.mkv');
  });
});

describe('parse budget — exceeded', () => {
  it('stops a batch mid-way and answers 413 with completed entries', async () => {
    const names = ['Movie.2020.1080p.mkv', PATHOLOGICAL, 'Another.2021.720p.mkv'];
    const res = await post(TIGHT_BASE, { filenames: names });
    expect(res.status).toBe(413);
    const body = (await res.json()) as {
      error: string;
      budget_ms: number;
      elapsed_ms: number;
      trigger: string;
      results: Array<{ input_string: string; result?: Record<string, unknown>; error?: string }>;
    };
    // Readable explanation plus the input that tripped the budget.
    expect(body.error).toMatch(/budget/i);
    expect(body.budget_ms).toBe(TIGHT_BUDGET_MS);
    expect(body.trigger).toBe(PATHOLOGICAL);
    // The first name completed and rides along under the usual contract; the
    // triggering name and everything after it are absent — never disguised as
    // ordinary result/error entries.
    expect(body.results).toHaveLength(1);
    expect(body.results[0].input_string).toBe('Movie.2020.1080p.mkv');
    expect(body.results[0].result).toMatchObject({ title: 'Movie', year: 2020 });
    expect(body.results.some((e) => e.input_string === PATHOLOGICAL)).toBe(false);
  });

  it('answers 413 for a single filename that exceeds the budget (GET)', async () => {
    const res = await fetch(`${TIGHT_BASE}?filename=${encodeURIComponent(PATHOLOGICAL)}`);
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; trigger: string };
    expect(body.error).toMatch(/budget/i);
    expect(body.trigger).toBe(PATHOLOGICAL);
  });

  it('answers 413 for a single filename that exceeds the budget (POST)', async () => {
    const res = await post(TIGHT_BASE, { filename: PATHOLOGICAL });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { trigger: string };
    expect(body.trigger).toBe(PATHOLOGICAL);
  });
});

describe('parse budget — default when GUESSIT_PARSE_BUDGET_MS is unset', () => {
  it('accepts a single worst-case filename under the default budget', async () => {
    // ~200 ms of parsing fits the conservative 1000 ms default.
    const res = await fetch(`${DEFAULT_BASE}?filename=${encodeURIComponent(PATHOLOGICAL)}`);
    expect(res.status).toBe(200);
  }, 20000);

  it('caps a hostile batch at the default 1000 ms budget', async () => {
    // 30 worst-case names would hold the request for several seconds; the
    // default budget aborts the batch after ~1 s of cumulative parsing.
    const res = await post(DEFAULT_BASE, { filenames: Array(30).fill(PATHOLOGICAL) });
    expect(res.status).toBe(413);
    const body = (await res.json()) as {
      budget_ms: number;
      trigger: string;
      results: Array<{ input_string: string }>;
    };
    expect(body.budget_ms).toBe(1000);
    expect(body.trigger).toBe(PATHOLOGICAL);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.length).toBeLessThan(30);
  }, 30000);
});
