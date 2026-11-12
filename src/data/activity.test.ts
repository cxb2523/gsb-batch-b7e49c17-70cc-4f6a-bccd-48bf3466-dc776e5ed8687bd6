/**
 * Offline unit tests for the activity-feed diffing rules, in particular:
 * container nodes (`svc::key`) must never produce a "New node" event, only real new services do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffEvents, seedEvents } from './activity.ts';
import type { ActivityEvent } from '../store-activity-types.ts';
import type { Deployment, Service } from './types.ts';

let seq = 0;
const nextSeq = () => ++seq;
const empty = () => ({ servers: {}, projects: {}, environments: {}, services: {}, deployments: {}, alerts: {} });

const service = (id: string, status: Service['status'], extra: Partial<Service> = {}): Service => ({
  id,
  projectId: 'p1',
  environmentId: 'e1',
  serverId: 'local',
  name: id,
  kind: 'compose',
  status,
  cpu: 0,
  memMb: 0,
  memLimitMb: 0,
  replicas: 1,
  lastDeploy: null,
  cpuHist: [],
  ...extra,
});

const ctx = (services: Record<string, Service>, prev: Record<string, Service> = {}) => ({
  prev: { ...empty(), services: prev },
  next: { ...empty(), services },
});

test('a new container node does not create a new-node event', () => {
  const next = { 'svc::web': service('svc::web', 'running') };
  const events = diffEvents(ctx(next), { services: Object.values(next) }, 1000, new Map(), nextSeq);
  assert.equal(events.some((e) => e.kind === 'new-node'), false);
});

test('a genuinely new service creates a new-node event', () => {
  const next = { svc: service('svc', 'running') };
  const events = diffEvents(ctx(next), { services: Object.values(next) }, 1000, new Map(), nextSeq);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'new-node');
  assert.equal(events[0]!.serviceId, 'svc');
});

test('a container node that disappeared and reappears emits no event, but status changes still do', () => {
  // Reappearing node: it exists in prev and next with the same id → no event at all.
  const prev = { 'svc::db': service('svc::db', 'running') };
  const next = { 'svc::db': service('svc::db', 'running') };
  assert.deepEqual(diffEvents(ctx(next, prev), { services: Object.values(next) }, 1000, new Map(), nextSeq), []);

  // Its status changing (e.g. idle → running after a restart) is still reported.
  const idle = { 'svc::db': service('svc::db', 'idle') };
  const up = { 'svc::db': service('svc::db', 'running') };
  const events = diffEvents(ctx(up, idle), { services: Object.values(up) }, 1000, new Map(), nextSeq);
  assert.equal(events[0]!.kind, 'started');
  assert.equal(events[0]!.serviceId, 'svc::db');
});

test('service-level down/recovery events keep firing', () => {
  const prev = { svc: service('svc', 'running') };
  const next = { svc: service('svc', 'error') };
  const events = diffEvents(ctx(next, prev), { services: Object.values(next) }, 1000, new Map(), nextSeq);
  assert.equal(events[0]!.kind, 'down');

  const back = { svc: service('svc', 'running') };
  const recovered = diffEvents(ctx(back, next), { services: Object.values(back) }, 1000, new Map(), nextSeq);
  assert.equal(recovered[0]!.kind, 'up');
});

test('deployment start and finish events are unaffected', () => {
  const dep: Deployment = {
    id: 'd1',
    serviceId: 'svc',
    trigger: 'push',
    status: 'running',
    stages: ['queued', 'queued', 'queued', 'queued', 'queued'],
    log: [],
    cart: 1,
    createdAt: 900,
  };
  const services = { svc: service('svc', 'deploying') };
  const events = diffEvents(ctx(services), { services: Object.values(services), deployments: [dep] }, 1000, new Map(), nextSeq);
  // One new-node for the service plus the deploy-start.
  assert.ok(events.some((e) => e.kind === 'new-node'));
  assert.ok(events.some((e) => e.kind === 'deploy-start'));
});

test('seedEvents only contains finished deploys, newest first', () => {
  const services = { svc: service('svc', 'running') };
  const deployments: Record<string, Deployment> = {
    d1: { id: 'd1', serviceId: 'svc', trigger: 'push', status: 'success', stages: [], log: [], cart: 1, createdAt: 100 },
    d2: { id: 'd2', serviceId: 'svc', trigger: 'push', status: 'running', stages: [], log: [], cart: 2, createdAt: 200 },
  };
  const events: ActivityEvent[] = seedEvents(services, deployments, nextSeq);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'deploy-ok');
});
