// Regenerates src/data/blogs.json from the chinese-independent-blogs data.
//
//   node scripts/build-blogs.mjs            # use the sibling clone
//   node scripts/build-blogs.mjs --remote   # pull the live CSV/README from GitHub
//
// The sibling clone (../../chinese-independent-blogs) is the default so the
// snapshot matches the exact list you cloned; --remote keeps it current.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../shared/blogs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sibling = path.resolve(root, '..', 'chinese-independent-blogs');

// Two mirrors for the same repo: raw.githubusercontent is blocked on plenty of
// Chinese networks, jsDelivr is not. Tried in order, first one that answers wins.
const MIRRORS = [
  { label: 'jsdelivr', base: 'https://cdn.jsdelivr.net/gh/timqian/chinese-independent-blogs@master' },
  { label: 'github:raw', base: 'https://raw.githubusercontent.com/timqian/chinese-independent-blogs/master' },
];
const remote = process.argv.includes('--remote');

async function fromMirror(file) {
  const failures = [];
  for (const m of MIRRORS) {
    try {
      const res = await fetch(`${m.base}/${file}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.length < 1000) throw new Error('suspiciously short response');
      return { text, label: m.label };
    } catch (err) {
      failures.push(`${m.label}: ${err.message}`);
    }
  }
  throw new Error(`${file} — ${failures.join('; ')}`);
}

async function load() {
  if (remote) {
    const [csv, readme] = await Promise.all([fromMirror('blogs-original.csv'), fromMirror('README.md')]);
    return { csvText: csv.text, readmeText: readme.text, label: csv.label };
  }
  try {
    const [csvText, readmeText] = await Promise.all([
      readFile(path.join(sibling, 'blogs-original.csv'), 'utf8'),
      readFile(path.join(sibling, 'README.md'), 'utf8'),
    ]);
    return { csvText, readmeText, label: 'local-clone' };
  } catch (err) {
    console.warn(`! local clone not readable (${err.message}), going upstream`);
    const [csv, readme] = await Promise.all([fromMirror('blogs-original.csv'), fromMirror('README.md')]);
    return { csvText: csv.text, readmeText: readme.text, label: csv.label };
  }
}

// The status snapshot decides freshness and death by real dates. Without it the
// README rank is used instead (the file is optional and may lag or be missing).
async function loadHealth() {
  try {
    const raw = await readFile(path.join(root, 'data', 'health.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.blogs || !Object.keys(parsed.blogs).length) return { health: undefined, count: 0 };
    return { health: parsed.blogs, count: Object.keys(parsed.blogs).length };
  } catch {
    return { health: undefined, count: 0 };
  }
}

const { csvText, readmeText, label } = await load();
const { health, count: healthCount } = await loadHealth();
const catalog = buildCatalog({
  csvText,
  readmeText,
  health,
  generatedAt: new Date().toISOString(),
});

const out = path.join(root, 'src', 'data', 'blogs.json');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(catalog), 'utf8');

const kb = (Buffer.byteLength(JSON.stringify(catalog)) / 1024).toFixed(0);
console.log(`✓ ${catalog.blogs.length} blogs from ${label} → ${path.relative(root, out)} (${kb} kB)`);
console.log(`  dead: ${catalog.stats.dead} · tagged: ${catalog.stats.tagged} · in README: ${catalog.stats.matchedInReadme}`);
console.log(`  health: ${healthCount ? `${healthCount} blogs with real dates from data/health.json` : "none — falling back to the README rank"}`);
const freshest = catalog.blogs.filter((b) => !b.dead).sort((a, b) => b.fresh - a.fresh)[0];
if (freshest) console.log(`  latest post: ${freshest.name}`);
