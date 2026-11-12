const { getPool } = require('./db');
const { normalizeSlug, CASE_SENSITIVE_SOURCES } = require('../sources');

async function upsertCompany(name, slug, source = 'ashby') {
  const pool = getPool();
  // SmartRecruiters identifiers are case-sensitive — the casing is part of the
  // identifier its API expects, so storing a lowercased copy would make the
  // nightly scrape request a board that doesn't exist. Every other source
  // stores the lowercase form.
  const normalizedSlug = typeof slug === 'string' ? normalizeSlug(slug.trim(), source) : slug;

  // The unique index is on the exact (slug, source), but identity is
  // case-folded ("notion"/"Notion" are one company). Rows written before
  // casing was preserved (e.g. a SmartRecruiters identifier stored
  // lowercased) would otherwise make a case-preserving insert create a
  // second row for the same board. Only the case-sensitive sources can
  // differ from their stored form, so only they pay for the lookup; every
  // other source lowercases on the way in either way.
  if (CASE_SENSITIVE_SOURCES.has(source)) {
    const { rows } = await pool.query(
      'SELECT id FROM companies WHERE LOWER(slug) = LOWER($1) AND source = $2 LIMIT 1',
      [normalizedSlug, source]
    );
    if (rows.length > 0) {
      await pool.query('UPDATE companies SET name = $1 WHERE id = $2', [name, rows[0].id]);
      return;
    }
  }

  await pool.query(
    `INSERT INTO companies (name, slug, source)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug, source) DO UPDATE SET name = EXCLUDED.name`,
    [name, normalizedSlug, source]
  );
}

async function updateLastScraped(slug, source = 'ashby') {
  const pool = getPool();
  const normalizedSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : slug;
  await pool.query(
    `UPDATE companies SET last_scraped_at = NOW() WHERE LOWER(slug) = LOWER($1) AND source = $2`,
    [normalizedSlug, source]
  );
}

// Keyed by "source:slug" — same slug string can exist under different ATSes.
async function getAllCompaniesLastScraped() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT source || ':' || LOWER(slug) AS key, MAX(last_scraped_at) AS last_scraped_at
     FROM companies GROUP BY 1`
  );
  return Object.fromEntries(rows.map(r => [r.key, r.last_scraped_at ? r.last_scraped_at.toISOString() : null]));
}

module.exports = { upsertCompany, updateLastScraped, getAllCompaniesLastScraped };
