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

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();
const sec = (msAgo: number) => (now - msAgo) / 1000;
const H = 3_600_000;

function hassWith(history: Record<string, { s: string; lu: number }[]>, fail = false) {
  const hass = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
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
    { s: '19', lu: sec(20 * H) },
    { s: '20', lu: sec(10 * H) },
    { s: 'unavailable', lu: sec(8 * H) },
    { s: '21', lu: sec(2 * H) },
  ],
  'sensor.out': [
    { s: '5', lu: sec(20 * H) },
    { s: '9', lu: sec(4 * H) },
  ],
};

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: ['sensor.in', 'sensor.out'],
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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('line chart', () => {
  it('draws one line per entity, broken at the unavailable stretch, under a header of current values', async () => {
    const card = await mount({});
    const lines = qa(card, 'path.line');
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(lines[1].getAttribute('d')!.match(/M/g)).toHaveLength(1);
    expect(lines[0].getAttribute('stroke')).toContain('--primary-color');
    expect(lines[1].getAttribute('stroke')).toContain('--warning-color');
    const header = qa(card, '.series-item').map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
    expect(header).toEqual(['Inside 21.0 °C', 'Outside 9.0 °C']);
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Line chart of Inside, Outside');
    expect(card.hass!.callWS).toHaveBeenCalledTimes(1);
  });

  it('uses per-entity colour, dashes and shape, and a stepped card shape', async () => {
    const card = await mount({
      curve: 'step',
      entities: [
        { entity: 'sensor.in', color: 'red', dash: true },
        { entity: 'sensor.out', curve: 'straight' },
      ],
    } as Partial<CardConfig>);
    const [a, b] = qa(card, 'path.line');
    expect(a.getAttribute('stroke')).toContain('--error-color');
    expect(a.classList.contains('dashed')).toBe(true);
    expect(a.getAttribute('d')).toMatch(/H/);
    expect(b.getAttribute('d')).toMatch(/L/);
  });

  it('colours by band with a gradient, and labels points when asked', async () => {
    const card = await mount({
      color_by: 'bands',
      labels: true,
      severity: [
        { from: 0, color: 'blue' },
        { from: 20, color: 'red' },
      ],
    } as Partial<CardConfig>);
    expect(qa(card, 'linearGradient')).toHaveLength(2);
    expect(qa(card, 'path.line')[0].getAttribute('stroke')).toBe('url(#cd-bands-0)');
    const labels = qa(card, '.point-label').map((e) => e.textContent);
    expect(labels).toContain('19.0');
    expect(labels).toContain('5.0');
  });

  it('says when history is loading, failed, or empty', async () => {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'] } as CardConfig);
    card.hass = hassWith(history);
    document.body.appendChild(card);
    await card.updateComplete;
    expect(q(card, '.chart-message')!.textContent).toBe('Loading history…');
    const failed = await mount({}, hassWith(history, true));
    expect(q(failed, '.chart-message.error')!.textContent!.trim()).toBe("Couldn't load history: boom");
    const empty = await mount({}, hassWith({}));
    expect(q(empty, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('draws its data even when moved while it was loading (masonry re-layout)', async () => {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'] } as CardConfig);
    card.hass = hassWith(history);
    document.body.appendChild(card);
    await card.updateComplete;
    card.remove();
    document.body.appendChild(card);
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    expect(qa(card, 'path.line')).toHaveLength(1);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'line', entities: ['sensor.in'], ...extra } as CardConfig);
    expect(set({ source: 'cloud' })).toThrow(/source/);
    expect(set({ curve: 'wiggly' })).toThrow(/curve/);
    expect(set({ entities: [{ entity: 'sensor.in', curve: 'wiggly' }] })).toThrow(/curve/);
    expect(set({ color_by: 'mood' })).toThrow(/color_by/);
    expect(set({ period: { last: -1 } })).toThrow(/period/);
  });

  it('opens more-info from a header item', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const item = qa(card, '.series-item')[1] as HTMLElement;
    item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    item.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.out']);
  });
});

describe('line chart axes', () => {
  const labels = (card: Card, sel: string) => qa(card, `${sel} .axis-label`).map((e) => e.textContent!.trim());

  it('labels values and times beside the plot, with lines across, by default', async () => {
    const card = await mount({});
    expect(q(card, '.plot-wrap')!.classList.contains('axes-outside')).toBe(true);
    const values = labels(card, '.y-axis');
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values.every((v) => /^-?\d+$/.test(v))).toBe(true);
    expect(q(card, '.axis-sizer')!.textContent!.length).toBe(Math.max(...values.map((v) => v.length)));
    expect(labels(card, '.x-axis').length).toBeGreaterThanOrEqual(2);
    expect(qa(card, '.grid line')).toHaveLength(values.length);
    // The y axis column sits outside the plot area; the x axis row below it.
    expect(q(card, '.plot-area .y-axis')).toBeNull();
    expect(q(card, '.plot-area .x-axis')).toBeNull();
  });

  it('draws labels over the plot, lines down, a fixed range, or nothing at all', async () => {
    const inside = await mount({
      axis_labels: 'inside',
      gridlines: { vertical: true, horizontal: false },
      y_min: 0,
      y_max: 40,
    } as Partial<CardConfig>);
    expect(q(inside, '.plot-area .y-axis')).not.toBeNull();
    expect(labels(inside, '.y-axis')).toEqual(['0', '10', '20', '30', '40']);
    expect(q(inside, '.y-axis .axis-label.top')!.textContent).toBe('40');
    expect(q(inside, '.y-axis .axis-label.bottom')!.textContent).toBe('0');
    expect(qa(inside, '.grid line')).toHaveLength(labels(inside, '.x-axis').length);
    const bare = await mount({ x_axis: false, y_axis: false, gridlines: { horizontal: false } } as Partial<CardConfig>);
    expect(q(bare, '.y-axis')).toBeNull();
    expect(q(bare, '.x-axis')).toBeNull();
    expect(qa(bare, '.grid line')).toHaveLength(0);
    expect(qa(bare, 'path.line')).toHaveLength(2);
  });

  it('redraws when the card is resized enough to fit a different number of time labels', async () => {
    let fire: (w: number) => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: (r: { contentRect: { width: number } }[]) => void) {
          fire = (width) => cb([{ contentRect: { width } }]);
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    try {
      const card = await mount({ period: { last: 7, unit: 'day' } } as Partial<CardConfig>);
      const before = labels(card, '.x-axis').length;
      fire(10);
      await card.updateComplete;
      expect(labels(card, '.x-axis').length).toBeLessThan(before);
      fire(12);
      fire(10);
      card.remove();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('checks its axis options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'line', entities: ['sensor.in'], ...extra } as CardConfig);
    expect(set({ axis_labels: 'left' })).toThrow(/axis_labels/);
    expect(set({ y_min: 10, y_max: 0 })).toThrow(/y_min/);
  });
});

describe('line chart editor', () => {
  it('shows the Chart section and writes period, source, shape and labels', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({
      period_calendar: 'rolling',
      period_last: 24,
      period_unit: 'hour',
      period_offset: 0,
      period_until: 'now',
      period_navigate: false,
      source: 'history',
      group_by: 'none',
      aggregate: 'mean',
      compare: [],
      compare_style: 'grey',
      curve: 'smooth',
      color_by: 'series',
      labels: false,
      labels_show: 'all',
      labels_position: 'auto',
      labels_overlap: false,
      line_width: 2.5,
      dots: false,
      extremes_max: false,
      extremes_min: false,
      extremes_average: 'none',
      anomalies: false,
      anomalies_window: 'auto',
      anomalies_sigma: 3,
      anomalies_color: 'red',
      anomalies_band: true,
      x_axis: true,
      y_axis: true,
      axis_labels: 'outside',
      grid_horizontal: true,
      grid_vertical: false,
      y_scale: 'linear',
      tooltip: true,
      zoom: false,
      overview: false,
      forecast_hours: 24,
      now_marker: 'off',
      zones: false,
      header: 'above',
      compact: false,
      legend_toggle: false,
      multiples: false,
      multiples_scale: 'auto',
    });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), period_last: 7, period_unit: 'day', labels: true } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, period: { last: 7, unit: 'day' }, labels: true });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), grid_vertical: true, axis_labels: 'inside', y_min: 0 } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, gridlines: { vertical: true }, axis_labels: 'inside', y_min: 0 });
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = (list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name);
    expect(fields).toEqual([
      'series_color',
      'curve',
      'line_width',
      'dash',
      'on_top',
      'dots',
      'forecast_entity',
      'forecast_attribute',
      'forecast_value_key',
      'forecast_time_key',
      'forecast_type',
      'forecast_multiply',
    ]);
  });
});
