import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanService } from '../src/scanner.js';
import { buildDashboard } from '../src/server.js';
import { createProject, flakyFixture, npmFixture, removeProject } from './helpers.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const originalFetch = globalThis.fetch;

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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Installs a fetch mock that answers every query except requests mentioning
 * `brokenPackage`, which throw to emulate an interrupted OSV.dev lookup.
 */
function installPartialOsvMock(brokenPackage) {
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/querybatch')) {
      const queries = JSON.parse(options.body).queries;
      if (queries.some(q => q.package?.name === brokenPackage)) {
        throw new Error(`simulated OSV outage for ${brokenPackage}`);
      }
      return jsonResponse({ results: queries.map(() => ({ vulns: [{ id: okVuln.id }] })) });
    }
    return jsonResponse(okVuln);
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('scanService marks a service complete when the OSV lookup succeeds', async () => {
  installPartialOsvMock('flaky-pkg');
  const dir = createProject(npmFixture);
  try {
    const result = await scanService(dir);
    assert.equal(result.scanStatus.complete, true);
    assert.equal(result.scanStatus.error, null);
    assert.ok(result.vulns.length > 0);
  } finally {
    removeProject(dir);
  }
});

test('scanService returns an incomplete result instead of throwing when OSV fails', async () => {
  installPartialOsvMock('lodash');
  const dir = createProject(npmFixture);
  try {
    const result = await scanService(dir);
    assert.equal(result.scanStatus.complete, false);
    assert.match(result.scanStatus.error, /OSV/);
    assert.equal(result.name, 'fixture-app');
    assert.equal(result.dir, dir);
    assert.deepEqual(result.vulns, []);
    assert.deepEqual(result.severity, { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 });
    assert.equal(result.riskScore, 0);
  } finally {
    removeProject(dir);
  }
});

test('scanService marks a service incomplete when the manifest cannot be parsed', async () => {
  const dir = createProject({ 'package-lock.json': '{ not valid json' });
  try {
    const result = await scanService(dir);
    assert.equal(result.scanStatus.complete, false);
    assert.equal(result.name, dir.split(/[\\/]/).pop());
    assert.deepEqual(result.vulns, []);
    assert.equal(result.riskScore, 0);
  } finally {
    removeProject(dir);
  }
});

test('offline mode keeps services complete despite missing CVE data', async () => {
  const dir = createProject(npmFixture);
  try {
    const result = await scanService(dir, { noOsv: true });
    assert.equal(result.scanStatus.complete, true);
    assert.equal(result.scanStatus.error, null);
    assert.equal(result.vulns.length, 0);
  } finally {
    removeProject(dir);
  }
});

test('CLI keeps successful services when one service fails its OSV lookup', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'osv-ui-scan-status-'));
  const good = createProject(npmFixture);
  const flaky = createProject(flakyFixture);
  try {
    const jsonFile = join(workDir, 'report.json');
    const htmlFile = join(workDir, 'report.html');
    execFileSync(process.execPath, [
      '--import', pathToFileURL(join(root, 'tests/mock-fetch-partial.js')).href,
      join(root, 'bin/cli.js'),
      good,
      flaky,
      `--json=${jsonFile}`,
      `--html=${htmlFile}`,
    ], { cwd: workDir, stdio: 'pipe' });

    const report = JSON.parse(readFileSync(jsonFile, 'utf8'));
    assert.equal(report.services.length, 2);
    const goodSvc = report.services.find(s => s.name === 'fixture-app');
    const flakySvc = report.services.find(s => s.name === 'flaky-app');
    assert.equal(goodSvc.scanStatus.complete, true);
    assert.ok(goodSvc.vulns.length > 0, 'successful service keeps its findings');
    assert.equal(flakySvc.scanStatus.complete, false);
    assert.match(flakySvc.scanStatus.error, /OSV|flaky/);
    assert.deepEqual(flakySvc.vulns, []);
    assert.equal(flakySvc.riskScore, 0);

    assert.equal(report.scanStatus.complete, false);
    assert.match(report.scanStatus.error, /flaky-app/);

    const html = readFileSync(htmlFile, 'utf8');
    assert.match(html, /Scan incomplete/);
    assert.match(html, /Vulnerability data unavailable/);
    assert.match(html, /The latest scan is incomplete/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    removeProject(good);
    removeProject(flaky);
  }
});

test('CLI reports a complete scan in offline mode', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'osv-ui-scan-status-'));
  const project = createProject(npmFixture);
  try {
    const jsonFile = join(workDir, 'report.json');
    execFileSync(process.execPath, [
      join(root, 'bin/cli.js'),
      project,
      '--offline',
      `--json=${jsonFile}`,
      '--fail-on=critical',
    ], { cwd: workDir, stdio: 'pipe' });

    const report = JSON.parse(readFileSync(jsonFile, 'utf8'));
    assert.equal(report.scanStatus.complete, true);
    assert.equal(report.scanStatus.error, null);
    assert.equal(report.services[0].scanStatus.complete, true);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    removeProject(project);
  }
});

test('CLI exits with code 3 when every service fails', () => {
  const project = createProject(npmFixture);
  try {
    assert.throws(() => execFileSync(process.execPath, [
      '--import', pathToFileURL(join(root, 'tests/mock-fetch-failure.js')).href,
      join(root, 'bin/cli.js'),
      project,
      '--json',
    ], { cwd: project, stdio: 'pipe' }), error => error.status === 3);
  } finally {
    removeProject(project);
  }
});

test('CLI refuses an incomplete scan as a baseline', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'osv-ui-scan-status-'));
  const good = createProject(npmFixture);
  const flaky = createProject(flakyFixture);
  try {
    const partialFile = join(workDir, 'partial.json');
    execFileSync(process.execPath, [
      '--import', pathToFileURL(join(root, 'tests/mock-fetch-partial.js')).href,
      join(root, 'bin/cli.js'),
      good,
      flaky,
      `--json=${partialFile}`,
    ], { cwd: workDir, stdio: 'pipe' });

    assert.equal(JSON.parse(readFileSync(partialFile, 'utf8')).scanStatus.complete, false);

    assert.throws(() => execFileSync(process.execPath, [
      join(root, 'bin/cli.js'),
      good,
      '--offline',
      `--baseline=${partialFile}`,
      '--json',
    ], { cwd: workDir, stdio: 'pipe' }), error => error.status === 1);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    removeProject(good);
    removeProject(flaky);
  }
});

test('dashboard marks failed services and never shows them as clean', () => {
  const payload = {
    scannedAt: '2026-01-01T00:00:00.000Z',
    noOsv: false,
    scanStatus: { complete: false, error: 'flaky-app: simulated OSV outage' },
    services: [
      {
        name: 'api',
        dir: '/tmp/api',
        ecosystem: 'npm',
        ecosystems: ['npm'],
        manifests: [],
        packages: [],
        totalPackages: 1,
        directCount: 1,
        vulns: [],
        severity: { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 },
        riskScore: 0,
        scanStatus: { complete: true, error: null },
      },
      {
        name: 'flaky-app',
        dir: '/tmp/flaky',
        ecosystem: 'npm',
        ecosystems: ['npm'],
        manifests: [],
        packages: [],
        totalPackages: 0,
        directCount: 0,
        vulns: [],
        severity: { critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 },
        riskScore: 0,
        scanStatus: { complete: false, error: 'simulated OSV outage' },
      },
    ],
  };

  const html = buildDashboard(payload, '2.0.0');
  assert.match(html, /Scan incomplete/);
  assert.match(html, /Vulnerability data unavailable/);
  assert.match(html, /simulated OSV outage/);
  // Sidebar entry and panel title both carry the failure marker.
  assert.match(html, /title="Scan incomplete: simulated OSV outage"[^>]*>⚠</);
  assert.match(html, />⚠ Scan incomplete</);
  // Only the healthy service may render the green "no vulnerabilities" state.
  assert.equal((html.match(/No vulnerabilities found/g) || []).length, 1);
});

test('dashboard shows complete scans without a failure banner', () => {
  const payload = {
    scannedAt: '2026-01-01T00:00:00.000Z',
    noOsv: true,
    scanStatus: { complete: true, error: null },
    services: [],
  };
  const html = buildDashboard(payload, '2.0.0');
  assert.doesNotMatch(html, /The latest scan is incomplete/);
  assert.match(html, /Running in offline mode/);
});
