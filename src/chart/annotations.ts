import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { formatNumber, withUnit } from '../format';
import { toReading } from '../history/fetch';
import { boundaries, wallTime, zonedTime } from '../history/timezone';
import type { Zone } from '../history/timezone';
import type { Range } from '../history/types';
import { localize } from '../localize';
import type { ChartContext } from '../styles/index';
import type { Band, CardConfig, HomeAssistant, ResolvedBand } from '../types';
import { conversion } from '../units';
import { formatDateTime } from './axes';
import { VIEW_H, VIEW_W } from './frame';
import type { ChartSeries, HistoryFrame } from './frame';
import type { PlotScales } from './grid';
import {
  checkThresholdHistory,
  historyEntity,
  stepValues,
  steppedThreshold,
  stopThresholdHistory,
  thresholdSteps,
  zoneBands,
} from './threshold-history';
import type { ThresholdZone } from './threshold-history';

/** What an annotation marks. */
export const ANNOTATION_TYPES = ['line', 'band', 'time', 'state', 'point'] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

/** Which reading a point label goes on. */
export const POINT_AT = ['max', 'min', 'last', 'first'] as const;
export type PointAt = (typeof POINT_AT)[number];

/**
 * One annotation, as written in YAML. Values (`value`, `from`, `to`) are a number or an entity id
 * whose state is the number.
 */
export interface Annotation {
  type: AnnotationType;
  label?: string;
  color?: string;
  /** line: where it is drawn. */
  value?: number | string;
  /** line: dashed (the default) or solid. */
  dash?: boolean;
  /** line: follow the value entity's history as a stepped line, not just its current state. */
  history?: boolean;
  /** line: shade the side above or below the line (see threshold-history.ts). */
  zone?: ThresholdZone;
  /** line with a zone: colour the zone by the line's value at each step, from these bands. */
  severity?: Band[];
  /** band: its bottom and top; either may be left out to run to the chart's edge. */
  from?: number | string;
  to?: number | string;
  /** time: "07:00" (every day) or "2026-10-28 07:00" (once), one or a list. */
  times?: string | string[];
  /** state: the entity whose changes are marked, and the state that counts (any change if absent). */
  entity?: string;
  state?: string;
  /** state: shade the stretches while the entity is in the state, as well as marking each start. */
  shade?: boolean;
  /** point: which reading gets a label. */
  at?: PointAt;
}

/** Default colours, picked to stand apart from the first series colours. */
const DEFAULT_COLOR: Record<AnnotationType, string> = {
  line: 'red',
  band: 'green',
  time: 'grey',
  state: 'amber',
  point: 'primary',
};

/** Above this many marks from one annotation, only the lines are drawn: labels would be a smear. */
const MAX_MARK_LABELS = 60;
/** Rows of mark labels along the top of the plot. */
const MARK_LABEL_ROWS = 2;
/** At most this many state changes are kept per entity. */
const MAX_CHANGES = 2000;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isEntityId = (v: unknown): v is string => typeof v === 'string' && /^[a-z_]+\.[a-z0-9_]+$/.test(v.trim());

/** A value that is a number or an entity id (numeric text counts as a number). */
function checkValue(v: unknown, where: string): void {
  if (v === undefined || isNumber(v) || isEntityId(v)) return;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return;
  throw new Error(`"${where}" must be a number or an entity id`);
}

const DAILY = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Whether a time is one the card can place: "07:00", "2026-10-28 07:00", or a full ISO time. */
export function isTimeText(text: string): boolean {
  const s = text.trim();
  const daily = DAILY.exec(s);
  if (daily) return Number(daily[1]) < 24 && Number(daily[2]) < 60;
  return LOCAL.test(s) || (/\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:?\d{2})$/.test(s) && Number.isFinite(Date.parse(s)));
}

/** The list of times an annotation gives, from a list or comma-separated text. */
export function timeList(times: Annotation['times']): string[] {
  const list = Array.isArray(times) ? times : typeof times === 'string' ? times.split(',') : [];
  return list.map((t) => String(t).trim()).filter((t) => t !== '');
}

/** Throw a readable error for a bad annotation. */
export function validateAnnotations(raw: CardConfig): void {
  const list = raw.annotations;
  if (raw.zones !== undefined && typeof raw.zones !== 'boolean') throw new Error('"zones" must be true or false');
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new Error('"annotations" must be a list');
  list.forEach((item: unknown, i) => {
    const where = (k: string) => `annotations[${i}].${k}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`"annotations[${i}]" must have a "type"`);
    }
    const a = item as Record<string, unknown>;
    if (!ANNOTATION_TYPES.includes(a.type as AnnotationType)) {
      throw new Error(`"${where('type')}" must be one of: ${ANNOTATION_TYPES.join(', ')}`);
    }
    for (const k of ['label', 'color', 'state']) {
      if (a[k] !== undefined && typeof a[k] !== 'string') throw new Error(`"${where(k)}" must be text`);
    }
    for (const k of ['dash', 'shade']) {
      if (a[k] !== undefined && typeof a[k] !== 'boolean') throw new Error(`"${where(k)}" must be true or false`);
    }
    checkValue(a.value, where('value'));
    checkValue(a.from, where('from'));
    checkValue(a.to, where('to'));
    if (a.entity !== undefined && !isEntityId(a.entity)) throw new Error(`"${where('entity')}" must be an entity id`);
    if (a.type === 'line' && a.value === undefined) throw new Error(`"${where('value')}" is needed for a line`);
    if (a.type === 'band' && a.from === undefined && a.to === undefined) {
      throw new Error(`"${where('from')}" or "${where('to')}" is needed for a band`);
    }
    if (a.type === 'time') {
      if (a.times !== undefined && typeof a.times !== 'string' && !Array.isArray(a.times)) {
        throw new Error(`"${where('times')}" must be a time or a list of times`);
      }
      const bad = timeList(a.times as Annotation['times']).find((t) => !isTimeText(t));
      if (bad !== undefined) throw new Error(`"${where('times')}" has "${bad}": use 07:00 or 2026-10-28 07:00`);
    }
    if (a.type === 'state' && a.entity === undefined)
      throw new Error(`"${where('entity')}" is needed for a state mark`);
    checkThresholdHistory(a, where);
    if (a.at !== undefined && !POINT_AT.includes(a.at as PointAt)) {
      throw new Error(`"${where('at')}" must be one of: ${POINT_AT.join(', ')}`);
    }
  });
}

/** The card's annotations; call after `validateAnnotations`. */
export function annotationsOf(raw: CardConfig): Annotation[] {
  return Array.isArray(raw.annotations) ? (raw.annotations as Annotation[]) : [];
}

/** Entities annotations read, so their changes redraw the card. */
export function annotationEntities(raw: CardConfig): string[] {
  const ids = new Set<string>();
  for (const a of annotationsOf(raw)) {
    for (const v of [a.value, a.from, a.to, a.type === 'state' ? a.entity : undefined]) {
      if (isEntityId(v)) ids.add(v.trim());
    }
  }
  return [...ids];
}

/**
 * A number, or an entity's state as one; undefined while it has none (unavailable, missing). An
 * entity's state is converted from its own unit to `unit` (the chart's, from its first series)
 * when the card knows the pair, so a °F input_number marks the right place on a °C chart. A
 * number written in the config is taken to be in the chart's unit already.
 */
export function resolveValue(v: number | string | undefined, hass: HomeAssistant, unit?: string): number | undefined {
  if (v === undefined) return undefined;
  if (isNumber(v)) return v;
  const own = toReading(v);
  if (own !== null) return own;
  const state = hass.states[v.trim()];
  const reading = toReading(state?.state);
  if (reading === null) return undefined;
  const from = state?.attributes?.unit_of_measurement;
  const c = conversion(typeof from === 'string' ? from : undefined, unit);
  return c ? c.apply(reading) : reading;
}

/** The unit an annotation's value is in: the first series' shown unit. */
export function annotationUnit(frame: Pick<HistoryFrame, 'series'>): string | undefined {
  return frame.series[0]?.entity.unit || undefined;
}

/**
 * Values the value axis should reach, so a threshold line is always on show (in `unit`, see
 * `resolveValue`). Given the chart and its frame, a line that follows its entity's history reaches
 * every value it stepped through.
 */
export function annotationValues(
  raw: CardConfig,
  hass: HomeAssistant,
  unit?: string,
  ctx?: ChartContext,
  frame?: HistoryFrame,
): number[] {
  const values = annotationsOf(raw)
    .filter((a) => a.type === 'line')
    .map((a) => resolveValue(a.value, hass, unit))
    .filter(isNumber);
  return ctx && frame ? [...values, ...stepValues(thresholdSteps(ctx, frame), frame.range)] : values;
}

/**
 * The moments a list of times falls on within `range`: each day's "07:00" in the zone, or a
 * single date and time (wall-clock in the zone, or with its own offset).
 */
export function markTimes(times: string[], range: Range, zone: Zone): number[] {
  const out: number[] = [];
  const days = boundaries('day', range.start, range.end, zone, 800);
  for (const text of times) {
    const daily = DAILY.exec(text);
    if (daily) {
      for (const day of days) {
        const w = wallTime(day, zone.timeZone);
        out.push(zonedTime(zone.timeZone, w.year, w.month, w.day, +daily[1], +daily[2], +(daily[3] ?? 0)));
      }
      continue;
    }
    const local = LOCAL.exec(text);
    const t = local
      ? zonedTime(zone.timeZone, +local[1], +local[2], +local[3], +local[4], +local[5], +(local[6] ?? 0))
      : Date.parse(text);
    if (Number.isFinite(t)) out.push(t);
  }
  return [...new Set(out.filter((t) => t >= range.start && t <= range.end))].sort((a, b) => a - b);
}

/** One entity's states over time, oldest first. */
export interface StateChange {
  t: number;
  s: string;
}

/**
 * The stretches an entity spent in `state` (or each change, when no state is given), clipped to
 * `range`. A stretch still going at the end runs to `until`.
 */
export function stateSpans(
  changes: StateChange[],
  state: string | undefined,
  range: Range,
  until: number,
): { start: number; end: number; s: string }[] {
  const out: { start: number; end: number; s: string }[] = [];
  const wanted = state?.trim().toLowerCase();
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (i > 0 && changes[i - 1].s === c.s) continue;
    if (wanted !== undefined && c.s.toLowerCase() !== wanted) continue;
    let j = i + 1;
    while (j < changes.length && changes[j].s === c.s) j++;
    const end = j < changes.length ? changes[j].t : until;
    const start = Math.max(c.t, range.start);
    if (end <= range.start || start > range.end) continue;
    out.push({ start, end: Math.min(end, range.end), s: c.s });
  }
  return out;
}

/** Rough width of a mark label in px (10 px text, with its padding). */
export function labelWidth(text: string): number {
  return Math.ceil(text.length * 5.8) + 10;
}

/**
 * Rows for mark labels so none overlap: each sits right of its line (left of it near the right
 * edge), in the first of `rows` rows with room; a label with no room is left out (its line stays).
 * `items` are in px; the result is a row per item, or undefined for none.
 */
export function placeMarkLabels(
  items: { x: number; width: number }[],
  plotWidth: number,
  rows = MARK_LABEL_ROWS,
): (number | undefined)[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a].x - items[b].x);
  const ends: number[] = Array.from({ length: rows }, () => -Infinity);
  const out: (number | undefined)[] = items.map(() => undefined);
  for (const i of order) {
    const { x, width } = items[i];
    const left = x + 2 + width > plotWidth ? x - 2 - width : x + 2;
    const row = ends.findIndex((end) => left >= end + 4);
    if (row < 0) continue;
    ends[row] = left + width;
    out[i] = row;
  }
  return out;
}

// ---------------------------------------------------------------- state history

interface StateCache {
  shape: string;
  from: number;
  to: number;
  status: 'loading' | 'ready' | 'error';
  data: Map<string, StateChange[]>;
  generation: number;
}

const caches = new WeakMap<HTMLElement, StateCache>();

interface CompressedState {
  s?: string;
  lu?: number;
  lc?: number;
}

/** Forget a card's state history (it leaves the page). */
export function stopAnnotations(host: HTMLElement): void {
  const c = caches.get(host);
  if (c) c.generation++;
  caches.delete(host);
  stopThresholdHistory(host);
}

/**
 * The states of the entities state marks follow, over `range`: loaded once, then kept up to date
 * from `hass` while the range reaches the present. Empty while loading or after a failure: the
 * chart draws without the marks rather than not at all.
 */
export function stateHistory(ctx: ChartContext, range: Range, live: boolean): Map<string, StateChange[]> {
  const ids = [
    ...new Set(
      annotationsOf(ctx.raw)
        .filter((a) => a.type === 'state' && a.entity)
        .map((a) => a.entity!.trim()),
    ),
  ];
  if (ids.length === 0) return new Map();
  const shape = ids.join(',');
  let cache = caches.get(ctx.host);
  const stale =
    !cache ||
    cache.shape !== shape ||
    range.start < cache.from ||
    (!live && range.end > cache.to + 60_000) ||
    (live && cache.to !== Infinity);
  if (stale) {
    const generation = (cache?.generation ?? 0) + 1;
    const next: StateCache = {
      shape,
      from: range.start,
      to: live ? Infinity : range.end,
      status: 'loading',
      data: new Map(),
      generation,
    };
    cache = next;
    caches.set(ctx.host, next);
    const call = ctx.hass.callWS?.<Record<string, CompressedState[]>>({
      type: 'history/history_during_period',
      start_time: new Date(range.start).toISOString(),
      end_time: new Date(range.end).toISOString(),
      entity_ids: ids,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
    if (call) {
      call.then(
        (result) => {
          if (caches.get(ctx.host) !== next || next.generation !== generation) return;
          for (const id of ids) {
            const rows = (result?.[id] ?? [])
              .map((r) => ({ t: Math.round((r.lu ?? r.lc ?? 0) * 1000), s: String(r.s ?? '') }))
              .filter((r) => r.t > 0);
            next.data.set(id, rows.slice(-MAX_CHANGES));
          }
          next.status = 'ready';
          ctx.requestUpdate();
        },
        () => {
          if (caches.get(ctx.host) !== next) return;
          next.status = 'error';
        },
      );
    }
  }
  const c = cache!;
  if (c.status === 'ready' && live) {
    // Keep up with changes since loading, as the history store does for readings.
    for (const id of ids) {
      const state = ctx.hass.states[id];
      if (!state) continue;
      const t = Date.parse(state.last_changed ?? state.last_updated ?? '');
      const rows = c.data.get(id) ?? [];
      const last = rows[rows.length - 1];
      if (Number.isFinite(t) && (!last || (t > last.t && last.s !== state.state))) {
        rows.push({ t, s: state.state });
        c.data.set(id, rows);
      }
    }
  }
  return c.data;
}

// ---------------------------------------------------------------- drawing

export interface AnnotationLayers {
  /** Shaded bands and zones, drawn behind the data. */
  behind: SVGTemplateResult | typeof nothing;
  /** Threshold and time lines, drawn over the data. */
  front: SVGTemplateResult | typeof nothing;
  /** Labels and point marks, in HTML over the plot. */
  overlay: TemplateResult | typeof nothing;
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

function seriesFor(a: Annotation, series: readonly ChartSeries[]): ChartSeries | undefined {
  return (a.entity && series.find((s) => s.entity.entityId === a.entity!.trim())) || series[0];
}

/** The reading a point label sits on. */
export function pointFor(series: ChartSeries, at: PointAt, range: Range, grouped: boolean) {
  // Carried values at the edges aren't readings taken in the span (groups always are).
  const pts = series.points.filter(
    (p) => p.v !== null && (grouped || (!p.carried && (p.t !== range.end || at === 'last'))),
  );
  if (pts.length === 0) return undefined;
  if (at === 'first') return pts[0];
  if (at === 'last') return pts[pts.length - 1];
  return pts.reduce((best, p) => ((at === 'max' ? p.v! > best.v! : p.v! < best.v!) ? p : best));
}

/** Severity bands drawn as faint zones behind the chart, from the first series' bands. */
function zoneRects(bands: ResolvedBand[], scales: PlotScales): SVGTemplateResult[] {
  const [lo, hi] = scales.domain;
  return bands.map((band, i) => {
    const from = Math.max(lo, Number.isFinite(band.from) ? band.from : lo);
    const to = Math.min(hi, i + 1 < bands.length ? bands[i + 1].from : hi);
    if (!(to > from)) return svg``;
    const y1 = scales.y(to);
    const y2 = scales.y(from);
    return svg`<rect class="zone" x="0" width=${VIEW_W} y=${y1} height=${y2 - y1} fill=${baseColor(band.color)}></rect>`;
  });
}

/**
 * Everything the card's annotations draw on a history chart: zones and bands behind, threshold
 * and time lines in front, and their labels and point marks over the plot. `plotWidth` is in px,
 * for spacing time labels.
 */
export function annotationLayers(
  ctx: ChartContext,
  frame: HistoryFrame,
  scales: PlotScales,
  plotWidth: number,
): AnnotationLayers {
  const list = annotationsOf(ctx.raw);
  const zones = ctx.raw.zones === true && frame.series[0] ? zoneRects(frame.series[0].entity.bands, scales) : [];
  if (list.length === 0 && zones.length === 0) return { behind: nothing, front: nothing, overlay: nothing };
  const behind: SVGTemplateResult[] = [...zones];
  const front: SVGTemplateResult[] = [];
  const labels: TemplateResult[] = [];
  const { range } = frame;
  const x = (t: number) => scales.x(t);
  const [lo, hi] = scales.domain;
  const states = stateHistory(ctx, range, frame.live);
  const steps = thresholdSteps(ctx, frame);
  const until = Math.min(range.end, Date.now());
  const unit = annotationUnit(frame);

  const pending: { t: number; label: string; color: string }[] = [];
  const marks = (a: Annotation, color: string, times: number[], kind: string) => {
    const shown = times.slice(0, 2000);
    front.push(
      svg`${shown.map((t) => svg`<line class="mark-line ${kind}" x1=${x(t)} x2=${x(t)} y1="0" y2=${VIEW_H} stroke=${color}></line>`)}`,
    );
    if (a.label && shown.length <= MAX_MARK_LABELS) {
      for (const t of shown) pending.push({ t, label: a.label, color });
    }
  };

  for (const a of list) {
    const color = baseColor(a.color ?? DEFAULT_COLOR[a.type]);
    const stepped = a.type === 'line' ? steps.get(historyEntity(a) ?? '') : undefined;
    const step =
      stepped && steppedThreshold(stepped, scales, color, a.dash !== false, a.zone, zoneBands(a, ctx.hass, unit));
    if (step) {
      // A line through the entity's history: stepped, with its label where it ends.
      if (step.zone) behind.push(step.zone);
      front.push(step.line);
      if (a.label) {
        labels.push(
          html`<span
            class="annotation-label threshold ${step.top < 0.12 ? 'below' : ''}"
            style="top:${pct(step.top)};--cd-annotation:${color}"
            >${a.label}</span
          >`,
        );
      }
    } else if (a.type === 'line') {
      const v = resolveValue(a.value, ctx.hass, unit);
      if (v === undefined || v < lo || v > hi) continue;
      const y = scales.y(v);
      front.push(
        svg`<line class="threshold ${a.dash === false ? '' : 'dashed'}" x1="0" x2=${VIEW_W} y1=${y} y2=${y} stroke=${color}></line>`,
      );
      if (a.label) {
        const top = y / VIEW_H;
        labels.push(
          html`<span
            class="annotation-label threshold ${top < 0.12 ? 'below' : ''}"
            style="top:${pct(top)};--cd-annotation:${color}"
            >${a.label}</span
          >`,
        );
      }
    } else if (a.type === 'band') {
      const from = a.from === undefined ? lo : resolveValue(a.from, ctx.hass, unit);
      const to = a.to === undefined ? hi : resolveValue(a.to, ctx.hass, unit);
      if (from === undefined || to === undefined) continue;
      const bottom = Math.max(lo, Math.min(from, to));
      const top = Math.min(hi, Math.max(from, to));
      if (!(top > bottom)) continue;
      const y1 = scales.y(top);
      behind.push(
        svg`<rect class="band" x="0" width=${VIEW_W} y=${y1} height=${scales.y(bottom) - y1} fill=${color}></rect>`,
      );
      if (a.label) {
        labels.push(
          html`<span class="annotation-label band" style="top:${pct(y1 / VIEW_H)};--cd-annotation:${color}"
            >${a.label}</span
          >`,
        );
      }
    } else if (a.type === 'time') {
      marks(a, color, markTimes(timeList(a.times), range, frame.zone), 'time');
    } else if (a.type === 'state') {
      const spans = stateSpans(states.get(a.entity!.trim()) ?? [], a.state, range, until);
      if (a.shade) {
        behind.push(
          svg`${spans.map((s) => svg`<rect class="state-shade" x=${x(s.start)} width=${Math.max(0, x(s.end) - x(s.start))} y="0" height=${VIEW_H} fill=${color}></rect>`)}`,
        );
      }
      // A stretch already going when the chart starts has no start to mark.
      marks(
        a,
        color,
        spans.map((s) => s.start).filter((t) => t > range.start),
        'state',
      );
    } else if (a.type === 'point') {
      const s = seriesFor(a, frame.series);
      const p = s && pointFor(s, a.at ?? 'max', range, frame.group !== undefined);
      if (!s || !p) continue;
      const left = x(p.t) / VIEW_W;
      const top = scales.y(p.v as number) / VIEW_H;
      if (!(left >= 0 && left <= 1 && top >= 0 && top <= 1)) continue;
      const value = withUnit(formatNumber(p.v as number, s.entity.decimals, ctx.hass), s.entity.unit);
      const edge = left < 0.1 ? 'start' : left > 0.9 ? 'end' : '';
      labels.push(
        html`<span class="annotation-dot" style="left:${pct(left)};top:${pct(top)};background:${color}"></span>
          <span
            class="annotation-label point ${edge} ${top < 0.2 ? 'below' : ''}"
            style="left:${pct(left)};top:${pct(top)};--cd-annotation:${color}"
            >${a.label ? html`<span class="point-name">${a.label}</span> ` : nothing}${value}</span
          >`,
      );
    }
  }
  // Mark labels from every annotation share the top rows, so none lands on another.
  const rows = placeMarkLabels(
    pending.map((m) => ({ x: (x(m.t) / VIEW_W) * plotWidth, width: labelWidth(m.label) })),
    plotWidth,
  );
  pending.forEach((m, i) => {
    const row = rows[i];
    if (row === undefined) return;
    const left = x(m.t) / VIEW_W;
    const flip = left * plotWidth + 2 + labelWidth(m.label) > plotWidth;
    labels.push(
      html`<span
        class="annotation-label mark ${flip ? 'end' : ''}"
        style="left:${pct(left)};top:${row * 15}px;--cd-annotation:${m.color}"
        title=${localize(ctx.hass, 'annotation_at', { label: m.label, time: formatDateTime(m.t, ctx.hass) })}
        >${m.label}</span
      >`,
    );
  });
  return {
    behind: behind.length ? svg`<g class="annotations-behind">${behind}</g>` : nothing,
    front: front.length ? svg`<g class="annotations-front">${front}</g>` : nothing,
    overlay: labels.length ? html`<div class="annotation-labels">${labels}</div>` : nothing,
  };
}

export const annotationStyles = css`
  .plot .zone {
    opacity: 0.1;
  }
  .plot .band {
    opacity: 0.14;
  }
  .plot .state-shade {
    opacity: 0.12;
  }
  .plot .threshold {
    stroke-width: 1.5;
  }
  .plot .threshold.dashed {
    stroke-dasharray: 6 4;
  }
  .plot .threshold.stepped {
    stroke-linejoin: round;
  }
  .plot .threshold-zone {
    opacity: 0.1;
  }
  .plot .mark-line {
    stroke-width: 1;
    stroke-dasharray: 3 3;
    opacity: 0.9;
  }
  .annotation-labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .annotation-label {
    position: absolute;
    font-size: 10px;
    line-height: 1.2;
    padding: 1px 4px;
    border-radius: 3px;
    white-space: nowrap;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: color-mix(in srgb, var(--cd-annotation) 75%, var(--primary-text-color));
    background: color-mix(in srgb, var(--card-background-color, #fff) 82%, transparent);
  }
  .annotation-label.threshold {
    right: 2px;
    transform: translateY(calc(-100% - 1px));
  }
  .annotation-label.threshold.below {
    transform: translateY(1px);
  }
  .annotation-label.band {
    left: 2px;
    transform: translateY(1px);
  }
  .annotation-label.mark {
    transform: translateX(2px);
    max-width: none;
  }
  .annotation-label.mark.end {
    transform: translateX(calc(-100% - 2px));
  }
  .annotation-dot {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 2px solid var(--card-background-color, #fff);
    transform: translate(-50%, -50%);
  }
  .annotation-label.point {
    transform: translate(-50%, calc(-100% - 7px));
    font-weight: 500;
    color: var(--primary-text-color);
    border: 1px solid color-mix(in srgb, var(--cd-annotation) 60%, transparent);
    background: color-mix(in srgb, var(--card-background-color, #fff) 90%, transparent);
  }
  .annotation-label.point .point-name {
    color: var(--secondary-text-color);
    font-weight: 400;
  }
  .annotation-label.point.below {
    transform: translate(-50%, 7px);
  }
  .annotation-label.point.start {
    transform: translate(-6px, calc(-100% - 7px));
  }
  .annotation-label.point.end {
    transform: translate(calc(-100% + 6px), calc(-100% - 7px));
  }
  .annotation-label.point.start.below {
    transform: translate(-6px, 7px);
  }
  .annotation-label.point.end.below {
    transform: translate(calc(-100% + 6px), 7px);
  }
`;
