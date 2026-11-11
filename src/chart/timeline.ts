import { baseColor, onFillText } from '../bands';
import type { Point, Range } from '../history/types';

/** One stretch of time an entity spent in one state. `state` is undefined where nothing was recorded. */
export interface StateSpan {
  start: number;
  end: number;
  state: string | undefined;
}

/** States that mean "no reading": drawn as a gap, not a bar. */
export const GAP_STATES = new Set(['unavailable', 'unknown']);

/** Whether a span is a gap (nothing recorded, unavailable or unknown). */
export function isGap(state: string | undefined): boolean {
  return state === undefined || state === '' || GAP_STATES.has(state);
}

/**
 * Text points as spans: each state lasts until the next point, the last one until `until`.
 * Repeats of the same state (an attribute changed, not the state) join into one span; points
 * at or after `until` and empty spans are left out.
 */
export function stateSpans(points: readonly Point[], until: number): StateSpan[] {
  const spans: StateSpan[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.t >= until) break;
    const end = Math.min(until, i + 1 < points.length ? points[i + 1].t : until);
    if (end <= p.t) continue;
    const last = spans[spans.length - 1];
    if (last && last.state === p.s && last.end === p.t) last.end = end;
    else spans.push({ start: p.t, end, state: p.s });
  }
  return spans;
}

/** The span covering time `t`, if any. */
export function spanAt(spans: readonly StateSpan[], t: number): StateSpan | undefined {
  return spans.find((s) => t >= s.start && (t < s.end || (t === s.end && s === spans[spans.length - 1])));
}

/**
 * Colours for common Home Assistant states, palette names or CSS colours. Words not listed get a
 * colour picked from the word itself, so one state has the same colour on every row.
 */
export const DEFAULT_STATE_COLORS: Record<string, string> = {
  on: 'amber',
  open: 'amber',
  opening: 'amber',
  closing: 'amber',
  home: 'green',
  playing: 'green',
  charging: 'green',
  auto: 'green',
  heat_cool: 'green',
  heat: '#ff8100',
  heating: '#ff8100',
  preheating: '#ff8100',
  cool: '#2b9af9',
  cooling: '#2b9af9',
  dry: '#efbd07',
  drying: '#efbd07',
  fan_only: '#14b8a6',
  fan: '#14b8a6',
  paused: 'purple',
  buffering: 'purple',
  detected: 'red',
  problem: 'red',
  triggered: 'red',
  unlocked: 'red',
  jammed: 'red',
  locked: 'green',
  armed_home: 'green',
  armed_away: 'green',
  armed_night: 'green',
  armed_vacation: 'green',
  armed_custom_bypass: 'green',
  arming: 'amber',
  pending: 'amber',
  cleaning: 'primary',
  returning: 'purple',
};

/** States that mean "nothing happening": drawn faint, so the active ones stand out. */
export const QUIET_STATES = new Set([
  'off',
  'closed',
  'not_home',
  'away',
  'idle',
  'standby',
  'docked',
  'clear',
  'disarmed',
  'none',
  'false',
]);

/** Colours for words with no default, in turn by the word. */
const WORD_COLORS = ['primary', 'purple', '#14b8a6', '#ec4899', 'amber', 'green', 'blue', 'red'];

/** A small stable number for a word. */
export function wordHash(word: string): number {
  let h = 0;
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
  return h;
}

export interface StateColor {
  /** A CSS colour (theme variables included). */
  color: string;
  /** Drawn faint: a "nothing happening" state with no colour of its own. */
  quiet: boolean;
  /** Text colour for a label on the bar. */
  text: 'dark' | 'light' | 'theme';
}

/**
 * The colour of one state. The card's own `state_colors` win (a palette name or any CSS
 * colour). Otherwise Home Assistant's theme colour for that domain and state is used when the
 * theme has one (`--state-light-on-color`, `--state-climate-heat-color`), falling back to the
 * defaults above, then grey for a quiet state, then a colour chosen by the word.
 */
export function stateColor(state: string, domain: string, own: Record<string, string> | undefined): StateColor {
  const set = own?.[state];
  if (set) return { color: baseColor(set), quiet: false, text: onFillText(set) };
  const quiet = QUIET_STATES.has(state) && !Object.prototype.hasOwnProperty.call(DEFAULT_STATE_COLORS, state);
  const base = Object.prototype.hasOwnProperty.call(DEFAULT_STATE_COLORS, state)
    ? DEFAULT_STATE_COLORS[state]
    : quiet
      ? 'grey'
      : WORD_COLORS[wordHash(state) % WORD_COLORS.length];
  const fallback = baseColor(base);
  const css = /^[a-z0-9_]+$/.test(state) && /^[a-z0-9_]+$/.test(domain);
  return {
    color: css ? `var(--state-${domain}-${state}-color, ${fallback})` : fallback,
    quiet,
    text: quiet ? 'theme' : onFillText(base),
  };
}

/** A length of time, short: "45 s", "12 min", "3 h 30", "2 d 4 h". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rest = m - h * 60;
    return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  const rest = h - d * 24;
  return rest ? `${d} d ${rest} h` : `${d} d`;
}

/** Rough width in px of a label at the timeline's 11 px font, with its padding. */
export function labelWidth(text: string): number {
  return text.length * 6.2 + 10;
}

/** Where a span sits across the plot, as fractions of the range (clamped to it). */
export function spanBox(span: StateSpan, range: Range): { left: number; width: number } {
  const total = range.end - range.start;
  if (!(total > 0)) return { left: 0, width: 0 };
  const a = Math.max(range.start, span.start);
  const b = Math.min(range.end, span.end);
  return { left: (a - range.start) / total, width: Math.max(0, b - a) / total };
}

/** One row of the timeline: an entity, or a heading over a group of them. */
export type TimelineRow<T> = { heading: string } | { item: T };

/**
 * Rows in listed order, with entities that share a `group` brought together under a heading
 * where the group is first listed. Entities without a group stay where they are, unheaded.
 */
export function timelineRows<T>(items: readonly T[], groupOf: (item: T) => string | undefined): TimelineRow<T>[] {
  const rows: TimelineRow<T>[] = [];
  const done = new Set<string>();
  for (const item of items) {
    const group = groupOf(item);
    if (group === undefined) {
      rows.push({ item });
      continue;
    }
    if (done.has(group)) continue;
    done.add(group);
    rows.push({ heading: group });
    for (const other of items) if (groupOf(other) === group) rows.push({ item: other });
  }
  return rows;
}

/** More distinct numbers than this and a row is a measurement, not a set of states. */
export const MAX_NUMBER_STATES = 8;

/**
 * Whether spans look like a measurement (a temperature, a power reading) rather than states:
 * every recorded state is a number, and there are more different ones than a few modes would
 * give. Those draw as a hint to use a line chart instead of a bar per reading.
 */
export function isMeasurement(spans: readonly StateSpan[]): boolean {
  const seen = new Set<string>();
  for (const s of spans) {
    if (isGap(s.state)) continue;
    if (!Number.isFinite(Number(s.state)) || (s.state as string).trim() === '') return false;
    seen.add(s.state as string);
  }
  return seen.size > MAX_NUMBER_STATES;
}
