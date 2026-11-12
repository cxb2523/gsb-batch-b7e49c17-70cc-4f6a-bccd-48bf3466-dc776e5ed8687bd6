const { getPool } = require('./db');

async function upsertCompany(name, slug, source = 'ashby') {
  const pool = getPool();
  const normalizedSlug = typeof slug === 'string' ? slug.trim().toLowerCase() : slug;
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
