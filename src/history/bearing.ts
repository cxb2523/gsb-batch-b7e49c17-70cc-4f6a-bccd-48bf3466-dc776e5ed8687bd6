/** The 16 compass points, clockwise from north, each 22.5° on from the last. */
export const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

const BY_NAME = new Map<string, number>(COMPASS_POINTS.map((name, i) => [name, i * 22.5]));
const WORDS: [RegExp, string][] = [
  [/north/g, 'n'],
  [/south/g, 's'],
  [/east/g, 'e'],
  [/west/g, 'w'],
];

/** Degrees folded into 0 ≤ d < 360 (−90 is 270, 360 is 0). */
export function normalizeDegrees(d: number): number {
  const n = ((d % 360) + 360) % 360;
  return n === 360 ? 0 : n;
}

/**
 * A wind direction reading as degrees clockwise from north (0 ≤ d < 360), or null when it can't
 * be read. Takes a number of degrees ("225", "225°", -135) or a compass point in any case ("SW",
 * "wsw", "North-East", "south west"). Anything else (unavailable, unknown, "variable") is null.
 */
export function parseBearing(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? normalizeDegrees(raw) : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  const number = Number(text.replace(/\s*°$/, ''));
  if (Number.isFinite(number)) return normalizeDegrees(number);
  let name = text.replace(/[\s_-]+/g, '');
  for (const [word, letter] of WORDS) name = name.replace(word, letter);
  return BY_NAME.get(name.toUpperCase()) ?? null;
}
