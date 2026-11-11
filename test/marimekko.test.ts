import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { cellValue, marimekkoLayout } from '../src/chart/marimekko';
import type { MekkoCell } from '../src/chart/marimekko';
import { categoryColors, segmentText, validateMarimekko } from '../src/styles/marimekko';
import { STYLES, isChart } from '../src/styles/index';
import type { CardConfig } from '../src/types';
import { makeHass } from './helpers/hass';
import { stubEditorElements } from './helpers/chart';
import type { Card, Editor, Stub } from './helpers/chart';

stubEditorElements();
await import('../src/editor/chartdeck-card-editor');

const cell = (index: number, group: string, category: string, value: number | null): MekkoCell => ({
  index,
  group,
  category,
  value,
});

const ROOMS: MekkoCell[] = [
  cell(0, 'Kitchen', 'Heat', 3),
  cell(1, 'Kitchen', 'Light', 1),
  cell(2, 'Office', 'Light', 1),
  cell(3, 'Office', 'Heat', 1),
  cell(4, 'Garage', 'Heat', 0),
  cell(5, 'Garage', 'Light', null),
];

describe('marimekko maths', () => {
  it('counts only positive numbers', () => {
    expect([cellValue(2), cellValue(0), cellValue(-1), cellValue(null), cellValue(NaN)]).toEqual([2, 0, 0, 0, 0]);
  });

  it('sizes columns by their total and segments by their share, dropping empty columns', () => {
    const l = marimekkoLayout(ROOMS, 206, 100, 6);
    expect(l.total).toBe(6);
    expect(l.categories).toEqual(['Heat', 'Light']);
    expect(l.columns.map((c) => c.name)).toEqual(['Kitchen', 'Office']);
    const [k, o] = l.columns;
    expect(k.w).toBeCloseTo(200 * (4 / 6));
    expect(o.x).toBeCloseTo(k.w + 6);
    expect(k.x + k.w + 6 + o.w).toBeCloseTo(206);
    expect(k.segments.map((s) => [s.share, s.h])).toEqual([
      [0.75, 75],
      [0.25, 25],
    ]);
    // Heat sits at the bottom of every column, whatever order the entities were listed in.
    expect(o.segments.map((s) => s.cell.category)).toEqual(['Heat', 'Light']);
    expect(o.segments[0].y).toBe(50);
    expect(o.segments[1].y).toBe(0);
  });

  it('orders columns by total when sorted, keeping equal ones as listed', () => {
    const cells = [cell(0, 'A', 'x', 1), cell(1, 'B', 'x', 5), cell(2, 'C', 'x', 1)];
    expect(marimekkoLayout(cells, 100, 100, 0, 'descending').columns.map((c) => c.name)).toEqual(['B', 'A', 'C']);
    expect(marimekkoLayout(cells, 100, 100, 0, 'ascending').columns.map((c) => c.name)).toEqual(['A', 'C', 'B']);
  });

  it('has nothing to lay out when nothing has a value', () => {
    const l = marimekkoLayout([cell(0, 'A', 'x', 0)], 100, 100, 3);
    expect(l.columns).toEqual([]);
    expect(l.total).toBe(0);
  });
});

describe('marimekko text', () => {
  const s = { h: 40 } as Parameters<typeof segmentText>[0];
  it('shows the share, the value or both when they fit, and nothing when asked', () => {
    expect(segmentText(s, 80, 'percent', '35%', '3.4 kWh')).toBe('35%');
    expect(segmentText(s, 80, 'value', '35%', '3.4 kWh')).toBe('3.4 kWh');
    expect(segmentText(s, 120, 'both', '35%', '3.4 kWh')).toBe('35% · 3.4 kWh');
    expect(segmentText(s, 40, 'both', '35%', '3.4 kWh')).toBe('35%');
    expect(segmentText(s, 80, 'none', '35%', '3.4 kWh')).toBe('');
    expect(segmentText(s, 20, 'percent', '35%', '3.4 kWh')).toBe('');
    expect(segmentText(s, 20, 'value', '35%', '3.4 kWh')).toBe('');
    expect(segmentText({ h: 10 } as typeof s, 200, 'percent', '35%', '')).toBe('');
  });

  it('colours each category from the first own colour among its entities, else in series order', () => {
    const l = marimekkoLayout(ROOMS, 100, 100, 0);
    expect(categoryColors(l, (i) => (i === 2 ? 'purple' : undefined))).toEqual(['primary', 'purple']);
    expect(categoryColors(l, () => undefined)).toEqual(['primary', 'amber']);
  });
});

describe('marimekko validation', () => {
  const v = (raw: Partial<CardConfig>) => () => validateMarimekko({ type: 'x', ...raw } as CardConfig);
  it('accepts its options and explains what is wrong', () => {
    expect(v({ segment_labels: 'both', group_by: 'area' })).not.toThrow();
    expect(v({ segment_labels: 'x' })).toThrow('"segment_labels" must be one of: percent, value, both, none');
    expect(v({ entities: [{ entity: 'sensor.a', category: 3 }] as CardConfig['entities'] })).toThrow(
      'Entity 1: "category" must be text',
    );
    expect(v({ entities: [{ entity: 'sensor.a', group: 3 }] as CardConfig['entities'] })).toThrow(/"group"/);
    expect(
      v({ entities: ['sensor.a', { entity: 'sensor.b', category: null }] as CardConfig['entities'] }),
    ).not.toThrow();
  });
});

const hass = (overrides: Record<string, string> = {}) =>
  makeHass({
    'sensor.kh': [overrides.kh ?? '3', { friendly_name: 'Kitchen heat', unit_of_measurement: 'kWh' }],
    'sensor.kl': ['1', { friendly_name: 'Kitchen light', unit_of_measurement: 'kWh' }],
    'sensor.oh': ['1', { friendly_name: 'Office heat', unit_of_measurement: 'kWh' }],
    'sensor.ol': ['1', { friendly_name: 'Office light', unit_of_measurement: 'kWh' }],
    'sensor.off': ['unavailable', { friendly_name: 'Garage heat', unit_of_measurement: 'kWh' }],
  });

const ENTITIES = [
  { entity: 'sensor.kh', group: 'Kitchen', category: 'Heat' },
  { entity: 'sensor.kl', group: 'Kitchen', category: 'Light' },
  { entity: 'sensor.oh', group: 'Office', category: 'Heat' },
  { entity: 'sensor.ol', group: 'Office', category: 'Light', color: 'purple' },
  { entity: 'sensor.off', group: 'Garage', category: 'Heat' },
];

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'marimekko', entities: ENTITIES, ...config } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('marimekko card', () => {
  it('is a chart in the parts-of-a-total group', () => {
    expect(isChart(STYLES.marimekko)).toBe(true);
    expect(STYLES.marimekko.group).toBe('totals');
  });

  it('draws a segment per entity with a value, each one opening its entity', async () => {
    const card = await mount({});
    const segs = qa(card, '.mekko .segment.entity');
    expect(segs.map((s) => s.getAttribute('data-index'))).toEqual(['0', '1', '2', '3']);
    expect(segs.map(text)).toEqual(['75%', '25%', '50%', '50%']);
    expect(segs[0].getAttribute('aria-label')).toBe('Kitchen heat, 3.0 kWh (75%, Kitchen)');
    expect(segs[3].getAttribute('style')).toContain('--purple-color');
    expect(q(card, '.mekko')!.getAttribute('role')).toBe('img');
    expect(q(card, '.mekko')!.getAttribute('aria-label')).toBe(
      'Marimekko chart, columns: Kitchen 4.0 kWh, Office 2.0 kWh',
    );
    expect(qa(card, '.mekko-names span').map(text)).toEqual(['Kitchen', 'Office']);
    expect(qa(card, '.mekko-totals span').map(text)).toEqual(['4.0 kWh', '2.0 kWh']);
    expect(qa(card, '.mekko-key').map(text)).toEqual(['Heat', 'Light']);
    // The unavailable entity is listed underneath, still tappable.
    const missing = q(card, '.mekko-missing .entity')!;
    expect(missing.getAttribute('data-index')).toBe('4');
    expect(text(missing)).toBe('Garage heat (Unavailable)');
  });

  it('orders columns with the card sort and labels segments as asked', async () => {
    const card = await mount({ sort: 'ascending', segment_labels: 'value' } as Partial<CardConfig>);
    expect(qa(card, '.mekko-names span').map(text)).toEqual(['Office', 'Kitchen']);
    // Categories keep the listed order (Heat at the bottom) though the card sorted the entities.
    expect(qa(card, '.mekko-key').map(text)).toEqual(['Heat', 'Light']);
    expect(qa(card, '.mekko .segment').map(text)).toContain('3.0 kWh');
    document.body.innerHTML = '';
    const none = await mount({ segment_labels: 'none', show: { name: false, value: false } } as Partial<CardConfig>);
    expect(qa(none, '.segment-text')).toHaveLength(0);
    expect(q(none, '.mekko-names')).toBeNull();
    expect(q(none, '.mekko-totals')).toBeNull();
  });

  it('falls back to the entity name as category and "Other" as group, and skips totals for mixed units', async () => {
    const h = makeHass({
      'sensor.a': ['2', { friendly_name: 'A', unit_of_measurement: 'kWh' }],
      'sensor.b': ['2', { friendly_name: 'B', unit_of_measurement: 'W' }],
    });
    const card = await mount({ entities: ['sensor.a', 'sensor.b'] }, h);
    expect(qa(card, '.mekko-names span').map(text)).toEqual(['Other']);
    expect(qa(card, '.mekko-key').map(text)).toEqual(['A', 'B']);
    expect(q(card, '.mekko-totals')).toBeNull();
  });

  it('says so when nothing has a value', async () => {
    const card = await mount({}, hass({ kh: '0' }));
    expect(qa(card, '.mekko .segment')).toHaveLength(4 - 1);
    document.body.innerHTML = '';
    const empty = await mount({ entities: [{ entity: 'sensor.off', group: 'G' }] });
    expect(text(q(empty, '.chart-message')!)).toBe('Nothing to show: no entity has a value above zero.');
    expect(q(empty, '.mekko-missing .entity')).not.toBeNull();
  });

  it('is checked when the card is set up', () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() => card.setConfig({ type: 'x', style: 'marimekko', segment_labels: 'x' } as CardConfig)).toThrow(
      /segment_labels/,
    );
  });
});

describe('marimekko editor', () => {
  async function editor(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as Editor;
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'marimekko', ...config } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return ed;
  }

  it('sets the segment text and group_by in the Chart section, dropping the default', async () => {
    const ed = await editor({ entities: ENTITIES } as Partial<CardConfig>);
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect((form.schema as { name: string }[]).map((s) => s.name)).toEqual(['marimekko_segment_labels', 'group_by']);
    expect(form.data).toEqual({ marimekko_segment_labels: 'percent', group_by: [] });
    const changed: CardConfig[] = [];
    ed.addEventListener('config-changed', (ev) => changed.push((ev as CustomEvent).detail.config));
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { marimekko_segment_labels: 'both', group_by: ['area'] } } }),
    );
    expect(changed.at(-1)!.segment_labels).toBe('both');
    expect(changed.at(-1)!.group_by).toEqual(['area']);
  });

  it("puts group, category and colour in each entity's options", async () => {
    const ed = await editor({ entities: ENTITIES } as Partial<CardConfig>);
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = list.chartFields as { fields: { name: string; path: string[] }[] };
    expect(fields.fields.map((f) => [f.name, f.path.join('.')])).toEqual([
      ['marimekko_group', 'group'],
      ['marimekko_category', 'category'],
      ['marimekko_color', 'color'],
    ]);
  });

  it('keeps a place group_by when switching from the treemap', async () => {
    const ed = await editor({ style: 'treemap', group_by: 'area' } as Partial<CardConfig>);
    const changed: CardConfig[] = [];
    ed.addEventListener('config-changed', (ev) => changed.push((ev as CustomEvent).detail.config));
    (ed.shadowRoot!.querySelector('button[data-style="marimekko"]') as HTMLElement).click();
    expect(changed.at(-1)!.style).toBe('marimekko');
    expect(changed.at(-1)!.group_by).toBe('area');
  });
});
