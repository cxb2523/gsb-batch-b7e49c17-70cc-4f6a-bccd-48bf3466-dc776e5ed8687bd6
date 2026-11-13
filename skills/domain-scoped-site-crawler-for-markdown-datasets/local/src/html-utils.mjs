/**
 * Small, dependency-free HTML helpers: enough for crawling public pages —
 * title, links, canonical, and a word count.
 *
 * This is intentionally not a full HTML5 parser. It is tolerant of malformed
 * markup, ignores <script>/<style>/<template> content, and does not attempt
 * to reproduce a browser DOM. That keeps the crawler runnable with a bare
 * Node.js install.
 */

const NAMED_ENTITIES = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  copy: '©',
  reg: '®',
  trade: '™',
};

/**
 * Decode the HTML entities that show up in ordinary page text.
 * Unknown named entities are left as written.
 *
 * @param {string} text
 * @returns {string}
 */
export function decodeHtmlEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function stripNoise(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, ' ');
}

/**
 * Read the page title: <title>, falling back to the first h1.
 *
 * @param {string} html
 * @returns {string}
 */
export function extractTitle(html) {
  const withoutNoise = stripNoise(html);
  const titleMatch = withoutNoise.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (titleMatch) {
    const title = collapseWhitespace(decodeHtmlEntities(stripTags(titleMatch[1])));
    if (title) return title;
  }
  const h1Match = withoutNoise.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  if (h1Match) {
    return collapseWhitespace(decodeHtmlEntities(stripTags(h1Match[1])));
  }
  return '';
}

/**
 * Extract the canonical URL as written (not resolved), or null.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function extractCanonicalHref(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const linkTags = withoutComments.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const rel = attributeValue(tag, 'rel');
    if (!rel) continue;
    const relValues = rel.toLowerCase().split(/\s+/);
    if (!relValues.includes('canonical')) continue;
    const href = attributeValue(tag, 'href');
    if (href) return href;
  }
  return null;
}

/**
 * Extract hrefs from <a> tags.
 *
 * @param {string} html
 * @returns {string[]}
 */
export function extractAnchorHrefs(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const anchorTags = withoutComments.match(/<a\b[^>]*>/gi) ?? [];
  const hrefs = [];
  for (const tag of anchorTags) {
    const href = attributeValue(tag, 'href');
    if (href) hrefs.push(href);
  }
  return hrefs;
}

/**
 * Read <base href> if present.
 *
 * @param {string} html
 * @returns {string|null}
 */
export function extractBaseHref(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const baseTags = withoutComments.match(/<base\b[^>]*>/gi) ?? [];
  for (const tag of baseTags) {
    const href = attributeValue(tag, 'href');
    if (href) return href;
  }
  return null;
}

/**
 * Count words in the visible text of an HTML document.
 *
 * @param {string} html
 * @returns {number}
 */
export function countWords(html) {
  return wordCountFromText(extractText(html));
}

/**
 * Extract visible text from HTML, with block-level tags turned into spaces.
 *
 * @param {string} html
 * @returns {string}
 */
export function extractText(html) {
  const withoutNoise = stripNoise(html).replace(/<head\b[\s\S]*?<\/head\s*>/gi, ' ');
  const text = withoutNoise
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|ul|ol|table|tr|td|th|h[1-6]|blockquote|pre)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return collapseWhitespace(decodeHtmlEntities(text));
}

/**
 * Count words in already-extracted text.
 *
 * @param {string} text
 * @returns {number}
 */
export function wordCountFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function stripTags(text) {
  return text.replace(/<[^>]+>/g, ' ');
}

function collapseWhitespace(text) {
  return text.replace(/[\s ]+/g, ' ').trim();
}

function attributeValue(tag, attribute) {
  const quoted = new RegExp(`\\b${attribute}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (quoted) return decodeHtmlEntities(quoted[2] ?? quoted[3] ?? '');
  const unquoted = new RegExp(`\\b${attribute}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
  if (unquoted) return decodeHtmlEntities(unquoted[1]);
  return null;
}
