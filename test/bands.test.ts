import { describe, expect, it } from 'vitest';
import { BAND_PRESETS, PALETTE, baseColor, bandFor, colorStops, legendItems, onFillText } from '../src/bands';
import { DEFAULT_BANDS } from '../src/config';

const bands = [
  { from: 0, color: 'red', label: 'Low' },
  { from: 20, color: 'amber' },
  { from: 50, color: 'green' },
];

describe('bandFor', () => {
  it('picks the last band with from <= value', () => {
    expect(bandFor(10, bands).color).toBe('red');
    expect(bandFor(20, bands).color).toBe('amber');
    expect(bandFor(99, bands).color).toBe('green');
  });
  it('falls back to the first band below the range', () => {
    expect(bandFor(-5, bands).color).toBe('red');
  });
  it('handles the default band', () => {
    expect(bandFor(42, DEFAULT_BANDS).color).toBe('primary');
  });
});

describe('colours', () => {
  it('maps palette names to theme variables', () => {
    expect(baseColor('green')).toBe('var(--success-color, #1fae7a)');
    expect(PALETTE.purple.variable).toBe('--purple-color');
  });
  it('passes other colours through', () => {
    expect(baseColor('#123456')).toBe('#123456');
    expect(baseColor('var(--my-colour)')).toBe('var(--my-colour)');
  });
  it('builds gradient stops', () => {
    const s = colorStops('red');
    expect(s.start).toBe('var(--error-color, #ef3b5a)');
    expect(s.end).toBe('color-mix(in srgb, var(--error-color, #ef3b5a) 80%, #fff)');
  });
});

describe('legendItems', () => {
  it('uses labels, ranges and an open-ended last band', () => {
    expect(legendItems(bands, String, '%').map((i) => i.text)).toEqual(['Low', '20–50 %', '50 %+']);
  });
  it('omits the space with an empty unit', () => {
    const b = [
      { from: 0, color: 'red' },
      { from: 5, color: 'green' },
    ];
    expect(legendItems(b, String, '').map((i) => i.text)).toEqual(['0–5', '5+']);
  });
  it('lists a -Infinity band as "< next"', () => {
    const b = [
      { from: -Infinity, color: 'red' },
      { from: 5, color: 'green' },
    ];
    expect(legendItems(b, String, '°C').map((i) => i.text)).toEqual(['< 5 °C', '5 °C+']);
  });
  it('gives nothing for a lone -Infinity band', () => {
    expect(legendItems([{ from: -Infinity, color: 'primary' }], String, '%')).toEqual([]);
  });
  it('returns resolved colours', () => {
    expect(legendItems(bands, String, '')[1].color).toBe('var(--warning-color, #f59e0b)');
  });
});

describe('BAND_PRESETS', () => {
  it('defines presets with finite numbers', () => {
    expect(BAND_PRESETS.battery).toEqual([
      { from: 0, color: 'red', label: 'Low' },
      { from: 20, color: 'amber' },
      { from: 50, color: 'green' },
    ]);
    expect(BAND_PRESETS.usage?.[2]).toEqual({ from: 85, color: 'red', label: 'High' });
    expect(BAND_PRESETS.temperature?.every((b) => Number.isFinite(b.from))).toBe(true);
    expect(BAND_PRESETS.none).toBeUndefined();
  });
});

describe('onFillText', () => {
  it('uses dark text on amber and white on the other palette colours', () => {
    expect(onFillText('amber')).toBe('dark');
    for (const c of ['primary', 'green', 'red', 'blue', 'purple', 'grey']) expect(onFillText(c), c).toBe('light');
  });
  it('measures the luminance of custom colours it can parse', () => {
    expect(onFillText('#ffeb3b')).toBe('dark');
    expect(onFillText('#1f3864')).toBe('light');
    expect(onFillText('#ff0')).toBe('dark');
    expect(onFillText('rgb(255, 235, 59)')).toBe('dark');
    expect(onFillText('rgba(31, 56, 100, 0.9)')).toBe('light');
    expect(onFillText('  #FFFFFF ')).toBe('dark');
  });
  it('follows the theme text colour on mostly see-through fills', () => {
    expect(onFillText('rgba(255, 255, 255, 0.15)')).toBe('theme');
    expect(onFillText('rgb(0 0 0 / 30%)')).toBe('theme');
    expect(onFillText('#ffffff22')).toBe('theme');
    expect(onFillText('#fff3')).toBe('theme');
    expect(onFillText('rgba(255, 235, 59, 0.8)')).toBe('dark');
    expect(onFillText('#1f3864cc')).toBe('light');
  });
  it('falls back to white text for colours it cannot read', () => {
    expect(onFillText('var(--x)')).toBe('light');
    expect(onFillText('hsl(60 100% 50%)')).toBe('light');
    expect(onFillText('#12')).toBe('light');
    expect(onFillText('')).toBe('light');
  });
});
