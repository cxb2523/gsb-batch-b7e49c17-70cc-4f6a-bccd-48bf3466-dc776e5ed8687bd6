import { describe, expect, it } from 'vitest';
import { defaultDecimals, formatNumber, withUnit } from '../src/format';
import { makeHass } from './helpers/hass';

const hass = makeHass(
  {},
  {
    entities: { 'sensor.a': { entity_id: 'sensor.a', display_precision: 2 } },
    locale: { language: 'en', number_format: 'language' },
  },
);
const withFormat = (number_format: string) => ({ ...hass, locale: { language: 'en', number_format } });

describe('defaultDecimals', () => {
  it('uses display precision, then unit based fallback', () => {
    expect(defaultDecimals(hass, 'sensor.a', 'W')).toBe(2);
    expect(defaultDecimals(hass, 'sensor.b', '%')).toBe(0);
    expect(defaultDecimals(hass, 'sensor.b', '°C')).toBe(1);
    expect(defaultDecimals(undefined, 'sensor.b', '%')).toBe(0);
  });
});

describe('formatNumber', () => {
  it('formats per locale setting', () => {
    expect(formatNumber(1234.5, 1, hass)).toBe('1,234.5');
    expect(formatNumber(1234.5, 1, withFormat('decimal_comma'))).toBe('1.234,5');
    expect(formatNumber(1234.5, 1, withFormat('comma_decimal'))).toBe('1,234.5');
    expect(formatNumber(1234.5, 0, withFormat('none'))).toBe('1235');
    expect(formatNumber(1234.5, 1)).toBe('1,234.5');
    expect(formatNumber(1234.5, 1, withFormat('system'))).toMatch(/1.234.5|1,234\.5/);
  });
  it('space_comma uses a comma decimal', () => {
    expect(formatNumber(1234.5, 1, withFormat('space_comma'))).toMatch(/^1\s234,5$/);
  });
  it('never yields negative zero', () => {
    expect(formatNumber(-0.04, 1, hass)).toBe('0.0');
    expect(formatNumber(-0, 0, hass)).toBe('0');
  });
});

describe('withUnit', () => {
  it('adds one space before unit', () => {
    expect(withUnit('12', '%')).toBe('12 %');
    expect(withUnit('21.5', '°C')).toBe('21.5 °C');
    expect(withUnit('12', '')).toBe('12');
  });
});
