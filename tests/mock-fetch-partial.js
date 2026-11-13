// Simulates a partial OSV.dev outage: lookups for "flaky-pkg" fail while every
// other package queries successfully. Used to prove a single failing service
// does not abort a multi-service scan.
const okVuln = {
  id: 'OSV-OK-1',
  aliases: ['CVE-2026-9001'],
  summary: 'simulated advisory',
  severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }],
  affected: [{
    package: { ecosystem: 'npm', name: 'lodash' },
    ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
  }],
  references: [],
};

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/querybatch')) {
    const queries = JSON.parse(options.body).queries;
    if (queries.some(q => q.package?.name === 'flaky-pkg')) {
      throw new Error('simulated OSV outage for flaky-pkg');
    }
    return new Response(JSON.stringify({ results: queries.map(() => ({ vulns: [{ id: okVuln.id }] })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(okVuln), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
