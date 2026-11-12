// Syncs data/health.json from the list's public status API.
//
//   https://indi.blog/api/blogs.json
//   → { blogs: [{ id, url, feed, tags, status, error, lastPost: { publishedAt },
//                 lastCheckedAt, lastOkAt, failingSince, dead }] }
//
// One request instead of 1430. The list's own worker re-checks every feed
// hourly, applies its thresholds (1 day for permanent errors, 7 days for the
// rest, 90 days to "gone") and caches the response for an hour — so this file
// only has to translate their vocabulary into ours:
//
//   lastPost.publishedAt → lastPostAt   (unix seconds)
//   dead + failingSince  → deadSince
//   error                → reason
//
// The output feeds shared/blogs.mjs, which turns lastPostAt into a freshness
// curve. If this file is missing the build silently falls back to ranking the
// README table, so a failed sync can never break a deploy.
//
//   node scripts/sync-health.mjs
//
// Runs daily from .github/workflows/sync-health.yml, and the result is
// committed because the runner is disposable.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blogId } from '../shared/blogs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const healthFile = path.join(root, 'data', 'health.json');

const API_URL = 'https://indi.blog/api/blogs.json';
const USER_AGENT =
  'Mozilla/5.0 (compatible; BlogCityBot/1.0; +https://github.com/timqian/chinese-independent-blogs)';
const TIMEOUT_MS = 45_000;
// their own renderer treats a short payload as a broken deployment, and so do we
const MIN_BLOGS = 1000;

/** ISO string → unix seconds, or null. */
function toUnix(iso) {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

async function fetchStatus() {
  // The endpoint sits behind Cloudflare and is occasionally slow to answer from
  // a home connection; one request, three tries, then give up cleanly.
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API_URL, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const blogs = Array.isArray(data?.blogs) ? data.blogs : [];
      if (blogs.length < MIN_BLOGS) throw new Error(`only ${blogs.length} blogs in the response`);
      return blogs;
    } catch (err) {
      last = err;
      if (attempt < 3) {
        console.warn(`  attempt ${attempt}/3 failed (${err.message}), retrying…`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw last;
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(healthFile, 'utf8')).blogs ?? {};
  } catch {
    return {};
  }
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const [list, previous] = await Promise.all([fetchStatus(), readPrevious()]);

  const blogs = {};
  let dated = 0;
  let dead = 0;

  for (const b of list) {
    const id = blogId(b.url || '');
    if (!id) continue;
    const prev = previous[id] ?? {};

    const at = toUnix(b.lastPost?.publishedAt);
    // a blog we already dated keeps its date when the API has none today
    const lastPostAt = at ?? prev.lastPostAt ?? null;
    if (lastPostAt) dated++;

    const failing = toUnix(b.failingSince);
    const isDead = Boolean(b.dead);
    if (isDead) dead++;

    blogs[id] = {
      feed: b.feed ?? prev.feed ?? '',
      ...(lastPostAt ? { lastPostAt } : {}),
      ...(isDead ? { deadSince: failing ?? prev.deadSince ?? now } : {}),
      ...(b.error ? { reason: String(b.error).slice(0, 200) } : {}),
      ...(failing ? { failingSince: failing } : {}),
    };
  }

  // Freshness is computed at build time from lastPostAt, so an unchanged
  // snapshot stays correct for as long as it exists. Only rewrite the file when
  // a fact actually changed — otherwise this would commit (and redeploy) every
  // single day for nothing.
  const sorted = (obj) =>
    JSON.stringify(
      Object.keys(obj)
        .sort()
        .map((k) => [k, obj[k]]),
    );
  if (sorted(previous) === sorted(blogs)) {
    console.log(`= ${list.length} blogs unchanged (${Object.keys(blogs).length} tracked) — data/health.json left as is`);
    return;
  }

  const payload = {
    updatedAt: new Date(now * 1000).toISOString(),
    source: API_URL,
    unit: 'unix seconds',
    blogs,
  };

  await mkdir(path.dirname(healthFile), { recursive: true });
  await writeFile(healthFile, JSON.stringify(payload), 'utf8');

  const ages = Object.values(blogs)
    .map((b) => b.lastPostAt)
    .filter(Boolean)
    .map((t) => (now - t) / 86400)
    .sort((a, b) => a - b);
  const median = ages.length ? ages[Math.floor(ages.length / 2)].toFixed(0) : '–';
  const kb = (Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(0);

  const prevIds = new Set(Object.keys(previous));
  const nextIds = Object.keys(blogs);
  const added = nextIds.filter((id) => !prevIds.has(id)).length;
  const removed = [...prevIds].filter((id) => !blogs[id]).length;
  const changed = nextIds.filter(
    (id) => prevIds.has(id) && JSON.stringify(previous[id]) !== JSON.stringify(blogs[id]),
  ).length;

  console.log(`✓ ${list.length} blogs from ${API_URL} → data/health.json (${kb} kB)`);
  console.log(`  +${added} new · ~${changed} changed · -${removed} gone`);
  console.log(`  dated ${dated} · dead ${dead} · median age ${median} days · newest ${ages[0]?.toFixed(1) ?? '–'} days`);
}

main().catch((err) => {
  console.error(`✗ sync failed: ${err.message}`);
  console.error('  data/health.json left untouched; the build will fall back to the README ranking');
  process.exit(1);
});
