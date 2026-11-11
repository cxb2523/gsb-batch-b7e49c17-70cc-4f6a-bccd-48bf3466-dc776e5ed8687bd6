import { svg } from 'lit';
import type { SVGTemplateResult } from 'lit';
import { bandFor, baseColor } from '../bands';
import { statisticsPeriod } from '../history/fetch';
import type { StatisticsQuery } from '../history/fetch';
import { PERIOD_MS, statisticsQueryFor } from '../history/group';
import { HistoryStore, trim } from '../history/store';
import type { Point, Range } from '../history/types';
import { resolveBands } from '../resolve';
import type { ChartContext } from '../styles/index';
import type { Band, CardConfig, HomeAssistant, ResolvedBand } from '../types';
import { conversion, convertPoints } from '../units';
import { VIEW_H } from './frame';
import type { HistoryFrame } from './frame';
import type { PlotScales } from './grid';
import { runPath } from './paths';

/**
 * Threshold lines that follow an entity's history. A line annotation whose `value` is an entity
 * normally sits at that entity's current state; with `history: true` it is drawn as a stepped
 * line through every state the entity had over the chart's span (a tariff, a set point, a
 * schedule), with an optional shaded zone above or below it, in the line's colour or, given
 * severity bands of its own, in the colour of each step's band (a tariff's cheap, normal and peak
 * rates in green, amber and red).
 */

/** Which side of a stepped threshold is shaded. */
export const THRESHOLD_ZONES = ['above', 'below'] as const;
export type ThresholdZone = (typeof THRESHOLD_ZONES)[number];

/** The keys a line annotation takes for this, as written in YAML. */
export interface ThresholdHistoryOptions {
  type?: string;
  value?: number | string;
  history?: boolean;
  zone?: ThresholdZone;
  /** Colours the zone by the entity's value at each step, as severity bands do elsewhere. */
  severity?: Band[];
}

const isEntityId = (v: unknown): v is string => typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v.trim());

/** Throw a readable error for a bad `history` or `zone` on annotation `where`. */
export function checkThresholdHistory(a: Record<string, unknown>, where: (k: string) => string): void {
  if (a.history !== undefined && typeof a.history !== 'boolean') {
    throw new Error(`"${where('history')}" must be true or false`);
  }
  if (a.zone !== undefined && !THRESHOLD_ZONES.includes(a.zone as ThresholdZone)) {
    throw new Error(`"${where('zone')}" must be one of: ${THRESHOLD_ZONES.join(', ')}`);
  }
  if ((a.history === true || a.zone !== undefined) && a.type !== 'line') {
    throw new Error(`"${where('history')}" and "${where('zone')}" are for a line`);
  }
  if (a.severity !== undefined) {
    if (a.type !== 'line') throw new Error(`"${where('severity')}" is for a line`);
    if (!Array.isArray(a.severity)) throw new Error(`"${where('severity')}" must be a list of bands`);
    a.severity.forEach((b: unknown, i: number) => {
      const band = b as Record<string, unknown> | null;
      const from = band?.from;
      const readable =
        (typeof from === 'number' && Number.isFinite(from)) ||
        (typeof from === 'string' && (Number.isFinite(Number(from)) || isEntityId(from)));
      if (!readable || from === '') {
        throw new Error(`"${where(`severity[${i}].from`)}" must be a number or an entity id`);
      }
      if (typeof band?.color !== 'string' || band.color === '') {
        throw new Error(`"${where(`severity[${i}].color`)}" is required`);
      }
    });
  }
}

/**
 * A line's own severity bands, read and sorted (a start may be an entity), or undefined when it
 * has none: its zone is then one colour. Bands whose start can't be read are left out. A start
 * read from an entity converts to `unit` (the chart's shown unit) when the pair is known; typed
 * numbers are already in it.
 */
export function zoneBands(
  a: ThresholdHistoryOptions,
  hass: HomeAssistant | undefined,
  unit?: string,
): ResolvedBand[] | undefined {
  if (!Array.isArray(a.severity) || a.severity.length === 0) return undefined;
  const typed = a.severity.map((b) => ({
    ...b,
    from: typeof b.from === 'string' && Number.isFinite(Number(b.from)) ? Number(b.from) : b.from,
  }));
  const read = resolveBands(typed, hass, unit).filter((b) => Number.isFinite(b.from));
  return read.length ? [...read].sort((x, y) => x.from - y.from) : undefined;
}

/** The entity a line follows through its history, or undefined when it is a fixed line. */
export function historyEntity(a: ThresholdHistoryOptions): string | undefined {
  return a.type === 'line' && a.history === true && isEntityId(a.value) ? a.value.trim() : undefined;
}

/** Every entity the card's threshold lines follow through their history. */
export function thresholdHistoryEntities(raw: CardConfig): string[] {
  const list = Array.isArray(raw.annotations) ? (raw.annotations as ThresholdHistoryOptions[]) : [];
  return [...new Set(list.map(historyEntity).filter((id): id is string => id !== undefined))];
}

/** A span longer than this loads statistics even on a card that reads history. */
export const LONG_SPAN = 7 * 86_400_000;

/** Each card's stores: statistics, and history (for a history card, or entities without statistics). */
const stores = new WeakMap<HTMLElement, { statistics: HistoryStore; history: HistoryStore }>();

function storesFor(ctx: ChartContext) {
  let pair = stores.get(ctx.host);
  if (!pair) {
    pair = { statistics: new HistoryStore(ctx.requestUpdate), history: new HistoryStore(ctx.requestUpdate) };
    stores.set(ctx.host, pair);
  }
  return pair;
}

/**
 * Where a threshold's readings come from: long-term statistics when the card reads statistics or
 * the span is longer than `LONG_SPAN` (a year of a chatty entity's raw history is a huge request),
 * otherwise the recorder's history. Statistics rows are as long as the card's own when it groups
 * statistics, else as `statisticsPeriod` picks for the span; the value is each row's mean (a meter's
 * state when it has no mean).
 */
export function thresholdQuery(frame: HistoryFrame, serverTimeZone?: string): StatisticsQuery | undefined {
  const { range, group, source, zone } = frame;
  if (source !== 'statistics' && range.end - range.start <= LONG_SPAN) return undefined;
  const period =
    group && source === 'statistics' ? statisticsQueryFor(group, zone, serverTimeZone).period : statisticsPeriod(range);
  return { period, types: ['mean', 'state'], value: 'mean' };
}

/**
 * The readings of each entity the card's threshold lines follow, over the frame's span, loaded as
 * the card loads its own series (see `thresholdQuery`). An entity with no statistics (a set point
 * or tariff without a state class) falls back to its history, as do all of them when the
 * statistics fail. History is kept up to date from `hass` while the span reaches the present, so
 * a rolling chart never refetches; statistics reload once a period. Each list runs on to the
 * present (or the span's end) with its last value, as a sensor holds its state until it changes.
 * Empty while loading or after a failure: the line then sits at the entity's current state.
 */
export function thresholdSteps(ctx: ChartContext, frame: HistoryFrame, now = Date.now()): Map<string, Point[]> {
  const ids = thresholdHistoryEntities(ctx.raw);
  const out = new Map<string, Point[]>();
  if (ids.length === 0) return out;
  const pair = storesFor(ctx);
  const until = Math.min(frame.range.end, now);
  // Steps share the value axis, so they are drawn in the chart's shown unit (its first series',
  // as `annotationUnit` reads it): an entity reporting a unit the card converts from moves to it.
  const unit = frame.series[0]?.entity.unit || undefined;
  const keep = (id: string, points: Point[]) => {
    const from = ctx.hass.states[id]?.attributes?.unit_of_measurement;
    const shown = convertPoints(points, conversion(typeof from === 'string' ? from : undefined, unit));
    if (shown.some((p) => p.v !== null)) out.set(id, holdTo(shown, until));
  };
  let rest = ids;
  const query = thresholdQuery(frame, ctx.hass.config?.time_zone);
  if (query) {
    // From one row early, so the step at the span's start has a value.
    const load = { start: frame.range.start - PERIOD_MS[query.period], end: frame.range.end };
    const stats = pair.statistics.get(
      ctx.hass,
      ids.map((entity) => ({ entity })),
      load,
      'statistics',
      { live: frame.live, statistics: query },
    );
    if (stats.status === 'loading') return out;
    if (stats.status === 'ready') {
      for (const id of ids) keep(id, trim(stats.data.get(id) ?? [], frame.range));
      rest = ids.filter((id) => !out.has(id));
    }
  }
  if (rest.length === 0) return out;
  const history = pair.history.get(
    ctx.hass,
    rest.map((entity) => ({ entity })),
    frame.range,
    'history',
    { live: frame.live },
  );
  if (history.status === 'ready') for (const id of rest) keep(id, history.data.get(id) ?? []);
  return out;
}

/** Stop a card's threshold history when it leaves the page; it carries on when it returns. */
export function stopThresholdHistory(host: HTMLElement): void {
  const pair = stores.get(host);
  pair?.statistics.pause();
  pair?.history.pause();
}

/** The readings with the last value carried on to `until`, so the step reaches the present. */
export function holdTo(points: Point[], until: number): Point[] {
  const last = points[points.length - 1];
  return last && last.v !== null && last.t < until ? [...points, { t: until, v: last.v }] : points;
}

/**
 * Unbroken runs of a stepped line: each value is held until the next reading, including up to
 * the moment a gap (unavailable, unknown) begins, so the step does not stop short of it.
 */
export function stepRuns(points: Point[]): Point[][] {
  const out: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p.v === null) {
      const last = run[run.length - 1];
      if (last && p.t > last.t) run.push({ t: p.t, v: last.v });
      if (run.length) out.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}

/** Every value the stepped lines reach within `range`, so the value axis can show them all. */
export function stepValues(steps: Map<string, Point[]>, range: Range): number[] {
  const out: number[] = [];
  for (const points of steps.values()) {
    for (const p of points) if (p.v !== null && p.t >= range.start && p.t <= range.end) out.push(p.v);
  }
  return out;
}

export interface SteppedThreshold {
  /** The stepped line, drawn with the threshold's class and colour. */
  line: SVGTemplateResult;
  /** The shaded side, drawn behind the data; undefined without a zone. */
  zone?: SVGTemplateResult;
  /** Where the line ends, as a fraction of the plot's height, for its label. */
  top: number;
}

/**
 * The zone under (or over) a stepped run, one closed shape per stretch of steps that share a
 * colour: each step reaches from its value to `edge` (the plot's top or bottom) for as long as it
 * is held. Without bands the whole run is one colour.
 */
export function zoneShapes(
  run: Point[],
  scales: PlotScales,
  edge: number,
  colorOf: (v: number) => string,
): { color: string; d: string }[] {
  const f = (n: number) => Math.round(n * 100) / 100;
  const out: { color: string; d: string }[] = [];
  for (let i = 0; i + 1 < run.length; i++) {
    const v = run[i].v as number;
    const x0 = f(scales.x(run[i].t));
    const x1 = f(scales.x(run[i + 1].t));
    if (!(x1 > x0)) continue;
    const y = f(scales.y(v));
    const color = colorOf(v);
    const d = `M${x0},${y}H${x1}V${edge}H${x0}Z`;
    const last = out[out.length - 1];
    if (last && last.color === color) last.d += d;
    else out.push({ color, d });
  }
  return out;
}

/**
 * A stepped threshold through `points`, with its zone shaded when one is asked for: in `color`,
 * or with `bands`, each step in the colour of the band its value falls in.
 */
export function steppedThreshold(
  points: Point[],
  scales: PlotScales,
  color: string,
  dashed: boolean,
  zone: ThresholdZone | undefined,
  bands?: ResolvedBand[],
): SteppedThreshold | undefined {
  const parts = stepRuns(points);
  if (parts.length === 0) return undefined;
  const d = parts
    .map((run) =>
      runPath(
        run.map((p) => [scales.x(p.t), scales.y(p.v as number)]),
        'step',
      ),
    )
    .join('');
  const line = svg`<path
    class="threshold stepped ${dashed ? 'dashed' : ''}"
    d=${d}
    fill="none"
    stroke=${color}
  ></path>`;
  const edge = zone === 'above' ? 0 : VIEW_H;
  const colorOf = bands ? (v: number) => baseColor(bandFor(v, bands).color) : () => color;
  const shapes = zone ? parts.flatMap((run) => zoneShapes(run, scales, edge, colorOf)) : [];
  // Shapes of one colour from several runs share a path.
  const merged = new Map<string, string>();
  for (const s of shapes) merged.set(s.color, (merged.get(s.color) ?? '') + s.d);
  const shade = zone
    ? svg`<g class="threshold-zone ${zone} ${bands ? 'banded' : ''}">${[...merged].map(
        ([fill, path]) => svg`<path d=${path} fill=${fill}></path>`,
      )}</g>`
    : undefined;
  const lastRun = parts[parts.length - 1];
  const last = lastRun[lastRun.length - 1];
  return { line, zone: shade, top: scales.y(last.v as number) / VIEW_H };
}
