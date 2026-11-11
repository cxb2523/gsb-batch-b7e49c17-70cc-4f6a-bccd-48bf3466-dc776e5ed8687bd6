import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonLd, resolvePath, extractRecipeFrontmatter } from '../lib/jsonld.js';

const wrap = (json) => `<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`;

describe('extractJsonLd — node selection', () => {
  it('picks the node whose @type matches', () => {
    const html = wrap(JSON.stringify({ '@type': 'Article', headline: 'H' }));
    const node = extractJsonLd(html, 'Article');
    assert.equal(node.headline, 'H');
  });

  it('matches when @type is an array that includes the type', () => {
    const html = wrap(JSON.stringify({ '@type': ['NewsArticle', 'Article'], headline: 'H' }));
    assert.ok(extractJsonLd(html, 'Article'));
    assert.ok(extractJsonLd(html, 'NewsArticle'));
  });

  it('is case-sensitive on @type', () => {
    const html = wrap(JSON.stringify({ '@type': 'Article' }));
    assert.equal(extractJsonLd(html, 'article'), null);
  });

  it('finds a node inside a top-level array', () => {
    const html = wrap(JSON.stringify([
      { '@type': 'WebSite', name: 'S' },
      { '@type': 'Article', headline: 'A' },
    ]));
    assert.equal(extractJsonLd(html, 'Article').headline, 'A');
  });

  it('finds a node inside an @graph', () => {
    const html = wrap(JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'O' },
        { '@type': 'Article', headline: 'G' },
      ],
    }));
    assert.equal(extractJsonLd(html, 'Article').headline, 'G');
  });

  it('handles an array whose elements carry @graph', () => {
    const html = wrap(JSON.stringify([
      { '@graph': [{ '@type': 'Article', headline: 'nested' }] },
    ]));
    assert.equal(extractJsonLd(html, 'Article').headline, 'nested');
  });

  it('returns the first match in document order across multiple blocks', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Article', headline: 'first' })}</script>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Article', headline: 'second' })}</script>
    </head></html>`;
    assert.equal(extractJsonLd(html, 'Article').headline, 'first');
  });

  it('skips a broken JSON block but still parses a later valid one', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ "@type": "Article", broken, }</script>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Article', headline: 'valid' })}</script>
    </head></html>`;
    assert.equal(extractJsonLd(html, 'Article').headline, 'valid');
  });

  it('returns null when no block matches', () => {
    const html = wrap(JSON.stringify({ '@type': 'WebSite' }));
    assert.equal(extractJsonLd(html, 'Article'), null);
  });

  it('returns null when there are no JSON-LD blocks', () => {
    assert.equal(extractJsonLd('<html><body>hi</body></html>', 'Article'), null);
  });
});

describe('resolvePath', () => {
  const node = {
    headline: 'Title',
    author: { name: 'Ada', '@type': 'Person' },
    authors: [{ name: 'Ada' }, { name: 'Bob' }],
    tags: ['a', 'b'],
    rating: 4.5,
    free: true,
    nested: { obj: { deep: 'value' } },
    image: { url: { not: 'primitive' } },
  };

  it('resolves a simple top-level path', () => {
    assert.equal(resolvePath(node, 'headline'), 'Title');
  });

  it('resolves a path through an object', () => {
    assert.equal(resolvePath(node, 'author.name'), 'Ada');
    assert.equal(resolvePath(node, 'nested.obj.deep'), 'value');
  });

  it('descends into the first element when a step is an array', () => {
    assert.equal(resolvePath(node, 'authors.name'), 'Ada');
  });

  it('takes the first element when the final value is an array', () => {
    assert.equal(resolvePath(node, 'tags'), 'a');
  });

  it('returns numbers and booleans as-is', () => {
    assert.equal(resolvePath(node, 'rating'), 4.5);
    assert.equal(resolvePath(node, 'free'), true);
  });

  it('returns undefined for a missing key', () => {
    assert.equal(resolvePath(node, 'author.missing'), undefined);
    assert.equal(resolvePath(node, 'nope'), undefined);
  });

  it('returns undefined when the final value is not a primitive', () => {
    assert.equal(resolvePath(node, 'author'), undefined);
    assert.equal(resolvePath(node, 'image.url'), undefined);
  });
});

describe('extractRecipeFrontmatter — orchestration', () => {
  it('extracts jsonld + selector fields into a plain object', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Article', author: { name: 'Ada' }, datePublished: '2026-01-02',
      })}</script></head>
      <body><span class="rating-value">  4.5  </span></body></html>`;
    const spec = {
      jsonld: { type: 'Article' },
      fields: {
        author: { jsonld: 'author.name' },
        published: { jsonld: 'datePublished' },
        rating: { selector: '.rating-value' },
      },
    };
    assert.deepEqual(extractRecipeFrontmatter(html, spec), {
      author: 'Ada', published: '2026-01-02', rating: '4.5',
    });
  });

  it('omits unresolved jsonld fields and missing/empty selectors', () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Article', author: { name: 'Ada' } })}</script>
      </head><body><span class="empty">   </span></body></html>`;
    const spec = {
      jsonld: { type: 'Article' },
      fields: {
        author: { jsonld: 'author.name' },
        missing: { jsonld: 'author.missing' },
        empty: { selector: '.empty' },
        absent: { selector: '.nope' },
      },
    };
    assert.deepEqual(extractRecipeFrontmatter(html, spec), { author: 'Ada' });
  });

  it('returns {} when the jsonld block is absent (no throw)', () => {
    const spec = { jsonld: { type: 'Article' }, fields: { author: { jsonld: 'author.name' } } };
    assert.deepEqual(extractRecipeFrontmatter('<html></html>', spec), {});
  });

  it('does not throw on broken JSON-LD', () => {
    const html = `<script type="application/ld+json">{ broken }</script><span class="r">x</span>`;
    const spec = {
      jsonld: { type: 'Article' },
      fields: { author: { jsonld: 'author.name' }, r: { selector: '.r' } },
    };
    assert.deepEqual(extractRecipeFrontmatter(html, spec), { r: 'x' });
  });
});
