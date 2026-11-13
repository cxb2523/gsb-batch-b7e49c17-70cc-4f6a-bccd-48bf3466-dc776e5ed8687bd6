// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { FingerprintUtils, RiskCalculator } from '@shieldeye/shared';

jest.mock('../security/url-validator', () => {
  return {
    validateTargetUrl: jest.fn(async (raw: string) => new URL(raw)),
  };
});

function makeHeaders(obj: Record<string, string>) {
  return {
    forEach: (cb: any) => {
      for (const [k, v] of Object.entries(obj)) cb(v, k);
    },
  };
}

const PAGE_URL = 'https://example.com/page';
const CDN_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js';

function htmlWithScripts(srcs: string[], inlineScripts: string[] = []) {
  const external = srcs.map((s) => `<script src="${s}"></script>`).join('');
  const inline = inlineScripts.map((c) => `<script>${c}</script>`).join('');
  return `<!doctype html><html><head></head><body>${inline}${external}</body></html>`;
}

describe('minimalAnalyzeAndPersist - vulnerability query status & script content handling', () => {
  let __test_minimalAnalyzeAndPersist: any;
  let dbInstance: any;
  let createFindingId = 0;

  // Per-test configurable in-memory fakes
  let osvHandler: () => Promise<any>;
  let scriptContentHandler: (url: string) => Promise<any>;
  let pageHtml: string;

  beforeEach(async () => {
    jest.resetModules();
    createFindingId = 0;

    dbInstance = {
      getLibrariesByScan: jest.fn().mockResolvedValue([]),
      getFindingsByScan: jest.fn().mockResolvedValue([]),
      createFinding: jest.fn().mockImplementation(async () => `f-${++createFindingId}`),
      createScriptsBatch: jest.fn().mockResolvedValue([]),
      createLibrariesBatch: jest.fn().mockResolvedValue([]),
      createScript: jest.fn().mockResolvedValue('s-1'),
      createLibrary: jest.fn().mockResolvedValue('l-1'),
      getVulnerabilityCacheEntry: jest.fn().mockResolvedValue(null),
      upsertVulnerabilityCacheEntry: jest.fn().mockResolvedValue(undefined),
      updateScanRiskScore: jest.fn().mockResolvedValue(undefined),
    };

    // Defaults: page with one CDN script, script content readable, OSV returns empty list
    pageHtml = htmlWithScripts([CDN_SCRIPT]);
    osvHandler = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ vulns: [] }),
      text: async () => JSON.stringify({ vulns: [] }),
      headers: makeHeaders({}),
    });
    scriptContentHandler = async () => ({
      ok: true,
      status: 200,
      text: async () => '/* jquery */ console.log("ok");',
      headers: makeHeaders({ 'content-type': 'application/javascript' }),
    });

    global.fetch = jest.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('api.osv.dev')) {
        return osvHandler();
      }
      if (u === PAGE_URL) {
        return {
          ok: true,
          status: 200,
          text: async () => pageHtml,
          headers: makeHeaders({}),
        } as any;
      }
      return scriptContentHandler(u);
    });

    const mod = await import('../minimal/analyzer');
    __test_minimalAnalyzeAndPersist = mod.__test_minimalAnalyzeAndPersist;
  });

  afterEach(() => {
    (global.fetch as any)?.mockClear?.();
  });

  it('marks the library as failed (with reason) when the vulnerability client throws', async () => {
    osvHandler = async () => {
      throw new Error('osv exploded');
    };

    const scan = { id: 'scan-fail', url: PAGE_URL, status: 'running' };
    const { libraries } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    expect(libraries.length).toBe(1);
    const lib = libraries[0];
    expect(lib.name).toBe('jquery');
    expect(lib.vulnerabilityQueryStatus).toBe('failed');
    expect(lib.vulnerabilityQueryError).toContain('osv exploded');
    // Failed query must not be treated as zero vulnerabilities: score stays
    // heuristic and is flagged as not based on complete vulnerability data.
    expect(lib.riskScorePartial).toBe(true);
    expect(lib.riskScore).toBe(40); // 10 base + 30 third-party heuristic
    // Heuristic third-party vulnerability record is still present
    expect(lib.vulnerabilities.map((v: any) => v.id)).toContain('MINIMAL-THIRD-PARTY-SCRIPT');
    // No cache write for failed queries
    expect(dbInstance.upsertVulnerabilityCacheEntry).not.toHaveBeenCalled();
    // Global risk score persistence still happens
    expect(dbInstance.updateScanRiskScore).toHaveBeenCalledWith('scan-fail', expect.any(Number));
  });

  it('marks the library as failed with the HTTP status when OSV responds with an error', async () => {
    osvHandler = async () => ({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
      headers: makeHeaders({}),
    });

    const scan = { id: 'scan-http-fail', url: PAGE_URL, status: 'running' };
    const { libraries } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    expect(libraries[0].vulnerabilityQueryStatus).toBe('failed');
    expect(libraries[0].vulnerabilityQueryError).toContain('503');
    expect(libraries[0].riskScorePartial).toBe(true);
  });

  it('marks the library as success when the vulnerability client returns an empty array', async () => {
    osvHandler = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ vulns: [] }),
      headers: makeHeaders({}),
    });

    const scan = { id: 'scan-empty', url: PAGE_URL, status: 'running' };
    const { libraries } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    expect(libraries.length).toBe(1);
    const lib = libraries[0];
    expect(lib.vulnerabilityQueryStatus).toBe('success');
    expect(lib.vulnerabilityQueryError).toBeUndefined();
    expect(lib.riskScorePartial).toBe(false);
    // Heuristic score retained; no OSV vulns merged
    expect(lib.riskScore).toBe(40);
    expect(lib.vulnerabilities.map((v: any) => v.id)).toEqual(['MINIMAL-THIRD-PARTY-SCRIPT']);
  });

  it('merges OSV vulnerabilities and computes the risk score on successful query', async () => {
    osvHandler = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        vulns: [
          {
            id: 'GHSA-xxxx-yyyy',
            summary: 'Test vuln',
            severity: [{ type: 'CVSS_V3', score: '9.8' }],
            references: [{ type: 'WEB', url: 'https://example.com/advisory' }],
          },
        ],
      }),
      headers: makeHeaders({}),
    });

    const scan = { id: 'scan-vuln', url: PAGE_URL, status: 'running' };
    const { libraries } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    const lib = libraries[0];
    expect(lib.vulnerabilityQueryStatus).toBe('success');
    expect(lib.riskScorePartial).toBe(false);
    expect(lib.vulnerabilities.map((v: any) => v.id)).toContain('GHSA-xxxx-yyyy');

    const expectedRisk = Math.round(
      RiskCalculator.calculateLibraryRisk([{ cvssScore: 9.8, severity: 'CRITICAL' }], 70, false),
    );
    expect(lib.riskScore).toBe(expectedRisk);

    // Vulnerability cache is updated on successful, non-empty results
    expect(dbInstance.upsertVulnerabilityCacheEntry).toHaveBeenCalledWith(
      'jquery',
      '3.6.0',
      expect.any(Array),
      expect.any(Number),
    );
  });

  it('uses cached vulnerabilities, scores from cache and marks the query as success', async () => {
    dbInstance.getVulnerabilityCacheEntry.mockResolvedValue({
      packageName: 'jquery',
      version: '3.6.0',
      vulnerabilities: [
        {
          id: 'CVE-2024-0001',
          title: 'Cached vuln',
          description: 'from cache',
          severity: 'critical',
          cvssScore: 9.0,
        },
      ],
    });

    const scan = { id: 'scan-cache', url: PAGE_URL, status: 'running' };
    const { libraries } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    const lib = libraries[0];
    expect(lib.vulnerabilityQueryStatus).toBe('success');
    expect(lib.riskScorePartial).toBe(false);
    expect(lib.vulnerabilities.map((v: any) => v.id)).toContain('CVE-2024-0001');

    const expectedRisk = Math.round(
      RiskCalculator.calculateLibraryRisk([{ cvssScore: 9.0, severity: 'CRITICAL' }], 70, false),
    );
    expect(lib.riskScore).toBe(expectedRisk);

    // OSV must not be queried when the cache satisfies the lookup
    const osvCalls = (global.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('api.osv.dev'));
    expect(osvCalls.length).toBe(0);
  });

  it('still records the script (source + fingerprint) when external script reading fails', async () => {
    scriptContentHandler = async () => {
      throw new Error('connection reset');
    };

    const scan = { id: 'scan-script-fail', url: PAGE_URL, status: 'running' };
    const { libraries, findings } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    // Script record is still created with source URL and fingerprint
    expect(dbInstance.createScriptsBatch).toHaveBeenCalledTimes(1);
    const insertedScripts = dbInstance.createScriptsBatch.mock.calls[0][0];
    expect(insertedScripts.length).toBe(1);
    expect(insertedScripts[0].sourceUrl).toBe(CDN_SCRIPT);
    expect(insertedScripts[0].fingerprint).toBe(FingerprintUtils.simpleHash(CDN_SCRIPT));
    // ... and the missing content is visible on the record
    expect(insertedScripts[0].contentFetched).toBe(false);
    expect(insertedScripts[0].contentError).toContain('connection reset');

    // ... and visible in the scan results as a finding
    const contentFinding = findings.find((f: any) => /External script content unavailable/i.test(f.title));
    expect(contentFinding).toBeTruthy();
    expect(contentFinding.evidence).toBe(CDN_SCRIPT);

    // The library is still identified from the URL and queried normally
    expect(libraries.length).toBe(1);
    expect(libraries[0].name).toBe('jquery');
    expect(libraries[0].detectedVersion).toBe('3.6.0');
    expect(libraries[0].vulnerabilityQueryStatus).toBe('success');
  });

  it('keeps success-path behavior: name merge, highest-confidence version, related scripts, inline patterns, global risk', async () => {
    const sameOrigin = 'https://example.com/lib-1.0.0.js';
    const thirdParty = 'https://cdn.example.com/lib-2.0.0.js';
    pageHtml = htmlWithScripts([sameOrigin, thirdParty], ['eval("alert(1)")']);

    dbInstance.createScriptsBatch.mockResolvedValueOnce(['s-1', 's-2']);
    dbInstance.createLibrariesBatch.mockResolvedValueOnce(['l-merged']);

    const scan = { id: 'scan-merge', url: PAGE_URL, status: 'running' };
    const { libraries, findings } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    // Libraries merged by name into a single record
    expect(libraries.length).toBe(1);
    const lib = libraries[0];
    expect(lib.id).toBe('l-merged');
    expect(lib.name).toBe('lib');
    // Highest-confidence detection (third-party, confidence 70) wins the version
    expect(lib.detectedVersion).toBe('2.0.0');
    expect(lib.confidence).toBe(70);
    // All related scripts are associated
    expect(lib.relatedScripts).toHaveLength(2);
    expect(lib.relatedScripts).toEqual(expect.arrayContaining([sameOrigin, thirdParty]));
    // Heuristic risk score kept (OSV returned empty) and query marked successful
    expect(lib.vulnerabilityQueryStatus).toBe('success');
    expect(lib.riskScorePartial).toBe(false);
    expect(lib.riskScore).toBe(40);

    // Persistence call structure unchanged: one batch call with the merged library
    expect(dbInstance.createLibrariesBatch).toHaveBeenCalledTimes(1);
    const persistedLibs = dbInstance.createLibrariesBatch.mock.calls[0][0];
    expect(persistedLibs).toHaveLength(1);
    expect(persistedLibs[0].name).toBe('lib');
    expect(dbInstance.createScriptsBatch).toHaveBeenCalledTimes(1);
    expect(dbInstance.createScriptsBatch.mock.calls[0][0]).toHaveLength(2);

    // Inline script risk pattern detection still works
    const evalFinding = findings.find((f: any) => f.type === 'EVAL_USAGE');
    expect(evalFinding).toBeTruthy();

    // Overall risk score persisted with the same call shape
    expect(dbInstance.updateScanRiskScore).toHaveBeenCalledWith('scan-merge', expect.any(Number));
  });
});
