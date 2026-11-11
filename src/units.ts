import type { Point } from './history/types';

/*
 * Unit conversion. An entity's `unit` (or the card's) used to be display text only: set `unit: kW`
 * on a sensor reporting W and the card wrote "1500 kW". Now, when the sensor's own unit and the
 * one asked for are both in one of the families below, the card converts: the value, its
 * history, and any limit or colour band start read from another entity (from that entity's own
 * unit). Numbers typed into the config (min: 5, a band from 20) are taken to be in the unit the
 * card shows, so they are never converted.
 *
 * A pair the card doesn't know (different families, a unit it has never heard of, an attribute,
 * which has no unit) stays display text, as before.
 */

/** Each unit as [scale, offset] onto its family's base unit: base = value × scale + offset. */
const FAMILIES: Record<string, Record<string, [number, number]>> = {
  energy: { Wh: [1, 0], kWh: [1e3, 0], MWh: [1e6, 0], GWh: [1e9, 0] },
  power: { W: [1, 0], kW: [1e3, 0], MW: [1e6, 0] },
  temperature: { '°C': [1, 0], '°F': [5 / 9, (-32 * 5) / 9], K: [1, -273.15] },
  speed: { 'm/s': [1, 0], 'km/h': [1 / 3.6, 0], mph: [0.44704, 0], kn: [1852 / 3600, 0], 'ft/s': [0.3048, 0] },
  pressure: {
    Pa: [1, 0],
    hPa: [100, 0],
    mbar: [100, 0],
    kPa: [1e3, 0],
    bar: [1e5, 0],
    inHg: [3386.389, 0],
    mmHg: [133.322387415, 0],
    psi: [6894.757293168, 0],
  },
  length: { mm: [1, 0], cm: [10, 0], m: [1e3, 0], in: [25.4, 0], ft: [304.8, 0] },
};

const FAMILY_OF = new Map<string, string>();
for (const [family, units] of Object.entries(FAMILIES))
  for (const unit of Object.keys(units)) FAMILY_OF.set(unit, family);

/** The units a value in `unit` can be converted to, itself first; none for a unit the card doesn't know. */
export function convertibleUnits(unit: string | undefined): string[] {
  const family = unit === undefined ? undefined : FAMILY_OF.get(unit);
  if (!family) return [];
  return [unit as string, ...Object.keys(FAMILIES[family]).filter((u) => u !== unit)];
}

/** How a value in one unit becomes another. */
export interface Conversion {
  from: string;
  to: string;
  /** How much one step of `from` is in `to` (1000 W → 1 kW: 0.001), for choosing decimals. */
  slope: number;
  apply(v: number): number;
}

/** The conversion from `from` to `to`, or undefined when they are the same or not a known pair. */
export function conversion(from: string | undefined, to: string | undefined): Conversion | undefined {
  if (from === undefined || to === undefined || from === to) return undefined;
  const family = FAMILY_OF.get(from);
  if (!family || FAMILY_OF.get(to) !== family) return undefined;
  const [fs, fo] = FAMILIES[family][from];
  const [ts, to0] = FAMILIES[family][to];
  return { from, to, slope: fs / ts, apply: (v) => (v * fs + fo - to0) / ts };
}

/**
 * Decimals for a converted value when none are set: as many as the source had, plus the places a
 * smaller unit needs (W at 0 shows kW at 3) or less the ones a bigger one doesn't (m/s at 1 shows
 * km/h at 0). Never below 0 or above 6.
 */
export function convertedDecimals(decimals: number, slope: number): number {
  return Math.min(6, Math.max(0, decimals + Math.round(-Math.log10(slope))));
}

/** History points in the converted unit: the value, and a statistic's lowest and highest. */
export function convertPoints(points: Point[], c: Conversion | undefined): Point[] {
  if (!c) return points;
  const f = (v: number | null | undefined) => (typeof v === 'number' ? c.apply(v) : v);
  return points.map((p) => {
    const out: Point = { ...p, v: p.v === null ? null : c.apply(p.v) };
    if (p.min !== undefined) out.min = f(p.min);
    if (p.max !== undefined) out.max = f(p.max);
    return out;
  });
}
