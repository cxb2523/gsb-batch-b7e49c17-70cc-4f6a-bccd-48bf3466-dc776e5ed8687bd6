/**
 * Turns a WorldPatch into human-readable activity-feed events.
 *
 * Pure (no React, no timers): the store owns the feed and hands the previous state in, so the
 * rules are unit-testable offline.
 *
 * The important identity rule: per-container nodes (`<serviceId>::<key>`) are created when a
 * container is first seen and are kept across short sampling gaps (see presence.ts), so a
 * container node that drops out and comes back must never announce itself as a "New node".
 * Only a genuinely new *service* (an id without the container separator) produces that event;
 * status changes of either kind are still reported as usual.
 */
import { isContainerNodeId } from './dokploy/presence';
import { duration } from '../format';
import type { ActivityEvent, EventKind, Tone } from '../store-activity-types';
import type {
  Alert,
  Deployment,
  Environment,
  Project,
  Server,
  Service,
  WorldPatch,
} from './types';

export interface EventContext {
  /** Records keyed by id, as the store keeps them. */
  prev: {
    services: Record<string, Service>;
    deployments: Record<string, Deployment>;
    projects: Record<string, Project>;
    environments: Record<string, Environment>;
    servers: Record<string, Server>;
    alerts: Record<string, Alert>;
  };
  next: EventContext['prev'];
}

/** Deployments that finished more recently than this and were never seen still get an event. */
export const RECENT_CART_MS = 2 * 60_000;
/** A CPU spike event per node needs at least this gap so a hot node doesn't spam the feed. */
export const CPU_EVENT_COOLDOWN_MS = 60_000;
/** A node is "spiking" once its CPU crosses this fraction of its limit. */
export const CPU_SPIKE = 0.85;

const firstLine = (s?: string) => s?.split('\n')[0];

/**
 * Events implied by one patch. `spikeAt` is the last spike-event timestamp per node id, owned
 * by the caller so cooldowns survive across calls; it is updated in place.
 */
export function diffEvents(
  ctx: EventContext,
  patch: WorldPatch,
  now: number,
  spikeAt: Map<string, number>,
  seq: () => number,
): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const ev = (e: Omit<ActivityEvent, 'id'>): ActivityEvent => ({ ...e, id: `ev-${seq()}` });
  const name = (id: string) => ctx.next.services[id]?.name ?? ctx.prev.services[id]?.name ?? 'node';
  const where = (id: string) => ctx.next.projects[ctx.next.services[id]?.projectId ?? '']?.name;

  for (const d of patch.deployments ?? []) {
    const prev = ctx.prev.deployments[d.id];
    const who = name(d.serviceId);
    const done = d.status === 'success' || d.status === 'failed';
    if (!prev && (d.status === 'queued' || d.status === 'running')) {
      out.push(ev({ kind: 'deploy-start', at: now, tone: 'info', text: `${who} deploy started`, detail: firstLine(d.commit?.message) ?? where(d.serviceId), serviceId: d.serviceId }));
    } else if (done && (prev ? prev.status !== d.status : now - (d.finishedAt ?? d.createdAt) < RECENT_CART_MS)) {
      // Also reports deploys we only ever saw finished (they were faster than a poll).
      const took = d.finishedAt && (d.startedAt ?? d.createdAt) ? duration(d.finishedAt - (d.startedAt ?? d.createdAt)) : undefined;
      out.push(
        d.status === 'success'
          ? ev({ kind: 'deploy-ok', at: now, tone: 'ok', text: `${who} deployed`, detail: took ? `in ${took}` : undefined, serviceId: d.serviceId })
          : ev({ kind: 'deploy-fail', at: now, tone: 'crit', text: `${who} deploy failed`, detail: d.log.at(-1), serviceId: d.serviceId }),
      );
    }
  }

  for (const svc of patch.services ?? []) {
    const prev = ctx.prev.services[svc.id];
    if (!prev) {
      // Container nodes (`<service>::<container>`) appear once stats arrive and are retained
      // through sampling gaps: their (re)appearance is never news. Only a new service is.
      if (!isContainerNodeId(svc.id)) {
        out.push(ev({ kind: 'new-node', at: now, tone: 'info', text: `New node ${svc.name}`, detail: where(svc.id), serviceId: svc.id }));
      }
      continue;
    }
    if (prev.status !== svc.status) {
      const t: { kind: EventKind; tone: Tone; text: string } | null =
        svc.status === 'error'
          ? { kind: 'down', tone: 'crit', text: `${svc.name} is down` }
          : prev.status === 'error' && svc.status === 'running'
            ? { kind: 'up', tone: 'ok', text: `${svc.name} recovered` }
            : svc.status === 'idle'
              ? { kind: 'stopped', tone: 'muted', text: `${svc.name} stopped` }
              : prev.status === 'idle' && svc.status === 'running'
                ? { kind: 'started', tone: 'ok', text: `${svc.name} started` }
                : null;
      if (t) out.push(ev({ at: now, ...t, detail: where(svc.id), serviceId: svc.id }));
    }
    // CPU spikes: once per crossing, at most once a minute per node.
    if (svc.cpu >= CPU_SPIKE && prev.cpu < CPU_SPIKE && now - (spikeAt.get(svc.id) ?? 0) > CPU_EVENT_COOLDOWN_MS) {
      spikeAt.set(svc.id, now);
      out.push(ev({ kind: 'cpu', at: now, tone: 'warn', text: `${svc.name} CPU ${Math.round(svc.cpu * 100)}%`, detail: where(svc.id), serviceId: svc.id }));
    }
  }
  return out;
}

/** Start the feed with recent history so it isn't empty on load. */
export function seedEvents(
  services: Record<string, Service>,
  deployments: Record<string, Deployment>,
  seq: () => number,
): ActivityEvent[] {
  return Object.values(deployments)
    .filter((d) => d.status !== 'queued' && d.status !== 'running')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12)
    .map((d) => {
      const who = services[d.serviceId]?.name ?? 'node';
      const at = d.finishedAt ?? d.createdAt;
      const ev = (e: Omit<ActivityEvent, 'id'>): ActivityEvent => ({ ...e, id: `ev-${seq()}` });
      return d.status === 'success'
        ? ev({ kind: 'deploy-ok', at, tone: 'ok', text: `${who} deployed`, detail: firstLine(d.commit?.message), serviceId: d.serviceId })
        : ev({ kind: 'deploy-fail', at, tone: 'crit', text: `${who} deploy failed`, detail: d.log.at(-1) ?? firstLine(d.commit?.message), serviceId: d.serviceId });
    });
}
