import { describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { fitStatusText } from '../src/status-text';
import type { ChartdeckCard } from '../src/chartdeck-card';
import { makeHass } from './helpers/hass';

/** Width at ~0.58 em per character. */
const width = (fit: { lines: string[]; size: number }) => Math.max(...fit.lines.map((l) => l.length)) * 0.58 * fit.size;

describe('fitStatusText', () => {
  it('keeps short text on one line at up to 12 px', () => {
    expect(fitStatusText('Unavailable')).toEqual({ lines: ['Unavailable'], size: 11 });
    expect(fitStatusText('Off')).toEqual({ lines: ['Off'], size: 12 });
  });

  it('splits longer text on the space that balances the lines best', () => {
    expect(fitStatusText('Entity not found')).toEqual({ lines: ['Entity', 'not found'], size: 12 });
    const de = fitStatusText('Entität nicht gefunden');
    expect(de.lines).toEqual(['Entität nicht', 'gefunden']);
    expect(width(de)).toBeLessThanOrEqual(76);
  });

  it('shrinks to fit, down to 8 px', () => {
    const word = fitStatusText('Nichtverfügbar');
    expect(word.lines).toEqual(['Nichtverfügbar']);
    expect(width(word)).toBeLessThanOrEqual(76);
    expect(fitStatusText('A really quite extraordinarily long status').size).toBe(8);
  });

  it('ignores leading and trailing spaces when splitting', () => {
    expect(fitStatusText(' Entity not found ')).toEqual({ lines: ['Entity', 'not found'], size: 12 });
  });

  it('counts wide (CJK) characters as a full em', () => {
    const fit = fitStatusText('エンティティが見つかりません');
    expect(fit.size).toBe(8);
    expect(fitStatusText('不可用不可用', 40).size).toBeLessThan(fitStatusText('abcdef', 40).size);
  });

  it('splits only above a chosen length', () => {
    expect(fitStatusText('Entity not found', 126, 12, 8, 18)).toEqual({ lines: ['Entity not found'], size: 12 });
  });

  it('honours a custom width and size range', () => {
    expect(fitStatusText('Unavailable', 64, 11, 7)).toEqual({ lines: ['Unavailable'], size: 10 });
  });
});

describe('ring and arc status text', () => {
  const hass = makeHass({ 'sensor.b': 'unavailable' });

  for (const style of ['ring', 'arc'] as const) {
    it(`${style} fits "Entity not found" inside the hollow on two lines`, async () => {
      const card = document.createElement('chartdeck-card') as ChartdeckCard;
      card.setConfig({ type: 'custom:chartdeck-card', style, entities: ['sensor.missing', 'sensor.b'] });
      card.hass = hass;
      document.body.appendChild(card);
      await card.updateComplete;
      const [missing, na] = [...card.shadowRoot!.querySelectorAll('.na')];
      expect([...missing.querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['Entity', 'not found']);
      expect(missing.getAttribute('style')).toContain('font-size: 12px');
      expect([...na.querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['Unavailable']);
      expect(na.getAttribute('style')).toContain('font-size: 11px');
      card.remove();
    });
  }
});
