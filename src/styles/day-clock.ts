import { css, html, nothing, svg } from 'lit';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { baseColor } from '../bands';
import { formatTime, hour12Of } from '../chart/axes';
import {
  BUCKETS,
  DAY_MINUTES,
  TAU,
  activeSet,
  averageDay,
  barHeights,
  clip,
  clockDays,
  foldSlots,
  formatClockDuration,
  isAdditive,
  minuteAngle,
  polar,
  ringLayout,
  sectorPath,
  stateIntervals,
  switchOns,
  totalMs,
  wallMinute,
  wallSpans,
} from '../chart/day-clock';
import type { AverageRun, Bucket, Interval, Slot } from '../chart/day-clock';
import { SERIES_COLORS, disconnectHistory, frameStyles, periodNav, seriesTransform } from '../chart/frame';
import type { HistoryFrame } from '../chart/frame';
import { TOUCH_LINGER_MS, tooltipEnabled, tooltipStyles, validateTooltipOptions } from '../chart/tooltip';
import { dayClockEditor, dayClockEntityFields } from '../editor/day-clock-editor';
import { formatNumber, withUnit } from '../format';
import { key, toReading } from '../history/fetch';
import { AGGREGATES } from '../history/group';
import type { Aggregate } from '../history/group';
import { parsePeriod, stepsFor } from '../history/period';
import type { Period } from '../history/period';
import { storeFor } from '../history/store';
import { convertPoints } from '../units';
import { chartConditions, conditionStatus, conditionalPoints, validateConditions } from '../history/condition';
import { zoneFor } from '../history/timezone';
import type { Point, SeriesRequest } from '../history/types';
import { localize } from '../localize';
import type { ResolvedEntity } from '../resolve';
import type { CardConfig, HomeAssistant } from '../types';
import type { ChartContext, ChartStyleModule } from './index';

export const CENTER = ['total', 'now', 'none'] as const;
export type Center = (typeof CENTER)[number];

/** Most days an average day may cover: a month of history is already a lot to load. */
export const MAX_DAYS = 31;

/** Arcs or bars per ring above which they are no longer each a tab stop. */
const MAX_FOCUSABLE = 48;

/** Domains whose states are words (on, heating, home), drawn as arcs rather than bars. */
const STATE_DOMAINS = new Set([
  'alarm_control_panel',
  'automation',
  'binary_sensor',
  'calendar',
  'climate',
  'cover',
  'device_tracker',
  'fan',
  'humidifier',
  'input_boolean',
  'lawn_mower',
  'light',
  'lock',
  'media_player',
  'person',
  'remote',
  'schedule',
  'script',
  'siren',
  'switch',
  'timer',
  'vacuum',
  'valve',
  'water_heater',
]);

type Own = { color?: string; active?: unknown };

const domainOf = (id: string) => id.split('.')[0];

/**
 * Arcs (time in a state) or bars (numbers by the hour). An entity with its own `active` list is
 * always a state ring; else its domain decides, then whether it has a unit or reads as a number.
 */
export function ringKind(e: ResolvedEntity): 'state' | 'numeric' {
  const active = (e.config as Own).active;
  if ((typeof active === 'string' && active.trim() !== '') || (Array.isArray(active) && active.length > 0)) {
    return 'state';
  }
  if (STATE_DOMAINS.has(domainOf(e.entityId))) return 'state';
  const attrs = e.stateObj?.attributes ?? {};
  if (!e.config.attribute && (attrs.unit_of_measurement !== undefined || attrs.state_class !== undefined)) {
    return 'numeric';
  }
  // Without a unit, a ring of numbers only when the state reads as one; words get a state ring.
  const state = e.stateObj?.state;
  const numeric = typeof state === 'string' && state.trim() !== '' && Number.isFinite(Number(state));
  return e.available && numeric ? 'numeric' : 'state';
}

/** A climate entity's state is its mode (heat all day); what it is doing is its `hvac_action`. */
function attributeOf(e: ResolvedEntity, kind: 'state' | 'numeric'): string | undefined {
  if (e.config.attribute) return e.config.attribute;
  return kind === 'state' && domainOf(e.entityId) === 'climate' ? 'hvac_action' : undefined;
}

/** The bars' aggregate: the card's, else change for meters, else a time-weighted mean. */
function aggregateOf(e: ResolvedEntity, raw: CardConfig): Aggregate {
  if (raw.aggregate !== undefined) return raw.aggregate as Aggregate;
  // A transformed series (running total, rate of change) is a level to average, not a meter.
  if ((e.config as { transform?: string }).transform !== undefined) return 'mean';
  const sc = e.stateObj?.attributes?.state_class;
  return sc === 'total_increasing' || sc === 'total' ? 'change' : 'mean';
}

export function validateDayClock(raw: CardConfig): void {
  validateTooltipOptions(raw);
  validateConditions(raw);
  parsePeriod(raw.period as CardConfig['period']);
  const days = raw.days;
  if (days !== undefined && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_DAYS)) {
    throw new Error(`"days" must be a whole number from 1 to ${MAX_DAYS}`);
  }
  if (raw.center !== undefined && !CENTER.includes(raw.center as Center)) {
    throw new Error(`"center" must be one of: ${CENTER.join(', ')}`);
  }
  if (raw.bucket !== undefined && !BUCKETS.includes(Number(raw.bucket) as Bucket)) {
    throw new Error(`"bucket" must be one of: ${BUCKETS.join(', ')}`);
  }
  if (raw.aggregate !== undefined && !AGGREGATES.includes(raw.aggregate as Aggregate)) {
    throw new Error(`"aggregate" must be one of: ${AGGREGATES.join(', ')}`);
  }
  for (const e of raw.entities ?? []) {
    if (typeof e !== 'object' || e === null) continue;
    const active = (e as Own).active;
    if (active === undefined) continue;
    const ok =
      (typeof active === 'string' && active.trim() !== '') ||
      (Array.isArray(active) && active.every((s) => typeof s === 'string'));
    if (!ok) throw new Error('"active" must be a state or a list of states');
  }
}

/** One ring, worked out: what it draws and what the legend says about it. */
export interface Ring {
  index: number;
  entity: ResolvedEntity;
  kind: 'state' | 'numeric';
  color: string;
  missing: boolean;
  hasData: boolean;
  /** State rings on a single day: the active stretches. */
  intervals: Interval[];
  /** State rings over several days: the average day. */
  runs: AverageRun[];
  /** Numeric rings: one bar per bucket, with heights 0–1. */
  slots: Slot[];
  heights: number[];
  aggregate: Aggregate;
  /** Active time (a day, on average), and switch-ons (a day). */
  totalMs: number;
  count: number;
  /** The last active state seen, for "heating on". */
  word?: string;
  /** The legend's line under the name. */
  stat: string;
}

export interface Clock {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  rings: Ring[];
  /** Each day's start, then the end of the last one. */
  bounds: number[];
  days: number;
  bucket: number;
  live: boolean;
  now: number;
  period: Period;
  back: number;
  zone: ReturnType<typeof zoneFor>;
}

/** The period the buttons step: one day, or `days` days at a time. */
function clockPeriod(raw: CardConfig, days: number): Period {
  const own = parsePeriod(raw.period as CardConfig['period']);
  return days === 1
    ? { last: 1, unit: 'day', calendar: 'day', offset: own.offset, navigate: own.navigate, until: 'end' }
    : { last: days, unit: 'day', offset: own.offset, navigate: own.navigate, until: 'end' };
}

/** A state word as the user reads it ("on", "heating"), lower case to follow a name. */
function stateWord(hass: HomeAssistant, e: ResolvedEntity, word: string, attribute: string | undefined): string {
  const s = e.stateObj;
  let text = word.replace(/_/g, ' ');
  if (s) {
    const formatted = attribute
      ? hass.formatEntityAttributeValue?.(s, attribute, word)
      : hass.formatEntityState?.(s, word);
    if (formatted) text = formatted;
  }
  return text.toLocaleLowerCase();
}

/** A wall-clock minute of the day as the user's clock shows it: "07:00", "7:00 AM". */
export function minuteLabel(minutes: number, hass?: HomeAssistant): string {
  const m = Math.round(minutes) % DAY_MINUTES;
  const t = Date.UTC(2000, 0, 1, Math.floor(m / 60), m % 60);
  return new Intl.DateTimeFormat(hass?.locale?.language ?? 'en', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: hour12Of(hass),
    timeZone: 'UTC',
  }).format(t);
}

/** The dial's four labels: "00 06 12 18", or "12 AM 6 AM…" on a 12-hour clock. */
export function dialLabels(hass?: HomeAssistant): string[] {
  const language = hass?.locale?.language ?? 'en';
  let twelve = hour12Of(hass);
  if (twelve === undefined) {
    try {
      twelve = new Intl.DateTimeFormat(language, { hour: 'numeric' }).resolvedOptions().hour12 === true;
    } catch {
      twelve = false;
    }
  }
  if (!twelve) return ['00', '06', '12', '18'];
  return [0, 6, 12, 18].map((h) =>
    new Intl.DateTimeFormat(language, { hour: 'numeric', hour12: true, timeZone: 'UTC' }).format(
      Date.UTC(2000, 0, 1, h),
    ),
  );
}

function valueText(v: number, e: ResolvedEntity, hass: HomeAssistant): string {
  return withUnit(formatNumber(v, e.decimals, hass), e.unit);
}

function timesText(hass: HomeAssistant, n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded === 1 ? localize(hass, 'day_clock_times_one') : localize(hass, 'day_clock_times', { n: rounded });
}

/** Load the card's history and work out every ring. */
export function dayClock(ctx: ChartContext, now = Date.now()): Clock {
  const { raw, hass } = ctx;
  const days = (raw.days as number | undefined) ?? 1;
  const bucket = Number(raw.bucket ?? 60);
  const period = clockPeriod(raw, days);
  const back = Math.max(0, period.offset + (period.navigate ? stepsFor(ctx.host, period) : 0));
  const zone = zoneFor(hass);
  const bounds = clockDays(now, zone, days, back);
  const live = back === 0;
  const end = bounds[bounds.length - 1];
  const until = Math.min(end, now);
  const kinds = ctx.items.map(ringKind);
  const requests: SeriesRequest[] = ctx.items.map((e, i) => ({
    entity: e.entityId,
    attribute: attributeOf(e, kinds[i]),
    text: true,
  }));
  const store = storeFor(ctx.host, ctx.requestUpdate);
  const loaded = store.get(hass, requests, { start: bounds[0], end: live ? now : end }, 'history', { live });
  const range = { start: bounds[0], end: until };
  // Rings with a `when` (their own or the card's) count only the time while it held.
  const conditions = chartConditions(ctx, { start: bounds[0], end: live ? now : end }, live);
  const status = conditionStatus(loaded.status, conditions);
  // Days that have begun: the average is per day of those, today counting as one once it starts.
  const daysSoFar = Math.max(1, bounds.slice(0, -1).filter((b) => b < until).length);
  const rings = ctx.items.map((entity, index): Ring => {
    const kind = kinds[index];
    const own = entity.config as typeof entity.config & Own;
    // A missing entity has no history worth drawing: an empty ring and "Entity not found".
    const points = entity.stateObj
      ? conditionalPoints(entity.config, loaded.data.get(key(requests[index])) ?? [], conditions)
      : [];
    const ring: Ring = {
      index,
      entity,
      kind,
      color: baseColor(own.color ?? SERIES_COLORS[index % SERIES_COLORS.length]),
      missing: !entity.stateObj,
      hasData: false,
      intervals: [],
      runs: [],
      slots: [],
      heights: [],
      aggregate: aggregateOf(entity, raw),
      totalMs: 0,
      count: 0,
      stat: '',
    };
    if (kind === 'state') {
      const active = activeSet(own.active);
      const spans = stateIntervals(points, range, active);
      ring.hasData = spans.known.length > 0;
      ring.word = spans.word;
      const on = spans.active;
      if (days === 1) ring.intervals = on;
      else ring.runs = averageDay(on, spans.known, bounds, zone.timeZone);
      ring.totalMs = totalMs(on) / daysSoFar;
      let count = 0;
      for (let d = 0; d + 1 < bounds.length; d++) {
        count += switchOns(clip(on, { start: bounds[d], end: bounds[d + 1] }));
      }
      ring.count = count / daysSoFar;
      // Over several days, each figure is a day's average: "30 m a day · 0.7 times a day".
      const daily = (text: string) => (days === 1 ? text : localize(hass, 'day_clock_a_day', { text }));
      const parts = [daily(formatClockDuration(ring.totalMs))];
      if (ring.count > 0) parts.push(daily(timesText(hass, ring.count)));
      ring.stat = parts.join(' · ');
    } else {
      // Loaded as words (a ring may be a state ring), read as numbers here, then in the shown unit.
      const numbers: Point[] = convertPoints(
        points.map((p) => ({ ...p, v: toReading(p.s), s: undefined })),
        entity.conversion,
      );
      // The entity's history transform (running total, rate of change), before folding into the day.
      const shown = seriesTransform(entity, numbers, range, until, zone, hass);
      ring.entity = shown.entity;
      ring.slots = foldSlots(shown.points, bounds, bucket, ring.aggregate, until, zone.timeZone);
      const additive = isAdditive(ring.aggregate);
      ring.heights = barHeights(ring.slots, additive);
      ring.hasData = ring.slots.length > 0;
      if (ring.hasData) {
        const top = ring.slots.reduce((a, b) => (b.v > a.v ? b : a));
        const time = minuteLabel(top.index * bucket, hass);
        if (additive) {
          const total = valueText(
            ring.slots.reduce((a, s) => a + s.v, 0),
            ring.entity,
            hass,
          );
          ring.stat = localize(hass, 'day_clock_busiest', {
            total: days === 1 ? total : localize(hass, 'day_clock_a_day', { text: total }),
            time,
          });
        } else {
          ring.stat = localize(hass, 'day_clock_peak', { value: valueText(top.v, ring.entity, hass), time });
        }
      }
    }
    if (ring.missing) ring.stat = localize(hass, 'entity_not_found');
    else if (!ring.hasData && status === 'ready') ring.stat = localize(hass, 'day_clock_no_data');
    return ring;
  });
  return {
    status,
    error: loaded.error,
    rings,
    bounds,
    days,
    bucket,
    live,
    now,
    period,
    back,
    zone,
  };
}

/* ------------------------------------------------------------------ hover */

/** Which arc or bar the pointer (or focus) is on. */
interface HoverState {
  ring?: number;
  item?: number;
  timer?: ReturnType<typeof setTimeout>;
}
const hovers = new WeakMap<HTMLElement, HoverState>();

function hoverOf(host: HTMLElement): HoverState {
  let h = hovers.get(host);
  if (!h) {
    h = {};
    hovers.set(host, h);
  }
  return h;
}

function setHover(ctx: ChartContext, ring: number | undefined, item: number | undefined): void {
  const h = hoverOf(ctx.host);
  if (h.timer !== undefined) clearTimeout(h.timer);
  h.timer = undefined;
  if (h.ring === ring && h.item === item) return;
  h.ring = ring;
  h.item = item;
  ctx.requestUpdate();
}

function leave(ctx: ChartContext, ev: Event): void {
  const touch = (ev as PointerEvent).pointerType === 'touch' || (ev as PointerEvent).pointerType === 'pen';
  if (!touch) {
    setHover(ctx, undefined, undefined);
    return;
  }
  const h = hoverOf(ctx.host);
  if (h.timer !== undefined) clearTimeout(h.timer);
  h.timer = setTimeout(() => {
    h.timer = undefined;
    setHover(ctx, undefined, undefined);
  }, TOUCH_LINGER_MS);
}

/* ------------------------------------------------------------------ live hand */

const ticks = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Redraw at the start of the next minute, so the hand and the dimmed future keep up. */
function tickNextMinute(ctx: ChartContext, now: number): void {
  if (ticks.has(ctx.host)) return;
  const wait = 60_000 - (now % 60_000) + 50;
  ticks.set(
    ctx.host,
    setTimeout(() => {
      ticks.delete(ctx.host);
      // Hidden tabs skip the redraw; the next visible minute catches up.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') tickNextMinute(ctx, Date.now());
      else ctx.requestUpdate();
    }, wait),
  );
}

function stopTick(host: HTMLElement): void {
  const t = ticks.get(host);
  if (t !== undefined) clearTimeout(t);
  ticks.delete(host);
}

/* ------------------------------------------------------------------ drawing */

/** The dial's drawing box: centre at 0, 0. Wider than tall so side labels fit. */
const VIEW = { x: -132, y: -120, w: 264, h: 240 };
const OUTER = 92;

interface Mark {
  d: string;
  /** Mid-angle and radius, for placing the tooltip. */
  angle: number;
  r: number;
  opacity?: number;
  /** The interval, run or slot it draws (its index in the ring's list). */
  item: number;
}

function stateMarks(ring: Ring, clock: Clock, r0: number, r1: number): Mark[] {
  const tz = clock.zone.timeZone;
  if (clock.days === 1) {
    return ring.intervals.map((iv, item) => {
      const spans = wallSpans(iv, clock.bounds[0], tz);
      const d = spans.map(([a, b]) => sectorPath(r0, r1, minuteAngle(a), minuteAngle(b))).join('');
      const mid = spans.length ? (spans[0][0] + spans[spans.length - 1][1]) / 2 : 0;
      return { d, angle: minuteAngle(mid), r: r1, item };
    });
  }
  return ring.runs.map((run, item) => ({
    d: sectorPath(r0, r1, minuteAngle(run.from), minuteAngle(run.to)),
    angle: minuteAngle((run.from + run.to) / 2),
    r: r1,
    opacity: Math.max(0.12, run.on / Math.max(1, run.of)),
    item,
  }));
}

function barMarks(ring: Ring, clock: Clock, r0: number, r1: number): Mark[] {
  const per = DAY_MINUTES / clock.bucket;
  // A small gap either side of each bar, less when the bars are thin.
  const pad = Math.min(0.03, TAU / per / 8);
  const additive = isAdditive(ring.aggregate);
  const marks: Mark[] = [];
  ring.slots.forEach((slot, i) => {
    // An hour with nothing added (no motion, no energy) has no bar, as on a bar chart.
    if (additive && slot.v === 0) return;
    const a0 = (slot.index / per) * TAU + pad;
    const a1 = ((slot.index + 1) / per) * TAU - pad;
    const r = r0 + Math.max(0.04, ring.heights[i]) * (r1 - r0);
    marks.push({ d: sectorPath(r0, r, a0, a1), angle: (a0 + a1) / 2, r, item: i });
  });
  return marks;
}

/** The tooltip's lines for the hovered arc or bar. */
function tipText(ring: Ring, item: number, clock: Clock, hass: HomeAssistant): { time: string; value: string } {
  const range = (from: string, to: string) => localize(hass, 'day_clock_range', { from, to });
  if (ring.kind === 'numeric') {
    const slot = ring.slots[item];
    const time = range(
      minuteLabel(slot.index * clock.bucket, hass),
      minuteLabel((slot.index + 1) * clock.bucket, hass),
    );
    const value = valueText(slot.v, ring.entity, hass);
    return { time, value: clock.days === 1 ? value : localize(hass, 'day_clock_average_value', { value }) };
  }
  if (clock.days > 1) {
    const run = ring.runs[item];
    return {
      time: range(minuteLabel(run.from, hass), minuteLabel(run.to, hass)),
      value: localize(hass, 'day_clock_on_days', { on: run.on, of: run.of }),
    };
  }
  const iv = ring.intervals[item];
  const running = clock.live && iv.end >= clock.now - 1000;
  const to = running ? localize(hass, 'day_clock_now').toLocaleLowerCase() : formatTime(iv.end, hass);
  const duration = formatClockDuration(iv.end - iv.start);
  return {
    time: range(formatTime(iv.start, hass), to),
    value: running ? localize(hass, 'day_clock_so_far', { duration }) : duration,
  };
}

function tooltip(ctx: ChartContext, clock: Clock, marks: Mark[][]): TemplateResult | typeof nothing {
  const h = hovers.get(ctx.host);
  if (h?.ring === undefined || h.item === undefined) return nothing;
  const ring = clock.rings[h.ring];
  const mark = marks[h.ring]?.[h.item];
  if (!ring || !mark) return nothing;
  const { time, value } = tipText(ring, mark.item, clock, ctx.hass);
  const [x, y] = polar(mark.r + 4, mark.angle);
  const left = ((x - VIEW.x) / VIEW.w) * 100;
  const top = ((y - VIEW.y) / VIEW.h) * 100;
  // Hang the box inwards, over the dial, so it stays inside the card even when the dial fills it.
  const side = `${x < 0 ? 'tip-right' : 'tip-left'} ${y < 0 ? 'tip-down' : 'tip-up'}`;
  return html`<div class="dc-tip tooltip ${side}" style="left:${left}%;top:${top}%" aria-hidden="true">
    <div class="tooltip-time">${time}</div>
    <div class="tooltip-row">
      <span class="swatch" style="background:${ring.color}"></span>
      <span class="tooltip-name">${ring.entity.name}</span>
      <span class="tooltip-value">${value}</span>
    </div>
  </div>`;
}

/**
 * "Heating on", "Alex home": a name and a state word. A name that already says the state
 * ("Heating" heating) reads "Heating on" instead.
 */
function stateLabel(hass: HomeAssistant, name: string, word: string): string {
  const state = name.toLocaleLowerCase().includes(word.toLocaleLowerCase()) ? localize(hass, 'day_clock_on') : word;
  return localize(hass, 'day_clock_state', { name, state });
}

/** The current state of a ring's entity, as "Heating on" or "Power 1.2 kW". */
function nowText(ring: Ring, hass: HomeAssistant): string {
  const e = ring.entity;
  if (!e.stateObj) return e.display;
  if (ring.kind === 'numeric') return localize(hass, 'day_clock_state', { name: e.name, state: e.display });
  const attribute = attributeOf(e, 'state');
  const raw = attribute ? e.stateObj.attributes?.[attribute] : e.stateObj.state;
  if (typeof raw !== 'string') return localize(hass, 'day_clock_state', { name: e.name, state: e.display });
  return stateLabel(hass, e.name, stateWord(hass, e, raw, attribute));
}

/** The ring the "now" line describes: the first entity that exists. */
function firstFound(clock: Clock): Ring | undefined {
  return clock.rings.find((r) => !r.missing);
}

/** What the middle of the dial says: a big line and a small one, or nothing. */
function centreText(ctx: ChartContext, clock: Clock): [string, string] | undefined {
  const center = (ctx.raw.center as Center | undefined) ?? 'total';
  if (center === 'none' || clock.rings.length === 0) return undefined;
  const { hass } = ctx;
  const found = firstFound(clock);
  if (center === 'now' && clock.live && clock.days === 1 && found) {
    return [formatTime(clock.now, hass), nowText(found, hass)];
  }
  const first = clock.rings.find((r) => r.kind === 'state' && r.hasData);
  if (first) {
    const word = first.word
      ? stateWord(hass, first.entity, first.word, attributeOf(first.entity, 'state'))
      : localize(hass, 'day_clock_on');
    const label = stateLabel(hass, first.entity.name, word);
    return [
      formatClockDuration(first.totalMs),
      clock.days === 1 ? label : localize(hass, 'day_clock_per_day', { label }),
    ];
  }
  const bars = clock.rings.find((r) => r.kind === 'numeric' && r.hasData);
  if (!bars) return undefined;
  const total = isAdditive(bars.aggregate)
    ? valueText(
        bars.slots.reduce((a, s) => a + s.v, 0),
        bars.entity,
        hass,
      )
    : bars.entity.display;
  return [total, bars.entity.name];
}

/** Fit text in the hole: a font size (in dial units) and the text, cut short with an ellipsis if need be. */
export function fitText(text: string, width: number, max: number): { size: number; text: string } {
  // About 0.56 em per character in the card's sans-serif.
  const size = Math.min(max, width / Math.max(1, text.length * 0.56));
  const floor = max * 0.62;
  if (size >= floor) return { size, text };
  const chars = Math.max(3, Math.floor(width / (floor * 0.56)) - 1);
  return { size: floor, text: `${text.slice(0, chars).trimEnd()}…` };
}

function centre(ctx: ChartContext, clock: Clock, hole: number): SVGTemplateResult | typeof nothing {
  const lines = centreText(ctx, clock);
  if (!lines) return nothing;
  const maxBig = Math.min(18, hole * 0.4);
  const maxSmall = Math.min(11, hole * 0.25);
  // The two lines are a block (value, then label) centred in the hole. Each may be as wide as the
  // hole is at the block's top and bottom edge, less a margin, so neither reaches the rings or the
  // hand (which starts at the hole's edge).
  const half = (1.05 * maxBig + 1.3 * maxSmall) / 2;
  const width = 2 * Math.sqrt(Math.max(0, hole * hole - half * half)) - 8;
  const big = fitText(lines[0], width, maxBig);
  const small = fitText(lines[1], width, maxSmall);
  // Value baseline at 0 (its glyphs reach up about 0.75 em), label baseline below it.
  const labelY = 0.3 * big.size + small.size;
  const shift = (-0.75 * big.size + labelY + 0.3 * small.size) / 2;
  return svg`<g class="dc-centre" aria-hidden="true">
    <text class="dc-centre-value" y=${-shift} font-size=${big.size}>${big.text}</text>
    <text class="dc-centre-label" y=${labelY - shift} font-size=${small.size}>${small.text}</text>
  </g>`;
}

function dial(ctx: ChartContext, clock: Clock): TemplateResult {
  const layout = ringLayout(
    clock.rings.map((r) => r.kind),
    OUTER,
  );
  const tip = tooltipEnabled(ctx.raw);
  const marks = clock.rings.map((ring, i) => {
    const { r0, r1 } = layout.rings[i];
    return ring.kind === 'state' ? stateMarks(ring, clock, r0, r1) : barMarks(ring, clock, r0, r1);
  });
  const h = hovers.get(ctx.host);
  const rings = clock.rings.map((ring, i) => {
    const { r0, r1 } = layout.rings[i];
    const focusable = clock.days === 1 && marks[i].length <= MAX_FOCUSABLE;
    const track =
      ring.kind === 'state'
        ? svg`<path class="dc-track" d=${sectorPath(r0, r1, 0, TAU)}></path>`
        : svg`<circle class="dc-base" r=${r0}></circle>`;
    return svg`<g
      class="entity dc-ring ${ring.kind}"
      data-index=${ring.index}
      tabindex="0"
      role="group"
      aria-label=${`${ring.entity.name}, ${ring.stat}`}
    >
      ${track}
      ${marks[i].map(
        (m, j) =>
          svg`<path
            class="dc-mark ${h?.ring === i && h.item === j ? 'hover' : ''}"
            d=${m.d}
            fill=${ring.color}
            fill-opacity=${m.opacity ?? nothing}
            tabindex=${focusable ? '0' : nothing}
            @pointerenter=${tip ? () => setHover(ctx, i, j) : nothing}
            @pointerdown=${tip ? () => setHover(ctx, i, j) : nothing}
            @pointerleave=${tip ? (ev: Event) => leave(ctx, ev) : nothing}
            @focus=${tip ? () => setHover(ctx, i, j) : nothing}
            @blur=${tip ? () => setHover(ctx, undefined, undefined) : nothing}
          ></path>`,
      )}
    </g>`;
  });
  const labels = dialLabels(ctx.hass);
  const LABEL_R = OUTER + 15;
  const tickMarks = Array.from({ length: 24 }, (_, hour) => {
    const a = (hour / 24) * TAU;
    const major = hour % 6 === 0;
    const [x0, y0] = polar(OUTER + 3, a);
    const [x1, y1] = polar(OUTER + (major ? 9 : 6), a);
    return svg`<line class="dc-tick ${major ? 'major' : ''}" x1=${x0} y1=${y0} x2=${x1} y2=${y1}></line>`;
  });
  const dialText = svg`
    <text class="dc-label" x="0" y=${-LABEL_R} text-anchor="middle">${labels[0]}</text>
    <text class="dc-label" x=${LABEL_R - 3} y="3.5" text-anchor="start">${labels[1]}</text>
    <text class="dc-label" x="0" y=${LABEL_R + 7} text-anchor="middle">${labels[2]}</text>
    <text class="dc-label" x=${-LABEL_R + 3} y="3.5" text-anchor="end">${labels[3]}</text>`;
  let hand: SVGTemplateResult | typeof nothing = nothing;
  if (clock.live && clock.days === 1) {
    const a = minuteAngle(wallMinute(clock.now, clock.bounds[0], clock.zone.timeZone));
    const [x0, y0] = polar(layout.hole, a);
    const [x1, y1] = polar(OUTER + 9, a);
    hand = svg`
      <path class="dc-future" d=${sectorPath(layout.hole - 1, OUTER + 1, a, TAU)}></path>
      <line class="dc-hand" x1=${x0} y1=${y0} x2=${x1} y2=${y1}></line>
      <circle class="dc-hand-dot" cx=${x1} cy=${y1} r="2.6"></circle>`;
  }
  const label = localize(ctx.hass, 'chart_aria', {
    style: localize(ctx.hass, 'editor_style_day_clock'),
    names: clock.rings.map((r) => r.entity.name).join(', '),
  });
  return html`<div class="dc-dial">
    <svg class="dc-svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" role="img" aria-label=${label}>
      ${tickMarks}${dialText}
      <g class="dc-marks">${rings}</g>
      ${hand} ${centre(ctx, clock, layout.hole)}
    </svg>
    ${tip ? tooltip(ctx, clock, marks) : nothing}
  </div>`;
}

function legend(ctx: ChartContext, clock: Clock): TemplateResult {
  const { hass } = ctx;
  let footer: TemplateResult | typeof nothing = nothing;
  if (clock.days > 1) {
    footer = html`<div class="dc-foot">
      <div class="dc-stat">${localize(hass, 'day_clock_average', { n: clock.days })}</div>
    </div>`;
  } else if (clock.live && firstFound(clock)) {
    footer = html`<div class="dc-foot">
      <div class="dc-stat">${localize(hass, 'day_clock_now')}</div>
      <div class="dc-now">${formatTime(clock.now, hass)} · ${nowText(firstFound(clock) as Ring, hass)}</div>
    </div>`;
  }
  return html`<div class="dc-legend">
    ${clock.rings.map(
      (ring) =>
        html`<div class="dc-item ${ring.missing ? 'missing' : ''}">
          <span class="dc-swatch" style="background:${ring.color}"></span>
          <div class="dc-text">
            <div class="dc-name">${ring.entity.name}</div>
            <div class="dc-stat">${ring.stat}</div>
          </div>
        </div>`,
    )}
    ${footer}
  </div>`;
}

function message(nav: TemplateResult | typeof nothing, text: string, error = false): TemplateResult {
  return html`<div class="frame">
    ${nav}
    <div class="chart-message ${error ? 'error' : ''}">${text}</div>
  </div>`;
}

export const day_clock: ChartStyleModule = {
  layout: 'chart',
  group: 'history',
  height: 280,
  styles: css`
    ${frameStyles}
    ${tooltipStyles}
    .dc-body {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 8px 20px;
      padding-bottom: 4px;
    }
    .dc-dial {
      position: relative;
      flex: 0 1 280px;
      min-width: 200px;
      aspect-ratio: 264 / 240;
    }
    .dc-svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .dc-track {
      fill: var(--cd-track);
    }
    .dc-base {
      fill: none;
      stroke: var(--divider-color, rgba(127, 127, 127, 0.3));
      stroke-width: 1;
    }
    .dc-mark {
      outline: none;
      transition: fill-opacity 0.15s ease;
    }
    .dc-ring:hover .dc-mark:not(.hover),
    .dc-ring:focus-within .dc-mark:not(.hover) {
      fill-opacity: 0.75;
    }
    .dc-mark.hover {
      stroke: var(--primary-text-color);
      stroke-width: 1.2;
      paint-order: stroke;
    }
    .dc-ring {
      cursor: pointer;
      outline: none;
    }
    .dc-ring:focus-visible .dc-track,
    .dc-ring:focus-visible .dc-base {
      stroke: var(--primary-color);
      stroke-width: 1.5;
    }
    .dc-tick {
      stroke: var(--secondary-text-color);
      stroke-opacity: 0.5;
      stroke-width: 1;
    }
    .dc-tick.major {
      stroke-opacity: 1;
      stroke-width: 1.5;
    }
    .dc-label {
      fill: var(--secondary-text-color);
      font-size: 10px;
    }
    .dc-future {
      fill: var(--card-background-color, #fff);
      fill-opacity: 0.55;
      pointer-events: none;
    }
    .dc-hand {
      stroke: var(--primary-text-color);
      stroke-width: 2;
      stroke-linecap: round;
      pointer-events: none;
    }
    .dc-hand-dot {
      fill: var(--primary-text-color);
    }
    .dc-centre text {
      text-anchor: middle;
      pointer-events: none;
    }
    .dc-centre-value {
      fill: var(--primary-text-color);
      font-weight: 500;
    }
    .dc-centre-label {
      fill: var(--secondary-text-color);
    }
    .dc-marks {
      opacity: 0;
      transition: opacity var(--cd-duration) var(--cd-easing);
    }
    :host([ready]) .dc-marks {
      opacity: 1;
    }
    :host([static]) .dc-marks,
    :host([static]) .dc-mark {
      transition: none;
    }
    .dc-legend {
      flex: 1 1 160px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .dc-item {
      display: flex;
      gap: 8px;
      align-items: baseline;
      min-width: 0;
    }
    .dc-swatch {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
    .dc-text {
      min-width: 0;
    }
    .dc-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dc-stat {
      color: var(--secondary-text-color);
      font-size: 0.875em;
    }
    .dc-item.missing .dc-name {
      color: var(--secondary-text-color);
    }
    .dc-foot {
      margin-top: 4px;
    }
    .dc-now {
      font-weight: 500;
      font-size: 1.1em;
    }
    .dc-tip {
      position: absolute;
      pointer-events: none;
      z-index: 1;
      white-space: nowrap;
    }
    .dc-tip.tip-right {
      transform: translate(6px, 0);
    }
    .dc-tip.tip-left {
      transform: translate(calc(-100% - 6px), 0);
    }
    .dc-tip.tip-right.tip-up {
      transform: translate(6px, -100%);
    }
    .dc-tip.tip-left.tip-up {
      transform: translate(calc(-100% - 6px), -100%);
    }
  `,
  thumbnail: () => svg`
    <circle cx="32" cy="20" r="15" fill="none" stroke="var(--divider-color, #ccc)" stroke-width="5" />
    <path d="M32 5 A15 15 0 0 1 46.5 16" fill="none" stroke="var(--error-color, #db4437)" stroke-width="5" />
    <path d="M38 33.8 A15 15 0 0 1 22 31" fill="none" stroke="var(--error-color, #db4437)" stroke-width="5" />
    <circle cx="32" cy="20" r="8" fill="none" stroke="var(--divider-color, #ccc)" stroke-width="3" />
    <path d="M32 12 A8 8 0 0 1 39.5 17.5" fill="none" stroke="var(--primary-color, #03a9f4)" stroke-width="3" />
    <line x1="32" y1="20" x2="19" y2="28" stroke="var(--primary-text-color, #212121)" stroke-width="1.5"
      stroke-linecap="round" />`,
  validate: validateDayClock,
  editor: dayClockEditor,
  entityFields: dayClockEntityFields,
  disconnect(host) {
    disconnectHistory(host);
    stopTick(host);
    const h = hovers.get(host);
    if (h?.timer !== undefined) clearTimeout(h.timer);
    hovers.delete(host);
  },
  render(ctx) {
    const clock = dayClock(ctx);
    if (clock.live) tickNextMinute(ctx, clock.now);
    const nav = periodNav(
      {
        period: clock.period,
        range: { start: clock.bounds[0], end: clock.bounds[clock.bounds.length - 1] },
        back: clock.back,
        zone: clock.zone,
      } as HistoryFrame,
      ctx,
      clock.now,
    );
    if (clock.status === 'loading') return message(nav, localize(ctx.hass, 'chart_loading'));
    if (clock.status === 'error') {
      return message(nav, localize(ctx.hass, 'chart_error', { error: clock.error ?? '' }), true);
    }
    if (clock.rings.every((r) => !r.hasData)) return message(nav, localize(ctx.hass, 'chart_no_data'));
    return html`<div class="frame">
      ${nav}
      <div class="dc-body">${dial(ctx, clock)} ${legend(ctx, clock)}</div>
    </div>`;
  },
};
