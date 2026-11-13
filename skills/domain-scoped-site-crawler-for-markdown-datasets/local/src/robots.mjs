/**
 * Minimal robots.txt parser and matcher.
 *
 * Implements the widely used parts of the Robots Exclusion Protocol:
 * user-agent groups, Disallow/Allow rules with `*` and `$` wildcards,
 * longest-match precedence with Allow winning ties, and Sitemap entries.
 * Blanket rules apply when the crawler's user agent has no own group.
 */

const MAX_RULE_MATCH = Number.MAX_SAFE_INTEGER;

/**
 * @param {string} userAgent
 * @returns {string} The token used for robots group matching (first word,
 *   lower-cased).
 */
export function robotsUserAgentToken(userAgent) {
  return String(userAgent).trim().split(/\s+/)[0]?.toLowerCase() ?? '*';
}

/**
 * Parse robots.txt content into per-agent rule groups.
 *
 * @param {string} text Raw robots.txt body.
 * @returns {{ groups: Map<string, {allow: string[], disallow: string[]}>,
 *             sitemaps: string[] }}
 */
export function parseRobotsTxt(text) {
  const groups = new Map();
  const sitemaps = [];
  let currentAgents = [];
  let currentGroup = null;
  let inRules = false;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === 'user-agent') {
      if (inRules) {
        currentAgents = [];
        currentGroup = null;
        inRules = false;
      }
      const agent = value.toLowerCase() || '*';
      currentAgents.push(agent);
      if (!groups.has(agent)) {
        groups.set(agent, { allow: [], disallow: [] });
      }
      currentGroup = groups.get(agent);
    } else if (key === 'allow' || key === 'disallow') {
      inRules = true;
      if (!currentGroup) continue;
      if (key === 'allow') currentGroup.allow.push(value);
      else currentGroup.disallow.push(value);
    } else if (key === 'sitemap') {
      if (value) sitemaps.push(value);
    } else {
      // Other directives (crawl-delay, host, ...) are irrelevant here.
    }
  }

  return { groups, sitemaps };
}

/**
 * Check whether a path is allowed for a given user agent.
 *
 * @param {{ groups: Map<string, {allow: string[], disallow: string[]}> }} parsed
 * @param {string} url Absolute URL to test.
 * @param {string} userAgent Crawler user agent.
 * @returns {boolean} true when the URL may be fetched.
 */
export function isAllowedByRobots(parsed, url, userAgent) {
  const target = urlPathAndQuery(url);
  const token = robotsUserAgentToken(userAgent);
  const agentGroup = parsed.groups.get(token);
  const wildcardGroup = parsed.groups.get('*');
  const groups = agentGroup ? [agentGroup] : wildcardGroup ? [wildcardGroup] : [];
  if (groups.length === 0) return true;

  let bestAllowLength = -1;
  let bestDisallowLength = -1;
  for (const group of groups) {
    for (const pattern of group.allow) {
      if (pattern && robotPatternMatches(pattern, target)) {
        bestAllowLength = Math.max(bestAllowLength, patternLength(pattern));
      }
    }
    for (const pattern of group.disallow) {
      if (pattern && robotPatternMatches(pattern, target)) {
        bestDisallowLength = Math.max(bestDisallowLength, patternLength(pattern));
      }
    }
  }

  if (bestDisallowLength === -1) return true;
  if (bestAllowLength === -1) return false;
  // Longest match wins; Allow wins an exact tie.
  return bestAllowLength >= bestDisallowLength;
}

function patternLength(pattern) {
  // Longer rules are considered more specific; `$` is not a path character.
  return pattern.endsWith('$') ? pattern.length - 1 : pattern.length;
}

function robotPatternMatches(pattern, target) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const regexp = new RegExp(`^${source}${anchored ? '$' : ''}`);
  return regexp.test(target);
}

function urlPathAndQuery(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}
