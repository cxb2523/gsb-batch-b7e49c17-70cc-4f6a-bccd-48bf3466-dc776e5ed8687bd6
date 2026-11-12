/**
 * Offline unit tests for the container presence tracker (the grace-period state machine).
 * Run with Node's built-in runner: `node --test --experimental-strip-types`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTAINER_GRACE_SAMPLES,
  ContainerPresence,
  ServiceContainers,
  containerKey,
  containerNodeId,
  isContainerNodeId,
} from '../dokploy/presence.ts';

test('containerKey strips the Swarm task id but keeps the stable prefix', () => {
  assert.equal(containerKey('app.1.rkzp2vw1q7ab'), 'app.1');
  assert.equal(containerKey('app.2.rkzp2vw1q7ab'), 'app.2');
  // A new task id for the same slot normalises to the same key: identity survives redeploys.
  assert.equal(containerKey('app.1.abcdefghijklm'), containerKey('app.1.rkzp2vw1q7ab'));
  // Fixed compose names are left untouched.
  assert.equal(containerKey('apps-stack-web-1'), 'apps-stack-web-1');
});

test('node ids combine service id and normalized container key', () => {
  assert.equal(containerNodeId('svc', 'app.1'), 'svc::app.1');
  assert.equal(isContainerNodeId('svc::app.1'), true);
  assert.equal(isContainerNodeId('svc'), false);
});

test('a single missed sample keeps the key (grace window), then restores cleanly', () => {
  const sc = new ServiceContainers();
  sc.observe(['web', 'db']);
  assert.deepEqual(sc.keys(), ['web', 'db']);
  assert.deepEqual(sc.absentKeys(), []);

  // Sample 2: `db` is missing once (a restart / partial docker ps). Still there, flagged absent.
  sc.observe(['web']);
  assert.deepEqual(sc.keys(), ['web', 'db']);
  assert.deepEqual(sc.absentKeys(), ['db']);

  // Sample 3: it comes back. Miss counter resets, identity and position are unchanged.
  sc.observe(['web', 'db']);
  assert.deepEqual(sc.keys(), ['web', 'db']);
  assert.deepEqual(sc.absentKeys(), []);
});

test(`a key is only evicted after more than ${CONTAINER_GRACE_SAMPLES} consecutive misses`, () => {
  const sc = new ServiceContainers();
  sc.observe(['web', 'db']);
  for (let i = 0; i < CONTAINER_GRACE_SAMPLES; i++) {
    sc.observe(['web']);
    assert.ok(sc.has('db'), `db must survive miss ${i + 1} of ${CONTAINER_GRACE_SAMPLES}`);
  }
  // One more miss beyond the grace window evicts it and closes the ordering gap.
  sc.observe(['web']);
  assert.equal(sc.has('db'), false);
  assert.deepEqual(sc.keys(), ['web']);
});

test('an intermittent miss resets instead of accumulating toward eviction', () => {
  const sc = new ServiceContainers();
  sc.observe(['web', 'db']);
  sc.observe(['web']); // miss 1
  sc.observe(['web', 'db']); // back: counter reset
  sc.observe(['web']); // miss 1 again, not miss 2
  assert.deepEqual(sc.keys(), ['web', 'db']);
});

test('new keys are appended and never shift an existing key position', () => {
  const sc = new ServiceContainers();
  sc.observe(['web']);
  sc.observe(['web', 'cache']);
  sc.observe(['cache', 'web']); // ordering in the input must not matter
  assert.deepEqual(sc.keys(), ['web', 'cache']);
});

test('eviction is reported so the collector can release retained metrics', () => {
  const sc = new ServiceContainers();
  sc.observe(['web', 'db']);
  assert.deepEqual(sc.observe(['web']), []); // within grace: nothing evicted yet
  assert.deepEqual(sc.observe(['web']), []);
  assert.deepEqual(sc.observe(['web']), ['db']); // grace exhausted
});

test('ContainerPresence lazily creates and prunes per service', () => {
  const p = new ContainerPresence();
  p.for('a').observe(['x']);
  p.for('b').observe(['y']);
  assert.ok(p.get('a')?.has('x'));
  p.prune(new Set(['a']));
  assert.equal(p.get('b'), undefined);
  assert.ok(p.get('a'));
});
