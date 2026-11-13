/**
 * URL helpers shared by the crawler, robots parser, and discovery code.
 * Only http(s) URLs are ever crawled; everything else (mailto:, tel:,
 * javascript:, data:, ...) is ignored.
 */

/**
 * Resolve and normalize a URL.
 *
 * @param {string} rawUrl URL as it appeared in a page, sitemap, or input.
 * @param {string} [baseUrl] Base URL for relative references.
 * @param {{ keepFragments?: boolean }} [options]
 *   When keepFragments is false (the default), the #fragment is removed so
 *   two links that differ only by fragment are treated as the same page.
 * @returns {string|null} Absolute http(s) URL, or null when the value is not
 *   a usable http(s) URL.
 */
export function normalizeUrl(rawUrl, baseUrl, { keepFragments = false } = {}) {
  if (typeof rawUrl !== 'string') return null;
  const value = rawUrl.trim();
  let url;
  try {
    url = baseUrl === undefined ? new URL(value) : new URL(value, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!keepFragments) url.hash = '';
  return url.href;
}

/**
 * Turn startUrls entries into plain URL strings.
 * The Actor schema uses objects such as {"url": "..."}; bare strings are
 * accepted too because they are convenient in local input files.
 *
 * @param {unknown} startUrls
 * @returns {string[]}
 */
export function startUrlStrings(startUrls) {
  if (!Array.isArray(startUrls) || startUrls.length === 0) {
    throw new TypeError('startUrls must be a non-empty array');
  }
  return startUrls.map((entry, index) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof entry.url === 'string') {
      return entry.url;
    }
    throw new TypeError(`startUrls[${index}] must be a URL string or an object with a url field`);
  });
}

/**
 * @param {string} url
 * @returns {string} Lower-cased hostname, including the port only through the
 *   separate origin helper. Domain scoping compares hostnames, not ports.
 */
export function hostnameOf(url) {
  return new URL(url).hostname;
}

/**
 * @param {string} url
 * @returns {string} URL origin (scheme + host + port).
 */
export function originOf(url) {
  return new URL(url).origin;
}

/**
 * @param {string} url
 * @param {string} hostname
 * @returns {boolean}
 */
export function isSameHostname(url, hostname) {
  return new URL(url).hostname === hostname;
}
