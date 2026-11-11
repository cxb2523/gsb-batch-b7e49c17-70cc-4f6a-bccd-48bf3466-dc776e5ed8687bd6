import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { disconnectHistory, frameMessage, frameStyles, historyFrame, validateHistoryOptions } from '../chart/frame';
import type { HistoryFrame } from '../chart/frame';
import { ROLLING_HISTORY_FIELDS, cachedSchema, chartForm, choice, rollingHistorySchema } from '../editor/chart-editors';
import { entityOptionsForm } from '../editor/entity-options';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import type { Point } from '../history/types';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartEditorContext, ChartStyleModule } from './index';

export const STEP_MODES = ['change', 'current'] as const;
export const ORIENTATIONS = ['vertical', 'horizontal'] as const;
type StepMode = (typeof STEP_MODES)[number];

/** How much a series changed: its last reading less its first, or null with no readings. */
export function change(points: Point[]): number | null {
  const readings = points.filter((p) => p.v !== null);
  if (readings.length === 0) return null;
  return (readings[readings.length - 1].v as number) - (readings[0].v as number);
}

/** The first reading in a series (at the start of the period), or null with none. */
export function firstReading(points: Point[]): number | null {
  const p = points.find((x) => x.v !== null);
  return p ? (p.v as number) : null;
}

export interface WaterfallBar {
  kind: 'start' | 'step' | 'total';
  /** Level the bar starts at and ends at; a step goes from the running total before it to after. */
  from: number;
  to: number;
  /** How much the bar adds (the value itself for start and total bars). */
  delta: number;
  /** Index into the chart's items; none for the total bar. */
  index?: number;
  /** A step with no number: drawn as an empty outline that adds nothing. */
  missing: boolean;
}

export interface StepInput {
  value: number | null;
  index: number;
}

/**
 * The bars of a waterfall: an optional start bar from zero, a step per input carrying the running
 * total along, and an optional total bar from zero to where the steps ended. The domain covers
 * every bar and zero, so bars always stand on a visible baseline.
 */
export function waterfallBars(
  start: StepInput | null,
  steps: StepInput[],
  total: boolean,
): { bars: WaterfallBar[]; domain: [number, number] } {
  const bars: WaterfallBar[] = [];
  let level = 0;
  if (start) {
    const v = start.value ?? 0;
    bars.push({ kind: 'start', from: 0, to: v, delta: v, index: start.index, missing: start.value === null });
    level = v;
  }
  for (const s of steps) {
    const delta = s.value ?? 0;
    bars.push({ kind: 'step', from: level, to: level + delta, delta, index: s.index, missing: s.value === null });
    level += delta;
  }
  if (total) bars.push({ kind: 'total', from: 0, to: level, delta: level, missing: false });
  let lo = 0;
  let hi = 0;
  for (const b of bars) {
    lo = Math.min(lo, b.from, b.to);
    hi = Math.max(hi, b.from, b.to);
  }
  if (lo === hi) hi = lo + 1;
  return { bars, domain: [lo, hi] };
}

/** "+6.1" or "−3.4" (a real minus sign); no sign for zero. */
export function signed(value: number, decimals: number, hass?: HomeAssistant): string {
  const text = formatNumber(Math.abs(value), decimals, hass);
  if (Number(value.toFixed(decimals)) === 0) return formatNumber(0, decimals, hass);
  return `${value > 0 ? '+' : '−'}${text}`;
}

function inverted(e: ResolvedEntity): boolean {
  return (e.config as { invert?: unknown }).invert === true;
}

function needsHistory(raw: CardConfig): boolean {
  return (raw.steps ?? 'change') === 'change' || raw.start_from_first === true;
}

/** Room left beyond the highest (and lowest, if below zero) bar for its label, as a share. */
const HEADROOM = { vertical: 0.14, horizontal: 0.24 };

interface Placed extends WaterfallBar {
  name: string;
  label: string;
  entity?: ResolvedEntity;
}

function placeBars(ctx: ChartContext, frame: HistoryFrame | undefined): Placed[] {
  const { items, raw, hass } = ctx;
  const mode = (raw.steps as StepMode | undefined) ?? 'change';
  const fromFirst = raw.start_from_first === true;
  const points = (i: number) => frame?.series[i]?.points ?? [];
  const stepValue = (e: ResolvedEntity, i: number): number | null => {
    const v = mode === 'change' ? change(points(i)) : e.available ? e.value : null;
    return v === null ? null : inverted(e) ? -v : v;
  };
  const start = fromFirst && items.length ? { value: firstReading(points(0)), index: 0 } : null;
  const steps = items.map((e, index) => ({ value: stepValue(e, index), index })).slice(fromFirst ? 1 : 0);
  const { bars } = waterfallBars(start, steps, raw.total !== false);
  const decimals = items[0]?.decimals ?? 1;
  return bars.map((b) => {
    const entity = b.index === undefined ? undefined : items[b.index];
    const places = entity?.decimals ?? decimals;
    let name: string;
    let label: string;
    if (b.kind === 'start') {
      name = localize(hass, 'waterfall_start');
      label = b.missing ? localize(hass, 'waterfall_no_readings') : formatNumber(b.to, places, hass);
    } else if (b.kind === 'total') {
      name = localize(hass, start ? 'waterfall_end' : 'waterfall_total');
      label = formatNumber(b.to, decimals, hass);
    } else {
      name = entity!.name;
      if (!b.missing) label = signed(b.delta, places, hass);
      else label = entity!.available ? localize(hass, 'waterfall_no_readings') : entity!.display;
    }
    return { ...b, name, label, entity };
  });
}

function colorOf(b: WaterfallBar): string {
  if (b.kind !== 'step') return baseColor('primary');
  return baseColor(b.delta < 0 ? 'red' : 'green');
}

function drawing(ctx: ChartContext, bars: Placed[]): TemplateResult {
  const horizontal = ctx.raw.orientation === 'horizontal';
  const values = bars.flatMap((b) => [b.from, b.to]);
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  if (lo === hi) hi = lo + 1;
  const room = (hi - lo) * HEADROOM[horizontal ? 'horizontal' : 'vertical'];
  hi += room;
  if (lo < 0) lo -= room;
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const n = bars.length;
  const slot = 100 / n;
  // The bar fills the middle of its slot; the rest is the gap the connectors cross.
  const fill = horizontal ? 0.64 : 0.6;
  const c0 = (i: number) => slot * i + (slot * (1 - fill)) / 2;
  const c1 = (i: number) => c0(i) + slot * fill;
  const unit = ctx.items[0]?.unit ?? '';
  const aria = localize(ctx.hass, 'waterfall_aria', {
    bars: bars.map((b) => `${b.name} ${b.missing ? b.label : withUnit(b.label, b.entity?.unit ?? unit)}`).join(', '),
  });
  const entityAttrs = (b: Placed) => (b.index === undefined ? '' : 'entity');
  const marks = bars.map((b, i) => {
    const a0 = at(Math.min(b.from, b.to));
    const a1 = at(Math.max(b.from, b.to));
    const vars = `--a0:${a0}%;--a1:${a1}%;--c0:${c0(i)}%;--c1:${c1(i)}%;--cm:${(c0(i) + c1(i)) / 2}%;--color:${colorOf(b)}`;
    const next = i + 1 < n ? `--a:${at(b.to)}%;--c0:${c1(i)}%;--c1:${c0(i + 1)}%` : '';
    return html`<div
        class="bar ${b.kind} ${b.missing ? 'missing' : ''} ${b.delta < 0 ? 'fall' : 'rise'} ${entityAttrs(b)}"
        data-index=${b.index ?? nothing}
        tabindex=${b.index === undefined ? nothing : 0}
        aria-label=${`${b.name}, ${b.label}`}
        style=${vars}
      ></div>
      <span class="bar-label ${b.missing ? 'missing' : ''} ${b.kind}" style=${vars}
        >${b.missing && !horizontal ? '\u2013' : b.label}</span
      >
      ${next ? html`<div class="connector" style=${next}></div>` : nothing}`;
  });
  const names = bars.map(
    (b) =>
      html`<div class="bar-name ${entityAttrs(b)}" data-index=${b.index ?? nothing} title=${b.name}>
        <span>${b.name}</span>
      </div>`,
  );
  return html`<div class="wf ${horizontal ? 'horizontal' : 'vertical'}" style="--n:${n}">
    <div class="names">${names}</div>
    <div class="wf-plot" role="img" aria-label=${aria}>
      <div class="zero" style="--a:${at(0)}%"></div>
      ${marks}
    </div>
  </div>`;
}

const FIELDS: FieldBinding[] = [
  ...ROLLING_HISTORY_FIELDS,
  { name: 'steps', path: ['steps'], default: 'change' },
  { name: 'orientation', path: ['orientation'], default: 'vertical' },
  { name: 'start_from_first', path: ['start_from_first'], default: false },
  { name: 'total', path: ['total'], default: true },
];

export function waterfallEditor(ctx: ChartEditorContext): TemplateResult {
  const schema = cachedSchema('waterfall', ctx.hass, () => [
    ...rollingHistorySchema(ctx.hass),
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'steps', selector: choice(ctx.hass, 'steps', STEP_MODES) },
        { name: 'orientation', selector: choice(ctx.hass, 'orientation', ORIENTATIONS) },
      ],
    },
    { name: 'start_from_first', selector: { boolean: {} } },
    { name: 'total', selector: { boolean: {} } },
  ]);
  return html`${chartForm(ctx, 'chart', schema, FIELDS)}
  ${entityOptionsForm(ctx, 'waterfall_invert', 'invert', { boolean: {} }, false)}`;
}

function checkBoolean(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`"${field}" must be true or false`);
}

export const waterfall: ChartStyleModule = {
  layout: 'chart',
  group: 'totals',
  height: 240,
  styles: css`
    ${frameStyles}
    .wf {
      display: grid;
      gap: 6px;
    }
    .wf.vertical {
      grid-template-rows: 180px auto;
    }
    .wf.vertical .names {
      grid-row: 2;
      display: grid;
      grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    }
    .wf.vertical .wf-plot {
      grid-row: 1;
    }
    .wf.horizontal {
      grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
      max-width: 100%;
    }
    .wf.horizontal .names {
      display: grid;
      grid-template-rows: repeat(var(--n), 30px);
      max-width: 140px;
    }
    .wf.horizontal .wf-plot {
      height: calc(var(--n) * 30px);
    }
    .wf-plot {
      position: relative;
      min-width: 0;
    }
    .bar-name {
      min-width: 0;
      display: flex;
      align-items: center;
      font-size: 0.8125em;
      color: var(--secondary-text-color);
    }
    .bar-name span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wf.vertical .bar-name {
      justify-content: center;
      padding: 0 2px;
    }
    .bar-name.entity {
      cursor: pointer;
      border-radius: 4px;
    }
    .bar {
      position: absolute;
      box-sizing: border-box;
      background: linear-gradient(var(--color), color-mix(in srgb, var(--color) 80%, #fff));
      border-radius: 4px;
      transition: transform var(--cd-duration) var(--cd-easing);
    }
    .bar.entity {
      cursor: pointer;
    }
    .bar.missing {
      background: none;
      border: 1.5px dashed var(--secondary-text-color);
      opacity: 0.6;
    }
    .wf.vertical .bar {
      left: var(--c0);
      width: calc(var(--c1) - var(--c0));
      bottom: var(--a0);
      height: max(calc(var(--a1) - var(--a0)), 2px);
      transform-origin: 50% 100%;
      transform: scaleY(0);
    }
    .wf.horizontal .bar {
      top: var(--c0);
      height: calc(var(--c1) - var(--c0));
      left: var(--a0);
      width: max(calc(var(--a1) - var(--a0)), 2px);
      transform-origin: 0 50%;
      transform: scaleX(0);
    }
    .wf.vertical .bar.missing {
      height: 16px;
      bottom: calc(var(--a0) - 8px);
    }
    .wf.horizontal .bar.missing {
      width: 16px;
      left: calc(var(--a0) - 8px);
    }
    :host([ready]) .wf .bar {
      transform: none;
    }
    .bar-label {
      position: absolute;
      font-size: 0.8125em;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
      pointer-events: none;
      color: var(--primary-text-color);
    }
    .bar-label:not(.start):not(.total):not(.missing) {
      color: var(--color);
    }
    .bar-label.missing {
      color: var(--secondary-text-color);
      font-weight: 400;
    }
    .wf.horizontal .bar-label.missing {
      margin-left: 10px;
    }
    .wf.vertical .bar-label {
      left: var(--cm);
      bottom: calc(var(--a1) + 4px);
      transform: translateX(-50%);
    }
    .wf.horizontal .bar-label {
      left: calc(var(--a1) + 6px);
      top: var(--cm);
      transform: translateY(-50%);
    }
    .connector {
      position: absolute;
      pointer-events: none;
      border: 0 dashed var(--secondary-text-color);
      opacity: 0.6;
    }
    .wf.vertical .connector {
      left: var(--c0);
      width: calc(var(--c1) - var(--c0));
      bottom: var(--a);
      border-top-width: 1px;
    }
    .wf.horizontal .connector {
      top: var(--c0);
      height: calc(var(--c1) - var(--c0));
      left: var(--a);
      border-left-width: 1px;
    }
    /* Narrow cards: smaller text so neighbouring columns' labels don't run into each other. */
    @container (max-width: 400px) {
      .wf .bar-label,
      .wf .bar-name {
        font-size: 0.6875em;
      }
      .wf.horizontal .names {
        max-width: 96px;
      }
    }
    .zero {
      position: absolute;
      pointer-events: none;
      background: var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .wf.vertical .zero {
      left: 0;
      right: 0;
      bottom: var(--a);
      height: 1px;
    }
    .wf.horizontal .zero {
      top: 0;
      bottom: 0;
      left: var(--a);
      width: 1px;
    }
  `,
  thumbnail: () => svg`
    <rect x="4" y="22" width="9" height="14" rx="1.5" fill="var(--primary-color, #03a9f4)" />
    <rect x="16" y="10" width="9" height="12" rx="1.5" fill="var(--success-color, #43a047)" />
    <rect x="28" y="10" width="9" height="8" rx="1.5" fill="var(--error-color, #db4437)" />
    <rect x="40" y="18" width="9" height="6" rx="1.5" fill="var(--error-color, #db4437)" />
    <rect x="52" y="24" width="9" height="12" rx="1.5" fill="var(--primary-color, #03a9f4)" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    if (raw.steps !== undefined && !STEP_MODES.includes(raw.steps as StepMode)) {
      throw new Error(`"steps" must be one of: ${STEP_MODES.join(', ')}`);
    }
    if (raw.orientation !== undefined && !ORIENTATIONS.includes(raw.orientation as (typeof ORIENTATIONS)[number])) {
      throw new Error(`"orientation" must be one of: ${ORIENTATIONS.join(', ')}`);
    }
    checkBoolean(raw.start_from_first, 'start_from_first');
    checkBoolean(raw.total, 'total');
    for (const e of raw.entities ?? []) {
      if (typeof e === 'object') checkBoolean((e as { invert?: unknown }).invert, 'invert');
    }
  },
  editor: waterfallEditor,
  disconnect: disconnectHistory,
  render(ctx) {
    let frame: HistoryFrame | undefined;
    if (needsHistory(ctx.raw)) {
      frame = historyFrame(ctx);
      const message = frameMessage(frame, ctx);
      if (message) return message;
    }
    return drawing(ctx, placeBars(ctx, frame));
  },
};
