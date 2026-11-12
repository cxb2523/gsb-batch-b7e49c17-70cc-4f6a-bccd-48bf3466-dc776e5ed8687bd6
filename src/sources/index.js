const fs = require('fs');
const path = require('path');
const { logger } = require('../utils');
const { ADAPTERS } = require('../normalize');

const REGISTRY_PATH = path.resolve(__dirname, 'registry.json');
const SUPPORTED_SOURCES = Object.keys(ADAPTERS);
// `start` runs the pipeline on every container restart; this gate is what
// stops those runs re-scraping companies the nightly run just did.
const FREQUENCY_HOURS = 12;

function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function getEnabledCompaniesWithDb(pool) {
  const enabled = loadRegistry();

  const key = c => `${c.source || 'ashby'}:${c.slug.toLowerCase()}`;
  const enabledKeys = new Set(enabled.map(key));

  try {
    const { rows } = await pool.query(
      'SELECT name, slug, source FROM companies'
    );

    let dbOnlyCount = 0;
    for (const row of rows) {
      const source = row.source || 'ashby';
      const rowKey = `${source}:${row.slug.toLowerCase()}`;
      if (!enabledKeys.has(rowKey)) {
        enabled.push({
          company: row.name,
          slug: row.slug,
          source,
        });
        enabledKeys.add(rowKey);
        dbOnlyCount++;
      }
    }

    if (dbOnlyCount > 0) {
      logger.info(`Discovered ${dbOnlyCount} companies from DB not in registry`);
    }
  } catch (err) {
    logger.warn(`Could not read companies from DB, using registry only: ${err.message}`);
  }

  return enabled;
}

const SLUG_MAX_LEN = 128;
const SLUG_REGEX = /^[a-zA-Z0-9_-]+$/;
const WORKDAY_SLUG_REGEX = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
// North American Teamtailor boards only answer on acme.na.teamtailor.com
// (acme.teamtailor.com 404s), so the region stays in the slug.
const TEAMTAILOR_SLUG_REGEX = /^[a-zA-Z0-9_-]+(\.na)?$/;
const SLUG_REGEX_BY_SOURCE = { workday: WORKDAY_SLUG_REGEX, teamtailor: TEAMTAILOR_SLUG_REGEX };

function isValidSlug(slug, source = 'ashby') {
  return (
    typeof slug === 'string' &&
    slug.length > 0 &&
    slug.length <= SLUG_MAX_LEN &&
    (SLUG_REGEX_BY_SOURCE[source] || SLUG_REGEX).test(slug)
  );
}

function addCompany(slug, name, source = 'ashby') {
  const normalizedSource = typeof source === 'string' ? source.trim().toLowerCase() : source;

  if (!isValidSlug(slug, normalizedSource)) {
    const format = normalizedSource === 'workday'
      ? 'tenant/wdHost/site (each segment may contain alphanumeric characters, hyphens, or underscores)'
      : 'alphanumeric, hyphen, underscore only';
    logger.warn(`Invalid slug rejected: "${slug}" (${format}; max ${SLUG_MAX_LEN} chars)`);
    return false;
  }
  if (!SUPPORTED_SOURCES.includes(normalizedSource)) {
    logger.warn(`Invalid source rejected: "${source}" (expected one of ${SUPPORTED_SOURCES.join(', ')})`);
    return false;
  }

  const normalizedSlug = slug.toLowerCase();
  const registry = loadRegistry();
  const exists = registry.find(c => c.slug.toLowerCase() === normalizedSlug && (c.source || 'ashby') === normalizedSource);
  if (exists) {
    logger.warn(`Company with slug "${slug}" already exists for source "${normalizedSource}"`);
    return false;
  }

  registry.push({
    company: name || slug,
    slug: normalizedSlug,
    source: normalizedSource,
  });

  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
  logger.info(`Added company "${name || slug}" (${normalizedSlug}, ${normalizedSource}) to registry`);
  return true;
}

function getDueCompanies(companiesLastScraped, allCompanies) {
  const now = Date.now();

  return allCompanies.filter(company => {
    const key = `${company.source || 'ashby'}:${company.slug.toLowerCase()}`;
    const lastScraped = companiesLastScraped[key];
    if (!lastScraped) return true;
    const elapsed = (now - new Date(lastScraped).getTime()) / (1000 * 60 * 60);
    return elapsed >= FREQUENCY_HOURS;
  });
}

module.exports = {
  loadRegistry,
  getEnabledCompaniesWithDb,
  addCompany,
  getDueCompanies,
  isValidSlug,
  SUPPORTED_SOURCES,
};
