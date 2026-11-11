import { COMPASS_POINTS, normalizeDegrees } from '../history/bearing';
import type { Point } from '../history/types';

/** How many compass sectors a wind rose can have. */
export const SECTOR_COUNTS = [4, 8, 16] as const;
export type SectorCount = (typeof SECTOR_COUNTS)[number];

/**
 * The sector a direction falls in. Sector `i` of `n` is centred on `i * 360 / n`, so with 16 the
 * north sector runs from 348.75° up to (not including) 11.25°, and 11.25° itself is NNE.
 */
export function sectorOf(degrees: number, n: number): number {
  const width = 360 / n;
  return Math.floor(normalizeDegrees(degrees) / width + 0.5) % n;
}

/** A sector's compass name: N, NNE… for 16, N, NE… for 8, N, E, S, W for 4. */
export function sectorName(i: number, n: number): string {
  return COMPASS_POINTS[(i * (16 / n)) % 16];
}

/** One stretch of time with a steady direction (and speed, when there is one). */
export interface WindSample {
  /** Degrees, the direction the wind blows from. */
  dir: number;
  speed: number | null;
  /** How long it held, ms. */
  ms: number;
}

/** The value a series holds at `t`: its last reading at or before `t`, unless that is too old. */
function heldAt(points: Point[], i: number, t: number, maxHold: number): number | null {
  if (i < 0) return null;
  const p = points[i];
  return t - p.t < maxHold ? p.v : null;
}

/**
 * Pair each direction with the speed in effect at the same moment, weighted by how long the pair
 * held. Sensors report on change, so both series are step-held: a new sample starts whenever
 * either one changes (the union of their change times), and runs until the next change or
 * `until`. Counting rows instead would favour gusty spells, which report more often.
 *
 * A gap (null) in either series drops that stretch. Without a `speed` series every stretch with a
 * direction counts, speed null. `maxHold` stops a reading carrying on past it: statistics rows
 * describe one period each, so a missing hour is a gap rather than the last hour held.
 */
export function pairWind(dir: Point[], speed: Point[] | undefined, until: number, maxHold = Infinity): WindSample[] {
  const times = new Set<number>([until]);
  for (const series of speed ? [dir, speed] : [dir]) {
    for (const p of series) {
      times.add(p.t);
      if (Number.isFinite(maxHold)) times.add(p.t + maxHold);
    }
  }
  const sorted = [...times].filter((t) => t <= until).sort((a, b) => a - b);
  const out: WindSample[] = [];
  let d = -1;
  let s = -1;
  for (let k = 0; k + 1 < sorted.length; k++) {
    const a = sorted[k];
    const ms = sorted[k + 1] - a;
    while (d + 1 < dir.length && dir[d + 1].t <= a) d++;
    const direction = heldAt(dir, d, a, maxHold);
    if (direction === null) continue;
    let v: number | null = null;
    if (speed) {
      while (s + 1 < speed.length && speed[s + 1].t <= a) s++;
      v = heldAt(speed, s, a, maxHold);
      if (v === null) continue;
    }
    const last = out[out.length - 1];
    // Neighbours that read the same merge, so a quiet sensor makes one sample, not hundreds.
    if (last && last.dir === direction && last.speed === v) last.ms += ms;
    else out.push({ dir: direction, speed: v, ms });
  }
  return out;
}

/** Default speed bands and calm limit for a unit, with how the bands are labelled. */
export interface SpeedDefaults {
  /** Where each band starts, lowest first; the last runs on with no top. */
  from: number[];
  /** Below this the air counts as calm. */
  calm: number;
}

/**
 * Speed bands for a sensor's unit. In m/s: 0–3, 3–6, 6–9, 9–12, 12+. In km/h, mph and knots the
 * bands start where Beaufort forces 3, 4, 5 and 6 do (a gentle breeze up to a strong breeze), and
 * in ft/s they are about the m/s bands. Calm is 0.5 m/s in each unit. Other units (or none) get
 * the m/s numbers.
 */
export function speedDefaults(unit: string | undefined): SpeedDefaults {
  switch ((unit ?? '').trim().toLowerCase()) {
    case 'km/h':
    case 'kmh':
    case 'kph':
      return { from: [0, 12, 20, 29, 39], calm: 1.8 };
    case 'mph':
      return { from: [0, 8, 13, 19, 25], calm: 1.1 };
    case 'kn':
    case 'kt':
    case 'kts':
    case 'knot':
    case 'knots':
      return { from: [0, 7, 11, 17, 22], calm: 1 };
    case 'ft/s':
      return { from: [0, 10, 20, 30, 40], calm: 1.6 };
    default:
      return { from: [0, 3, 6, 9, 12], calm: 0.5 };
  }
}

/** Index of the band a speed falls in: the last that starts at or below it (the first if none). */
export function bandIndex(speed: number, from: readonly number[]): number {
  let found = 0;
  for (let i = 0; i < from.length; i++) {
    if (from[i] <= speed) found = i;
    else break;
  }
  return found;
}

/** A wind rose's numbers: shares of the time, per sector and speed band. */
export interface Rose {
  /** All the time counted, ms (calm included). */
  total: number;
  /** Share of the time calm, 0–1. */
  calm: number;
  /** `sectors[i][b]`: share of the time (0–1) the wind blew from sector i in speed band b. */
  sectors: number[][];
  /** Each sector's share, all bands together. */
  totals: number[];
  /** The sector with the most time, or -1 when there is none. */
  prevailing: number;
  /** Time-weighted mean speed (calm included), or null without speeds. */
  meanSpeed: number | null;
}

/**
 * Bin samples into `n` sectors and the speed bands starting at `from`. A sample below `calm` (when
 * it has a speed) counts towards calm, not a sector: a vane's reading means little in still air,
 * and many sensors report 0° (north) then. Samples without a speed all go in band 0.
 */
export function windRose(samples: WindSample[], n: number, from: readonly number[], calm = 0): Rose {
  const bands = Math.max(1, from.length);
  const ms = Array.from({ length: n }, () => new Array<number>(bands).fill(0));
  let total = 0;
  let calmMs = 0;
  let speedMs = 0;
  let speedSum = 0;
  for (const sample of samples) {
    total += sample.ms;
    if (sample.speed !== null) {
      speedMs += sample.ms;
      speedSum += sample.speed * sample.ms;
      if (sample.speed < calm) {
        calmMs += sample.ms;
        continue;
      }
    }
    const b = sample.speed === null ? 0 : bandIndex(sample.speed, from);
    ms[sectorOf(sample.dir, n)][b] += sample.ms;
  }
  const share = (v: number) => (total > 0 ? v / total : 0);
  const sectors = ms.map((row) => row.map(share));
  const totals = sectors.map((row) => row.reduce((a, b) => a + b, 0));
  let prevailing = -1;
  totals.forEach((t, i) => {
    if (t > 0 && (prevailing < 0 || t > totals[prevailing])) prevailing = i;
  });
  return {
    total,
    calm: share(calmMs),
    sectors,
    totals,
    prevailing,
    meanSpeed: speedMs > 0 ? speedSum / speedMs : null,
  };
}

/** The highest speed in the readings: a statistics row's max where it has one, else its value. */
export function strongest(points: Point[]): number | null {
  let best: number | null = null;
  for (const p of points) {
    const v = typeof p.max === 'number' && Number.isFinite(p.max) ? p.max : p.v;
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

/**
 * Round ring values (in %) for a rose whose longest petal is `max` %: steps of 1, 2, 2.5 or 5
 * times a power of ten, about three rings, the last at or just past the longest petal.
 */
export function ringSteps(max: number): number[] {
  if (!(max > 0)) return [];
  const raw = max / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw - 1e-9) ?? 10 * power;
  const count = Math.max(1, Math.ceil(max / step - 1e-9));
  return Array.from({ length: count }, (_, i) => Math.round((i + 1) * step * 1000) / 1000);
}

/*
 * Geometry. Angles are radians clockwise from north (12 o'clock), as a compass reads, with the
 * centre at (0, 0) and y pointing down as in SVG. These two are the same as `polar` and
 * `sectorPath` in the polar area chart's `src/chart/polar.ts`; kept here until the two meet.
 */

const round = (n: number) => Math.round(n * 100) / 100 || 0;

/** The point at radius `r` and `angle` from the centre. */
export function polarPoint(r: number, angle: number): [number, number] {
  return [round(r * Math.sin(angle)), round(-r * Math.cos(angle))];
}

/** The SVG path of a ring sector from `a0` to `a1` between radii `r0` and `r1`. */
export function petalPath(r0: number, r1: number, a0: number, a1: number): string {
  if (r1 <= r0 || a1 <= a0) return '';
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [ox0, oy0] = polarPoint(r1, a0);
  const [ox1, oy1] = polarPoint(r1, a1);
  const outer = `M${ox0} ${oy0}A${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1}`;
  if (r0 <= 0) return `${outer}L0 0Z`;
  const [ix1, iy1] = polarPoint(r0, a1);
  const [ix0, iy0] = polarPoint(r0, a0);
  return `${outer}L${ix1} ${iy1}A${r0} ${r0} 0 ${large} 0 ${ix0} ${iy0}Z`;
}
