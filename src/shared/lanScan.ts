/**
 * LAN scan shared rules (pure logic, no platform dependencies).
 *
 * Single source of truth for the subnet validation, prefix derivation,
 * result ordering/dedup and scan status merge rules used by:
 *   - the web frontend (React/Capacitor layer)
 *   - the Android native plugin (android/.../NativeShellPlugin.java),
 *     which mirrors these rules 1:1 in Java because Java cannot import
 *     TypeScript directly
 *   - the unit tests under src/shared/*.test.ts, runnable in plain Node
 *
 * This module must stay free of any DOM, Capacitor or Android imports so
 * it can run unchanged under Node/Vite.
 */

export type ScanStatus = 'completed' | 'cancelled';

export interface ScanHost {
  ip: string;
  status?: string;
}

export interface ScanResult {
  /** 'completed' for a full scan (even with zero hosts), 'cancelled' on user cancel. */
  status: ScanStatus;
  /** Unique hosts sorted ascending by the numeric value of the IP's last octet. */
  hosts: string[];
  /** Always hosts.length — redundant on purpose so callers can verify counts. */
  found: number;
}

export interface SubnetCheck {
  valid: boolean;
  /** Present (and valid === false) when the subnet is rejected before any work starts. */
  reason?: string;
}

/**
 * Validate a user-supplied subnet BEFORE any thread pool / network work starts.
 *
 * Rules (mirrored exactly in NativeShellPlugin.java#validateSubnet):
 *   1. must be a non-empty string containing '/';
 *   2. the dotted prefix before '/' must split into at least three numeric
 *      octets, e.g. "192.168.1.0/24" -> ["192","168","1"] -> valid.
 * An empty-but-valid scan ("10.0.0.0/24" with no alive hosts) is NOT a
 * validation failure and must never be confused with a rejection.
 */
export function validateSubnet(subnet: unknown): SubnetCheck {
  if (typeof subnet !== 'string' || subnet.length === 0) {
    return { valid: false, reason: 'Target subnet required' };
  }
  if (!subnet.includes('/')) {
    return { valid: false, reason: 'Subnet must contain "/" (e.g. 192.168.1.0/24)' };
  }

  const addressPart = subnet.split('/')[0];
  const octets = addressPart.split('.');
  if (octets.length < 3) {
    return { valid: false, reason: 'Subnet prefix must contain at least three dotted octets (e.g. 192.168.1.0/24)' };
  }

  // At least the first three segments must parse as integers.
  for (let i = 0; i < 3; i++) {
    const octet = octets[i].trim();
    if (!/^\d+$/.test(octet)) {
      return { valid: false, reason: `Subnet octet #${i + 1} ("${octets[i]}") is not a number` };
    }
  }

  return { valid: true };
}

/**
 * Derive the dotted prefix to which host suffixes (1..254) are appended.
 * Mirrors the original native behaviour: take everything up to and including
 * the last '.' in the address part, e.g. "192.168.1.0/24" -> "192.168.1.".
 *
 * Callers MUST run validateSubnet() first; an invalid subnet throws.
 */
export function derivePrefix(subnet: string): string {
  const check = validateSubnet(subnet);
  if (!check.valid) {
    throw new Error(check.reason ?? 'Invalid subnet');
  }
  const addressPart = subnet.split('/')[0];
  return addressPart.substring(0, addressPart.lastIndexOf('.') + 1);
}

/** Numeric value of an IP's last octet, used as the stable sort key. */
export function lastOctet(ip: string): number {
  const tail = ip.substring(ip.lastIndexOf('.') + 1);
  const value = Number.parseInt(tail, 10);
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

/**
 * Deduplicate discovered IPs (case-insensitive, trimmed) and sort them
 * ascending by the numeric value of their last octet.
 */
export function sortAndDedupHosts(ips: string[]): string[] {
  const unique = new Set<string>();
  for (const ip of ips) {
    if (typeof ip === 'string' && ip.trim().length > 0) {
      unique.add(ip.trim());
    }
  }
  return Array.from(unique).sort((a, b) => lastOctet(a) - lastOctet(b));
}

/**
 * Build the final, verifiable scan result.
 * A normal scan with zero alive hosts is still 'completed' with hosts: [].
 * 'cancelled' preserves every host discovered before cancellation.
 */
export function buildScanResult(status: ScanStatus, hosts: string[]): ScanResult {
  const merged = sortAndDedupHosts(hosts);
  return { status, hosts: merged, found: merged.length };
}

/**
 * Stateful accumulator for one scan session. It enforces the two guarantees
 * the UI relies on:
 *   - addHost() is a no-op after cancel()/finish(), so no hostFound can be
 *     appended once a scan has been cancelled;
 *   - finish()/cancel() finalize at most once — the native layer resolves
 *     its plugin call exactly once with the returned ScanResult.
 */
export class LanScanSession {
  private readonly collected = new Set<string>();
  private cancelled = false;
  private finalized = false;

  /** Record a discovered host. Returns false when the scan already ended. */
  addHost(ip: string): boolean {
    if (this.cancelled || this.finalized) return false;
    if (typeof ip !== 'string' || ip.trim().length === 0) return false;
    this.collected.add(ip.trim());
    return true;
  }

  cancel(): ScanResult {
    if (this.finalized) {
      return this.snapshot(this.cancelled ? 'cancelled' : 'completed');
    }
    this.cancelled = true;
    this.finalized = true;
    return this.snapshot('cancelled');
  }

  finish(): ScanResult {
    if (this.finalized) {
      return this.snapshot(this.cancelled ? 'cancelled' : 'completed');
    }
    this.finalized = true;
    return this.snapshot('completed');
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  isFinalized(): boolean {
    return this.finalized;
  }

  private snapshot(status: ScanStatus): ScanResult {
    return buildScanResult(status, Array.from(this.collected));
  }
}
