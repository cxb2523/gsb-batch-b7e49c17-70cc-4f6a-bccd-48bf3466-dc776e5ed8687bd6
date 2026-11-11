import type { ResolvedBand } from './types';

export type PaletteName = 'primary' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'grey';

export const PALETTE: Record<PaletteName, { variable: string; fallback: string }> = {
  primary: { variable: '--primary-color', fallback: '#2f6fe4' },
  green: { variable: '--success-color', fallback: '#1fae7a' },
  amber: { variable: '--warning-color', fallback: '#f59e0b' },
  red: { variable: '--error-color', fallback: '#ef3b5a' },
  blue: { variable: '--info-color', fallback: '#2f6fe4' },
  purple: { variable: '--purple-color', fallback: '#8b6cff' },
  grey: { variable: '--grey-color', fallback: '#8e919a' },
};

export function baseColor(color: string): string {
  if (Object.prototype.hasOwnProperty.call(PALETTE, color)) {
    const { variable, fallback } = PALETTE[color as PaletteName];
    return `var(${variable}, ${fallback})`;
  }
  return color;
}

/** A plain colour for places that can't take var(): a palette name's fallback, or the colour itself. */
export function solidColor(color: string): string {
  return Object.prototype.hasOwnProperty.call(PALETTE, color) ? PALETTE[color as PaletteName].fallback : color;
}

export function colorStops(color: string): { start: string; end: string } {
  const start = baseColor(color);
  return { start, end: `color-mix(in srgb, ${start} 80%, #fff)` };
}

/** Palette colours light enough to need dark text on top. */
const LIGHT_PALETTE = new Set(['amber']);

/** [r, g, b, alpha] (0–255, 0–1) from #rgb(a), #rrggbb(aa), rgb() or rgba(); undefined for anything else. */
function parseRgba(color: string): [number, number, number, number] | undefined {
  const c = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(c);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return [r, g, b, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(c);
  if (fn) {
    const [r, g, b] = [fn[1], fn[2], fn[3]].map((n) => Math.min(255, Number(n)));
    const a = fn[4] === undefined ? 1 : Number(fn[4]) / (fn[5] ? 100 : 1);
    return [r, g, b, Math.min(1, a)];
  }
  return undefined;
}

/** WCAG relative luminance of an sRGB colour. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Text colour for text drawn over a fill of `color`: 'dark' on light fills (amber, or a parseable
 * custom colour with luminance above 0.4), 'theme' on mostly see-through fills (alpha below 0.5),
 * where the card behind shows through, and 'light' (white) otherwise and for anything unreadable.
 */
export function onFillText(color: string): 'dark' | 'light' | 'theme' {
  if (Object.prototype.hasOwnProperty.call(PALETTE, color)) return LIGHT_PALETTE.has(color) ? 'dark' : 'light';
  const rgba = parseRgba(color);
  if (!rgba) return 'light';
  if (rgba[3] < 0.5) return 'theme';
  return luminance([rgba[0], rgba[1], rgba[2]]) > 0.4 ? 'dark' : 'light';
}

/** Last band with from <= value; below the first band, the first. Bands are sorted ascending. */
export function bandFor(value: number, bands: ResolvedBand[]): ResolvedBand {
  let found = bands[0];
  for (const band of bands) {
    if (band.from <= value) found = band;
    else break;
  }
  return found;
}

export function legendItems(
  bands: ResolvedBand[],
  format: (n: number) => string,
  unit: string,
): { color: string; text: string }[] {
  const u = unit ? ` ${unit}` : '';
  const items: { color: string; text: string }[] = [];
  bands.forEach((band, i) => {
    const next = bands[i + 1];
    const color = baseColor(band.color);
    if (band.label) {
      items.push({ color, text: band.label });
    } else if (!Number.isFinite(band.from)) {
      if (next) items.push({ color, text: `< ${format(next.from)}${u}` });
    } else if (next) {
      items.push({ color, text: `${format(band.from)}–${format(next.from)}${u}` });
    } else {
      items.push({ color, text: `${format(band.from)}${u}+` });
    }
  });
  return items;
}

export const BAND_PRESETS: Record<'battery' | 'usage' | 'temperature' | 'none', ResolvedBand[] | undefined> = {
  battery: [
    { from: 0, color: 'red', label: 'Low' },
    { from: 20, color: 'amber' },
    { from: 50, color: 'green' },
  ],
  usage: [
    { from: 0, color: 'green' },
    { from: 60, color: 'amber' },
    { from: 85, color: 'red', label: 'High' },
  ],
  temperature: [
    { from: -50, color: 'blue', label: 'Cold' },
    { from: 16, color: 'green' },
    { from: 24, color: 'amber' },
    { from: 28, color: 'red', label: 'Hot' },
  ],
  none: undefined,
};
