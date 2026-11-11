import type { CardConfig, EntityConfig } from '../types';
import type { XY } from './paths';

/** Line width in px when neither the card nor the entity sets one. */
export const DEFAULT_LINE_WIDTH = 2.5;
export const MIN_LINE_WIDTH = 0.5;
export const MAX_LINE_WIDTH = 12;
/** Above this many readings a series gets no dots: they would merge into a thick line. */
export const MAX_DOTS = 200;

export interface SeriesStyle {
  width: number;
  dots: boolean;
  onTop: boolean;
}

type Own = Pick<EntityConfig, 'line_width' | 'dots' | 'on_top'>;

/** How one series is drawn: its own settings, else the card's, else the defaults. */
export function seriesStyle(entity: object, raw: CardConfig): SeriesStyle {
  // Entity configs keep keys the card doesn't know, so a series' own settings are on it.
  const own = entity as Own;
  return {
    width: own.line_width ?? (raw.line_width as number | undefined) ?? DEFAULT_LINE_WIDTH,
    dots: own.dots ?? raw.dots === true,
    onTop: own.on_top === true,
  };
}

/** Series in drawing order: as listed, then those marked on top (as listed among themselves). */
export function drawOrder<T>(series: readonly T[], onTop: (s: T) => boolean): T[] {
  return [...series.filter((s) => !onTop(s)), ...series.filter(onTop)];
}

/** One round dot per point: a zero-length segment with a round cap stays round in a stretched SVG. */
export function dotsPath(pts: XY[]): string {
  return pts.map(([x, y]) => `M${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}h0`).join('');
}

/** Dot diameter for a line of `width` px: a little wider than the line so it shows. */
export function dotSize(width: number): number {
  return Math.round((width + 3.5) * 10) / 10;
}

function checkWidth(v: unknown, where: string): void {
  if (v === undefined) return;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN_LINE_WIDTH || v > MAX_LINE_WIDTH) {
    throw new Error(`${where} must be a number from ${MIN_LINE_WIDTH} to ${MAX_LINE_WIDTH}`);
  }
}

function checkBool(v: unknown, where: string): void {
  if (v !== undefined && typeof v !== 'boolean') throw new Error(`${where} must be true or false`);
}

/** Throw a readable error for a bad line width, dots or on-top setting, on the card or an entity. */
export function validateSeriesStyle(raw: CardConfig): void {
  checkWidth(raw.line_width, '"line_width"');
  checkBool(raw.dots, '"dots"');
  for (const e of raw.entities ?? []) {
    if (typeof e !== 'object') continue;
    checkWidth(e.line_width, `"line_width" of ${e.entity}`);
    checkBool(e.dots, `"dots" of ${e.entity}`);
    checkBool(e.on_top, `"on_top" of ${e.entity}`);
  }
}
