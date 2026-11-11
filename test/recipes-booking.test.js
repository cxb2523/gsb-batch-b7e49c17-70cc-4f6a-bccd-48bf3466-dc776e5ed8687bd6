import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RecipeSchema } from '../lib/recipes.js';
import { buildFrontmatter } from '../lib/frontmatter.js';
import { extractHtml } from '../lib/web.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultFile = path.join(here, '..', 'site-recipes.default.json');

function shippedRecipes() {
  const raw = JSON.parse(fs.readFileSync(defaultFile, 'utf8'));
  return raw.map((entry) => {
    const parsed = RecipeSchema.safeParse(entry);
    assert.equal(parsed.success, true, `shipped recipe "${entry.name}" must validate`);
    return parsed.data;
  });
}

const HOTEL_URL = 'https://www.booking.com/hotel/de/adlon-kempinski-berlin.en-gb.html';

const HOTEL_PAGE = `<html><head>
  <title>Hotel Adlon Kempinski Berlin, Berlin (updated prices 2026)</title>
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'http://schema.org',
    '@type': 'Hotel',
    name: 'Hotel Adlon Kempinski Berlin',
    description: 'The quintessence of luxury lodging.',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Unter den Linden 77, Mitte, 10117 Berlin, Germany',
    },
    priceRange: null,
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: 9.1,
      bestRating: 10,
      reviewCount: 3819,
    },
  })}</script>
</head><body>
  <div data-testid="web-shell-header-mfe"><p>Register Sign in and lots of header links that should never appear.</p></div>
  <div data-capla-component-boundary="b-property-web-property-page/PropertyDescriptionDesktop">
    <h3>Get the celebrity treatment</h3>
    <p>The quintessence of luxury lodging, the Adlon is a legendary five star hotel situated beside the Brandenburg Gate. It offers state of the art facilities including a Michelin star restaurant and a shopping arcade for every guest to enjoy during a stay.</p>
    <p>Rooms have a sophisticated allure thanks to antique furnishings with extravagant twists and marble bathrooms, and all of them are equipped with WiFi and a modern media system for entertainment.</p>
  </div>
  <div id="hp_facilities_box">
    <h2>Most popular facilities</h2>
    <ul><li>Indoor swimming pool</li><li>Free WiFi</li><li>Fitness centre</li></ul>
  </div>
  <div id="property-qna-desktop"><p>Travellers are asking placeholder that only ever renders an empty skeleton.</p></div>
  <img src="https://t-cf.bstatic.com/design-assets/images-flags/Gb.png" alt="United Kingdom">
</body></html>`;

describe('booking.com built-in recipes', () => {
  it('the two booking recipes load from the shipped default file', () => {
    const recipes = shippedRecipes();
    const names = recipes.map(r => r.name);
    assert.ok(names.includes('booking-hotel-noise'));
    assert.ok(names.includes('booking-hotel-frontmatter'));
  });

  it('extracts Hotel JSON-LD fields into frontmatter and omits null priceRange', async () => {
    const recipes = shippedRecipes();
    const result = await extractHtml(HOTEL_PAGE, { url: HOTEL_URL, recipes });
    const fm = buildFrontmatter(result.metadata, { source: result.source });
    assert.match(fm, /description: The quintessence of luxury lodging\./);
    assert.match(fm, /address: Unter den Linden 77, Mitte, 10117 Berlin, Germany/);
    assert.match(fm, /rating: '?9\.1'?/);
    assert.match(fm, /rating_best: '?10'?/);
    assert.match(fm, /review_count: '?3819'?/);
    // priceRange is null in the JSON-LD → non-primitive → silently omitted
    assert.doesNotMatch(fm, /price_range:/);
  });

  it('strips booking chrome (header shell, Q&A skeleton, flag images) from the body', async () => {
    const recipes = shippedRecipes();
    const result = await extractHtml(HOTEL_PAGE, { url: HOTEL_URL, recipes });
    assert.doesNotMatch(result.markdown, /Register Sign in/);
    assert.doesNotMatch(result.markdown, /Travellers are asking/);
    assert.doesNotMatch(result.markdown, /images-flags/);
    // the real content survives
    assert.match(result.markdown, /quintessence of luxury lodging/);
  });

  it('does not match non-hotel booking paths', async () => {
    const recipes = shippedRecipes();
    const result = await extractHtml(HOTEL_PAGE, { url: 'https://www.booking.com/searchresults.en-gb.html', recipes });
    const fm = buildFrontmatter(result.metadata, { source: result.source });
    // frontmatter recipe must not apply outside /hotel/**
    assert.doesNotMatch(fm, /rating_best:/);
  });
});
