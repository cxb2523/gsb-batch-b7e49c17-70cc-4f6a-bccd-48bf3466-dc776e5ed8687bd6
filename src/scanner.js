import { basename } from 'path';
import { parseManifests } from './parsers.js';
import { queryOSV } from './osv.js';

const zeroSeverity = () => ({ critical: 0, high: 0, moderate: 0, low: 0, unknown: 0 });

/**
 * Build a placeholder service result for a service that could not be scanned.
 * The service keeps its identity so the dashboard can report which one is
 * incomplete, but carries no vulnerability data.
 */
function failedService(dir, noOsv, manifests, error, packages = []) {
  const ecosystems = [...new Set(manifests.map(m => m.ecosystem))];
  const name = manifests.find(m => m.name && m.name !== 'npm-project' && m.name !== 'python-project')?.name
    || basename(dir);

  return {
    name,
    dir,
    ecosystem: ecosystems.join('+'),
    ecosystems,
    manifests: manifests.map(m => ({ type: m.type, source: m.source || m.type, lockVersion: m.lockVersion })),
    packages,
    totalPackages: packages.length,
    directCount: packages.filter(p => p.isDirect).length,
    vulns: [],
    severity: zeroSeverity(),
    riskScore: 0,
    noOsv,
    scannedAt: new Date().toISOString(),
    scanStatus: {
      complete: false,
      error: error?.message || String(error),
    },
  };
}

/**
 * Scan a single service directory.
 * Returns a structured result object for the dashboard.
 *
 * A service that cannot be parsed or queried is returned as an incomplete
 * result (scanStatus.complete === false) instead of throwing, so one broken
 * service does not abort a multi-service scan.
 */
export async function scanService(dir, { noOsv = false } = {}) {
  let manifests;
  try {
    manifests = parseManifests(dir);
  } catch (error) {
    return failedService(dir, noOsv, [], error);
  }
  if (manifests.length === 0) {
    return failedService(dir, noOsv, [], new Error('No supported manifest files found'));
  }

  // If multiple manifests (e.g. monorepo with both npm + python in same dir),
  // merge them into one service result
  const allPackages = manifests.flatMap(m => m.packages);
  const ecosystems = [...new Set(manifests.map(m => m.ecosystem))];

  // Determine display name
  const name = manifests.find(m => m.name && m.name !== 'npm-project' && m.name !== 'python-project')?.name
    || basename(dir);

  // ── Query OSV.dev ──────────────────────────────────────────────────────────
  let osvResults = new Map();
  if (!noOsv) {
    try {
      const queryable = allPackages.filter(p => p.version && p.version !== 'unknown');
      if (queryable.length > 0) {
        process.stdout.write(`    ${dim('OSV.dev: querying ' + queryable.length + ' packages...')}\n`);
        osvResults = await queryOSV(queryable);
      }
    } catch (error) {
      // An interrupted OSV.dev lookup means CVE data is unknown for this
      // service — never report it as clean.
      return failedService(dir, noOsv, manifests, error, allPackages);
    }
  }

  // ── Build vulnerability list ────────────────────────────────────────────────
  const vulns = [];
  const severityCounts = zeroSeverity();
  const seenVulns = new Set();

  for (const pkg of allPackages) {
    const key = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
    const pkgVulns = osvResults.get(key) || [];
    for (const vuln of pkgVulns) {
      const normalized = {
        ...vuln,
        packageName: pkg.name,
        packageVersion: pkg.version,
        ecosystem: pkg.ecosystem,
        isDirect: pkg.isDirect,
        dev: pkg.dev,
        registryUrl: pkg.registry,
      };
      const dedupeKey = getVulnDedupeKey(normalized);
      if (seenVulns.has(dedupeKey)) continue;
      seenVulns.add(dedupeKey);
      severityCounts[normalized.severity] = (severityCounts[normalized.severity] || 0) + 1;
      vulns.push(normalized);
    }
  }

  // Sort: critical first, then high, moderate, low
  const SEV_ORDER = { critical: 0, high: 1, moderate: 2, low: 3, unknown: 4 };
  vulns.sort((a, b) => (SEV_ORDER[a.severity] ?? 5) - (SEV_ORDER[b.severity] ?? 5));

  // ── Risk score ──────────────────────────────────────────────────────────────
  const riskScore = Math.min(100,
    severityCounts.critical * 25 +
    severityCounts.high * 10 +
    severityCounts.moderate * 3 +
    severityCounts.low * 1
  );

  return {
    name,
    dir,
    ecosystem: ecosystems.join('+'),
    ecosystems,
    manifests: manifests.map(m => ({ type: m.type, source: m.source || m.type, lockVersion: m.lockVersion })),
    packages: allPackages,
    totalPackages: allPackages.length,
    directCount: allPackages.filter(p => p.isDirect).length,
    vulns,
    severity: severityCounts,
    riskScore,
    noOsv,
    scannedAt: new Date().toISOString(),
    scanStatus: { complete: true, error: null },
  };
}

function dim(s) { return `\x1b[90m${s}\x1b[0m`; }

function getVulnDedupeKey(vuln) {
  const advisory = vuln.cveId?.startsWith('CVE-')
    ? vuln.cveId
    : vuln.ghsaId || vuln.cveId || vuln.id;
  return `${vuln.ecosystem}:${vuln.packageName}@${vuln.packageVersion}:${advisory}`;
}
