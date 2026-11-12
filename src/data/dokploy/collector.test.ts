/**
 * Offline integration tests for the Collector's multi-container split and the
 * absence → grace → eviction lifecycle. Everything is driven through a fake Transport that
 * serves hand-made Dokploy payloads; no network, no timers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collector } from './collector.ts';
import type { Transport } from './api.ts';
import type { Service, World, WorldPatch } from '../types.ts';

const SERVICE = 'svc-stack';
const APP = 'apps-stack';
const WEB = `${APP}-web-1`;
const DB = `${APP}-db-1`;
const CACHE = `${APP}-cache-1`;
const DEPLOY = 'dep-1';

interface FakeState {
  /** Container-list payload per app name; an empty array models `docker ps` listing nothing. */
  containers: Record<string, { name: string; state: string; status: string }[]>;
  /** Raw stats snapshots, as `swarm.getContainerStats` would return. */
  stats: Record<string, { CPUPerc: string; MemUsage: string; NetIO: string }>;
  composeStatus: 'done' | 'error' | 'running';
  deploys: Record<string, unknown>[];
}

function rawStat(name: string, cpu: number, rx: number) {
  return { Name: name, CPUPerc: String(cpu * 100), MemUsage: '64MiB/512MiB', NetIO: `${rx}B/0B` };
}

function makeTransport(state: FakeState): { transport: Transport; containerRefreshes: () => number } {
  let containerCalls = 0;
  const transport: Transport = async (path: string) => {
    const url = new URL(path, 'http://local');
    const proc = url.pathname.split('/api/')[1]!;
    switch (proc) {
      case 'settings.getDokployVersion':
        return 'v0.29.8';
      case 'project.all':
        // The real endpoint only lists ids; project.one below carries the full structure.
        return [{ projectId: 'p1', name: 'proj' }];
      case 'project.one':
        return {
          projectId: 'p1',
          name: 'proj',
          environments: [
            {
              environmentId: 'e1',
              name: 'production',
              compose: [
                {
                  composeId: SERVICE,
                  name: 'stack',
                  appName: APP,
                  composeStatus: state.composeStatus,
                  serverId: 'local',
                },
              ],
            },
          ],
        };
      case 'docker.getContainersByAppNameMatch': {
        containerCalls++;
        const appName = url.searchParams.get('appName')!;
        return state.containers[appName] ?? [];
      }
      case 'swarm.getContainerStats':
        return Object.entries(state.stats).map(([name, s]) => ({ ...s, Name: name }));
      case 'deployment.allCentralized':
        return state.deploys;
      case 'deployment.readLogs':
        return '';
      case 'compose.one':
        return { domains: [], memoryLimit: 0, replicas: 1 };
      case 'swarm.getNodes':
        return [{ ID: 'n1', Self: true, Hostname: 'host' }];
      case 'swarm.getNodeInfo':
        return { Description: { Resources: { NanoCPUs: 2e9, MemoryBytes: 4 * 1024 ** 3 } }, Status: { Addr: '127.0.0.1' } };
      default:
        throw new Error(`unexpected call: ${proc}`);
    }
  };
  return { transport, containerRefreshes: () => containerCalls };
}

const running = (name: string) => ({ name, state: 'running', status: 'Up 1 hour (healthy)' });
const allThree = () => [running(WEB), running(DB), running(CACHE)];
const statsFor = (names: string[], cpu = 0.2, rx = 1000) =>
  Object.fromEntries(names.map((n, i) => [n, rawStat(n, cpu + i * 0.05, rx + i * 100)]));

function freshState(): FakeState {
  return {
    containers: { [APP]: allThree() },
    stats: statsFor([WEB, DB, CACHE]),
    composeStatus: 'done',
    deploys: [],
  };
}

/** Drive enough ticks for `n` container-list refreshes (the list is fetched every 6th tick). */
async function containerSamples(collector: Collector, n: number) {
  for (let i = 0; i < n * 6; i++) await collector.tick();
}

const node = (w: World, id: string): Service => {
  const found = w.services.find((s) => s.id === id);
  assert.ok(found, `node ${id} should exist`);
  return found!;
};
const hasNode = (w: World, id: string) => w.services.some((s) => s.id === id);
const mainId = () => SERVICE; // the main (first) container keeps the bare service id
const dbNodeId = () => `${SERVICE}::${APP}-db-1`;
const cacheNodeId = () => `${SERVICE}::${APP}-cache-1`;

/** Every patch published across the tests below, so removal semantics can be asserted. */
const patches: WorldPatch[] = [];
const makeCollector = (transport: Transport) =>
  new Collector(transport, (event, data) => {
    if (event === 'patch') patches.push(data as WorldPatch);
  });

test('normal multi-container split: one node per container, main keeps the service id', async () => {
  const state = freshState();
  const { transport } = makeTransport(state);
  const collector = makeCollector(transport);
  await collector.bootstrap();
  await containerSamples(collector, 1);

  const w = collector.world!;
  assert.equal(w.services.length, 3);
  // Web ranks as the main container and keeps the service id; the others get composite ids.
  assert.ok(hasNode(w, mainId()));
  assert.ok(hasNode(w, dbNodeId()));
  assert.ok(hasNode(w, cacheNodeId()));
  const ids = w.services.map((s) => s.id);
  assert.equal(ids[0], mainId(), 'main container is first and owns the service id');
  for (const s of w.services) {
    assert.equal(s.status, 'running');
    assert.ok(s.cpu > 0, 'each node carries its own CPU sample');
  }
});

test('a container missing from one or two samples keeps identity, metrics, history and position', async () => {
  const state = freshState();
  const { transport } = makeTransport(state);
  const collector = makeCollector(transport);
  await collector.bootstrap();
  await containerSamples(collector, 1);

  const before = node(collector.world!, dbNodeId());
  const orderBefore = collector.world!.services.map((s) => s.id);
  const histBefore = [...before.cpuHist];
  assert.ok(histBefore.length > 0);

  // Sample 2: the db container is absent from both the list and the stats snapshot (restart).
  state.containers[APP] = [running(WEB), running(CACHE)];
  state.stats = statsFor([WEB, CACHE]);
  await containerSamples(collector, 1);

  let w = collector.world!;
  assert.ok(hasNode(w, dbNodeId()), 'db node survives the first missing sample');
  assert.deepEqual(w.services.map((s) => s.id), orderBefore, 'node order is unchanged');
  const idle = node(w, dbNodeId());
  assert.equal(idle.status, 'idle', 'an absent node is shown as idle');
  assert.deepEqual(idle.cpuHist, histBefore, 'CPU history is retained');
  assert.equal(idle.cpu, before.cpu, 'last metric value is retained');
  assert.ok(idle.description?.includes('reconnecting'));

  // Sample 3: still missing — one more miss is still within the grace window.
  await containerSamples(collector, 1);
  w = collector.world!;
  assert.ok(hasNode(w, dbNodeId()), 'db node survives a second missing sample');
  assert.equal(node(w, dbNodeId()).status, 'idle');

  // Sample 4: it comes back (possibly under a new Swarm task name — same normalized key).
  state.containers[APP] = allThree();
  state.stats = statsFor([WEB, DB, CACHE]);
  await containerSamples(collector, 1);
  w = collector.world!;
  assert.ok(hasNode(w, dbNodeId()));
  assert.deepEqual(w.services.map((s) => s.id), orderBefore, 'it returns to its original position');
  assert.equal(node(w, dbNodeId()).status, 'running');
});

test('a container absent for longer than the grace period is really removed', async () => {
  const state = freshState();
  const { transport } = makeTransport(state);
  const collector = makeCollector(transport);
  await collector.bootstrap();
  await containerSamples(collector, 1);
  assert.ok(hasNode(collector.world!, dbNodeId()));

  // db never comes back. Grace = 2 missed samples; the 3rd consecutive miss evicts it.
  state.containers[APP] = [running(WEB), running(CACHE)];
  state.stats = statsFor([WEB, CACHE]);
  await containerSamples(collector, 2); // misses 1 and 2: still present
  assert.ok(hasNode(collector.world!, dbNodeId()));
  await containerSamples(collector, 1); // miss 3: evicted
  assert.equal(hasNode(collector.world!, dbNodeId()), false);

  // The removal is published in a patch, not just silently dropped.
  const removed = patches.flatMap((p) => p.removed?.services ?? []);
  assert.ok(removed.includes(dbNodeId()));
});

test('stats missing a container while the list still has it: node stays present with old metrics', async () => {
  const state = freshState();
  const { transport } = makeTransport(state);
  const collector = makeCollector(transport);
  await collector.bootstrap();
  await containerSamples(collector, 1);
  const before = node(collector.world!, dbNodeId());

  // List is complete, but this `docker stats` response simply omits db.
  state.stats = statsFor([WEB, CACHE]);
  await containerSamples(collector, 1);
  const w = collector.world!;
  const db = node(w, dbNodeId());
  assert.equal(db.status, 'running', 'still listed, so its container state stands');
  assert.equal(db.cpu, before.cpu, 'missing stats do not zero the metric');
  assert.deepEqual(db.cpuHist, before.cpuHist);
});

test('main container absence does not detach deploys and alerts from the service', async () => {
  const state = freshState();
  const { transport } = makeTransport(state);
  const collector = makeCollector(transport);
  await collector.bootstrap();
  await containerSamples(collector, 1);

  // A deploy starts, then the main (web) container drops out of the listing for a while.
  state.deploys = [
    {
      deploymentId: DEPLOY,
      composeId: SERVICE,
      status: 'running',
      title: 'Deploying stack',
      createdAt: new Date(1000).toISOString(),
    },
  ];
  state.containers[APP] = [running(DB), running(CACHE)];
  state.stats = statsFor([DB, CACHE]);
  await containerSamples(collector, 1);

  const w = collector.world!;
  const main = node(w, mainId());
  assert.equal(main.status, 'idle', 'absent main node goes idle, not away');
  // The deployment is still attached to the service id, which still exists as a node.
  const dep = w.deployments.find((d) => d.id === DEPLOY);
  assert.ok(dep);
  assert.equal(dep!.serviceId, SERVICE);
  assert.ok(hasNode(w, SERVICE), 'the service id node survives an empty main-container slot');
  // No node-error alert is raised for an idle (not erroring) service.
  assert.equal(w.alerts.some((a) => a.serviceId === SERVICE), false);
});

test('an absent node inherits the service error instead of masking it as idle', async () => {
  const state = freshState();
  const { transport } = makeTransport(state);
  const collector = makeCollector(transport);
  await collector.bootstrap();
  await containerSamples(collector, 1);

  state.composeStatus = 'error';
  state.containers[APP] = [running(WEB), running(CACHE)]; // db absent
  state.stats = statsFor([WEB, CACHE]);
  await containerSamples(collector, 1);

  const w = collector.world!;
  assert.equal(node(w, dbNodeId()).status, 'error', 'absent node follows the service-level error');
  assert.equal(node(w, mainId()).status, 'error', 'main node keeps the service error');
  assert.ok(w.alerts.some((a) => a.serviceId === SERVICE && a.title === 'Node in error state'));
});

test('a single-container service stays its service node but goes idle while absent', async () => {
  const state = freshState();
  // Only the main container: no split happens.
  state.containers[APP] = [running(WEB)];
  state.stats = statsFor([WEB]);
  const { transport } = makeTransport(state);
  const collector = makeCollector(transport);
  await collector.bootstrap();
  await containerSamples(collector, 1);
  assert.deepEqual(collector.world!.services.map((s) => s.id), [SERVICE]);
  assert.equal(node(collector.world!, SERVICE).status, 'running');

  // Its only container briefly disappears: the node id (service id) survives, state goes idle.
  state.containers[APP] = [];
  state.stats = {};
  await containerSamples(collector, 1);
  assert.ok(hasNode(collector.world!, SERVICE));
  assert.equal(node(collector.world!, SERVICE).status, 'idle');

  // And comes back without any node being removed/recreated.
  state.containers[APP] = [running(WEB)];
  state.stats = statsFor([WEB]);
  await containerSamples(collector, 1);
  assert.equal(node(collector.world!, SERVICE).status, 'running');
});

test('Swarm task renames (stripped task id) do not create a new node', async () => {
  const state = freshState();
  const { transport } = makeTransport(state);
  const collector = makeCollector(transport);
  await collector.bootstrap();
  await containerSamples(collector, 1);
  const swarmKey = `${APP}.1`;
  const swarmNode = `${SERVICE}::${swarmKey}`;

  // Replace the fixed-name containers with a Swarm task whose name carries a task id.
  state.containers[APP] = [{ name: `${APP}.1.rkzp2vw1q7ab`, state: 'running', status: 'Up' }];
  state.stats = { [`${APP}.1.rkzp2vw1q7ab`]: rawStat(`${APP}.1.rkzp2vw1q7ab`, 0.3, 2000) };
  await containerSamples(collector, 1);
  assert.ok(hasNode(collector.world!, swarmNode));
  const firstTaskNode = node(collector.world!, swarmNode);

  // A new task id after a redeploy: the normalized key (and node id) is identical.
  state.containers[APP] = [{ name: `${APP}.1.zzzzzzzzzzzz`, state: 'running', status: 'Up' }];
  state.stats = { [`${APP}.1.zzzzzzzzzzzz`]: rawStat(`${APP}.1.zzzzzzzzzzzz`, 0.4, 3000) };
  await containerSamples(collector, 1);
  assert.ok(hasNode(collector.world!, swarmNode));
  const hist = node(collector.world!, swarmNode).cpuHist;
  // The old task's sample (0.3) is still at the head: the history survived the task rename,
  // and the new task's 0.4 samples continue the same series instead of starting a new node.
  assert.equal(hist[0], firstTaskNode.cpuHist[0]);
  assert.ok(hist.length > firstTaskNode.cpuHist.length, 'the series keeps growing on the same node');
  assert.ok(hist.includes(0.4));
});
