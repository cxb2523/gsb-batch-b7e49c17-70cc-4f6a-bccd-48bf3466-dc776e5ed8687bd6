import { css, html, nothing, svg } from 'lit';
import type { TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { DEFAULT_BANDS } from '../config';
import { disconnectHistory, frameMessage, frameStyles, periodNav, validateHistoryOptions } from '../chart/frame';
import type { HistoryFrame } from '../chart/frame';
import { chartFrame, chartLayout, layoutStyles, validateLayout } from '../chart/layout';
import { tooltipEnabled, tooltipStyles, validateTooltipOptions } from '../chart/tooltip';
import {
  SECTOR_COUNTS,
  pairWind,
  petalPath,
  polarPoint,
  ringSteps,
  sectorName,
  speedDefaults,
  strongest,
  windRose,
} from '../chart/wind';
import type { Rose, SectorCount } from '../chart/wind';
import { windRoseEditor } from '../editor/wind-rose-editor';
import { key } from '../history/fetch';
import type { StatisticsQuery } from '../history/fetch';
import { PERIOD_MS } from '../history/group';
import { parsePeriod, periodRange, stepsFor } from '../history/period';
import type { Period } from '../history/period';
import { storeFor } from '../history/store';
import { conditionStatus, conditionalPoints, loadConditions } from '../history/condition';
import { zoneFor } from '../history/timezone';
import type { Point, Range, SeriesRequest, Source } from '../history/types';
import { formatNumber, withUnit } from '../format';
import { localize } from '../localize';
import { resolveBands } from '../resolve';
import type { CardConfig, MergedEntity, ResolvedBand } from '../types';
import { conversion, convertPoints } from '../units';
import type { Conversion } from '../units';
import type { ChartContext, ChartStyleModule } from './index';

/** A rolling month: long enough for the pattern to show, short enough to load quickly. */
export const DEFAULT_WIND_PERIOD = { last: 30, unit: 'day' };
const DEFAULT_SECTORS: SectorCount = 16;

/** The card's period, with any key it leaves out taken from the wind rose's month. */
export function windPeriod(raw: CardConfig): Period {
  const own = raw.period;
  if (own === undefined || own === null) return parsePeriod(DEFAULT_WIND_PERIOD as CardConfig['period']);
  if (typeof own !== 'object' || Array.isArray(own)) return parsePeriod(own as CardConfig['period']);
  return parsePeriod({ ...DEFAULT_WIND_PERIOD, ...(own as object) } as CardConfig['period']);
}

/** `sectors` from YAML (or the editor, which hands back text): 4, 8 or 16. */
export function windSectors(raw: CardConfig): SectorCount {
  const v = raw.sectors;
  if (v === undefined || v === null || v === '') return DEFAULT_SECTORS;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!SECTOR_COUNTS.includes(n as SectorCount)) {
    throw new Error(`"sectors" must be one of: ${SECTOR_COUNTS.join(', ')}`);
  }
  return n as SectorCount;
}

function calmOption(raw: CardConfig): number | undefined {
  const v = raw.calm;
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error('"calm" must be a number of 0 or more');
  return n;
}

/** One of the two sensors a wind rose reads, and where it sits in the drawn entities (or -1). */
interface Role {
  id: string;
  entity: MergedEntity;
  index: number;
}

/**
 * Which entity is which: the first listed is the direction, the second the speed. Taken from the
 * listed order, not the drawn one, so sorting or hiding unavailable entities can't swap them (a
 * direction reported as compass points reads as unavailable to the rest of the card).
 */
export function windRoles(ctx: Pick<ChartContext, 'config' | 'items'>): { direction?: Role; speed?: Role } {
  const listed = ctx.config.entities.length ? ctx.config.entities : ctx.items.map((e) => e.config);
  const role = (entity: MergedEntity | undefined): Role | undefined =>
    entity && { id: entity.entity, entity, index: ctx.items.findIndex((e) => e.entityId === entity.entity) };
  return { direction: role(listed[0]), speed: role(listed[1]) };
}

/**
 * The unit speeds are shown in, and how to get there: the speed entity's `unit` converts from its
 * sensor's unit when the card knows the pair (m/s to km/h), as on every other chart; otherwise the
 * unit is only shown. An attribute has no unit of its own, so it is never converted.
 */
export function speedUnit(role: Role, ctx: Pick<ChartContext, 'hass'>): { unit: string; conversion?: Conversion } {
  const own = role.entity.attribute ? '' : String(ctx.hass.states[role.id]?.attributes?.unit_of_measurement ?? '');
  const unit = role.entity.unit ?? own;
  const c = role.entity.unit === undefined ? undefined : conversion(own || undefined, role.entity.unit);
  return c ? { unit, conversion: c } : { unit };
}

/** Everything the rose is drawn from. */
interface WindFrame {
  frame: HistoryFrame;
  direction: Point[];
  speed?: Point[];
  until: number;
  maxHold: number;
}

/** Statistics rows to ask for: 5-minute ones for two days or less, else hourly. */
function statisticsQuery(range: Range): StatisticsQuery {
  const period = range.end - range.start <= 2 * 86_400_000 ? '5minute' : 'hour';
  return { period, types: ['mean', 'max'], value: 'mean' };
}

function loadWind(ctx: ChartContext, direction: Role, speed: Role | undefined, now = Date.now()): WindFrame {
  const period = windPeriod(ctx.raw);
  const source: Source = (ctx.raw.source as Source | undefined) ?? 'history';
  const zone = zoneFor(ctx.hass);
  const span = periodRange(period, now, zone, period.navigate ? stepsFor(ctx.host, period) : 0);
  const range: Range = { start: span.start, end: span.end };
  const requests: SeriesRequest[] = [
    { entity: direction.id, attribute: direction.entity.attribute, bearing: true },
    ...(speed ? [{ entity: speed.id, attribute: speed.entity.attribute }] : []),
  ];
  const statistics = source === 'statistics' ? statisticsQuery(range) : undefined;
  const rowMs = statistics ? PERIOD_MS[statistics.period] : Infinity;
  const load = statistics ? { start: range.start - rowMs, end: range.end } : range;
  const loaded = storeFor(ctx.host, ctx.requestUpdate).get(ctx.hass, requests, load, source, {
    live: span.live,
    statistics,
  });
  // Each sensor with a `when` (its own or the card's) keeps only the readings taken while it held;
  // a gap in either drops that stretch from the rose.
  const roles = speed ? [direction.entity, speed.entity] : [direction.entity];
  const conditions = loadConditions(ctx.host, ctx.hass, roles, load, span.live, ctx.requestUpdate, ctx.raw);
  const points = (r: SeriesRequest, role: Role) =>
    conditionalPoints(role.entity, loaded.data.get(key(r)) ?? [], conditions);
  const dirPoints = points(requests[0], direction);
  const speedPoints = speed ? points(requests[1], speed) : undefined;
  const frame: HistoryFrame = {
    status: conditionStatus(loaded.status, conditions),
    error: loaded.error,
    range,
    period,
    source,
    series: [],
    live: span.live,
    back: span.back,
    zone,
  };
  return {
    frame,
    direction: dirPoints,
    // A speed sensor with no readings at all (missing, unavailable all along) leaves a rose of
    // directions only, rather than nothing.
    speed: speedPoints?.some((p) => p.v !== null) ? speedPoints : undefined,
    until: Math.min(range.end, now),
    maxHold: rowMs,
  };
}

/** A speed band as drawn: where it starts, its colour and its legend text. */
interface SpeedBand {
  from: number;
  color: string;
  label: string;
}

/**
 * Sequential colours for the default bands, from the theme's primary colour: mixed towards the
 * card's background for light winds and towards the text colour for strong ones, the strongest
 * turning purple. In a dark theme the same mixes run dark to light, so strong winds still stand out.
 */
const RAMP = [
  'color-mix(in srgb, var(--primary-color, #2f6fe4) 35%, var(--card-background-color, #fff))',
  'color-mix(in srgb, var(--primary-color, #2f6fe4) 62%, var(--card-background-color, #fff))',
  'var(--primary-color, #2f6fe4)',
  'color-mix(in srgb, var(--primary-color, #2f6fe4) 68%, var(--primary-text-color, #212121))',
  'color-mix(in srgb, var(--purple-color, #8b6cff) 80%, var(--primary-text-color, #212121))',
];

const numberText = (n: number, ctx: ChartContext) => formatNumber(n, Number.isInteger(n) ? 0 : 1, ctx.hass);

function rangeLabel(from: number, next: number | undefined, ctx: ChartContext): string {
  if (!Number.isFinite(from)) return next === undefined ? '' : `< ${numberText(next, ctx)}`;
  return next === undefined ? `${numberText(from, ctx)}+` : `${numberText(from, ctx)}–${numberText(next, ctx)}`;
}

/** The card's colour bands when it has any (on the speed entity or the card), else the defaults. */
export function speedBands(bands: ResolvedBand[], defaults: number[], ctx: ChartContext): SpeedBand[] {
  if (bands !== DEFAULT_BANDS && bands.length > 0) {
    return bands.map((b, i) => ({
      from: b.from,
      color: baseColor(b.color),
      label: b.label ?? rangeLabel(b.from, bands[i + 1]?.from, ctx),
    }));
  }
  return defaults.map((from, i) => ({
    from,
    color: RAMP[i % RAMP.length],
    label: rangeLabel(from, defaults[i + 1], ctx),
  }));
}

/** A share (0–1) as a percentage: whole numbers, with one decimal under 1 % (or with `fine`). */
function shareText(share: number, ctx: ChartContext, fine = false): string {
  const pct = share * 100;
  if (pct === 0) return `${formatNumber(0, 0, ctx.hass)}%`;
  return `${formatNumber(pct, fine || pct < 1 ? 1 : 0, ctx.hass)}%`;
}

/** Which sector is under the pointer or focus, per card. */
const hovered = new WeakMap<HTMLElement, number>();

function setHover(ctx: ChartContext, sector: number | undefined) {
  if (hovered.get(ctx.host) === sector) return;
  if (sector === undefined) hovered.delete(ctx.host);
  else hovered.set(ctx.host, sector);
  ctx.requestUpdate();
}

const R = 100;
const R0 = 10;
const BOX = 124;

interface Drawn {
  rose: Rose;
  n: number;
  bands: SpeedBand[];
  rings: number[];
  /** Radius for a share (0–1). */
  radius(share: number): number;
}

/**
 * Where to write the ring values: along the edge between two sectors, choosing the edge whose
 * neighbouring petals are shortest, so the numbers sit in a gap rather than on a petal.
 */
function ringLabelAngle(totals: number[]): number {
  const n = totals.length;
  let best = 0;
  let bestLength = Infinity;
  // Start at the north-east and go round, so a tie keeps the labels top right.
  for (let k = 0; k < n; k++) {
    const edge = (Math.floor(n / 8) + k) % n;
    const length = Math.max(totals[edge], totals[(edge + 1) % n]);
    if (length < bestLength - 1e-9) {
      best = edge;
      bestLength = length;
    }
  }
  return ((best + 0.5) * 2 * Math.PI) / n;
}

function roseSvg(d: Drawn, direction: Role, label: string, ctx: ChartContext): TemplateResult {
  const { rose, n, bands, rings } = d;
  const step = (2 * Math.PI) / n;
  const pad = step * 0.09;
  const tooltip = tooltipEnabled(ctx.raw);
  const petals = rose.sectors.map((row, i) => {
    if (rose.totals[i] <= 0) return nothing;
    const a0 = i * step - step / 2 + pad;
    const a1 = i * step + step / 2 - pad;
    let acc = 0;
    const parts = row.map((share, b) => {
      if (share <= 0) return nothing;
      const path = petalPath(d.radius(acc), d.radius(acc + share), a0, a1);
      acc += share;
      return svg`<path d=${path} style="fill:${bands[b].color}"></path>`;
    });
    const name = sectorName(i, n);
    const interactive = direction.index >= 0;
    return svg`<g
      class="petal ${interactive ? 'entity' : ''}"
      data-index=${interactive ? direction.index : nothing}
      data-sector=${i}
      tabindex=${interactive || tooltip ? 0 : nothing}
      aria-label=${`${name} ${shareText(rose.totals[i], ctx, true)}`}
      @pointerenter=${tooltip ? () => setHover(ctx, i) : nothing}
      @pointerleave=${tooltip ? () => setHover(ctx, undefined) : nothing}
      @focus=${tooltip ? () => setHover(ctx, i) : nothing}
      @blur=${tooltip ? () => setHover(ctx, undefined) : nothing}
    >${parts}</g>`;
  });
  const ringAngle = ringLabelAngle(rose.totals);
  const compass = (['N', 'E', 'S', 'W'] as const).map((name, q) => {
    const [x, y] = polarPoint(R + 13, (q * Math.PI) / 2);
    return svg`<text class="compass ${name === 'N' ? 'north' : ''}" x=${x} y=${y + 4}>${name}</text>`;
  });
  return html`<svg class="rose" viewBox="${-BOX} ${-BOX} ${2 * BOX} ${2 * BOX}" role="img" aria-label=${label}>
    ${rings.map((p) => svg`<circle class="ring" r=${d.radius(p / 100)}></circle>`)}
    <circle class="rim" r=${R + 2}></circle>
    <line class="spoke" x1="0" y1=${-R - 2} x2="0" y2=${R + 2}></line>
    <line class="spoke" x1=${-R - 2} y1="0" x2=${R + 2} y2="0"></line>
    <g class="petals">${petals}</g>
    <circle class="calm-circle" r=${R0 - 1}></circle>
    ${compass}
    ${rings.map((p) => {
      const [x, y] = polarPoint(d.radius(p / 100), ringAngle);
      const anchor = Math.sin(ringAngle) >= 0 ? 'start' : 'end';
      return svg`<text class="ring-label" x=${x + (anchor === 'start' ? 3 : -3)} y=${y} text-anchor=${anchor}>${formatNumber(
        p,
        Number.isInteger(p) ? 0 : 1,
        ctx.hass,
      )}%</text>`;
    })}
  </svg>`;
}

/** The hovered sector's share and its split by speed band, beside the petal's tip. */
function roseTooltip(d: Drawn, speedUnit: string | undefined, ctx: ChartContext): TemplateResult | typeof nothing {
  const i = hovered.get(ctx.host);
  if (i === undefined || !tooltipEnabled(ctx.raw) || !(d.rose.totals[i] > 0)) return nothing;
  const angle = (i * 2 * Math.PI) / d.n;
  const [x, y] = polarPoint(d.radius(d.rose.totals[i]), angle);
  // The box goes towards the middle, so it stays over the rose rather than off the card.
  const side = x > 0 ? 'left' : 'right';
  const rows =
    speedUnit === undefined
      ? [{ color: d.bands[0].color, name: localize(ctx.hass, 'wind_share'), share: d.rose.totals[i] }]
      : d.rose.sectors[i]
          .map((share, b) => ({ color: d.bands[b].color, name: withUnit(d.bands[b].label, speedUnit), share }))
          .filter((r) => r.share > 0);
  return html`<div class="hover-layer" aria-hidden="true">
    <div
      class="tooltip rose-tip ${side}"
      style="left:${((x + BOX) / (2 * BOX)) * 100}%;top:${((y + BOX) / (2 * BOX)) * 100}%"
    >
      <div class="tooltip-time">${sectorName(i, d.n)} · ${shareText(d.rose.totals[i], ctx, true)}</div>
      ${rows.map(
        (r) =>
          html`<div class="tooltip-row">
            <span class="swatch" style="background:${r.color}"></span>
            <span class="tooltip-name">${r.name}</span>
            <span class="tooltip-value">${shareText(r.share, ctx, true)}</span>
          </div>`,
      )}
    </div>
  </div>`;
}

function stat(label: string, value: string, role: Role | undefined, kind: string): TemplateResult {
  const interactive = role !== undefined && role.index >= 0;
  return html`<div
    class="stat stat-${kind} ${interactive ? 'entity' : ''}"
    data-index=${interactive ? role.index : nothing}
    tabindex=${interactive ? 0 : nothing}
  >
    <span class="stat-label">${label}</span>
    <span class="stat-value">${value}</span>
  </div>`;
}

function readout(
  d: Drawn,
  roles: { direction: Role; speed?: Role },
  speed: { unit: string; decimals: number; points: Point[] } | undefined,
  ctx: ChartContext,
): TemplateResult {
  const t = (k: string, vars?: Record<string, string>) => localize(ctx.hass, k, vars);
  const { rose } = d;
  const prevailing =
    rose.prevailing < 0 ? '—' : `${sectorName(rose.prevailing, d.n)} · ${shareText(rose.totals[rose.prevailing], ctx)}`;
  const speedText = (v: number | null) =>
    v === null ? '—' : withUnit(formatNumber(v, speed?.decimals ?? 1, ctx.hass), speed?.unit ?? '');
  return html`<div class="readout">
    <div class="stats">
      ${stat(t('wind_prevailing'), prevailing, roles.direction, 'prevailing')}
      ${
        speed
          ? html`${stat(t('wind_mean_speed'), speedText(rose.meanSpeed), roles.speed, 'mean')}
            ${stat(t('wind_strongest'), speedText(strongest(speed.points)), roles.speed, 'strongest')}
            ${stat(t('wind_calm'), shareText(rose.calm, ctx), roles.speed, 'calm')}`
          : nothing
      }
    </div>
    ${
      speed
        ? html`<div class="speed-legend">
            <div class="stat-label">${speed.unit ? t('wind_speed_unit', { unit: speed.unit }) : t('wind_speed')}</div>
            <div class="keys">
              ${d.bands.map(
                (b) =>
                  html`<div class="key">
                    <span class="key-swatch" style="background:${b.color}"></span>
                    <span class="key-label">${b.label}</span>
                  </div>`,
              )}
            </div>
          </div>`
        : nothing
    }
  </div>`;
}

export const windRoseStyle: ChartStyleModule = {
  layout: 'chart',
  group: 'distribution',
  height: 280,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    ${layoutStyles}
    .wind {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px 20px;
    }
    .rose-wrap {
      position: relative;
      flex: 1 1 200px;
      max-width: 270px;
      aspect-ratio: 1;
    }
    .rose {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .rose .ring {
      fill: none;
      stroke: var(--divider-color, rgba(127, 127, 127, 0.3));
      stroke-dasharray: 3 3;
    }
    .rose .rim,
    .rose .spoke {
      fill: none;
      stroke: var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .rose .calm-circle {
      fill: var(--card-background-color, #fff);
      stroke: var(--divider-color, rgba(127, 127, 127, 0.3));
    }
    .rose text {
      font-family: inherit;
      fill: var(--secondary-text-color);
      text-anchor: middle;
      font-size: 12px;
    }
    .rose .compass.north {
      fill: var(--primary-text-color);
      font-weight: 500;
    }
    .rose .ring-label {
      font-size: 10px;
      paint-order: stroke;
      stroke: var(--card-background-color, #fff);
      stroke-width: 3px;
      stroke-linejoin: round;
    }
    .rose .petal {
      outline: none;
      transform-box: view-box;
      transform-origin: 0 0;
      transform: scale(0);
      transition: transform var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .rose .petal {
      transform: scale(1);
    }
    .rose .petal.entity {
      cursor: pointer;
    }
    .rose .petal:focus-visible path {
      stroke: var(--primary-text-color);
      stroke-width: 1.5px;
    }
    .rose-tip {
      top: 0;
      white-space: nowrap;
    }
    .tooltip.rose-tip.right {
      transform: translate(10px, -50%);
    }
    .tooltip.rose-tip.left {
      transform: translate(calc(-100% - 10px), -50%);
    }
    .readout {
      flex: 1 1 150px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
      gap: 8px 16px;
    }
    .stat {
      display: flex;
      flex-direction: column;
      min-width: 0;
      border-radius: 4px;
    }
    .stat.entity {
      cursor: pointer;
    }
    .stat:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    .stat-label {
      color: var(--secondary-text-color);
      font-size: 0.875em;
    }
    .stat-value {
      font-size: 1.25em;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-variant-numeric: tabular-nums;
    }
    .keys {
      display: flex;
      gap: 4px;
      margin-top: 6px;
    }
    .key {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .key-swatch {
      width: 100%;
      height: 10px;
      border-radius: 2px;
    }
    .key-label {
      font-size: 11px;
      color: var(--secondary-text-color);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .frame.compact .rose-wrap {
      max-width: 170px;
      flex-basis: 150px;
    }
    .frame.compact .wind {
      gap: 4px 12px;
    }
    .frame.compact .readout {
      gap: 8px;
    }
    .frame.compact .stats {
      gap: 4px 12px;
    }
    .frame.compact .stat-value {
      font-size: 1.05em;
    }
  `,
  thumbnail: () => svg`
    <circle cx="32" cy="20" r="17" fill="none" stroke="var(--divider-color, #ccc)" stroke-dasharray="2 2" />
    <path d="M32 20 L21 29 A14 14 0 0 1 18 23 Z" fill="var(--primary-color, #03a9f4)" />
    <path d="M32 20 L27 34 A15 15 0 0 1 22 32 Z" fill="var(--primary-color, #03a9f4)" opacity="0.7" />
    <path d="M32 20 L23 14 A10 10 0 0 1 26 11 Z" fill="var(--primary-color, #03a9f4)" opacity="0.5" />
    <path d="M32 20 L36 12 A9 9 0 0 1 40 15 Z" fill="var(--primary-color, #03a9f4)" opacity="0.4" />
    <path d="M32 20 L40 24 A9 9 0 0 1 37 27 Z" fill="var(--primary-color, #03a9f4)" opacity="0.4" />`,
  validate(raw: CardConfig) {
    validateHistoryOptions(raw);
    windPeriod(raw);
    validateTooltipOptions(raw);
    validateLayout(raw);
    windSectors(raw);
    calmOption(raw);
  },
  editor: windRoseEditor,
  disconnect(host) {
    disconnectHistory(host);
    hovered.delete(host);
  },
  render(ctx) {
    const layout = { ...chartLayout(ctx.raw), header: 'above' as const };
    const roles = windRoles(ctx);
    const direction = roles.direction;
    if (!direction) return html``;
    const loaded = loadWind(ctx, direction, roles.speed);
    const { frame } = loaded;
    const nav = periodNav(frame, ctx);
    const noData = html`<div class="chart-message">${localize(ctx.hass, 'chart_no_data')}</div>`;
    const message =
      frame.status !== 'ready'
        ? frameMessage(frame, ctx)
        : loaded.direction.every((p) => p.v === null)
          ? noData
          : undefined;
    if (message) return chartFrame(layout, nav, message);

    const n = windSectors(ctx.raw);
    const speedRole = loaded.speed ? roles.speed : undefined;
    const speed = speedRole ? speedUnit(speedRole, ctx) : undefined;
    const unit = speed?.unit;
    // Speeds, the default bands (picked for the shown unit) and the calm limit all in the shown unit.
    const speedPoints = loaded.speed && convertPoints(loaded.speed, speed?.conversion);
    const defaults = speedDefaults(unit);
    const bands: SpeedBand[] = speedRole
      ? speedBands(resolveBands(speedRole.entity.severity, ctx.hass, unit), defaults.from, ctx)
      : [{ from: 0, color: 'var(--primary-color, #2f6fe4)', label: '' }];
    const calm = speedRole ? (calmOption(ctx.raw) ?? defaults.calm) : 0;
    const samples = pairWind(loaded.direction, speedPoints, loaded.until, loaded.maxHold);
    const rose = windRose(
      samples,
      n,
      bands.map((b) => b.from),
      calm,
    );
    if (rose.total <= 0) return chartFrame(layout, nav, noData);
    const longest = Math.max(0, ...rose.totals) * 100;
    const rings = ringSteps(longest);
    const top = (rings[rings.length - 1] ?? 100) / 100;
    const drawn: Drawn = { rose, n, bands, rings, radius: (share) => R0 + (share / top) * (R - R0) };

    const pct = (s: number) => shareText(s, ctx);
    const vars = {
      direction: rose.prevailing < 0 ? '' : sectorName(rose.prevailing, n),
      share: rose.prevailing < 0 ? '' : pct(rose.totals[rose.prevailing]),
      calm: pct(rose.calm),
    };
    const label = localize(
      ctx.hass,
      rose.prevailing < 0 ? 'wind_aria_still' : speedRole ? 'wind_aria_calm' : 'wind_aria',
      vars,
    );
    const speedInfo = speedRole
      ? {
          unit: unit ?? '',
          decimals: speedRole.index >= 0 ? ctx.items[speedRole.index].decimals : 1,
          points: speedPoints ?? [],
        }
      : undefined;
    return chartFrame(
      layout,
      nav,
      html`<div class="wind">
        <div class="rose-wrap">
          ${roseSvg(drawn, direction, label, ctx)} ${roseTooltip(drawn, speedInfo ? speedInfo.unit : undefined, ctx)}
        </div>
        ${readout(drawn, { direction, speed: speedRole }, speedInfo, ctx)}
      </div>`,
    );
  },
};
