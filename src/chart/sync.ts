import type { HistoryFrame } from './frame';
import { setSteps, stepsFor } from '../history/period';
import type { ChartContext } from '../styles/index';
import type { CardConfig } from '../types';

/**
 * Synced charts: cards with the same `sync` group name share what the pointer is over, and
 * previous / next steps between charts covering the same kind of period. They talk over one
 * window event, so cards anywhere on the dashboard (in stacks, grids, other columns) find each
 * other without knowing about one another.
 */
export const SYNC_EVENT = 'chartdeck-sync';

/** What one chart tells the others in its group. */
export type SyncMessage =
  /** The time under the pointer, or undefined once it has left. */
  | { type: 'hover'; t: number | undefined }
  /** Steps back from the period, for charts with the same period. */
  | { type: 'period'; period: string; steps: number }
  /** A zoom window over the span (fractions), for charts that zoom; same period only. */
  | { type: 'zoom'; period: string; from: number; to: number };

export interface SyncDetail {
  group: string;
  source: HTMLElement;
  message: SyncMessage;
}

export function validateSyncOptions(raw: CardConfig): void {
  if (raw.sync !== undefined && (typeof raw.sync !== 'string' || raw.sync.trim() === '')) {
    throw new Error('"sync" must be a group name');
  }
}

/** The card's sync group, if it has one. */
export function syncGroup(raw: CardConfig): string | undefined {
  return typeof raw.sync === 'string' && raw.sync.trim() !== '' ? raw.sync.trim() : undefined;
}

interface SyncState {
  group: string;
  listener: (ev: Event) => void;
  /** The last hover time this card sent, so it sends only changes. */
  sent?: number;
  /** The time another chart's pointer is over. */
  remote?: number;
  /** The period and steps this card last drew, to notice its own buttons being used. */
  period?: string;
  steps?: number;
  /** Handlers for message kinds features add (zoom). */
  handlers: Map<SyncMessage['type'], (m: SyncMessage) => void>;
  ctx: ChartContext;
}

const states = new WeakMap<HTMLElement, SyncState>();

/** Send a message to the other charts in the card's group. */
export function syncSend(host: HTMLElement, message: SyncMessage): void {
  const s = states.get(host);
  if (!s) return;
  window.dispatchEvent(new CustomEvent<SyncDetail>(SYNC_EVENT, { detail: { group: s.group, source: host, message } }));
}

/** Stop listening (the card leaves the page, or its group is cleared). */
export function stopSync(host: HTMLElement): void {
  const s = states.get(host);
  if (s) window.removeEventListener(SYNC_EVENT, s.listener);
  states.delete(host);
}

const periodKey = (frame: Pick<HistoryFrame, 'period'>) => JSON.stringify(frame.period);

/**
 * Join (or keep up) the card's group for this draw. Call it from `render` with the frame being
 * drawn and the time the card's own pointer is over: it tells the group when that changes, or
 * when the card's previous / next buttons stepped, and returns the time another chart's pointer
 * is over, for the card to show its guide there.
 */
export function syncChart(ctx: ChartContext, frame: HistoryFrame, hover: number | undefined): number | undefined {
  const group = syncGroup(ctx.raw);
  let s = states.get(ctx.host);
  if (!group) {
    if (s) stopSync(ctx.host);
    return undefined;
  }
  if (!s || s.group !== group) {
    if (s) stopSync(ctx.host);
    const state: SyncState = { group, handlers: new Map(), ctx, listener: () => undefined };
    state.listener = (ev: Event) => receive(state, (ev as CustomEvent<SyncDetail>).detail);
    window.addEventListener(SYNC_EVENT, state.listener);
    states.set(ctx.host, state);
    s = state;
  }
  s.ctx = ctx;
  if (hover !== s.sent) {
    s.sent = hover;
    syncSend(ctx.host, { type: 'hover', t: hover });
  }
  const period = periodKey(frame);
  const steps = frame.period.navigate ? stepsFor(ctx.host, frame.period) : 0;
  if (s.period === period && s.steps !== steps) syncSend(ctx.host, { type: 'period', period, steps });
  s.period = period;
  s.steps = steps;
  // The other chart's pointer, while this one's own isn't on the chart.
  return hover === undefined ? s.remote : undefined;
}

/** Let a feature (zoom) act on its kind of message from the group. */
export function onSync(host: HTMLElement, type: SyncMessage['type'], handler: (m: SyncMessage) => void): void {
  states.get(host)?.handlers.set(type, handler);
}

function receive(s: SyncState, detail: SyncDetail | undefined): void {
  if (!detail || detail.group !== s.group || detail.source === s.ctx.host) return;
  const m = detail.message;
  if (m.type === 'hover') {
    if (m.t === s.remote) return;
    s.remote = m.t;
    s.ctx.requestUpdate();
  } else if (m.type === 'period') {
    const frame = { period: JSON.parse(m.period) as HistoryFrame['period'] };
    // Only a chart covering the same kind of period, with its own buttons, follows the steps.
    if (m.period !== s.period || !frame.period.navigate || stepsFor(s.ctx.host, frame.period) === m.steps) return;
    setSteps(s.ctx.host, frame.period, m.steps);
    // Taken from the group, not this card's buttons: nothing to pass on.
    s.steps = m.steps;
    s.ctx.requestUpdate();
  }
  s.handlers.get(m.type)?.(m);
}
