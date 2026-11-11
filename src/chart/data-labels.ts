import { css, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { formatNumber } from '../format';
import type { Point } from '../history/types';
import type { CardConfig, HomeAssistant } from '../types';

/** Which readings get a value label. */
export const LABEL_SHOW = ['all', 'last', 'minmax', 'ends'] as const;
export type LabelShow = (typeof LABEL_SHOW)[number];

/** Where a label sits against its point: `auto` puts peaks' labels above and dips' below. */
export const LABEL_POSITIONS = ['auto', 'above', 'below', 'center'] as const;
export type LabelPosition = (typeof LABEL_POSITIONS)[number];

export interface LabelOptions {
  show: LabelShow;
  position: LabelPosition;
  /** Leave out a label that would overlap one already placed (on unless set false). */
  hideOverlap: boolean;
}

/** Without overlap hiding, a series with more readings than this gets no labels at all. */
const MAX_UNHIDDEN = 40;
/** At most this many candidates per chart are tried; the rest could never fit. */
const MAX_CANDIDATES = 600;
/** Gap between a point and its label, px. */
const OFFSET_PX = 6;
/** Label height, px (10 px text and its padding). */
const LABEL_H = 14;

type LabelRaw = CardConfig & {
  labels?: unknown;
  labels_show?: unknown;
  labels_position?: unknown;
  labels_overlap?: unknown;
};

export function validateLabelOptions(config: CardConfig): void {
  const raw = config as LabelRaw;
  if (raw.labels !== undefined && typeof raw.labels !== 'boolean') throw new Error('"labels" must be true or false');
  if (raw.labels_show !== undefined && !LABEL_SHOW.includes(raw.labels_show as LabelShow)) {
    throw new Error(`"labels_show" must be one of: ${LABEL_SHOW.join(', ')}`);
  }
  if (raw.labels_position !== undefined && !LABEL_POSITIONS.includes(raw.labels_position as LabelPosition)) {
    throw new Error(`"labels_position" must be one of: ${LABEL_POSITIONS.join(', ')}`);
  }
  if (raw.labels_overlap !== undefined && typeof raw.labels_overlap !== 'boolean') {
    throw new Error('"labels_overlap" must be true or false');
  }
}

/** The card's label options, or undefined when it has no labels. */
export function labelOptions(config: CardConfig): LabelOptions | undefined {
  const raw = config as LabelRaw;
  if (raw.labels !== true) return undefined;
  return {
    show: (raw.labels_show as LabelShow | undefined) ?? 'all',
    position: (raw.labels_position as LabelPosition | undefined) ?? 'auto',
    hideOverlap: raw.labels_overlap !== true,
  };
}

/**
 * Indexes of the readings to label, most important first: the last, then the highest and lowest,
 * then the rest in time order. Gaps are never labelled.
 */
export function pickPoints(points: readonly Point[], show: LabelShow): number[] {
  const real = points.map((p, i) => (p.v === null ? -1 : i)).filter((i) => i >= 0);
  if (real.length === 0) return [];
  const last = real[real.length - 1];
  const first = real[0];
  let hi = first;
  let lo = first;
  for (const i of real) {
    if ((points[i].v as number) > (points[hi].v as number)) hi = i;
    if ((points[i].v as number) < (points[lo].v as number)) lo = i;
  }
  const picked =
    show === 'last' ? [last] : show === 'ends' ? [last, first] : show === 'minmax' ? [hi, lo] : [last, hi, lo, ...real];
  return [...new Set(picked)];
}

/** Whether a reading is a peak (label above) or a dip (label below) against its neighbours. */
export function autoSide(points: readonly Point[], i: number): 'above' | 'below' {
  const v = points[i].v as number;
  const prev = points[i - 1]?.v ?? null;
  const next = points[i + 1]?.v ?? null;
  const around = [prev, next].filter((x): x is number => x !== null);
  if (around.length === 0) return 'above';
  const mean = around.reduce((a, b) => a + b, 0) / around.length;
  return v < mean ? 'below' : 'above';
}

/** A label to place: its anchor and size in px, and where it would rather go. */
export interface LabelBox {
  x: number;
  y: number;
  width: number;
  /** Positions to try in order; the first that fits wins. */
  sides: LabelPosition[];
}

export interface Placed {
  side: Exclude<LabelPosition, 'auto'>;
  /** The label's box, px: left, top, right, bottom. */
  box: [number, number, number, number];
}

function boxFor(l: LabelBox, side: Exclude<LabelPosition, 'auto'>): [number, number, number, number] {
  const left = l.x - l.width / 2;
  const top = side === 'above' ? l.y - OFFSET_PX - LABEL_H : side === 'below' ? l.y + OFFSET_PX : l.y - LABEL_H / 2;
  return [left, top, left + l.width, top + LABEL_H];
}

const overlaps = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Place labels in order, each on the first of its sides that overlaps none placed before it and
 * stays inside `height` px. With `hide`, a label with no such side is left out (undefined);
 * without, it takes its first side regardless. Labels are given most important first.
 */
export function placeLabels(labels: LabelBox[], height: number, hide: boolean): (Placed | undefined)[] {
  const taken: number[][] = [];
  return labels.map((l) => {
    for (const s of l.sides) {
      const side = s === 'auto' ? 'above' : s;
      const box = boxFor(l, side);
      if (!hide) {
        return { side, box };
      }
      if (box[1] < -2 || box[3] > height + 2) continue;
      if (taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      return { side, box };
    }
    return undefined;
  });
}

/** Rough width of a label in px: 10 px digits and its padding. */
export function labelWidth(text: string): number {
  return Math.ceil(text.length * 6) + 6;
}

/** One series' readings to label, as the chart draws them. */
export interface LabelSeries {
  points: readonly Point[];
  decimals: number;
  color: string;
}

export interface LabelLayout {
  /** Point position as a fraction of the plot's width and height (0 at the top). */
  at(p: Point): [number, number];
  /** Plot size in px, for spacing. */
  width: number;
  height: number;
  /** Leave out readings that aren't real ones (carried values at the edges). */
  skip?(p: Point): boolean;
}

/** A label that would run off the left or right of the plot lines up with that edge instead. */
export function edge(x: number, width: number, plotWidth: number): '' | 'start' | 'end' {
  if (x - width / 2 < 0) return 'start';
  if (x + width / 2 > plotWidth) return 'end';
  return '';
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/**
 * Value labels for every series, chosen, positioned and kept apart as the options say. Drawn in
 * HTML over the plot, in percent, so the stretched SVG doesn't distort them.
 */
export function dataLabels(
  series: readonly LabelSeries[],
  options: LabelOptions,
  layout: LabelLayout,
  hass?: HomeAssistant,
): TemplateResult | typeof nothing {
  const boxes: (LabelBox & { text: string; color: string; fx: number; fy: number })[] = [];
  const rest: typeof boxes = [];
  for (const s of series) {
    const real = layout.skip ? s.points.map((p) => (layout.skip!(p) ? { ...p, v: null } : p)) : s.points;
    if (!options.hideOverlap && options.show === 'all' && real.filter((p) => p.v !== null).length > MAX_UNHIDDEN) {
      continue;
    }
    pickPoints(real, options.show).forEach((i, rank) => {
      const p = real[i];
      const [fx, fy] = layout.at(p);
      if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return;
      const text = formatNumber(p.v as number, s.decimals, hass);
      const preferred: LabelPosition = options.position === 'auto' ? autoSide(real, i) : options.position;
      const other: LabelPosition = preferred === 'above' ? 'below' : 'above';
      const box = {
        x: fx * layout.width,
        y: fy * layout.height,
        width: labelWidth(text),
        sides: preferred === 'center' ? ['center' as const] : [preferred, other],
        text,
        color: s.color,
        fx,
        fy,
      };
      // Each series' key readings go before any series' ordinary ones.
      (rank < 3 && options.show === 'all' ? boxes : options.show === 'all' ? rest : boxes).push(box);
    });
  }
  const all = [...boxes, ...rest].slice(0, MAX_CANDIDATES);
  const placed = placeLabels(all, layout.height, options.hideOverlap);
  const shown = all.map((b, i) => ({ b, p: placed[i] })).filter((x) => x.p !== undefined);
  if (shown.length === 0) return nothing;
  // Back in time order, so the DOM reads left to right.
  shown.sort((a, b) => a.b.fx - b.b.fx);
  return html`<div class="point-labels">
    ${shown.map(
      ({ b, p }) =>
        html`<span
          class="point-label ${p!.side} ${edge(b.fx * layout.width, b.width, layout.width)}"
          style="left:${pct(b.fx)};top:${pct(b.fy)};--cd-label:${b.color}"
          >${b.text}</span
        >`,
    )}
  </div>`;
}

/**
 * Where a slice's label goes: on the slice's middle angle, `r` out from the centre. Angles are
 * radians clockwise from 12 o'clock, as pie and donut charts draw them. Returns fractions of a
 * square drawing.
 */
export function sliceAnchor(start: number, end: number, r: number): [number, number] {
  const mid = (start + end) / 2;
  return [0.5 + r * Math.sin(mid), 0.5 - r * Math.cos(mid)];
}

export const dataLabelStyles = css`
  .point-labels {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .point-label {
    position: absolute;
    transform: translate(-50%, calc(-100% - 6px));
    font-size: 10px;
    line-height: 1;
    padding: 2px 3px;
    border-radius: 3px;
    color: var(--primary-text-color);
    background: color-mix(in srgb, var(--card-background-color, #fff) 80%, transparent);
    box-shadow: inset 0 -1.5px 0 color-mix(in srgb, var(--cd-label, transparent) 70%, transparent);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .point-label.below {
    transform: translate(-50%, 6px);
  }
  .point-label.center {
    transform: translate(-50%, -50%);
  }
  .point-label.start {
    --cd-label-x: -4px;
  }
  .point-label.end {
    --cd-label-x: calc(-100% + 4px);
  }
  .point-label.start,
  .point-label.end {
    transform: translate(var(--cd-label-x), calc(-100% - 6px));
  }
  .point-label.start.below,
  .point-label.end.below {
    transform: translate(var(--cd-label-x), 6px);
  }
  .point-label.start.center,
  .point-label.end.center {
    transform: translate(var(--cd-label-x), -50%);
  }
`;
