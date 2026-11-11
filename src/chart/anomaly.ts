import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { baseColor } from '../bands';
import type { FieldBinding } from '../editor/schemas';
import { formatNumber, withUnit } from '../format';
import type { Point, Range } from '../history/types';
import { localize } from '../localize';
import type { ChartContext } from '../styles/index';
import type { CardConfig, HomeAssistant } from '../types';
import { LABEL_H, labelBox, overlaps, placeLabels } from './extremes';
import type { Box, LabelSpec, PlacedLabel } from './extremes';
import { VIEW_H, VIEW_W } from './frame';
import type { ChartSeries } from './frame';
import type { PlotScales } from './grid';

/*
 * Anomaly markers: around each reading, the typical value and spread of the other readings within
 * a time window centred on it. A reading more than `sigma` deviations from that typical value is
 * marked, and the band of typical ± sigma deviations is shaded behind the line, so what counts as
 * normal is visible.
 *
 * "Typical" and "spread" are the robust forms of the mean and standard deviation: the median, and
 * the median absolute deviation scaled by 1.4826 (which equals the standard deviation for normally
 * distributed readings). The plain mean and deviation let a spike hide itself: a spike a few
 * readings wide sits in its neighbours' windows, pulls their mean towards it and widens their
 * deviation until nothing looks unusual. The median ignores a few wild readings.
 */

/** Fewer neighbours than this in a reading's window, and it is not judged (too little to go on). */
export const MIN_NEIGHBOURS = 5;
/**
 * Fewer than this on either side, and it is not judged either: against neighbours on one side
 * only, any reading on a slope looks out of line (the first of a rise sits below everything after it).
 */
export const MIN_SIDE = 2;
/** At most this many markers are drawn per series, the furthest out first. */
const MAX_MARKERS = 200;
/** At most this many markers get a "+3.4σ" label, the furthest out first (nearby marks share one). */
const MAX_LABELS = 3;
/** By default the window is this fraction of the chart's span. */
const AUTO_WINDOW = 1 / 12;

export const DEFAULT_SIGMA = 3;
export const DEFAULT_ANOMALY_COLOR = 'red';

export interface AnomalyOptions {
  /** The whole window, centred on each reading, in ms; undefined: a twelfth of the span. */
  window?: number;
  sigma: number;
  color: string;
  band: boolean;
}

type Raw = CardConfig & {
  anomalies?: unknown;
  anomalies_window?: unknown;
  anomalies_sigma?: unknown;
  anomalies_color?: unknown;
  anomalies_band?: unknown;
};

const UNIT_MS: Record<string, number> = { s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };
const DURATION = /^(\d+(?:\.\d+)?)\s*(s|min|h|d|w)$/;

/** A window as written ("30min", "2h", "1d"; a bare number is minutes) in ms; undefined if unreadable. */
export function parseWindow(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw * 60_000 : undefined;
  if (typeof raw !== 'string') return undefined;
  const m = DURATION.exec(raw.trim());
  if (!m) return undefined;
  const ms = Number(m[1]) * UNIT_MS[m[2]];
  return ms > 0 ? ms : undefined;
}

/** Throw a readable error for bad anomaly options. */
export function validateAnomalies(config: CardConfig): void {
  const raw = config as Raw;
  for (const k of ['anomalies', 'anomalies_band'] as const) {
    if (raw[k] !== undefined && typeof raw[k] !== 'boolean') throw new Error(`"${k}" must be true or false`);
  }
  if (
    raw.anomalies_window !== undefined &&
    raw.anomalies_window !== 'auto' &&
    parseWindow(raw.anomalies_window) === undefined
  ) {
    throw new Error('"anomalies_window" must be a time such as 30min, 2h or 1d (or auto)');
  }
  const sigma = raw.anomalies_sigma;
  if (sigma !== undefined && !(typeof sigma === 'number' && Number.isFinite(sigma) && sigma > 0)) {
    throw new Error('"anomalies_sigma" must be a number above 0');
  }
  if (raw.anomalies_color !== undefined && typeof raw.anomalies_color !== 'string') {
    throw new Error('"anomalies_color" must be text');
  }
}

/** The card's anomaly options, or undefined when it doesn't mark anomalies. Call after validating. */
export function anomalyOptions(config: CardConfig): AnomalyOptions | undefined {
  const raw = config as Raw;
  if (raw.anomalies !== true) return undefined;
  return {
    window: parseWindow(raw.anomalies_window),
    sigma: (raw.anomalies_sigma as number | undefined) ?? DEFAULT_SIGMA,
    color: (raw.anomalies_color as string | undefined) ?? DEFAULT_ANOMALY_COLOR,
    band: raw.anomalies_band !== false,
  };
}

/* ------------------------------------------------------------------ maths ------------------------------------------------------------------ */

/** One reading's neighbourhood: its typical value and spread, and how far out the reading is. */
export interface RollingStat {
  t: number;
  v: number;
  /** The neighbours' median. */
  mid: number;
  /** Their spread, as a standard deviation (1.4826 × the median absolute deviation). */
  sd: number;
  /** Deviations out: (v - mid) / sd. Infinite when the neighbours never vary but it does. */
  z: number;
}

/** Scales a median absolute deviation to a standard deviation for normally distributed readings. */
const MAD_TO_SD = 1.4826;
/** Scales a mean absolute deviation to a standard deviation, likewise. */
const MEAN_AD_TO_SD = 1.2533;
/** A window holding more readings than this is sampled evenly, to keep the sorting cheap. */
const MAX_WINDOW_READINGS = 401;

function median(sorted: readonly number[]): number {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/**
 * The series' reading-to-reading noise, as a deviation: the robust spread of the steps between
 * neighbouring readings, over √2 (a step is the difference of two noisy readings). A steady slope
 * is a constant step and adds nothing; spikes are a few steps among many and are ignored.
 */
export function noiseFloor(pts: readonly { v: number }[]): number {
  if (pts.length < 3) return 0;
  const steps = pts.slice(1).map((p, i) => p.v - pts[i].v);
  steps.sort((a, b) => a - b);
  const mid = median(steps);
  const offs = steps.map((d) => Math.abs(d - mid)).sort((a, b) => a - b);
  return (MAD_TO_SD * median(offs)) / Math.SQRT2;
}

/**
 * For each reading, the median and robust deviation (see above) of the other readings within
 * `window / 2` either side of it, and its z-score. Gaps and the value carried in at the start get
 * null (so a band drawn from these breaks at gaps), as do readings with fewer than
 * `MIN_NEIGHBOURS` neighbours or fewer than `MIN_SIDE` on either side.
 */
export function rollingStats(points: readonly Point[], window: number): (RollingStat | null)[] {
  const slots: (RollingStat | null)[] = points.map(() => null);
  const at: number[] = [];
  const pts: { t: number; v: number }[] = [];
  points.forEach((p, i) => {
    if (p.v === null || p.carried) return;
    at.push(i);
    pts.push(p as { t: number; v: number });
  });
  const floor = noiseFloor(pts);
  const half = window / 2;
  let lo = 0;
  let hi = 0;
  pts.forEach((p, i) => {
    while (hi < pts.length && pts[hi].t <= p.t + half) hi++;
    while (pts[lo].t < p.t - half) lo++;
    const n = hi - lo - 1;
    if (n < MIN_NEIGHBOURS || i - lo < MIN_SIDE || hi - 1 - i < MIN_SIDE) return;
    const step = Math.max(1, Math.ceil(n / MAX_WINDOW_READINGS));
    const values: number[] = [];
    for (let k = lo; k < hi; k += step) if (k !== i) values.push(pts[k].v);
    values.sort((a, b) => a - b);
    const mid = median(values);
    const offs = values.map((v) => Math.abs(v - mid)).sort((a, b) => a - b);
    // Over half the neighbours on one value (a sensor that mostly reads 0) leaves no median
    // deviation: the mean absolute deviation, scaled the same way, still sees the rest.
    const local = MAD_TO_SD * median(offs) || MEAN_AD_TO_SD * (offs.reduce((sum, d) => sum + d, 0) / offs.length);
    // A handful of neighbours can agree by chance and give a tiny spread: never below the noise.
    const sd = Math.max(local, floor);
    const dev = p.v - mid;
    // A tolerance for rounding: a flat neighbourhood has no spread, not a tiny one.
    const flat = sd < 1e-9 * Math.max(1, Math.abs(mid));
    const z = flat ? (Math.abs(dev) < 1e-9 * Math.max(1, Math.abs(mid)) ? 0 : Math.sign(dev) * Infinity) : dev / sd;
    slots[at[i]] = { t: p.t, v: p.v, mid, sd: flat ? 0 : sd, z };
  });
  return slots;
}

/** The readings more than `sigma` deviations out, furthest out first. */
export function anomaliesOf(stats: readonly (RollingStat | null)[], sigma: number): RollingStat[] {
  return stats
    .filter((s): s is RollingStat => s !== null && Math.abs(s.z) > sigma)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

/** Past this many deviations a label stops counting: "> +10σ". */
export const Z_CAP = 10;

/** A z-score as a label: "+3.4σ", "−2.1σ", or past ten "> +10σ" / "< −10σ" (localised). */
export function zText(z: number, hass?: HomeAssistant): string {
  const sign = z < 0 ? '−' : '+';
  if (Math.abs(z) > Z_CAP) {
    const limit = `${sign}${formatNumber(Z_CAP, 0, hass)}σ`;
    return localize(hass, z < 0 ? 'anomaly_beyond_low' : 'anomaly_beyond_high', { limit });
  }
  return `${sign}${formatNumber(Math.abs(z), 1, hass)}σ`;
}

/** A marker to label: where its dot is (fractions of the plot) and how far out it is. */
export interface MarkSpot {
  x: number;
  y: number;
  z: number;
}

/** Marks closer than this to a labelled one, in px across, share its label... */
const NEAR_X = 48;
/** ...and in px up or down. */
const NEAR_Y = LABEL_H * 3;
/** A dot's half-size in px, kept clear by labels. */
const DOT_HALF = 6;

/**
 * Which marks get a label, and where. Marks go furthest out first; a mark near one already
 * labelled (within `NEAR_X` across and `NEAR_Y` up or down, a spike a few readings wide or two
 * series spiking together) shares that label and keeps only its dot. A label must sit inside the
 * plot clear of every dot, every earlier label and the `obstacles`; one that can't is left out
 * (the dot still names its value for screen readers and on hover). At most `max` labels.
 * Returns the index into `marks` and the placement of each label, in order.
 */
export function pickLabels(
  marks: readonly MarkSpot[],
  texts: readonly string[],
  width: number,
  height: number,
  obstacles: readonly Box[] = [],
  max = MAX_LABELS,
): { index: number; spec: LabelSpec; placed: PlacedLabel }[] {
  const order = marks.map((_, i) => i).sort((a, b) => Math.abs(marks[b].z) - Math.abs(marks[a].z));
  const dots: Box[] = marks.map((m) => ({
    l: m.x * width - DOT_HALF,
    r: m.x * width + DOT_HALF,
    t: m.y * height - DOT_HALF,
    b: m.y * height + DOT_HALF,
  }));
  const leaders: number[] = [];
  const taken: Box[] = [...obstacles];
  const out: { index: number; spec: LabelSpec; placed: PlacedLabel }[] = [];
  for (const i of order) {
    if (out.length >= max) break;
    const m = marks[i];
    const near = leaders.some(
      (j) => Math.abs((marks[j].x - m.x) * width) < NEAR_X && Math.abs((marks[j].y - m.y) * height) < NEAR_Y,
    );
    if (near) continue;
    leaders.push(i);
    const spec: LabelSpec = { x: m.x, y: m.y, text: texts[i], prefer: m.z > 0 ? 'above' : 'below', dot: true };
    const others = dots.filter((_, k) => k !== i);
    const [placed] = placeLabels([spec], width, height, [...taken, ...others]);
    const box = labelBox(spec, placed, width, height);
    const inside = box.t >= 0 && box.b <= height && box.l >= 0 && box.r <= width;
    if (!inside || taken.some((b) => overlaps(b, box)) || others.some((b) => overlaps(b, box))) continue;
    taken.push(box);
    out.push({ index: i, spec, placed });
  }
  return out;
}

/**
 * The band of median ± `sigma` deviations as SVG path data: one closed shape per unbroken stretch
 * of judged readings, the top edge left to right and the bottom back.
 */
export function bandPath(
  stats: readonly (RollingStat | null)[],
  sigma: number,
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = '';
  let run: RollingStat[] = [];
  const close = () => {
    if (run.length >= 2) {
      const top = run.map((s, i) => `${i ? 'L' : 'M'}${f(x(s.t))},${f(y(s.mid + sigma * s.sd))}`).join('');
      const bottom = [...run]
        .reverse()
        .map((s) => `L${f(x(s.t))},${f(y(s.mid - sigma * s.sd))}`)
        .join('');
      d += `${top}${bottom}Z`;
    }
    run = [];
  };
  for (const s of stats) {
    if (s === null) close();
    else run.push(s);
  }
  close();
  return d;
}

/** Every `step`-th stat, so a band over thousands of readings stays a few hundred points. */
function thin(stats: (RollingStat | null)[], max: number): (RollingStat | null)[] {
  if (stats.length <= max) return stats;
  const step = Math.ceil(stats.length / max);
  return stats.filter((_, i) => i % step === 0 || i === stats.length - 1);
}

/* ---------------------------------------------------------------- drawing ---------------------------------------------------------------- */

export interface AnomalyInput {
  ctx: ChartContext;
  series: readonly ChartSeries[];
  scales: PlotScales;
  range: Range;
  /** The plot's size in px, for keeping labels inside it. */
  width: number;
  height: number;
  /** Parts of the plot labels keep clear of, in px (a header laid over it). */
  obstacles?: Box[];
}

export interface AnomalyLayer {
  /** The shaded bands, for the plot's SVG behind the lines. */
  behind: SVGTemplateResult | typeof nothing;
  /** The markers and labels, in HTML over the plot. */
  overlay: TemplateResult | typeof nothing;
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/**
 * Anomaly bands and markers for each series of a history chart, when the card asks for them
 * (`anomalies: true`). The window is the card's, or a twelfth of the span drawn.
 */
export function anomalyLayer(input: AnomalyInput): AnomalyLayer {
  const { ctx, scales } = input;
  const options = anomalyOptions(ctx.raw);
  if (!options) return { behind: nothing, overlay: nothing };
  const window = options.window ?? Math.max(60_000, (input.range.end - input.range.start) * AUTO_WINDOW);
  const color = baseColor(options.color);
  const bands: SVGTemplateResult[] = [];
  const marks: { s: ChartSeries; a: RollingStat; x: number; y: number }[] = [];
  for (const s of input.series) {
    const stats = rollingStats(s.points, window);
    if (options.band) {
      const d = bandPath(thin(stats, 600), options.sigma, scales.x, scales.y);
      if (d) bands.push(svg`<path class="anomaly-band" d=${d} fill=${s.color}></path>`);
    }
    for (const a of anomaliesOf(stats, options.sigma).slice(0, MAX_MARKERS)) {
      const x = scales.x(a.t) / VIEW_W;
      const y = scales.y(a.v) / VIEW_H;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) marks.push({ s, a, x, y });
    }
  }
  if (bands.length === 0 && marks.length === 0) return { behind: nothing, overlay: nothing };
  marks.sort((p, q) => Math.abs(q.a.z) - Math.abs(p.a.z));
  const texts = marks.map((m) => zText(m.a.z, ctx.hass));
  const labels = pickLabels(
    marks.map((m) => ({ x: m.x, y: m.y, z: m.a.z })),
    texts,
    input.width,
    input.height,
    input.obstacles,
  );
  const describe = (m: (typeof marks)[number]) =>
    localize(ctx.hass, 'anomaly_title', {
      name: m.s.entity.name,
      value: withUnit(formatNumber(m.a.v, m.s.entity.decimals, ctx.hass), m.s.entity.unit),
      sigma: zText(m.a.z, ctx.hass),
    });
  const overlay =
    marks.length === 0
      ? nothing
      : html`<div class="anomaly-layer" style="--cd-anomaly:${color}">
          ${labels.map(({ index, placed }) => {
            const m = marks[index];
            const { side, align, tier } = placed;
            const across = align === 'start' ? 'left:0' : align === 'end' ? 'right:0' : `left:${pct(m.x)}`;
            return html`<span
              class="anomaly-label ${side} ${align} ${tier ? 'far' : ''}"
              style="${across};top:${pct(m.y)}"
              >${texts[index]}</span
            >`;
          })}
          ${marks.map(
            (m) =>
              html`<span
                class="anomaly-dot"
                style="left:${pct(m.x)};top:${pct(m.y)}"
                role="img"
                aria-label=${describe(m)}
                title=${describe(m)}
              ></span>`,
          )}
        </div>`;
  return {
    behind: bands.length ? svg`<g class="anomaly-bands">${bands}</g>` : nothing,
    overlay,
  };
}

export const anomalyStyles = css`
  .plot .anomaly-band {
    opacity: 0.13;
    stroke: none;
  }
  .anomaly-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .anomaly-dot {
    position: absolute;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--cd-anomaly);
    border: 1.5px solid var(--card-background-color, #fff);
    transform: translate(-50%, -50%);
  }
  .anomaly-label {
    position: absolute;
    height: ${LABEL_H}px;
    line-height: ${LABEL_H}px;
    padding: 0 5px;
    box-sizing: border-box;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, var(--cd-anomaly) 70%, var(--primary-text-color));
    background: color-mix(in srgb, var(--card-background-color, #fff) 85%, transparent);
    transform: translateY(var(--dy));
  }
  .anomaly-label.above {
    --dy: calc(-100% - 8px);
  }
  .anomaly-label.below {
    --dy: 8px;
  }
  .anomaly-label.above.far {
    --dy: calc(-200% - 10px);
  }
  .anomaly-label.below.far {
    --dy: calc(100% + 10px);
  }
  .anomaly-label.center {
    transform: translate(-50%, var(--dy));
  }
`;

/* ---------------------------------------------------------------- editor ---------------------------------------------------------------- */

export const ANOMALY_FIELDS: FieldBinding[] = [
  { name: 'anomalies', path: ['anomalies'], default: false },
  { name: 'anomalies_window', path: ['anomalies_window'], default: 'auto' },
  { name: 'anomalies_sigma', path: ['anomalies_sigma'], default: DEFAULT_SIGMA },
  { name: 'anomalies_color', path: ['anomalies_color'], default: DEFAULT_ANOMALY_COLOR },
  { name: 'anomalies_band', path: ['anomalies_band'], default: true },
];

/** Part of the Chart section's cache key: whether anomalies are on. */
export const anomalyVariant = (config: CardConfig | undefined) =>
  (config as Raw | undefined)?.anomalies === true ? 'anomalies' : '';

/** The switch, then the window, sigma, colour and band once it is on (cache under `anomalyVariant`). */
export function anomalySchema(config: CardConfig | undefined) {
  return [
    { name: 'anomalies', selector: { boolean: {} } },
    ...(anomalyVariant(config)
      ? [
          {
            type: 'grid',
            name: '',
            schema: [
              { name: 'anomalies_window', selector: { text: {} } },
              { name: 'anomalies_sigma', selector: { number: { min: 0.5, max: 6, step: 0.1, mode: 'box' } } },
              { name: 'anomalies_color', selector: { text: {} } },
              { name: 'anomalies_band', selector: { boolean: {} } },
            ],
          },
        ]
      : []),
  ];
}
