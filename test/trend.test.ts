import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

class Stub extends HTMLElement {
  [key: string]: unknown;
}
for (const tag of [
  'ha-form',
  'ha-expansion-panel',
  'ha-selector',
  'ha-entity-picker',
  'ha-icon-picker',
  'ha-icon-button',
  'ha-switch',
]) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}
await import('../src/editor/chartdeck-card-editor');

type Card = HTMLElement & {
  setConfig(c: CardConfig): void;
  hass?: HomeAssistant;
  updateComplete: Promise<boolean>;
  getGridOptions(): Record<string, unknown>;
};

const now = Date.now();
const sec = (msAgo: number) => (now - msAgo) / 1000;
const H = 3_600_000;

function hassWith(history: Record<string, { s: string; lu: number }[]>, fail = false) {
  const hass = makeHass({
    'sensor.in': ['18.8', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
  });
  hass.callWS = vi.fn(async () => {
    if (fail) throw new Error('boom');
    return history;
  }) as HomeAssistant['callWS'];
  return hass;
}

const history = {
  'sensor.in': [
    { s: '17', lu: sec(23 * H) },
    { s: '19', lu: sec(16 * H) },
    { s: '22', lu: sec(8 * H) },
    { s: '18.8', lu: sec(2 * H) },
  ],
  'sensor.out': [
    { s: '5', lu: sec(23 * H) },
    { s: '9', lu: sec(4 * H) },
  ],
};

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'trend',
    entities: ['sensor.in'],
    ...config,
  } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('trend card', () => {
  it('shows the name, icon and large value over a filled line, as a half-width tile', async () => {
    const card = await mount({ name: 'Temperature' });
    expect(text(q(card, '.trend-name'))).toBe('Temperature');
    expect(q(card, '.trend-header ha-state-icon')).not.toBeNull();
    expect(text(q(card, '.trend-value'))).toBe('18.8');
    expect(text(q(card, '.trend-unit'))).toBe('°C');
    expect(qa(card, 'path.line')).toHaveLength(1);
    expect(q(card, 'path.fill.fade')!.getAttribute('mask')).toBe('url(#cd-trend-fade)');
    // 24 hours at 0.5 points per hour is 12 buckets, drawn as one smooth run edge to edge.
    const d = q(card, 'path.line')!.getAttribute('d')!;
    expect(d.startsWith('M0,')).toBe(true);
    expect(d.match(/C/g)!.length).toBeGreaterThanOrEqual(12);
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Trend chart of Temperature');
    expect(q(card, '.trend-graph')!.getAttribute('style')).toContain('aspect-ratio:500 / 150');
    expect(card.getGridOptions()).toMatchObject({ columns: 6, min_columns: 3, rows: 'auto' });
  });

  it('draws every reading with points_per_hour 0, and fades or drops the fill', async () => {
    const raw = await mount({ points_per_hour: 0, fill: 'solid', curve: 'straight' } as Partial<CardConfig>);
    expect(q(raw, 'path.line')!.getAttribute('d')!.match(/L/g)).toHaveLength(4);
    expect(q(raw, 'path.fill.solid')!.hasAttribute('mask')).toBe(false);
    const none = await mount({ fill: false } as Partial<CardConfig>);
    expect(q(none, 'path.fill')).toBeNull();
  });

  it('colours the line by bands, and the icon, name and value by the current band', async () => {
    const card = await mount({
      severity: [
        { from: 0, color: 'blue' },
        { from: 18, color: 'red' },
      ],
      color_icon: true,
      color_name: true,
      color_value: true,
      color_transition: 'hard',
    } as Partial<CardConfig>);
    expect(q(card, 'path.line')!.getAttribute('stroke')).toBe('url(#cd-trend-0)');
    expect(qa(card, '#cd-trend-0 stop').length).toBe(4);
    expect(q(card, '.trend-value')!.getAttribute('style')).toContain('--error-color');
    expect(q(card, '.trend-name')!.getAttribute('style')).toContain('--error-color');
    expect(q(card, '.trend-icon')!.getAttribute('style')).toContain('--error-color');
    // An entity's own colour wins over bands.
    const own = await mount({
      entities: [{ entity: 'sensor.in', color: 'green' }],
      severity: [{ from: 0, color: 'blue' }],
    } as Partial<CardConfig>);
    expect(q(own, 'path.line')!.getAttribute('stroke')).toContain('--success-color');
  });

  it('shows other entities small, in a legend, and on a right-hand axis', async () => {
    const card = await mount({
      name: 'Temperatures',
      entities: ['sensor.in', { entity: 'sensor.out', show_state: true, y_axis: 'secondary', show_legend_state: true }],
      labels: true,
    } as Partial<CardConfig>);
    expect(qa(card, 'path.line')).toHaveLength(2);
    expect(text(q(card, '.trend-state.small'))).toBe('9.0°C');
    // The card's name is the header's; the legend uses each entity's friendly name.
    expect(qa(card, '.trend-legend .series-item').map(text)).toEqual(['Inside', 'Outside 9.0 °C']);
    expect(text(q(card, '.trend-labels.primary'))).toMatch(/°C/);
    expect(text(q(card, '.trend-labels.secondary'))).toBe('9.0 °C5.0 °C');
    expect(q(card, '.trend-labels-wrap.labels-always')).not.toBeNull();
  });

  it('leaves out an entity that is off the graph, and draws a fixed value flat', async () => {
    const card = await mount({
      entities: [
        { entity: 'sensor.in', fixed_value: true },
        { entity: 'sensor.out', show_graph: false },
      ],
      points_per_hour: 0,
      curve: 'straight',
    } as Partial<CardConfig>);
    const lines = qa(card, 'path.line');
    expect(lines).toHaveLength(1);
    const ys = lines[0].getAttribute('d')!.match(/,([\d.]+)/g)!;
    expect(new Set(ys).size).toBe(1);
    expect(q(card, '.trend-legend')).toBeNull();
  });

  it('draws bars from zero, coloured by band, one per day', async () => {
    const card = await mount({
      graph: 'bar',
      period: { last: 3, unit: 'day' },
      group_by: 'day',
      severity: [
        { from: 0, color: 'blue' },
        { from: 18.5, color: 'red' },
      ],
    } as Partial<CardConfig>);
    const bars = qa(card, '.trend-col');
    expect(bars.length).toBeGreaterThanOrEqual(1);
    expect(bars.length).toBeLessThanOrEqual(4);
    expect(qa(card, 'path.line')).toHaveLength(0);
  });

  it('shows min, average and max, and scales values by value_factor', async () => {
    const card = await mount({
      extrema: true,
      average: true,
      value_factor: -1,
      points_per_hour: 0,
    } as Partial<CardConfig>);
    const items = qa(card, '.trend-chip').map(text);
    expect(items[0]).toMatch(/^Low 1\.7 °C · /);
    expect(items[1]).toMatch(/^Average 1\.\d °C$/);
    expect(items[2]).toMatch(/^High 2\.2 °C · /);
    expect(text(q(card, '.trend-value'))).toBe('1.9');
  });

  it('shows the value under the pointer in place of the current one', async () => {
    const card = await mount({ name: 'Temperature' });
    const graph = q(card, '.trend-graph') as HTMLElement;
    graph.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 30 }) as DOMRect;
    graph.dispatchEvent(new PointerEvent('pointermove', { clientX: 50, pointerType: 'mouse' }));
    await card.updateComplete;
    expect(q(card, '.trend-when')).not.toBeNull();
    expect(text(q(card, '.trend-value'))).toMatch(/^(19|22)\.\d$/);
    expect(q(card, '.hover-dot')).not.toBeNull();
    expect(q(card, '.trend-graph .crosshair')).not.toBeNull();
    graph.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await card.updateComplete;
    expect(q(card, '.trend-when')).toBeNull();
    expect(text(q(card, '.trend-value'))).toBe('18.8');
  });

  it('lays out the header and value as asked, and hides the graph', async () => {
    const card = await mount({
      align_icon: 'state',
      align_state: 'center',
      align_header: 'center',
      graph: 'none',
      font_size: 80,
      font_size_header: 18,
      icon_image: '/local/me.png',
      group: true,
    } as Partial<CardConfig>);
    expect(q(card, '.trend-header .trend-icon')).toBeNull();
    expect(q(card, '.trend-states .trend-icon img')!.getAttribute('src')).toBe('/local/me.png');
    expect(q(card, '.trend-states.align-center')!.getAttribute('style')).toContain('font-size:80%');
    expect(q(card, '.trend-header.align-center')!.getAttribute('style')).toContain('font-size:18px');
    expect(q(card, '.trend-graph')).toBeNull();
    expect(q(card, '.trend.group.no-graph')).not.toBeNull();
  });

  it('says when history is loading, failed or empty, under the value', async () => {
    const failed = await mount({}, hassWith(history, true));
    expect(text(q(failed, '.trend-graph.message.error'))).toBe("Couldn't load history: boom");
    expect(text(q(failed, '.trend-value'))).toBe('18.8');
    const empty = await mount({}, hassWith({}));
    expect(text(q(empty, '.trend-graph.message'))).toBe('No readings in this period.');
  });

  it('opens the entity from its name, value and legend entry', async () => {
    const card = await mount({ entities: ['sensor.in', 'sensor.out'] });
    expect(qa(card, '.entity').map((e) => (e as HTMLElement).dataset.index)).toEqual(['0', '0', '0', '1']);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'trend', entities: ['sensor.in'], ...extra } as CardConfig);
    expect(set({ graph: 'pie' })).toThrow(/"graph" must be one of: line, bar, none/);
    expect(set({ fill: 'striped' })).toThrow(/"fill"/);
    expect(set({ points: 'sometimes' })).toThrow(/"points"/);
    expect(set({ points_per_hour: -1 })).toThrow(/"points_per_hour"/);
    expect(set({ value_factor: 1.5 })).toThrow(/whole number/);
    expect(set({ y_min: 'low' })).toThrow(/"y_min"/);
    expect(set({ extrema: 'yes' })).toThrow(/"extrema"/);
    expect(set({ icon_image: 5 })).toThrow(/"icon_image"/);
    expect(set({ entities: [{ entity: 'sensor.in', y_axis: 'left' }] })).toThrow(/y_axis/);
    expect(set({ entities: [{ entity: 'sensor.in', aggregate: 'avg' }] })).toThrow(/aggregate/);
    expect(set({ entities: [{ entity: 'sensor.in', show_fill: 'no' }] })).toThrow(/show_fill/);
    expect(set({ fill: true, points: false, labels: 'hover', y_min: '~0', y_max: 30 })).not.toThrow();
  });
});

describe('trend card editor', () => {
  it('shows the Chart section, writes options, and keeps number bounds as numbers', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'trend', entities: ['sensor.in'], y_max: 30 } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    const data = form.data as Record<string, unknown>;
    expect(data).toMatchObject({
      points_per_hour: 0.5,
      graph: 'line',
      fill: 'fade',
      points: 'hover',
      labels: 'hover',
      height: 150,
      line_width: 2.5,
      legend: true,
      trend_y_max: '30',
      trend_tooltip: true,
    });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...data, graph: 'bar', trend_y_min: '0', trend_y_max: '~40', extrema: true } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, graph: 'bar', y_min: 0, y_max: '~40', extrema: true });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = (list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name);
    expect(fields).toContain('y_axis_side');
    expect(fields).toContain('show_state');
    expect(fields).toContain('fixed_value');
  });
});
