/**
 * guessit-js API as a Cloudflare Worker — zero-maintenance hosted API.
 * Deploy: npx wrangler deploy   (or the deploy-api GitHub workflow on release)
 *
 * Routes (same contract as `guessit-js --serve` and server.ts):
 *   GET  /api/guessit?filename=Movie.2020.1080p.mkv[&type=movie|episode]
 *   POST /api/guessit   {"filename": "..."} or {"filenames": [...], "options": {...}}
 *   GET  /api/health
 */
// Workers runtime has no `process` global, and the bundle reads process.env
// debug flags at call time. A side-effect shim import gets tree-shaken (the
// package sets sideEffects: false), so define it before a dynamic import.
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {} };
}
const { guessit, version } = await import('../dist/guessit-js.js');

// Parsing cost grows with the square of the number of matches a name yields, so
// a long synthetic string costs far more than its length suggests: 400
// repetitions of "S01E01" take seconds where a real name takes under 3 ms. The
// whole fixture corpus tops out at 196 characters, so these bounds only ever
// reject something that was never a filename.
const MAX_FILENAME_LENGTH = 1024;
// 100 names is the documented batch contract across every HTTP surface, and on
// the free Workers tier it also keeps one request inside the CPU budget.
const MAX_BATCH = 100;

/**
 * Cumulative wall-clock parse time one request may consume, in milliseconds —
 * the same budget server.ts enforces. Length caps alone don't bound cost:
 * parsing grows with the square of the match count, so a 1024-character string
 * of repeated season markers burns ~200 ms of CPU where a real name burns
 * under 3 ms. The budget is per request, shared between the single-name and
 * batch paths, and checked after each parsed name (parsing is synchronous, so
 * a name already in flight always runs to completion). Over budget → 413; a
 * batch's completed names are still returned in the 413 body under `results`,
 * and the name that tripped the budget is reported as `trigger`, never as a
 * normal entry. The library itself is untouched — in-process callers of
 * guessit() / guessitMany() stay unbounded.
 *
 * Set GUESSIT_PARSE_BUDGET_MS as a Worker var (wrangler.toml [vars] or a
 * secret) to override; unset or unparseable values fall back to a
 * conservative default. Caveat: the Workers runtime freezes timers between
 * awaits, so on Cloudflare the clock may not advance inside a purely
 * synchronous batch loop — the budget still trips on the single-name paths
 * and on any runtime with a live clock (miniflare, Node), and the free-tier
 * CPU limit remains the backstop on Cloudflare itself.
 */
const DEFAULT_PARSE_BUDGET_MS = 1000;

function resolveParseBudgetMs(env) {
  const raw = (env && env.GUESSIT_PARSE_BUDGET_MS) ??
    (globalThis.process && globalThis.process.env && globalThis.process.env.GUESSIT_PARSE_BUDGET_MS);
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_PARSE_BUDGET_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PARSE_BUDGET_MS;
}

/** Body sent with a 413 when the parse budget trips. */
function budgetExceededBody(budgetMs, elapsedMs, trigger, results) {
  return {
    error:
      `Parse time budget exceeded: ${Math.round(elapsedMs)} ms used of the ` +
      `${budgetMs} ms allowed per request (GUESSIT_PARSE_BUDGET_MS)`,
    budget_ms: budgetMs,
    elapsed_ms: Math.round(elapsedMs),
    trigger,
    ...(results !== undefined ? { results } : {}),
  };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

const USAGE = {
  service: 'guessit-js API',
  notice: 'DEMO for testing/evaluation only — never use in production. Free tier, daily request cap, no SLA. Self-host: npx guessit-js --serve',
  docs: 'https://opensubtitles.github.io/guessit-js/docs/',
  get: '/api/guessit?filename=Movie.2020.1080p.mkv&type=movie|episode (type optional)',
  post: '/api/guessit with {"filename": "..."} or {"filenames": [...], "options": {...}}',
  health: '/api/health',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parseBudgetMs = resolveParseBudgetMs(env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/health') return json({ status: 'ok', version });
    if (url.pathname === '/' || url.pathname === '') return json({ ...USAGE, version });
    if (url.pathname !== '/api/guessit') return json({ error: 'Not found', ...USAGE }, 404);

    if (request.method === 'GET') {
      const filename = url.searchParams.get('filename');
      if (!filename) return json({ error: 'Missing required parameter: filename', ...USAGE }, 400);
      if (filename.length > MAX_FILENAME_LENGTH) {
        return json({ error: `filename exceeds ${MAX_FILENAME_LENGTH} characters` }, 413);
      }
      const options = {};
      const type = url.searchParams.get('type');
      if (type === 'movie' || type === 'episode') options.type = type;
      try {
        // Cloudflare does NOT auto-cache Worker responses — a Cache-Control
        // header alone only instructs browsers. Real edge caching needs the
        // Cache API. Identical input → identical output, so cache hard.
        const cache = caches.default;
        const cacheKey = new Request(url.toString(), { method: 'GET' });
        const hit = await cache.match(cacheKey);
        if (hit) {
          const res = new Response(hit.body, hit);
          res.headers.set('X-Cache', 'HIT');
          return res;
        }
        const start = performance.now();
        const result = guessit(filename, options);
        const elapsed = performance.now() - start;
        if (elapsed > parseBudgetMs) {
          return json(budgetExceededBody(parseBudgetMs, elapsed, filename), 413);
        }
        const res = json(result, 200, {
          'Cache-Control': 'public, max-age=86400',
          'X-Cache': 'MISS',
        });
        await cache.put(cacheKey, res.clone());
        return res;
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid JSON body' }, 400); }
      const options = body && typeof body.options === 'object' && body.options ? body.options : {};
      try {
        if (Array.isArray(body.filenames)) {
          // One entry per name, each {input_string, result} or {input_string, error},
          // answered in request order — the same contract as server.ts and --serve.
          // guessitMany parses the options once for the batch and isolates a failing
          // name instead of taking the request down with it. Over-limit is 413, as
          // the single-filename path and the other two surfaces already answered.
          if (body.filenames.length > MAX_BATCH) {
            return json({ error: `Max ${MAX_BATCH} filenames per request` }, 413);
          }
          const names = body.filenames.map(String);
          if (names.some((f) => f.length > MAX_FILENAME_LENGTH)) {
            return json({ error: `filename exceeds ${MAX_FILENAME_LENGTH} characters` }, 413);
          }
          // Parse name by name so the per-request budget can stop the batch:
          // once cumulative parse time crosses the budget, the remaining names
          // are refused with a 413 instead of being parsed. Entries are built
          // exactly like guessitMany does — a throwing name yields
          // {input_string, error} and does not abort the batch.
          const budgetStart = performance.now();
          const entries = [];
          for (const name of names) {
            let entry;
            try {
              entry = { input_string: name, result: guessit(name, options) };
            } catch (e) {
              entry = { input_string: name, error: String((e && e.message) || e) };
            }
            const elapsed = performance.now() - budgetStart;
            if (elapsed > parseBudgetMs) {
              return json(budgetExceededBody(parseBudgetMs, elapsed, name, entries), 413);
            }
            entries.push(entry);
          }
          return json(entries);
        }
        if (typeof body.filename === 'string') {
          if (body.filename.length > MAX_FILENAME_LENGTH) {
            return json({ error: `filename exceeds ${MAX_FILENAME_LENGTH} characters` }, 413);
          }
          const start = performance.now();
          const result = guessit(body.filename, options);
          const elapsed = performance.now() - start;
          if (elapsed > parseBudgetMs) {
            return json(budgetExceededBody(parseBudgetMs, elapsed, body.filename), 413);
          }
          return json(result);
        }
        return json({ error: 'Body must contain "filename" (string) or "filenames" (array)' }, 400);
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    return json({ error: 'Method not allowed' }, 405);
  },
};
