/**
 * URL filtering: include/exclude globs and regular expressions.
 *
 * Filters are applied only to *discovered* URLs. Start URLs are always
 * fetched, matching the Actor's documented behaviour.
 */

const GLOB_SPECIAL = /[.+^${}()|[\]\\]/;

/**
 * Convert a glob to a RegExp. Supports `*` (any characters except none at all
 * — it may span path separators, as the Actor's filter does for URLs),
 * `?` (one character), `{a,b}` alternation, and `[abc]` character classes.
 *
 * Matching is anchored to the whole URL and case-insensitive, which is how
 * URL filters behave in practice.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else if (char === '{') {
      const close = glob.indexOf('}', index);
      if (close === -1) {
        source += '\\{';
      } else {
        const alternatives = glob
          .slice(index + 1, close)
          .split(',')
          .map((part) => globToRegExpSource(part));
        source += `(?:${alternatives.join('|')})`;
        index = close;
      }
    } else if (char === '[') {
      const close = glob.indexOf(']', index);
      if (close === -1) {
        source += '\\[';
      } else {
        const body = glob.slice(index + 1, close);
        source += `[${body}]`;
        index = close;
      }
    } else if (GLOB_SPECIAL.test(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`, 'i');
}

function globToRegExpSource(glob) {
  return globToRegExp(glob).source.slice(1, -1);
}

/**
 * Build the URL filter used for discovered links.
 *
 * Semantics, mirroring the Actor schema:
 * - Include globs: when any are set, the URL must match at least one.
 * - Include regexps: when any are set, the URL must match at least one.
 * - Both include families must pass when both are set.
 * - Any exclude glob or regexp match rejects the URL.
 *
 * @param {object} options
 * @param {string[]} [options.includeUrlGlobs]
 * @param {string[]} [options.excludeUrlGlobs]
 * @param {string[]} [options.includeUrlRegexps]
 * @param {string[]} [options.excludeUrlRegexps]
 * @returns {(url: string) => boolean} true when the URL passes the filters
 */
export function createUrlFilter({
  includeUrlGlobs = [],
  excludeUrlGlobs = [],
  includeUrlRegexps = [],
  excludeUrlRegexps = [],
} = {}) {
  const includeGlobs = compileGlobs(includeUrlGlobs, 'includeUrlGlobs');
  const excludeGlobs = compileGlobs(excludeUrlGlobs, 'excludeUrlGlobs');
  const includeRegexps = compileRegexps(includeUrlRegexps, 'includeUrlRegexps');
  const excludeRegexps = compileRegexps(excludeUrlRegexps, 'excludeUrlRegexps');

  return function urlFilter(url) {
    if (includeGlobs.length > 0 && !includeGlobs.some((pattern) => pattern.test(url))) {
      return false;
    }
    if (includeRegexps.length > 0 && !includeRegexps.some((pattern) => pattern.test(url))) {
      return false;
    }
    if (excludeGlobs.some((pattern) => pattern.test(url))) {
      return false;
    }
    if (excludeRegexps.some((pattern) => pattern.test(url))) {
      return false;
    }
    return true;
  };
}

function compileGlobs(globs, fieldName) {
  if (!Array.isArray(globs)) {
    throw new TypeError(`${fieldName} must be an array of strings`);
  }
  return globs.map((glob) => {
    if (typeof glob !== 'string') {
      throw new TypeError(`${fieldName} entries must be strings`);
    }
    return globToRegExp(glob);
  });
}

function compileRegexps(regexps, fieldName) {
  if (!Array.isArray(regexps)) {
    throw new TypeError(`${fieldName} must be an array of strings`);
  }
  return regexps.map((source) => {
    if (typeof source !== 'string') {
      throw new TypeError(`${fieldName} entries must be strings`);
    }
    try {
      // Case-insensitive like the glob filters; no global flag so .test is
      // stateless across calls.
      return new RegExp(source, 'i');
    } catch (error) {
      throw new TypeError(`${fieldName} contains an invalid regular expression "${source}": ${error.message}`);
    }
  });
}
