/**
 * Pure-logic tests for the shared LAN scan rules.
 * Runnable with the toolchain already in this repo (Node >= 20 + tsx):
 *
 *   npm test
 *
 * or directly:
 *
 *   node --import tsx --test src/shared/lanScan.test.ts
 *
 * No device, emulator or Capacitor runtime is required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScanResult,
  derivePrefix,
  LanScanSession,
  sortAndDedupHosts,
  validateSubnet,
} from './lanScan';

describe('validateSubnet / derivePrefix', () => {
  it('accepts a normal /24 subnet and derives its dotted prefix', () => {
    assert.deepEqual(validateSubnet('192.168.1.0/24'), { valid: true });
    assert.equal(derivePrefix('192.168.1.0/24'), '192.168.1.');
    assert.equal(derivePrefix('10.0.0.0/8'), '10.0.0.');
  });

  it('rejects illegal subnets without starting a scan', () => {
    const noSlash = validateSubnet('192.168.1.0');
    assert.equal(noSlash.valid, false);
    assert.ok(noSlash.reason);
    assert.match(noSlash.reason as string, /\//);

    const tooFewOctets = validateSubnet('192.168/16');
    assert.equal(tooFewOctets.valid, false);
    assert.ok(tooFewOctets.reason);

    const nonNumeric = validateSubnet('192.abc.1.0/24');
    assert.equal(nonNumeric.valid, false);
    assert.ok(nonNumeric.reason);

    assert.equal(validateSubnet('').valid, false);
    assert.equal(validateSubnet(undefined as unknown as string).valid, false);

    // An invalid subnet must never produce a prefix (no thread pool starts).
    assert.throws(() => derivePrefix('192.168/16'));
    assert.throws(() => derivePrefix('no-slash'));
  });

  it('keeps an empty-but-valid scan distinct from a rejection', () => {
    assert.deepEqual(validateSubnet('172.16.5.0/24'), { valid: true });
    const result = buildScanResult('completed', []);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.hosts, []);
    assert.equal(result.found, 0);
  });
});

describe('sortAndDedupHosts / buildScanResult', () => {
  it('case 1: normal scan with hosts — deduped, sorted by last octet, found matches', () => {
    // Events can arrive out of order and even repeat (64 worker threads).
    const events = [
      '192.168.1.100',
      '192.168.1.1',
      '192.168.1.20',
      '192.168.1.1', // duplicate event
      '192.168.1.254',
      '192.168.1.20', // duplicate event
    ];

    const sorted = sortAndDedupHosts(events);
    assert.deepEqual(sorted, [
      '192.168.1.1',
      '192.168.1.20',
      '192.168.1.100',
      '192.168.1.254',
    ]);
    // Numeric ordering, not lexicographic (100 must come after 20).
    assert.ok(sorted.indexOf('192.168.1.20') < sorted.indexOf('192.168.1.100'));

    const result = buildScanResult('completed', events);
    assert.equal(result.status, 'completed');
    assert.equal(result.found, 4);
    assert.equal(result.found, result.hosts.length);
    assert.deepEqual(result.hosts, sorted);
  });

  it('case 2: normal scan with zero hosts — still completed with empty hosts', () => {
    const result = buildScanResult('completed', []);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.hosts, []);
    assert.equal(result.found, 0);
  });
});

describe('LanScanSession cancellation semantics', () => {
  it('case 3: illegal subnet is rejected before a session does any work', () => {
    for (const bad of ['10.0/8', 'just-text', '', '192.168.x.0/24']) {
      const check = validateSubnet(bad);
      assert.equal(check.valid, false, `expected rejection for ${JSON.stringify(bad)}`);
      assert.ok(typeof check.reason === 'string' && check.reason.length > 0);
    }
  });

  it('case 4: after cancel no further hosts are appended, hosts found so far are kept', () => {
    const session = new LanScanSession();
    assert.equal(session.addHost('192.168.1.10'), true);
    assert.equal(session.addHost('192.168.1.2'), true);
    assert.equal(session.addHost('192.168.1.10'), true); // duplicate, ignored

    const cancelled = session.cancel();
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.found, 2);
    assert.deepEqual(cancelled.hosts, ['192.168.1.2', '192.168.1.10']);

    // Late hostFound events (workers still finishing in-flight probes):
    // they must never reach the result once cancelled.
    assert.equal(session.addHost('192.168.1.99'), false);
    assert.equal(session.addHost('192.168.1.3'), false);

    // Re-cancelling / finishing returns the same snapshot — single finalization.
    const again = session.cancel();
    assert.deepEqual(again, cancelled);
    const finishedAfterCancel = session.finish();
    assert.equal(finishedAfterCancel.status, 'cancelled');
    assert.deepEqual(finishedAfterCancel.hosts, ['192.168.1.2', '192.168.1.10']);
  });

  it('finalizes exactly once: finish() after a normal scan stays completed', () => {
    const session = new LanScanSession();
    session.addHost('10.0.0.5');
    const first = session.finish();
    assert.equal(first.status, 'completed');
    assert.equal(first.found, 1);

    // A late finish must not reset or duplicate the result.
    const second = session.finish();
    assert.deepEqual(second, first);
    assert.equal(session.addHost('10.0.0.6'), false);
  });
});
