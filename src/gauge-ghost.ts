import { css, nothing, svg } from 'lit';
import type { SVGTemplateResult } from 'lit';
import { formatNumber, withUnit } from './format';
import type { GhostSpan } from './gauge';
import { polar, arcPath } from './geometry';
import { loadHistory, loadStatistics } from './history/fetch';
import type { Point, Range } from './history/types';
import { localize } from './localize';
import type { HomeAssistant } from './types';

/*
 * The history ghost on the needle, arc and ring gauges: a faint band from the lowest to the
 * highest reading of the last 24 hours (or 7 days) and a tick at its mean, so a glance tells
 * whether now is usual. The last 24 hours come from the recorder's history (every change, mean
 * weighted by how long each reading held). Seven days come from the hourly long-term statistics
 * (lowest of the hourly lows, highest of the highs, mean of the means), which is far less to
 * load; a sensor without statistics (no state_class) falls back to its history.
 *
 * What is loaded is kept per entity and span for every card on the page, and loaded again once
 * it is older than a few minutes (an hour for 7 days), on the next draw. A gauge draws whenever
 * its entity changes, so the ghost keeps up without a timer of its own.
 */

/** Milliseconds each ghost span covers. */
export const GHOST_MS: Record<Exclude<GhostSpan, 'off'>, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};

/** How old a loaded ghost may get before the next draw loads it again. */
const REFRESH_MS: Record<Exclude<GhostSpan, 'off'>, number> = {
  '24h': 5 * 60_000,
  '7d': 3_600_000,
};

export interface Ghost {
  min: number;
  max: number;
  mean: number;
}

/**
 * Lowest, highest and time-weighted mean of history readings over a range. Each reading holds
 * until the next one (the last until the range ends); gaps (`v: null`) count for nothing. Null
 * when there is no reading at all.
 */
export function historyGhost(points: Point[], range: Range): Ghost | null {
  let min = Infinity;
  let max = -Infinity;
  let area = 0;
  let time = 0;
  let sum = 0;
  let count = 0;
  points.forEach((p, i) => {
    if (p.v === null) return;
    min = Math.min(min, p.v);
    max = Math.max(max, p.v);
    sum += p.v;
    count++;
    const from = Math.max(p.t, range.start);
    const to = Math.min(i + 1 < points.length ? points[i + 1].t : range.end, range.end);
    if (to > from) {
      area += p.v * (to - from);
      time += to - from;
    }
  });
  if (count === 0) return null;
  // Every reading at the very end of the range (no time held): a plain mean.
  return { min, max, mean: time > 0 ? area / time : sum / count };
}

/** Lowest low, highest high and mean of the means of statistics rows; null without a mean. */
export function statisticsGhost(points: Point[]): Ghost | null {
  const rows = points.filter((p) => p.v !== null);
  if (!rows.length) return null;
  const lows = rows.map((p) => p.min ?? p.v!).filter((v): v is number => v !== null);
  const highs = rows.map((p) => p.max ?? p.v!).filter((v): v is number => v !== null);
  return {
    min: Math.min(...lows),
    max: Math.max(...highs),
    mean: rows.reduce((a, p) => a + p.v!, 0) / rows.length,
  };
}

/** Load one entity's ghost for a span ending now. */
export async function loadGhost(
  hass: HomeAssistant,
  entity: string,
  attribute: string | undefined,
  span: Exclude<GhostSpan, 'off'>,
  now = Date.now(),
): Promise<Ghost | null> {
  const range = { start: now - GHOST_MS[span], end: now };
  const series = [{ entity, attribute }];
  if (span === '7d' && !attribute) {
    const data = await loadStatistics(hass, series, range, {
      period: 'hour',
      types: ['mean', 'min', 'max'],
      value: 'mean',
    });
    const ghost = statisticsGhost(data.get(entity) ?? []);
    if (ghost) return ghost;
  }
  const data = await loadHistory(hass, series, range);
  const key = attribute ? `${entity}|${attribute}` : entity;
  return historyGhost(data.get(key) ?? [], range);
}

interface Entry {
  ghost: Ghost | null;
  /** When it was loaded (or asked for, while loading). */
  at: number;
  loading: boolean;
  /** Redraws waiting for it to arrive. */
  waiting: Set<() => void>;
}

const cache = new Map<string, Entry>();

/** Forget every loaded ghost (tests). */
export function clearGhosts(): void {
  cache.clear();
}

/**
 * The ghost for an entity as loaded so far, asking for it (or for a fresh copy) when it is
 * missing or stale; `redraw` is called once it arrives. Null until then, and when the recorder
 * has nothing or the call fails.
 */
export function ghostFor(
  hass: HomeAssistant,
  entity: string,
  attribute: string | undefined,
  span: GhostSpan | undefined,
  redraw: (() => void) | undefined,
  now = Date.now(),
): Ghost | null {
  if (!span || span === 'off' || !hass.callWS || !hass.states[entity]) return null;
  const key = `${entity}|${attribute ?? ''}|${span}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = { ghost: null, at: -Infinity, loading: false, waiting: new Set() };
    cache.set(key, entry);
  }
  if (!entry.loading && now - entry.at > REFRESH_MS[span]) {
    const current = entry;
    current.loading = true;
    current.at = now;
    const done = (ghost: Ghost | null) => {
      current.ghost = ghost;
      current.loading = false;
      const waiting = [...current.waiting];
      current.waiting.clear();
      for (const fn of waiting) fn();
    };
    loadGhost(hass, entity, attribute, span, now).then(done, () => done(current.ghost));
  }
  if (entry.loading && redraw) entry.waiting.add(redraw);
  return entry.ghost;
}

/** Where a ghost sits along a gauge from `min` to `max`, each end clamped to 0..1. */
export function ghostPositions(ghost: Ghost, min: number, max: number): { from: number; to: number; mean: number } {
  const range = max - min;
  const at = (v: number) => (range > 0 ? Math.min(1, Math.max(0, (v - min) / range)) : 0);
  return { from: at(ghost.min), to: at(ghost.max), mean: at(ghost.mean) };
}

/** The ghost's hover text: "Last 24 hours: 22 – 68 %, mean 46 %". */
export function ghostTitle(
  ghost: Ghost,
  span: Exclude<GhostSpan, 'off'>,
  decimals: number,
  unit: string,
  hass: HomeAssistant | undefined,
): string {
  const f = (v: number) => withUnit(formatNumber(v, decimals, hass), unit);
  return localize(hass, `ghost_title_${span}`, { min: f(ghost.min), max: f(ghost.max), mean: f(ghost.mean) });
}

export interface GhostGeometry {
  cx: number;
  cy: number;
  /** Radius of the band's centre line. */
  r: number;
  /** Band width. */
  width: number;
  /** The mean tick runs from `tick[0]` to `tick[1]` from the centre. */
  tick: [number, number];
  /** Degrees for a 0..1 position along the gauge. */
  at(t: number): number;
}

/** The ghost band and mean tick for a gauge, or nothing without a ghost. */
export function ghostMarks(
  ghost: Ghost | null,
  e: { min: number; max: number; decimals: number; unit: string },
  span: GhostSpan | undefined,
  g: GhostGeometry,
  hass: HomeAssistant | undefined,
): SVGTemplateResult | typeof nothing {
  if (!ghost || !span || span === 'off') return nothing;
  const pos = ghostPositions(ghost, e.min, e.max);
  let a0 = g.at(pos.from);
  let a1 = g.at(pos.to);
  // A steady reading still shows: at least two degrees of band, centred on it.
  if (a1 - a0 < 2) {
    const mid = (a0 + a1) / 2;
    a0 = mid - 1;
    a1 = mid + 1;
  }
  const m = g.at(pos.mean);
  const [x1, y1] = polar(g.cx, g.cy, g.tick[0], m);
  const [x2, y2] = polar(g.cx, g.cy, g.tick[1], m);
  return svg`<g class="ghost">
    <title>${ghostTitle(ghost, span, e.decimals, e.unit, hass)}</title>
    <path class="ghost-band" d=${arcPath(g.cx, g.cy, g.r, a0, a1)} style="stroke-width: ${g.width}px"></path>
    <line class="ghost-mean" x1=${x1.toFixed(2)} y1=${y1.toFixed(2)} x2=${x2.toFixed(2)} y2=${y2.toFixed(2)}></line>
  </g>`;
}

/** Ghost colours: the text colour, faint for the band and stronger for the mean. */
export const ghostStyles = css`
  .ghost-band {
    fill: none;
    stroke: var(--primary-text-color);
    stroke-opacity: 0.2;
    stroke-linecap: butt;
  }
  .ghost-mean {
    stroke: var(--primary-text-color);
    stroke-opacity: 0.75;
    stroke-width: 2px;
    stroke-linecap: round;
  }
`;
