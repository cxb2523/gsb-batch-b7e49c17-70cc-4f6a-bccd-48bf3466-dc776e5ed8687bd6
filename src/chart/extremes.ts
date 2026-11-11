import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import type { Grouping } from '../history/group';
import type { Point, Range } from '../history/types';
import { languageOf, localize } from '../localize';
import type { ChartContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { formatDateTime, formatTime, timeZoneOf } from './axes';
import { VIEW_H, VIEW_W } from './frame';
import type { ChartSeries } from './frame';
import type { PlotScales } from './grid';

/** How a chart shows each series' average: not at all, a dashed line across, or just the figure. */
export const AVERAGE_MODES = ['none', 'line', 'figure'] as const;
export type AverageMode = (typeof AVERAGE_MODES)[number];

/** Which marks a chart draws. Every key has a default, so none is required in YAML. */
export interface ExtremesOptions {
  min: boolean;
  max: boolean;
  average: AverageMode;
}

export const DEFAULT_EXTREMES: ExtremesOptions = { min: false, max: false, average: 'none' };

type Raw = CardConfig & { extremes?: unknown };

/** Throw a readable error for a bad `extremes` option, on the card or an entity. */
export function validateExtremes(config: CardConfig): void {
  const raw = (config as Raw).extremes;
  if (raw !== undefined) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('"extremes" must have "min", "max" (true or false) and "average"');
    }
    const e = raw as Record<string, unknown>;
    for (const k of ['min', 'max']) {
      if (e[k] !== undefined && typeof e[k] !== 'boolean') throw new Error(`"extremes.${k}" must be true or false`);
    }
    if (e.average !== undefined && !AVERAGE_MODES.includes(e.average as AverageMode)) {
      throw new Error(`"extremes.average" must be one of: ${AVERAGE_MODES.join(', ')}`);
    }
  }
  for (const item of config.entities ?? []) {
    if (typeof item !== 'object') continue;
    const own = (item as { extremes?: unknown }).extremes;
    if (own !== undefined && typeof own !== 'boolean')
      throw new Error(`"extremes" of ${item.entity} must be true or false`);
  }
}

/** The card's marks with defaults filled in. Call after `validateExtremes`. */
export function extremesOptions(config: CardConfig): ExtremesOptions {
  const e = ((config as Raw).extremes ?? {}) as Partial<ExtremesOptions>;
  return {
    min: e.min ?? DEFAULT_EXTREMES.min,
    max: e.max ?? DEFAULT_EXTREMES.max,
    average: e.average ?? DEFAULT_EXTREMES.average,
  };
}

/** Whether the card draws any mark at all. */
export function extremesOn(o: ExtremesOptions): boolean {
  return o.min || o.max || o.average !== 'none';
}

/** Whether one series gets the card's marks: on unless the entity sets `extremes: false`. */
export function seriesHasExtremes(entity: object): boolean {
  return (entity as { extremes?: unknown }).extremes !== false;
}

/* ------------------------------------------------------------------ maths ------------------------------------------------------------------ */

/**
 * The lowest and highest readings taken in the period, as points. Gaps don't count, nor does the
 * reading carried in from before the start (it was taken earlier). On a tie the earliest wins, so
 * the value carried on to the right edge never beats the reading it repeats.
 */
export function extremePoints(points: readonly Point[]): { min?: Point; max?: Point } {
  let min: Point | undefined;
  let max: Point | undefined;
  for (const p of points) {
    if (p.v === null || p.carried) continue;
    if (!min || p.v < (min.v as number)) min = p;
    if (!max || p.v > (max.v as number)) max = p;
  }
  return { min, max };
}

/**
 * The average over the period. Raw history is irregular (a sensor reports when it changes), so
 * each reading counts for as long as it held: a value that sat at 20 all night and flickered to 25
 * for a minute averages near 20, not 22.5. That includes the reading carried in at the start, and
 * stops at `until` (now); unavailable stretches count for nothing. Grouped or statistics points
 * are one per equal period (an hour, a day), so they get a plain mean. A single reading, or
 * readings all at one instant, fall back to the plain mean too.
 */
export function averageOf(points: readonly Point[], timeWeighted: boolean, until = Infinity): number | undefined {
  const values = points.filter((p) => p.v !== null && !(p.carried && !timeWeighted));
  if (values.length === 0) return undefined;
  if (timeWeighted) {
    let area = 0;
    let span = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.v === null) continue;
      const next = i + 1 < points.length ? points[i + 1].t : p.t;
      const dt = Math.max(0, Math.min(next, until) - p.t);
      area += p.v * dt;
      span += dt;
    }
    if (span > 0) return area / span;
  }
  return values.reduce((sum, p) => sum + (p.v as number), 0) / values.length;
}

/* ---------------------------------------------------------------- placing ---------------------------------------------------------------- */

/** One label to place: where its dot is (fractions of the plot), its text, and the side it prefers. */
export interface LabelSpec {
  x: number;
  y: number;
  text: string;
  prefer: 'above' | 'below';
  /** It marks a dot there, which other labels keep clear of. */
  dot?: boolean;
}

export interface PlacedLabel {
  side: 'above' | 'below';
  /** Centred on the dot, or held against the plot's left or right edge near it. */
  align: 'center' | 'start' | 'end';
  /** 0 beside the dot; 1 a label's height further out, past a neighbour. */
  tier: number;
}

/** A rectangle on the plot, in px from its top-left corner. */
export interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}

/** A label's rough size in px: 11 px text plus padding. Real text varies; this errs wide. */
export const LABEL_H = 18;
const LABEL_GAP = 8;
const DOT_R = 6;
export const labelWidth = (text: string) => Math.ceil(text.length * 6.2) + 12;

export const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/** The box a label placed by `placeLabels` covers, in px on a plot `width` × `height`. */
export function labelBox(label: LabelSpec, placed: PlacedLabel, width: number, height: number): Box {
  const w = labelWidth(label.text);
  const px = label.x * width;
  const py = label.y * height;
  const left = placed.align === 'start' ? 0 : placed.align === 'end' ? width - w : px - w / 2;
  const gap = LABEL_GAP + placed.tier * (LABEL_H + 2);
  const t = placed.side === 'above' ? py - gap - LABEL_H : py + gap;
  return { l: left, r: left + w, t, b: t + LABEL_H };
}

/**
 * Where each label goes on a plot `width` × `height` px. Each is centred over its dot, or held
 * against the edge it would run past, on its preferred side (the high above, the low below)
 * unless that leaves the plot or covers a dot, an earlier label or one of `obstacles` (a header
 * laid over the plot); then the other side. If neither side is clear it takes a side that fits.
 */
export function placeLabels(
  labels: readonly LabelSpec[],
  width: number,
  height: number,
  obstacles: readonly Box[] = [],
): PlacedLabel[] {
  const dots: Box[] = labels
    .filter((l) => l.dot)
    .map((l) => ({
      l: l.x * width - DOT_R,
      r: l.x * width + DOT_R,
      t: l.y * height - DOT_R,
      b: l.y * height + DOT_R,
    }));
  const taken: Box[] = [...obstacles, ...dots];
  return labels.map((label) => {
    const w = labelWidth(label.text);
    const px = label.x * width;
    const align = px - w / 2 < 0 ? 'start' : px + w / 2 > width ? 'end' : 'center';
    // Each side has a near spot and, on a crowded plot, one a label's height further out.
    const box = (side: 'above' | 'below', tier = 0): Box => labelBox(label, { side, align, tier }, width, height);
    const inside = (b: Box) => b.t >= 0 && b.b <= height;
    const clear = (b: Box) => inside(b) && !taken.some((p) => overlaps(p, b));
    const other: 'above' | 'below' = label.prefer === 'above' ? 'below' : 'above';
    const spots: { side: 'above' | 'below'; tier: number }[] = [
      { side: label.prefer, tier: 0 },
      { side: other, tier: 0 },
      { side: label.prefer, tier: 1 },
      { side: other, tier: 1 },
    ];
    const spot =
      spots.find((p) => clear(box(p.side, p.tier))) ??
      spots.find((p) => p.tier === 0 && inside(box(p.side))) ??
      spots[0];
    taken.push(box(spot.side, spot.tier));
    const side = spot.side;
    const tier = spot.tier;
    return { side, align, tier };
  });
}

/* ---------------------------------------------------------------- drawing ---------------------------------------------------------------- */

const DAY = 86_400_000;

/**
 * When a mark happened, in the user's language, clock and zone: a clock time over a day or less,
 * with the date beyond. A grouped point names its group: the day for days and weeks, the month
 * for months.
 */
export function extremeTime(t: number, range: Range, hass?: HomeAssistant, group?: Grouping): string {
  if (group?.unit === 'day' || group?.unit === 'week' || group?.unit === 'month') {
    const opts: Intl.DateTimeFormatOptions =
      group.unit === 'month'
        ? { month: 'short', year: 'numeric' }
        : { weekday: 'short', day: 'numeric', month: 'short' };
    try {
      return new Intl.DateTimeFormat(hass?.locale?.language ?? 'en', { ...opts, timeZone: timeZoneOf(hass) }).format(t);
    } catch {
      return new Intl.DateTimeFormat('en', opts).format(t);
    }
  }
  return range.end - range.start > DAY ? formatDateTime(t, hass) : formatTime(t, hass);
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** One series' marks, worked out for drawing. */
interface SeriesMarks {
  s: ChartSeries;
  min?: Point;
  max?: Point;
  average?: number;
}

/** Inputs for `extremesLayer`; the frame's `range`, `group` and `source` say how to average. */
export interface ExtremesInput {
  ctx: ChartContext;
  series: readonly ChartSeries[];
  scales: PlotScales;
  range: Range;
  group?: Grouping;
  /** Raw history (true) is averaged by time; statistics and groups by point. */
  timeWeighted: boolean;
  /** The plot's size in px, for keeping labels inside it. */
  width: number;
  height: number;
  /** Nothing is known after this (now): the last reading holds until here. */
  until?: number;
  /** Parts of the plot labels keep clear of, in px (a header laid over it). */
  obstacles?: Box[];
}

export interface ExtremesLayer {
  /** Dashed average lines, for the plot's SVG. */
  lines: SVGTemplateResult | typeof nothing;
  /** Dots and labels, for the HTML over the plot. */
  overlay: TemplateResult | typeof nothing;
}

/**
 * The marks for a history chart: a ringed dot and a label ("High 14.2 °C · 14:10") at each
 * series' highest and lowest reading, and its average as a dashed line labelled at the right edge
 * or as a figure in the plot's top-right corner. Any history chart can draw it: the lines go in
 * its SVG, the overlay over the plot.
 */
export function extremesLayer(input: ExtremesInput): ExtremesLayer {
  const { ctx, scales, width, height } = input;
  const options = extremesOptions(ctx.raw);
  if (!extremesOn(options)) return { lines: nothing, overlay: nothing };
  const marks: SeriesMarks[] = input.series
    .filter((s) => seriesHasExtremes(s.entity.config))
    .map((s) => {
      const { min, max } = extremePoints(s.points);
      const average = options.average === 'none' ? undefined : averageOf(s.points, input.timeWeighted, input.until);
      return { s, min: options.min ? min : undefined, max: options.max ? max : undefined, average };
    });
  const value = (v: number, s: ChartSeries) => withUnit(formatNumber(v, s.entity.decimals, ctx.hass), s.entity.unit);
  const t = (k: string) => localize(ctx.hass, k);
  const inPlot = (y: number) => y >= 0 && y <= 1;

  interface Mark {
    s: ChartSeries;
    kind: 'max' | 'min' | 'average';
    spec: LabelSpec;
  }
  const items: Mark[] = [];
  for (const m of marks) {
    for (const kind of ['max', 'min'] as const) {
      const p = m[kind];
      if (!p) continue;
      const y = scales.y(p.v as number) / VIEW_H;
      if (!inPlot(y)) continue;
      const word = t(kind === 'max' ? 'extremes_high' : 'extremes_low');
      items.push({
        s: m.s,
        kind,
        spec: {
          x: scales.x(p.t) / VIEW_W,
          y,
          text: `${word} ${value(p.v as number, m.s)} · ${extremeTime(p.t, input.range, ctx.hass, input.group)}`,
          prefer: kind === 'max' ? 'above' : 'below',
          dot: true,
        },
      });
    }
    if (options.average === 'line' && m.average !== undefined) {
      const y = scales.y(m.average) / VIEW_H;
      if (inPlot(y)) {
        items.push({
          s: m.s,
          kind: 'average',
          spec: { x: 1, y, text: `${t('extremes_average')} ${value(m.average, m.s)}`, prefer: 'above' },
        });
      }
    }
  }
  const placed = placeLabels(
    items.map((i) => i.spec),
    width,
    height,
    input.obstacles,
  );

  const lines =
    options.average === 'line'
      ? svg`<g class="average-lines">${marks.map((m) => {
          if (m.average === undefined) return nothing;
          const y = scales.y(m.average);
          return svg`<line class="average-line" x1="0" x2=${VIEW_W} y1=${y} y2=${y} stroke=${m.s.color}></line>`;
        })}</g>`
      : nothing;

  const figures =
    options.average === 'figure' && marks.some((m) => m.average !== undefined)
      ? html`<div class="extreme-figures">
          ${marks.map((m) =>
            m.average === undefined
              ? nothing
              : html`<div class="extreme-figure">
                  ${input.series.length > 1 ? html`<span class="swatch" style="background:${m.s.color}"></span>` : nothing}
                  <span>${t('extremes_average')} ${value(m.average, m.s)}</span>
                </div>`,
          )}
        </div>`
      : nothing;

  // Labels first, then the dots over them, so no label hides another series' dot.
  const overlay = html`<div class="extremes-layer">
    ${items.map((item, i) => {
      const { side, align, tier } = placed[i];
      const { x, y, text } = item.spec;
      const across = align === 'start' ? 'left:0' : align === 'end' ? 'right:0' : `left:${pct(x)}`;
      return html`<span
        class="extreme-label ${item.kind} ${side} ${align} ${tier ? 'far' : ''}"
        style="${across};top:${pct(y)};--series:${item.s.color}"
        >${text}</span
      >`;
    })}
    ${items.map((item) =>
      item.spec.dot
        ? html`<span
            class="extreme-dot ${item.kind}"
            style="left:${pct(item.spec.x)};top:${pct(item.spec.y)};border-color:${item.s.color}"
          ></span>`
        : nothing,
    )}
    ${figures}
  </div>`;
  return { lines, overlay };
}

/** The look of the marks, from the theme and each series' colour, light and dark. */
export const extremesStyles = css`
  .plot .average-line {
    stroke-width: 1.5;
    stroke-dasharray: 6 5;
    opacity: 0.75;
  }
  .extremes-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--cd-duration) var(--cd-easing);
  }
  :host([ready]) .extremes-layer {
    opacity: 1;
  }
  .extreme-dot {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2.5px solid;
    background: var(--card-background-color, #fff);
    transform: translate(-50%, -50%);
  }
  .extreme-label {
    position: absolute;
    height: ${LABEL_H}px;
    box-sizing: border-box;
    padding: 0 6px;
    border-radius: 9px;
    font-size: 11px;
    line-height: ${LABEL_H}px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: var(--primary-text-color);
    background: color-mix(in srgb, var(--series) 16%, var(--card-background-color, #fff));
  }
  .extreme-label.above {
    --dy: calc(-100% - ${LABEL_GAP}px);
  }
  .extreme-label.below {
    --dy: ${LABEL_GAP}px;
  }
  .extreme-label.above.far {
    --dy: calc(-200% - ${LABEL_GAP + 2}px);
  }
  .extreme-label.below.far {
    --dy: calc(100% + ${LABEL_GAP + 2}px);
  }
  .extreme-label {
    transform: translateY(var(--dy));
  }
  .extreme-label.center {
    transform: translate(-50%, var(--dy));
  }
  .extreme-label.average {
    color: var(--secondary-text-color);
    background: color-mix(in srgb, var(--card-background-color, #fff) 80%, transparent);
  }
  .extreme-figures {
    position: absolute;
    top: 2px;
    right: 4px;
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--secondary-text-color);
    background: color-mix(in srgb, var(--card-background-color, #fff) 75%, transparent);
    font-variant-numeric: tabular-nums;
  }
  .extreme-figure {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .extreme-figure .swatch {
    width: 8px;
    height: 8px;
  }
`;

/* ---------------------------------------------------------------- editor ---------------------------------------------------------------- */

/** The card's marks in its Chart section. */
export const EXTREMES_FIELDS: FieldBinding[] = [
  { name: 'extremes_max', path: ['extremes', 'max'], default: DEFAULT_EXTREMES.max },
  { name: 'extremes_min', path: ['extremes', 'min'], default: DEFAULT_EXTREMES.min },
  { name: 'extremes_average', path: ['extremes', 'average'], default: DEFAULT_EXTREMES.average },
];

export function extremesSchema(hass?: HomeAssistant) {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'extremes_max', selector: { boolean: {} } },
        { name: 'extremes_min', selector: { boolean: {} } },
      ],
    },
    {
      name: 'extremes_average',
      selector: {
        select: {
          mode: 'dropdown',
          options: AVERAGE_MODES.map((value) => ({
            value,
            label: localize(hass, `editor_extremes_average_${value}`),
          })),
        },
      },
    },
  ];
}

/** Each series' own switch, shown in its options while the card draws any mark. */
export const ENTITY_EXTREMES_FIELD: FieldBinding = { name: 'extremes', path: ['extremes'], default: true };

const entitySchemas = new Map<string, unknown[]>();

/**
 * A series' options with the marks switch added after `base` (built once per language and base,
 * so ha-form keeps the same schema).
 */
export function withEntityExtremes(base: unknown[], hass: HomeAssistant | undefined): unknown[] {
  const k = languageOf(hass);
  let schema = entitySchemas.get(k);
  if (!schema || schema[0] !== base[0]) {
    schema = [...base, { name: 'extremes', selector: { boolean: {} } }];
    entitySchemas.set(k, schema);
  }
  return schema;
}

const entityFieldLists = new WeakMap<FieldBinding[], FieldBinding[]>();

export function withEntityExtremesFields(base: FieldBinding[]): FieldBinding[] {
  let fields = entityFieldLists.get(base);
  if (!fields) {
    fields = [...base, ENTITY_EXTREMES_FIELD];
    entityFieldLists.set(base, fields);
  }
  return fields;
}
