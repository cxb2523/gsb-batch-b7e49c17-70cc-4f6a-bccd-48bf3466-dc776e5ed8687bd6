import { baseColor } from '../bands';
import { SERIES_COLORS } from './frame';

/** Series colours in order, for entities and groups without their own `color` (shared with the history charts). */
export { SERIES_COLORS };

/** The n-th series colour (wrapping round), or `own` when set, ready for CSS. */
export function seriesColor(index: number, own?: unknown): string {
  return baseColor(typeof own === 'string' && own ? own : SERIES_COLORS[index % SERIES_COLORS.length]);
}

/**
 * `color` faded towards the card background: 100 is the colour itself, 0 the background. Works
 * in light and dark themes alike, since it mixes with whatever the card is drawn on.
 */
export function shade(color: string, percent: number): string {
  const p = Math.round(Math.min(100, Math.max(0, percent)));
  return p >= 100 ? color : `color-mix(in srgb, ${color} ${p}%, var(--card-background-color, #fff))`;
}
