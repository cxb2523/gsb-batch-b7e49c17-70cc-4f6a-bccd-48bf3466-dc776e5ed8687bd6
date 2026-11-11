import type { Point, SeriesRequest } from '../history/types';

/** The attributes a climate entity reports, and what the chart draws from each. */
export const CLIMATE_ATTRIBUTES = {
  current: 'current_temperature',
  target: 'temperature',
  low: 'target_temp_low',
  high: 'target_temp_high',
  action: 'hvac_action',
} as const;

export type ClimatePart = keyof typeof CLIMATE_ATTRIBUTES;
const PARTS = Object.keys(CLIMATE_ATTRIBUTES) as ClimatePart[];

/** Everything to load for one thermostat: four numbers and the action's words, in one history call. */
export function climateRequests(entity: string): Record<ClimatePart, SeriesRequest> {
  const out = {} as Record<ClimatePart, SeriesRequest>;
  for (const part of PARTS) {
    out[part] =
      part === 'action'
        ? { entity, attribute: CLIMATE_ATTRIBUTES[part], text: true }
        : { entity, attribute: CLIMATE_ATTRIBUTES[part] };
  }
  return out;
}

export type ClimateData = Record<ClimatePart, Point[]>;

/**
 * One thermostat's loaded points, each carried on to `until` (the present, or the end of a past
 * span): a thermostat holds its readings and its set point until they change.
 */
export function climateData(
  loaded: Map<string, Point[]>,
  requests: Record<ClimatePart, SeriesRequest>,
  until: number,
  key: (s: SeriesRequest) => string,
): ClimateData {
  const out = {} as ClimateData;
  for (const part of PARTS) {
    const points = loaded.get(key(requests[part])) ?? [];
    const last = points[points.length - 1];
    const held = part === 'action' ? last?.s !== undefined : last?.v !== null && last?.v !== undefined;
    out[part] = last && held && last.t < until ? [...points, { ...last, t: until, carried: true }] : points;
  }
  return out;
}

/** How a running thermostat is shaded. Idle and off aren't shaded at all. */
export type ActionKind = 'heat' | 'cool' | 'dry' | 'fan';
export const ACTION_KINDS: ActionKind[] = ['heat', 'cool', 'dry', 'fan'];

const KIND_OF: Record<string, ActionKind> = {
  heating: 'heat',
  preheating: 'heat',
  cooling: 'cool',
  // A heat pump defrosting runs its cycle backwards: it is taking heat out of the room.
  defrosting: 'cool',
  drying: 'dry',
  fan: 'fan',
};

/** The shading for an `hvac_action`; undefined for idle, off, unknown words, and none. */
export function actionKind(action: string | undefined): ActionKind | undefined {
  return action === undefined ? undefined : KIND_OF[action];
}

/** A stretch of time the thermostat spent doing one thing. */
export interface ActionSpan {
  kind: ActionKind;
  action: string;
  start: number;
  end: number;
}

/**
 * The stretches spent heating, cooling and so on, from the action's points. An action lasts
 * from its point to the next point that says something else; the last one runs on to `end`.
 * Only kinds in `kinds` are kept.
 */
export function actionSpans(points: Point[], end: number, kinds: readonly ActionKind[] = ACTION_KINDS): ActionSpan[] {
  const out: ActionSpan[] = [];
  let open: ActionSpan | undefined;
  for (const p of points) {
    if (open && p.s === open.action) continue;
    if (open) {
      open.end = p.t;
      if (open.end > open.start) out.push(open);
      open = undefined;
    }
    const kind = actionKind(p.s);
    if (kind && kinds.includes(kind)) open = { kind, action: p.s as string, start: p.t, end };
  }
  if (open && end > open.start) out.push({ ...open, end: Math.max(open.end, end) });
  return out;
}

/** The point in effect at `t`: the last one at or before it (points sorted by time). */
export function valueAt(points: readonly Point[], t: number): Point | undefined {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? points[lo - 1] : undefined;
}

/**
 * A set point as held values: unbroken runs, each value kept until the next reading (so a run
 * ends where the set point went away, not at its last reading), with repeats dropped.
 */
export function holdRuns(points: readonly Point[]): { t: number; v: number }[][] {
  const out: { t: number; v: number }[][] = [];
  let run: { t: number; v: number }[] = [];
  const close = (t: number) => {
    if (!run.length) return;
    const last = run[run.length - 1];
    if (t > last.t) run.push({ t, v: last.v });
    out.push(run);
    run = [];
  };
  for (const p of points) {
    if (p.v === null) {
      close(p.t);
      continue;
    }
    const last = run[run.length - 1];
    if (last && last.v === p.v) continue;
    run.push({ t: p.t, v: p.v });
  }
  const end = points[points.length - 1];
  if (run.length) close(end.t);
  return out;
}

/** Both ends of a heat/cool range at each moment they were both set, as points carrying `[low, high]`. */
export function rangePoints(
  low: readonly Point[],
  high: readonly Point[],
): { t: number; v: [number, number] | null }[] {
  const highAt = new Map(high.map((p) => [p.t, p.v]));
  return low.map((p) => {
    const h = highAt.get(p.t);
    return { t: p.t, v: p.v !== null && typeof h === 'number' ? [p.v, h] : null };
  });
}

type XY = [number, number];
const f = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * The area between the two ends of a heat/cool range, held like a set point: along the top
 * (high) from left to right, then back along the bottom (low). One closed shape per unbroken run.
 */
export function rangeBandPath(
  points: readonly { t: number; v: [number, number] | null }[],
  x: (t: number) => number,
  y: (v: number) => number,
): string {
  let d = '';
  let run: { t: number; v: [number, number] }[] = [];
  const flush = (t: number) => {
    if (!run.length) return;
    const last = run[run.length - 1];
    if (t > last.t) run.push({ t, v: last.v });
    if (run.length > 1) {
      const top: XY[] = run.map((p) => [x(p.t), y(p.v[1])]);
      const bottom: XY[] = run.map((p) => [x(p.t), y(p.v[0])]);
      d += `M${f(top[0][0])},${f(top[0][1])}`;
      for (let i = 1; i < top.length; i++) d += `H${f(top[i][0])}V${f(top[i][1])}`;
      d += `V${f(bottom[bottom.length - 1][1])}`;
      for (let i = bottom.length - 2; i >= 0; i--) d += `V${f(bottom[i][1])}H${f(bottom[i][0])}`;
      d += 'Z';
    }
    run = [];
  };
  for (const p of points) {
    if (p.v === null) flush(p.t);
    else run.push({ t: p.t, v: p.v });
  }
  if (run.length) flush(points[points.length - 1].t);
  return d;
}
