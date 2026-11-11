import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import type { FieldBinding } from '../editor/schemas';
import { key } from '../history/fetch';
import { PERIOD_MS, groupHistory, groupStatistics, statisticsQueryFor } from '../history/group';
import { HistoryStore } from '../history/store';
import { addUnits, boundaries, startOf } from '../history/timezone';
import type { CalendarUnit, Zone } from '../history/timezone';
import type { Point } from '../history/types';
import { localize } from '../localize';
import type { ChartContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { convertPoints } from '../units';
import { downsample } from './downsample';
import { seriesTransform } from './frame';
import type { ChartSeries, HistoryFrame } from './frame';
import type { PlotScales } from './grid';
import { runPath, runs } from './paths';

/*
 * Compare-period ghosts: the same entities over an earlier span (yesterday, a week ago, a year
 * ago) drawn faintly behind the current lines, moved forward so each earlier moment sits over the
 * same time of day (or week, or year) now. Unlike `period.offset` or the previous / next buttons,
 * which show an earlier span instead, the chart still shows now; the ghosts are an overlay.
 */

/** How the ghosts are coloured: grey, or a faded copy of each series' own colour. */
export const COMPARE_STYLES = ['grey', 'series'] as const;
export type CompareStyle = (typeof COMPARE_STYLES)[number];

/** Offsets the editor offers; any `<n>h`, `<n>d`, `<n>w`, `<n>mo` or `<n>y` can be typed. */
export const COMPARE_PRESETS = ['1d', '7d', '28d', '1y'];
/** At most this many offsets: more would be a smear. */
export const MAX_COMPARE = 4;

const UNITS: Record<string, CalendarUnit> = { h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' };
const OFFSET = /^(\d+)\s*(h|d|w|mo|y)$/;

/** One earlier span: how far back, by the clock or the calendar. */
export interface CompareOffset {
  text: string;
  n: number;
  unit: CalendarUnit;
}

/** An offset as written ("1d", "7d", "1y", "3mo", "12h"), or undefined if unreadable or zero. */
export function parseOffset(raw: unknown): CompareOffset | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  const m = OFFSET.exec(text);
  if (!m || Number(m[1]) <= 0) return undefined;
  return { text, n: Number(m[1]), unit: UNITS[m[2]] };
}

type Raw = CardConfig & { compare?: unknown; compare_style?: unknown };

/** The offsets as a list (one may be written alone). */
function offsetList(raw: CardConfig): unknown[] {
  const c = (raw as Raw).compare;
  return c === undefined ? [] : Array.isArray(c) ? c : [c];
}

/** Throw a readable error for bad compare options. */
export function validateCompare(raw: CardConfig): void {
  const list = offsetList(raw);
  const bad = list.find((o) => parseOffset(o) === undefined);
  if (bad !== undefined) throw new Error(`"compare" has "${String(bad)}": use 1d, 7d, 1y, 3mo or 12h`);
  if (list.length > MAX_COMPARE) throw new Error(`"compare" can have at most ${MAX_COMPARE} offsets`);
  const style = (raw as Raw).compare_style;
  if (style !== undefined && !COMPARE_STYLES.includes(style as CompareStyle)) {
    throw new Error(`"compare_style" must be one of: ${COMPARE_STYLES.join(', ')}`);
  }
}

/** The card's offsets, in order, without repeats. Call after validating. */
export function compareOffsets(raw: CardConfig): CompareOffset[] {
  const seen = new Set<string>();
  return offsetList(raw)
    .map(parseOffset)
    .filter(
      (o): o is CompareOffset => o !== undefined && !seen.has(`${o.n}${o.unit}`) && !!seen.add(`${o.n}${o.unit}`),
    );
}

/** `t` moved back by an offset, keeping the wall-clock time for days and longer. */
export function shiftBack(t: number, offset: CompareOffset, zone: Zone): number {
  return addUnits(offset.unit, t, -offset.n, zone);
}

/** What an offset is called: "Yesterday", "Last week", "Last year", or "3 days earlier". */
export function offsetLabel(offset: CompareOffset, hass?: HomeAssistant): string {
  const { n, unit } = offset;
  if (unit === 'day' && n === 1) return localize(hass, 'period_yesterday');
  if ((unit === 'day' && n === 7) || (unit === 'week' && n === 1)) return localize(hass, 'period_last_week');
  if (unit === 'month' && n === 1) return localize(hass, 'period_last_month');
  if ((unit === 'year' && n === 1) || (unit === 'month' && n === 12)) return localize(hass, 'period_last_year');
  return localize(hass, `compare_${unit}s_earlier`, { n });
}

/* ------------------------------------------------------------------ loading ------------------------------------------------------------------ */

const stores = new WeakMap<HTMLElement, Map<string, HistoryStore>>();

function storeFor(ctx: ChartContext, k: string): HistoryStore {
  let map = stores.get(ctx.host);
  if (!map) {
    map = new Map();
    stores.set(ctx.host, map);
  }
  let store = map.get(k);
  if (!store) {
    store = new HistoryStore(ctx.requestUpdate);
    map.set(k, store);
  }
  return store;
}

/** Pause a card's ghost history when it leaves the page; it is kept for when it comes back. */
export function stopCompare(host: HTMLElement): void {
  for (const store of stores.get(host)?.values() ?? []) store.pause();
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * A function moving an instant of the earlier span forward by `offset` to the same wall-clock time
 * in `zone` (the inverse of `shiftBack`). By the clock (hours) it is one fixed amount. By the
 * calendar it is worked out per day: a day of 24 hours whose counterpart is also 24 hours moves
 * by one amount, found once; where either day has a clock change each instant is moved by its
 * own wall-clock time. A time that never happens on the later day (the clocks went forward)
 * lands on the moment they jumped; one that happens twice lands on the first.
 */
export function forwardMapper(offset: CompareOffset, zone: Zone): (t: number) => number {
  if (offset.unit === 'hour') return (t) => t + offset.n * HOUR;
  const exact = (t: number) => addUnits(offset.unit, t, offset.n, zone) + (((t % 1000) + 1000) % 1000);
  // The day of the earlier span last asked about, and the one amount its instants move by (null:
  // each on its own). Points come in time order, so the day is nearly always the last one.
  let lo = Infinity;
  let hi = -Infinity;
  let delta: number | null = null;
  return (t) => {
    if (t < lo || t >= hi) {
      lo = startOf('day', t, zone);
      hi = addUnits('day', lo, 1, zone);
      const later = addUnits(offset.unit, lo, offset.n, zone);
      const laterEnd = addUnits('day', later, 1, zone);
      // Both days 24 hours long: no clock change on either, so every instant moves alike.
      delta = hi - lo === DAY && laterEnd - later === DAY ? later - lo : null;
    }
    return delta === null ? exact(t) : t + delta;
  };
}

/**
 * Move an earlier span's points forward over the current one, each to the same wall-clock time
 * (see `forwardMapper`); grouped points move their ends too. A point landing on or before the
 * one drawn before it is left out, so the line never runs backwards: the second run of the hour
 * that happens twice when the clocks go back, and the hour the clocks skip folded onto one moment.
 */
export function shiftForward(points: readonly Point[], offset: CompareOffset, zone: Zone): Point[] {
  const move = forwardMapper(offset, zone);
  const out: Point[] = [];
  let last = -Infinity;
  for (const p of points) {
    const t = move(p.t);
    if (t <= last) continue;
    last = t;
    out.push({ ...p, t, ...(p.end !== undefined ? { end: Math.max(t, move(p.end)) } : {}) });
  }
  return out;
}

/** One ghost: a series' readings over an earlier span, moved over the current one. */
export interface Ghost extends ChartSeries {
  /** Which offset (0 is the first listed), for its dash pattern. */
  ghost: number;
  offset: CompareOffset;
}

/**
 * The card's ghosts for a history frame: each offset's span loaded (once, then kept; a past span
 * reloads only when the chart's own span has moved on), grouped as the frame is, and moved
 * forward over the frame's range. Empty while loading or after a failure: the chart draws without
 * them rather than not at all.
 */
export function compareGhosts(ctx: ChartContext, frame: HistoryFrame, now = Date.now()): Ghost[] {
  const offsets = compareOffsets(ctx.raw);
  if (offsets.length === 0) return [];
  const style = ((ctx.raw as Raw).compare_style as CompareStyle | undefined) ?? 'grey';
  const requests = ctx.items.map((e) => ({ entity: e.entityId, attribute: e.config.attribute }));
  const { group, zone, source } = frame;
  const ghosts: Ghost[] = [];
  offsets.forEach((offset, o) => {
    const start = shiftBack(frame.range.start, offset, zone);
    const end = shiftBack(frame.range.end, offset, zone);
    // Readings stop at the present, which a short offset's span may reach.
    const until = Math.min(end, now);
    if (start >= now) return;
    const statistics =
      group && source === 'statistics' ? statisticsQueryFor(group, zone, ctx.hass.config?.time_zone) : undefined;
    const load = statistics ? { start: start - PERIOD_MS[statistics.period], end } : { start, end };
    const loaded = storeFor(ctx, offset.text).get(ctx.hass, requests, load, source, { live: false, statistics });
    if (loaded.status !== 'ready') return;
    const bounds = group ? boundaries(group.unit, start, end, zone) : [];
    // `s.index` is the series' place among the card's entities; the frame may leave some out
    // (names that toggle series hide them), so its position in `frame.series` is not.
    frame.series.forEach((s) => {
      // As the series itself: in the shown unit, then its transform (a running total starts at
      // the earlier span's own start). The entity as configured, not the series' transformed copy.
      const item = ctx.items[s.index];
      let points = convertPoints(loaded.data.get(key(requests[s.index])) ?? [], item.conversion);
      points = seriesTransform(item, points, { start, end }, until, zone, ctx.hass).points;
      const last = points[points.length - 1];
      if (group) {
        points =
          source === 'statistics'
            ? groupStatistics(points, bounds, group.aggregate, until)
            : groupHistory(points, bounds, group.aggregate, until);
      } else if (source === 'history' && last && last.v !== null && last.t < until) {
        points = [...points, { t: until, v: last.v }];
      }
      if (!points.some((p) => p.v !== null)) return;
      const label = offsetLabel(offset, ctx.hass);
      ghosts.push({
        ...s,
        points: shiftForward(points, offset, zone),
        color: style === 'grey' ? 'var(--secondary-text-color)' : s.color,
        entity: {
          ...s.entity,
          name:
            frame.series.length > 1
              ? localize(ctx.hass, 'compare_series', { name: s.entity.name, offset: label })
              : label,
        },
        dash: o > 0,
        ghost: o,
        offset,
      });
    });
  });
  return ghosts;
}

/* ---------------------------------------------------------------- drawing ---------------------------------------------------------------- */

/** Dash patterns, one per offset: solid, dashed, dotted, dash-dot. */
const DASHES = ['', '6 4', '1.5 3.5', '8 3 1.5 3'];

/** The ghost lines, faint and thin, for the plot's SVG behind the current lines. */
export function ghostLines(ghosts: readonly Ghost[], scales: PlotScales): SVGTemplateResult | typeof nothing {
  if (ghosts.length === 0) return nothing;
  return svg`<g class="compare-ghosts">${ghosts.map((g) => {
    const d = runs(downsample(g.points, 500))
      .map((run) =>
        runPath(
          run.map((p) => [scales.x(p.t), scales.y(p.v as number)]),
          g.curve,
        ),
      )
      .join('');
    return svg`<path
      class="ghost-line"
      data-series=${g.index}
      data-offset=${g.offset.text}
      d=${d}
      fill="none"
      stroke=${g.color}
      stroke-dasharray=${DASHES[g.ghost % DASHES.length] || nothing}
    ></path>`;
  })}</g>`;
}

/** A key naming each offset beside a sample of its line, for the header. */
export function compareKey(ctx: ChartContext, ghosts: readonly Ghost[]): TemplateResult | typeof nothing {
  if (ghosts.length === 0) return nothing;
  const style = ((ctx.raw as Raw).compare_style as CompareStyle | undefined) ?? 'grey';
  const seen = new Set<number>();
  const offsets = ghosts.filter((g) => !seen.has(g.ghost) && !!seen.add(g.ghost));
  return html`<div class="compare-key">
    ${offsets.map(
      (g) =>
        html`<span class="compare-item"
          ><svg viewBox="0 0 18 6" aria-hidden="true">
            <line
              x1="1"
              x2="17"
              y1="3"
              y2="3"
              stroke=${style === 'grey' ? 'var(--secondary-text-color)' : 'currentColor'}
              stroke-dasharray=${DASHES[g.ghost % DASHES.length] || nothing}
            ></line></svg
          >${offsetLabel(g.offset, ctx.hass)}</span
        >`,
    )}
  </div>`;
}

export const compareStyles = css`
  .plot .ghost-line {
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0.55;
  }
  .compare-key {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    padding: 0 0 6px;
    font-size: 0.75em;
    color: var(--secondary-text-color);
  }
  .compare-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .compare-item svg {
    width: 18px;
    height: 6px;
    overflow: visible;
  }
  .compare-item line {
    stroke-width: 1.5;
    stroke-linecap: round;
    opacity: 0.8;
  }
`;

/* ---------------------------------------------------------------- editor ---------------------------------------------------------------- */

export const COMPARE_FIELDS: FieldBinding[] = [
  { name: 'compare', path: ['compare'], default: [] },
  { name: 'compare_style', path: ['compare_style'], default: 'grey' },
];

/** Part of the Chart section's cache key: whether any offset is set. */
export const compareVariant = (config: CardConfig | undefined) =>
  config && offsetList(config).length > 0 ? 'compare' : '';

/** The offsets to draw, then their colouring once there are any (cache under `compareVariant`). */
export function compareSchema(hass: HomeAssistant | undefined, config: CardConfig | undefined) {
  const label = (text: string) => offsetLabel(parseOffset(text)!, hass);
  return [
    {
      name: 'compare',
      selector: {
        select: {
          multiple: true,
          custom_value: true,
          mode: 'dropdown',
          options: COMPARE_PRESETS.map((value) => ({ value, label: label(value) })),
        },
      },
    },
    ...(compareVariant(config)
      ? [
          {
            name: 'compare_style',
            selector: {
              select: {
                mode: 'dropdown',
                options: COMPARE_STYLES.map((value) => ({
                  value,
                  label: localize(hass, `editor_compare_style_${value}`),
                })),
              },
            },
          },
        ]
      : []),
  ];
}
