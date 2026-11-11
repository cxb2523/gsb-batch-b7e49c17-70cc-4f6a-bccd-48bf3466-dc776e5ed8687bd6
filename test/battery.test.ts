import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { DEFAULT_BANDS } from '../src/config';
import type { ResolvedEntity } from '../src/resolve';
import { batteryColor, batteryColumns } from '../src/styles/battery';
import { STYLES, isChart } from '../src/styles/index';
import type { CardConfig } from '../src/types';
import { makeHass } from './helpers/hass';
import { stubEditorElements } from './helpers/chart';
import type { Card, Editor } from './helpers/chart';

stubEditorElements();
await import('../src/editor/chartdeck-card-editor');

const entity = (value: number | null, own?: Partial<ResolvedEntity>) =>
  ({
    available: value !== null,
    value,
    config: { severity: DEFAULT_BANDS },
    band: { from: 0, color: 'purple' },
    ...own,
  }) as unknown as ResolvedEntity;

describe('battery maths', () => {
  it('colours red below 20, amber below 40 and green above when no bands are set', () => {
    expect([5, 19.9, 20, 39, 40, 100].map((v) => batteryColor(entity(v)))).toEqual([
      'red',
      'red',
      'amber',
      'amber',
      'green',
      'green',
    ]);
    expect(batteryColor(entity(-3))).toBe('red');
    expect(batteryColor(entity(null))).toBe('grey');
  });

  it("uses the card's or the entity's own bands when they are set", () => {
    expect(batteryColor(entity(5, { config: { severity: [] } } as unknown as Partial<ResolvedEntity>))).toBe('purple');
  });

  it('fits as many tiles as there is room for, or at most the set number of columns', () => {
    expect(batteryColumns(undefined)).toBe('grid-template-columns: repeat(auto-fill, minmax(88px, 1fr))');
    expect(batteryColumns(4)).toContain('calc((100% - 24px) / 4 - 0.5px)');
    expect(batteryColumns(1)).toContain('calc((100% - 0px) / 1 - 0.5px)');
  });
});

const hass = () =>
  makeHass({
    'sensor.door': ['92', { friendly_name: 'Front door', unit_of_measurement: '%', device_class: 'battery' }],
    'sensor.leak': ['12', { friendly_name: 'Water leak', unit_of_measurement: '%', device_class: 'battery' }],
    'sensor.remote': ['34', { friendly_name: 'Remote', unit_of_measurement: '%', device_class: 'battery' }],
    'sensor.off': ['unavailable', { friendly_name: 'Window', device_class: 'battery' }],
  });

async function mount(config: Partial<CardConfig>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'battery',
    entities: ['sensor.door', 'sensor.leak', 'sensor.remote', 'sensor.off', 'sensor.missing'],
    ...config,
  } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('battery card', () => {
  it('is a chart among the bars', () => {
    expect(isChart(STYLES.battery)).toBe(true);
    expect(STYLES.battery.group).toBe('bars');
  });

  it('draws a battery per entity, filled to its level and coloured by it, each opening its entity', async () => {
    const card = await mount({ sort: 'ascending' });
    const tiles = qa(card, '.battery-grid .battery.entity');
    expect(tiles.map((t) => t.getAttribute('data-index'))).toEqual(['0', '1', '2', '3', '4']);
    expect(tiles.map((t) => t.querySelector('.battery-name')!.textContent)).toEqual([
      'Water leak',
      'Remote',
      'Front door',
      'Window',
      'sensor.missing',
    ]);
    expect(tiles.map((t) => text(t.querySelector('.battery-value')!))).toEqual([
      '12 %',
      '34 %',
      '92 %',
      'Unavailable',
      'Entity not found',
    ]);
    const levels = tiles.map((t) => t.querySelector('rect.level'));
    expect(levels[0]!.getAttribute('fill')).toContain('--error-color');
    expect(levels[1]!.getAttribute('fill')).toContain('--warning-color');
    expect(levels[2]!.getAttribute('fill')).toContain('--success-color');
    expect(Number(levels[0]!.getAttribute('width'))).toBeCloseTo(38 * 0.12);
    expect(levels[3]).toBeNull();
    expect(tiles[3].classList.contains('unavailable')).toBe(true);
    expect(tiles[3].querySelector('rect.body.empty')).not.toBeNull();
    const grid = card.shadowRoot!.querySelector('.battery-grid')!;
    expect(grid.getAttribute('role')).toBe('img');
    expect(grid.getAttribute('aria-label')).toBe(
      'Battery levels: Water leak, 12 %, Remote, 34 %, Front door, 92 %, Window, Unavailable, sensor.missing, Entity not found',
    );
    expect(grid.getAttribute('style')).toContain('minmax(88px, 1fr)');
  });

  it('keeps the listed order without a sort, follows columns, bands and the Display switches', async () => {
    const card = await mount({
      columns: 2,
      show: { name: false },
      severity: [
        { from: 0, color: 'blue' },
        { from: 50, color: 'purple' },
      ],
    } as Partial<CardConfig>);
    const tiles = qa(card, '.battery.entity');
    expect(tiles.map((t) => t.getAttribute('title'))[0]).toBe('Front door, 92 %');
    expect(qa(card, '.battery-name')).toHaveLength(0);
    expect(tiles[0].querySelector('rect.level')!.getAttribute('fill')).toContain('--purple-color');
    expect(tiles[1].querySelector('rect.level')!.getAttribute('fill')).toContain('--info-color');
    expect(card.shadowRoot!.querySelector('.battery-grid')!.getAttribute('style')).toContain('/ 2 - 0.5px');
    document.body.innerHTML = '';
    const quiet = await mount({ show: { value: false } } as Partial<CardConfig>);
    // Values hide, but a battery with no reading still says why.
    expect(qa(quiet, '.battery-value').map(text)).toEqual(['Unavailable', 'Entity not found']);
  });
});

describe('battery editor', () => {
  async function editor(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as Editor;
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', ...config } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return ed;
  }

  it('sorts lowest first when the style is picked, unless a sort is already set', async () => {
    const ed = await editor({ entities: ['sensor.a'] });
    const changed: CardConfig[] = [];
    ed.addEventListener('config-changed', (ev) => changed.push((ev as CustomEvent).detail.config));
    const pick = () => (ed.shadowRoot!.querySelector('button[data-style="battery"]') as HTMLElement).click();
    pick();
    expect(changed.at(-1)!.style).toBe('battery');
    expect(changed.at(-1)!.sort).toBe('ascending');
    ed.setConfig({ type: 'custom:chartdeck-card', entities: ['sensor.a'], sort: 'descending' } as CardConfig);
    await ed.updateComplete;
    pick();
    expect(changed.at(-1)!.sort).toBe('descending');
  });

  it('has no Chart section: columns and sort are in Display', async () => {
    const ed = await editor({ style: 'battery', entities: ['sensor.a'] } as Partial<CardConfig>);
    expect(ed.shadowRoot!.querySelector('.section-chart')).toBeNull();
  });
});
