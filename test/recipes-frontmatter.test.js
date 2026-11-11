import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RecipeSchema, mergeRecipes, loadRecipes, getRecipeStatus } from '../lib/recipes.js';
import { buildFrontmatter } from '../lib/frontmatter.js';
import { extractHtml } from '../lib/web.js';
import { createApp } from '../server.js';
import { createCache } from '../lib/cache.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = (rel) => path.join(here, 'fixtures/recipes', rel);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
describe('RecipeSchema — frontmatter block', () => {
  it('accepts a valid frontmatter block', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: {
        jsonld: { type: 'Article' },
        fields: {
          author: { jsonld: 'author.name' },
          rating: { selector: '.rating-value' },
        },
      },
    };
    assert.equal(RecipeSchema.safeParse(recipe).success, true);
  });

  it('accepts a selector-only frontmatter block without jsonld type', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { fields: { rating: { selector: '.r' } } },
    };
    assert.equal(RecipeSchema.safeParse(recipe).success, true);
  });

  it('rejects unknown keys inside frontmatter', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { fields: { a: { selector: '.a' } }, bogus: true },
    };
    assert.equal(RecipeSchema.safeParse(recipe).success, false);
  });

  it('rejects a field descriptor with both jsonld and selector', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { jsonld: { type: 'Article' }, fields: { a: { jsonld: 'x', selector: '.y' } } },
    };
    assert.equal(RecipeSchema.safeParse(recipe).success, false);
  });

  it('rejects a field descriptor with neither jsonld nor selector', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { fields: { a: {} } },
    };
    assert.equal(RecipeSchema.safeParse(recipe).success, false);
  });

  it('rejects an invalid field name', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { fields: { '1bad': { selector: '.a' } } },
    };
    assert.equal(RecipeSchema.safeParse(recipe).success, false);
  });

  it('rejects an empty fields record', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { fields: {} },
    };
    assert.equal(RecipeSchema.safeParse(recipe).success, false);
  });

  it('rejects a jsonld-sourced field without frontmatter.jsonld.type', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { fields: { author: { jsonld: 'author.name' } } },
    };
    assert.equal(RecipeSchema.safeParse(recipe).success, false);
  });

  it('rejects a reserved pipeline-provenance field name (source)', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { fields: { source: { selector: '.s' } } },
    };
    const result = RecipeSchema.safeParse(recipe);
    assert.equal(result.success, false);
    const msg = result.error.issues.map((i) => i.message).join('; ');
    assert.match(msg, /frontmatter field name "source" is reserved/);
  });

  it('rejects a reserved LLM/media field name (llm_tokens)', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { fields: { llm_tokens: { selector: '.t' } } },
    };
    const result = RecipeSchema.safeParse(recipe);
    assert.equal(result.success, false);
    const msg = result.error.issues.map((i) => i.message).join('; ');
    assert.match(msg, /frontmatter field name "llm_tokens" is reserved/);
  });

  it('still accepts an overridable metadata-derived field name (author)', () => {
    const recipe = {
      name: 'r', host: 'example.com',
      frontmatter: { fields: { author: { selector: '.a' } } },
    };
    assert.equal(RecipeSchema.safeParse(recipe).success, true);
  });
});

// ---------------------------------------------------------------------------
// Reserved field names — rejected at load time (not just safeParse)
// ---------------------------------------------------------------------------
describe('recipe frontmatter — reserved field names rejected at load time', () => {
  const writeTmp = (recipes) => {
    const tmpFile = path.join(os.tmpdir(), `recipes-reserved-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(recipes));
    return tmpFile;
  };

  it('a recipe defining a reserved frontmatter field is rejected by the loader and counted in status', () => {
    const tmpFile = writeTmp([{
      name: 'bad-recipe', host: 'example.com',
      frontmatter: { fields: { source: { selector: '.s' } } },
    }]);
    try {
      const { status } = loadRecipes({ defaultPath: tmpFile, userPath: null });
      assert.equal(status.loaded, 0);
      assert.equal(status.rejected, 1);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

// ---------------------------------------------------------------------------
// mergeRecipes
// ---------------------------------------------------------------------------
describe('mergeRecipes — frontmatter', () => {
  const mk = (name, frontmatter) => RecipeSchema.parse({ name, host: 'example.com', frontmatter });

  it('merges disjoint fields from several recipes', () => {
    const a = mk('a', { fields: { rating: { selector: '.r' } } });
    const b = mk('b', { fields: { price: { selector: '.p' } } });
    const merged = mergeRecipes([a, b]);
    assert.deepEqual(Object.keys(merged.frontmatter.fields).sort(), ['price', 'rating']);
  });

  it('later recipe wins on a colliding field key', () => {
    const a = mk('a', { fields: { rating: { selector: '.first' } } });
    const b = mk('b', { fields: { rating: { selector: '.second' } } });
    const merged = mergeRecipes([a, b]);
    assert.equal(merged.frontmatter.fields.rating.selector, '.second');
  });

  it('frontmatter.jsonld is scalar last-wins', () => {
    const a = mk('a', { jsonld: { type: 'Article' }, fields: { x: { jsonld: 'a' } } });
    const b = mk('b', { jsonld: { type: 'NewsArticle' }, fields: { y: { jsonld: 'b' } } });
    const merged = mergeRecipes([a, b]);
    assert.equal(merged.frontmatter.jsonld.type, 'NewsArticle');
  });

  it('leaves frontmatter undefined when no recipe defines it', () => {
    const merged = mergeRecipes([RecipeSchema.parse({ name: 'a', host: 'example.com' })]);
    assert.equal(merged.frontmatter, undefined);
  });
});

// ---------------------------------------------------------------------------
// Integration via extractHtml (recipes apply only with a URL)
// ---------------------------------------------------------------------------
describe('recipe frontmatter — integration', () => {
  const ARTICLE = (extra = '') => `<html><head>
    <title>Test Article</title>
    <meta name="author" content="Generic Author">
    <script type="application/ld+json">${JSON.stringify({
      '@type': 'Article', author: { name: 'Recipe Author' }, datePublished: '2026-01-02',
    })}</script>
    ${extra}
    </head><body>
    <article><h1>Test Article</h1><p>Main content paragraph long enough for the extractor to treat it as substantial body content worth keeping in the output markdown so the pipeline produces a real document.</p></article>
    <span class="rating-value">  9.1  </span>
    </body></html>`;

  it('injects jsonld + selector fields into the output frontmatter', async () => {
    const recipes = [{
      name: 'fm', host: 'example.com',
      frontmatter: {
        jsonld: { type: 'Article' },
        fields: {
          author: { jsonld: 'author.name' },
          published: { jsonld: 'datePublished' },
          rating: { selector: '.rating-value' },
        },
      },
    }];
    const result = await extractHtml(ARTICLE(), { url: 'https://example.com/a', recipes });
    const fm = buildFrontmatter(result.metadata, { source: result.source });
    assert.match(fm, /author: Recipe Author/);
    assert.match(fm, /published: 2026-01-02/);
    assert.match(fm, /rating: '?9\.1'?/);
  });

  it('recipe field overrides a generic metadata-derived field on collision', async () => {
    const recipes = [{
      name: 'fm', host: 'example.com',
      frontmatter: { jsonld: { type: 'Article' }, fields: { author: { jsonld: 'author.name' } } },
    }];
    const result = await extractHtml(ARTICLE(), { url: 'https://example.com/a', recipes });
    const fm = buildFrontmatter(result.metadata, { source: result.source });
    assert.match(fm, /author: Recipe Author/);
    assert.doesNotMatch(fm, /author: Generic Author/);
    // exactly one author line
    assert.equal((fm.match(/^author:/gm) || []).length, 1);
  });

  it('omits an unresolved jsonld field', async () => {
    const recipes = [{
      name: 'fm', host: 'example.com',
      frontmatter: { jsonld: { type: 'Article' }, fields: { missing: { jsonld: 'author.nope' } } },
    }];
    const result = await extractHtml(ARTICLE(), { url: 'https://example.com/a', recipes });
    const fm = buildFrontmatter(result.metadata, { source: result.source });
    assert.doesNotMatch(fm, /missing:/);
  });

  it('omits a field whose selector has no match', async () => {
    const recipes = [{
      name: 'fm', host: 'example.com',
      frontmatter: { fields: { nope: { selector: '.does-not-exist' } } },
    }];
    const result = await extractHtml(ARTICLE(), { url: 'https://example.com/a', recipes });
    const fm = buildFrontmatter(result.metadata, { source: result.source });
    assert.doesNotMatch(fm, /nope:/);
  });

  it('does not break content extraction on broken JSON-LD', async () => {
    const broken = '<script type="application/ld+json">{ not json ,, }</script>';
    const recipes = [{
      name: 'fm', host: 'example.com',
      frontmatter: { jsonld: { type: 'Article' }, fields: { author: { jsonld: 'author.name' } } },
    }];
    const result = await extractHtml(ARTICLE(broken), { url: 'https://example.com/a', recipes });
    assert.match(result.markdown, /Main content paragraph/);
  });

  it('defensively ignores a reserved field name even in a hand-crafted recipeFields object (schema is the primary guard)', () => {
    const meta = { recipeFields: { source: 'spoofed-provenance', llm_tokens: 999, author: 'Recipe Author' } };
    const fm = buildFrontmatter(meta, { source: 'trafilatura' });
    assert.match(fm, /^source: trafilatura$/m);
    assert.doesNotMatch(fm, /spoofed-provenance/);
    assert.doesNotMatch(fm, /llm_tokens:/);
    assert.match(fm, /author: Recipe Author/);
  });

  it('YAML-escapes a recipe value containing quotes / carriage returns', async () => {
    const html = `<html><head><title>T</title>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Article', headline: 'He said "hi"\rinjected: pwned' })}</script>
      </head><body><article><h1>T</h1><p>Main content paragraph long enough for the extractor to treat it as substantial body content worth keeping in the produced document output here.</p></article></body></html>`;
    const recipes = [{
      name: 'fm', host: 'example.com',
      frontmatter: { jsonld: { type: 'Article' }, fields: { tagline: { jsonld: 'headline' } } },
    }];
    const result = await extractHtml(html, { url: 'https://example.com/a', recipes });
    const fm = buildFrontmatter(result.metadata, { source: result.source });
    assert.match(fm, /tagline: "He said \\"hi\\"/);
    assert.doesNotMatch(fm, /\r/);
    assert.doesNotMatch(fm, /\ninjected: pwned/);
  });
});

// ---------------------------------------------------------------------------
// Allowlist interaction (recipe fields)
// ---------------------------------------------------------------------------
describe('recipe frontmatter — PULLMD_FRONTMATTER_FIELDS allowlist', () => {
  const save = process.env.PULLMD_FRONTMATTER_FIELDS;
  afterEach(() => {
    if (save === undefined) delete process.env.PULLMD_FRONTMATTER_FIELDS;
    else process.env.PULLMD_FRONTMATTER_FIELDS = save;
  });

  const meta = { title: 'T', recipeFields: { rating: '9.1' } };

  it('passes recipe fields through when env is unset', () => {
    delete process.env.PULLMD_FRONTMATTER_FIELDS;
    assert.match(buildFrontmatter(meta), /rating: '?9\.1'?/);
  });

  it('drops a recipe field not listed in the allowlist', () => {
    process.env.PULLMD_FRONTMATTER_FIELDS = 'title';
    assert.doesNotMatch(buildFrontmatter(meta), /rating:/);
  });

  it('passes a recipe field listed in the allowlist', () => {
    process.env.PULLMD_FRONTMATTER_FIELDS = 'title,rating';
    assert.match(buildFrontmatter(meta), /rating: '?9\.1'?/);
  });
});

// ---------------------------------------------------------------------------
// Status endpoint + loader warning for filtered recipe fields
// ---------------------------------------------------------------------------
describe('recipe frontmatter — filtered fields visibility', () => {
  const save = process.env.PULLMD_FRONTMATTER_FIELDS;
  let tmpFile;
  afterEach(() => {
    if (save === undefined) delete process.env.PULLMD_FRONTMATTER_FIELDS;
    else process.env.PULLMD_FRONTMATTER_FIELDS = save;
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  });

  const writeRecipes = () => {
    tmpFile = path.join(os.tmpdir(), `recipes-fm-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify([{
      name: 'fm-recipe', host: 'example.com',
      frontmatter: { fields: { rating: { selector: '.r' }, price: { selector: '.p' } } },
    }]));
    return tmpFile;
  };

  it('records filtered field names in status when the allowlist drops them', () => {
    process.env.PULLMD_FRONTMATTER_FIELDS = 'title,price';
    loadRecipes({ defaultPath: writeRecipes(), userPath: null });
    const status = getRecipeStatus();
    const entry = status.filteredFrontmatterFields.find((e) => e.recipe === 'fm-recipe');
    assert.ok(entry, 'expected a filtered-fields entry for fm-recipe');
    assert.deepEqual(entry.fields, ['rating']);
  });

  it('exposes filteredFrontmatterFields through GET /api/recipes/status', async () => {
    process.env.PULLMD_FRONTMATTER_FIELDS = 'title';
    loadRecipes({ defaultPath: writeRecipes(), userPath: null });
    const app = createApp({ cache: null });
    const server = app.listen(0);
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/recipes/status`);
      const body = await res.json();
      const entry = body.filteredFrontmatterFields.find((e) => e.recipe === 'fm-recipe');
      assert.ok(entry);
      assert.deepEqual(entry.fields.sort(), ['price', 'rating']);
    } finally {
      server.close();
    }
  });

  it('reports no filtered fields when the allowlist is unset', () => {
    delete process.env.PULLMD_FRONTMATTER_FIELDS;
    loadRecipes({ defaultPath: writeRecipes(), userPath: null });
    assert.deepEqual(getRecipeStatus().filteredFrontmatterFields, []);
  });
});

// ---------------------------------------------------------------------------
// Cache survival
// ---------------------------------------------------------------------------
describe('recipe frontmatter — cache survival', () => {
  it('recipeFields ride in the stored metadata JSON and rebuild on a cache hit', () => {
    const cache = createCache(':memory:');
    cache.put({
      url: 'https://example.com/a', title: 'T', markdown: '# T\n\nbody',
      source: 'readability', metadata: { title: 'T', recipeFields: { rating: '9.1' } },
    });
    const hit = cache.get('https://example.com/a');
    assert.deepEqual(hit.metadata.recipeFields, { rating: '9.1' });
    const fm = buildFrontmatter(hit.metadata, { source: hit.source });
    assert.match(fm, /rating: '?9\.1'?/);
  });
});
