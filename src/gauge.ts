import { polar } from './geometry';
import type { CardConfig, StyleName } from './types';

/**
 * Options the gauge styles (ring, arc, needle) share. Angles are degrees clockwise from the top
 * (12 o'clock), as in geometry.ts: -90 is 9 o'clock, 90 is 3 o'clock, ±180 is 6 o'clock.
 */
export const CENTER_MODES = ['value', 'band', 'name', 'text', 'none'] as const;
export type CenterMode = (typeof CENTER_MODES)[number];

/** The history ghost's span (see gauge-ghost.ts). */
export const GHOST_SPANS = ['off', '24h', '7d'] as const;
export type GhostSpan = (typeof GHOST_SPANS)[number];

export interface GaugeOptions {
  /** Set only when the card sets it; otherwise the style's own default angle. */
  startAngle?: number;
  endAngle?: number;
  center: CenterMode;
  centerText: string;
  tickLabels: boolean;
  /** The history ghost's span; set only when the card turns it on. */
  ghost?: GhostSpan;
}

/** Each gauge style's sweep when no angle is set. */
export const DEFAULT_ANGLES: Partial<Record<StyleName, [number, number]>> = {
  ring: [-180, 180],
  arc: [-135, 135],
  needle: [-90, 90],
};

function angle(raw: unknown, field: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < -360 || n > 360) {
    throw new Error(`"${field}" must be a number of degrees from -360 to 360`);
  }
  return n;
}

/** Read and check the gauge options of a card config. Throws a readable Error. */
export function parseGaugeOptions(raw: CardConfig, style: StyleName = raw.style ?? 'bar'): GaugeOptions {
  const startAngle = angle(raw.start_angle, 'start_angle');
  const endAngle = angle(raw.end_angle, 'end_angle');
  const defaults = DEFAULT_ANGLES[style];
  if (defaults && (startAngle !== undefined || endAngle !== undefined)) {
    const [a0, a1] = [startAngle ?? defaults[0], endAngle ?? defaults[1]];
    if (!(a1 > a0)) throw new Error(`"end_angle" (${a1}) must be greater than "start_angle" (${a0})`);
    if (a1 - a0 > 360) throw new Error(`"end_angle" can be at most 360 degrees after "start_angle"`);
  }
  const center = raw.center ?? 'value';
  if (!CENTER_MODES.includes(center as CenterMode)) {
    throw new Error(`"center" must be one of: ${CENTER_MODES.join(', ')}`);
  }
  if (raw.center_text !== undefined && raw.center_text !== null && typeof raw.center_text !== 'string') {
    throw new Error('"center_text" must be text');
  }
  if (raw.tick_labels !== undefined && typeof raw.tick_labels !== 'boolean') {
    throw new Error('"tick_labels" must be true or false');
  }
  if (raw.ghost !== undefined && raw.ghost !== null && !GHOST_SPANS.includes(raw.ghost as GhostSpan)) {
    throw new Error(`"ghost" must be one of: ${GHOST_SPANS.join(', ')}`);
  }
  const options: GaugeOptions = {
    center: center as CenterMode,
    centerText: (raw.center_text as string | undefined) ?? '',
    tickLabels: raw.tick_labels === true,
  };
  if (startAngle !== undefined) options.startAngle = startAngle;
  if (endAngle !== undefined) options.endAngle = endAngle;
  if (raw.ghost && raw.ghost !== 'off') options.ghost = raw.ghost as GhostSpan;
  return options;
}

/** The angles a gauge draws between: the card's, else the style's default. */
export function gaugeAngles(defaults: [number, number], options?: GaugeOptions): [number, number] {
  return [options?.startAngle ?? defaults[0], options?.endAngle ?? defaults[1]];
}

/** Whether the card changed the angles from the style's default. */
export function customAngles(options?: GaugeOptions): boolean {
  return options?.startAngle !== undefined || options?.endAngle !== undefined;
}

/** The angle for a 0..1 position along a sweep. */
export function angleAt([a0, a1]: [number, number], t: number): number {
  return a0 + (a1 - a0) * t;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The union of boxes. */
export function union(...boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/**
 * The box around an arc of radius `r` drawn with a stroke `pad` wide on each side (round caps
 * included): its two ends and every compass point (0, 90, 180, 270 degrees) it passes.
 */
export function arcBox(cx: number, cy: number, r: number, a0: number, a1: number, pad: number): Box {
  const angles = [a0, a1];
  for (let k = Math.ceil(a0 / 90); k * 90 <= a1; k++) angles.push(k * 90);
  const points = angles.map((a) => polar(cx, cy, r, a));
  const box = {
    x0: Math.min(...points.map((p) => p[0])),
    y0: Math.min(...points.map((p) => p[1])),
    x1: Math.max(...points.map((p) => p[0])),
    y1: Math.max(...points.map((p) => p[1])),
  };
  return { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
}

/** A tick step of 1, 2, 2.5 or 5 times a power of ten, near `span / count`. */
export function tickStep(span: number, count = 5): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * power;
}

/**
 * Round tick values from `min` to `max`, about `count` steps apart. The scale's own ends are
 * always labelled; a round tick too close to an end (under 40 % of a step) is dropped so the
 * labels don't collide.
 */
export function scaleTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return [];
  const step = tickStep(max - min, count);
  const inner: number[] = [];
  for (let v = Math.ceil(min / step) * step; v < max - step * 0.4; v += step) {
    if (v > min + step * 0.4) inner.push(Number(v.toPrecision(12)));
  }
  return [min, ...inner, max];
}

/** Decimals a tick needs: those of the step, or the value itself if it has more (a scale end). */
export function tickDecimals(value: number, step: number): number {
  const places = (n: number) => {
    const text = String(Number(n.toPrecision(12)));
    return text.includes('e') ? 0 : (text.split('.')[1]?.length ?? 0);
  };
  return Math.min(3, Math.max(places(step), places(value)));
}

/** Text anchor and vertical nudge (em) for a label placed outward at `deg`. */
export function labelPlacement(deg: number): { anchor: 'start' | 'middle' | 'end'; dy: number } {
  const rad = (deg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const anchor = sin > 0.3 ? 'start' : sin < -0.3 ? 'end' : 'middle';
  // Labels above the centre sit on their baseline, those below hang from it, sides are centred.
  const dy = cos > 0.3 ? 0 : cos < -0.3 ? 0.75 : 0.35;
  return { anchor, dy };
}

/** What the gauge shows in place of its value: the value itself, or text. */
export type CenterContent = { kind: 'value' } | { kind: 'text'; text: string; band: boolean } | { kind: 'none' };

/**
 * The centre content for an available entity: its band's label in `band` mode (the value when the
 * band has none), its name, the set text, or nothing.
 */
export function centerContent(
  e: { name: string; band: { label?: string } },
  options: GaugeOptions | undefined,
): CenterContent {
  switch (options?.center ?? 'value') {
    case 'band':
      return e.band.label ? { kind: 'text', text: e.band.label, band: true } : { kind: 'value' };
    case 'name':
      return { kind: 'text', text: e.name, band: false };
    case 'text':
      return options!.centerText ? { kind: 'text', text: options!.centerText, band: false } : { kind: 'none' };
    case 'none':
      return { kind: 'none' };
    default:
      return { kind: 'value' };
  }
}
