/**
 * Tests for the fetch conclusion emitted by scripts/update-ground-stations.ts.
 *
 * The weekly merge used to silently drop stations or mislabel statuses when a
 * source scrape failed or returned partial data. runUpdate now records a
 * per-source outcome (adopted / reject reason / candidate count) plus the
 * merge outcome, writes it into the change report, and never touches
 * data/ground-stations.json when every source failed.
 *
 * All tests run fully offline against temp files with injected sources.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runUpdate,
  type RunUpdateOptions,
  type Station,
  type StationCandidate,
} from '../../scripts/update-ground-stations';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

interface Fixture {
  dataPath: string;
  metaPath: string;
  reportPath: string;
  readData: () => { lastUpdated: string; stations: Station[] };
  readReport: () => string;
}

function setup(existingStations: Station[]): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'gs-update-'));
  tempDirs.push(dir);
  const dataPath = join(dir, 'ground-stations.json');
  const metaPath = join(dir, 'ground-stations-meta.json');
  const reportPath = join(dir, 'ground-stations-update-report.md');
  writeFileSync(
    dataPath,
    JSON.stringify({ lastUpdated: '2026-01-01T00:00:00.000Z', stations: existingStations }, null, 2),
  );
  return {
    dataPath,
    metaPath,
    reportPath,
    readData: () => JSON.parse(readFileSync(dataPath, 'utf-8')),
    readReport: () => readFileSync(reportPath, 'utf-8'),
  };
}

function candidate(overrides: Partial<StationCandidate>): StationCandidate {
  return {
    name: 'Alpha, XX',
    lat: 0,
    lon: 0,
    status: 'operational',
    type: 'gateway',
    source: 'test',
    ...overrides,
  };
}

/** Offline defaults: no PoP tagging fetch, no geocoding. */
function offlineOptions(fixture: Fixture): RunUpdateOptions {
  return {
    dataPath: fixture.dataPath,
    metaPath: fixture.metaPath,
    reportPath: fixture.reportPath,
    fetchPopCities: async () => new Set<string>(),
    geocodeFn: async () => null,
  };
}

const EXISTING: Station[] = [
  { name: 'Alpha, XX', lat: 10, lon: 10, status: 'planned', type: 'gateway' },
  { name: 'Beta, YY', lat: -40, lon: 170, status: 'operational', type: 'gateway' },
];

describe('runUpdate fetch conclusion', () => {
  it('merges two healthy sources and records one status change', async () => {
    const fixture = setup(EXISTING);

    const conclusion = await runUpdate({
      ...offlineOptions(fixture),
      sources: [
        // insider-like source: names + status only, no coordinates
        {
          name: 'source-a',
          fetch: async () => [
            candidate({ name: 'Alpha, XX', status: 'operational', source: 'source-a' }),
            candidate({ name: 'Beta, YY', status: 'operational', source: 'source-a' }),
          ],
        },
        // starlink.sx-like source: coordinates + status
        {
          name: 'source-b',
          fetch: async () => [
            candidate({ name: 'Alpha, XX', lat: 10.001, lon: 10.001, status: 'planned', source: 'source-b' }),
            candidate({ name: 'Beta, YY', lat: -40.001, lon: 170.001, status: 'operational', source: 'source-b' }),
          ],
        },
      ],
    });

    // Both sources adopted, no reject reason, candidate counts recorded
    expect(conclusion.sources).toEqual([
      { name: 'source-a', adopted: true, rejectReason: null, candidateCount: 2 },
      { name: 'source-b', adopted: true, rejectReason: null, candidateCount: 2 },
    ]);

    // Exactly one status change: Alpha planned → operational (operational wins)
    expect(conclusion.statusChanged).toEqual([
      { name: 'Alpha, XX', from: 'planned', to: 'operational' },
    ]);
    expect(conclusion.added).toEqual([]);
    expect(conclusion.coordConflicts).toEqual([]);
    expect(conclusion.dataFileWritten).toBe(true);

    // Data file reflects the merged status
    const data = fixture.readData();
    const alpha = data.stations.find((s) => s.name === 'Alpha, XX')!;
    expect(alpha.status).toBe('operational');
    expect(data.stations.length).toBe(2);

    // Report contains the new conclusion section AND the original sections
    const report = fixture.readReport();
    expect(report).toContain('## Fetch Conclusion');
    expect(report).toContain('| source-a | yes | — | 2 |');
    expect(report).toContain('| source-b | yes | — | 2 |');
    expect(report).toContain('## Sources');
    expect(report).toContain('- Used: source-a, source-b');
    expect(report).toContain('## Status Changed');
    expect(report).toContain('- Alpha, XX: planned → operational');
  });

  it('adopts the surviving source when the other one throws', async () => {
    const fixture = setup(EXISTING);

    const conclusion = await runUpdate({
      ...offlineOptions(fixture),
      sources: [
        {
          name: 'source-a',
          fetch: async () => {
            throw new Error('HTTP 503');
          },
        },
        {
          name: 'source-b',
          fetch: async () => [
            candidate({ name: 'Alpha, XX', lat: 10.001, lon: 10.001, status: 'operational', source: 'source-b' }),
            candidate({ name: 'Beta, YY', lat: -40.001, lon: 170.001, status: 'operational', source: 'source-b' }),
          ],
        },
      ],
    });

    // Failed source marked with fetch-error, surviving source still adopted
    expect(conclusion.sources).toEqual([
      { name: 'source-a', adopted: false, rejectReason: 'fetch-error', candidateCount: 0 },
      { name: 'source-b', adopted: true, rejectReason: null, candidateCount: 2 },
    ]);

    // Merge still happened from the surviving source
    expect(conclusion.statusChanged).toEqual([
      { name: 'Alpha, XX', from: 'planned', to: 'operational' },
    ]);
    const data = fixture.readData();
    expect(data.stations.find((s) => s.name === 'Alpha, XX')!.status).toBe('operational');

    // Report marks the failed source in both the conclusion and Sources sections
    const report = fixture.readReport();
    expect(report).toContain('| source-a | no | fetch-error | 0 |');
    expect(report).toContain('- Used: source-b');
    expect(report).toContain('- Failed: source-a');
  });

  it('leaves the station file untouched when every source fails', async () => {
    const fixture = setup(EXISTING);
    const before = readFileSync(fixture.dataPath, 'utf-8');

    const conclusion = await runUpdate({
      ...offlineOptions(fixture),
      sources: [
        {
          name: 'source-a',
          fetch: async () => {
            throw new Error('network down');
          },
        },
        {
          name: 'source-b',
          fetch: async () => {
            throw new Error('HTTP 500');
          },
        },
      ],
    });

    // Both sources rejected as fetch errors
    expect(conclusion.sources).toEqual([
      { name: 'source-a', adopted: false, rejectReason: 'fetch-error', candidateCount: 0 },
      { name: 'source-b', adopted: false, rejectReason: 'fetch-error', candidateCount: 0 },
    ]);
    expect(conclusion.dataFileWritten).toBe(false);
    expect(conclusion.totalStations).toBe(2);

    // data/ground-stations.json byte-identical
    expect(readFileSync(fixture.dataPath, 'utf-8')).toBe(before);

    // Report still written, with the conclusion showing both failures
    const report = fixture.readReport();
    expect(report).toContain('## Fetch Conclusion');
    expect(report).toContain('| source-a | no | fetch-error | 0 |');
    expect(report).toContain('| source-b | no | fetch-error | 0 |');
    expect(report).toContain('- Used: none');
    expect(report).toContain('- Failed: source-a, source-b');

    // Meta tracking is not advanced when nothing was merged
    expect(existsSync(fixture.metaPath)).toBe(false);
  });
});
