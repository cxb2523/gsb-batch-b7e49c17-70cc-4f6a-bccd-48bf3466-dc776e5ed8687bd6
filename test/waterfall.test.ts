import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { change, firstReading, signed, waterfallBars } from '../src/styles/waterfall';
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
    'sensor.battery': ['6', { friendly_name: 'Battery', unit_of_measurement: 'kWh' }],
    'sensor.solar': ['10', { friendly_name: 'Solar', unit_of_measurement: 'kWh' }],
    'sensor.house': ['7', { friendly_name: 'House', unit_of_measurement: 'kWh' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off' }],
  });
  hass.callWS = vi.fn(async () => {
    if (fail) throw new Error('boom');
    return history;
  }) as HomeAssistant['callWS'];
  return hass;
}

const history = {
  'sensor.battery': [
    { s: '4', lu: sec(20 * H) },
    { s: '6', lu: sec(2 * H) },
  ],
  'sensor.solar': [
    { s: '4', lu: sec(20 * H) },
    { s: '10', lu: sec(3 * H) },
  ],
  'sensor.house': [
    { s: '3', lu: sec(20 * H) },
    { s: 'unavailable', lu: sec(10 * H) },
    { s: '7', lu: sec(1 * H) },
  ],
};

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'waterfall',
    entities: ['sensor.solar', 'sensor.house'],
    ...config,
  } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const text = (card: Card, sel: string) => qa(card, sel).map((e) => e.textContent!.trim());

afterEach(() => {
  document.body.innerHTML = '';
});

describe('waterfall maths', () => {
  it('measures change from the first reading to the last, skipping gaps', () => {
    expect(
      change([
        { t: 0, v: null },
        { t: 1, v: 4 },
        { t: 2, v: null },
        { t: 3, v: 1.5 },
        { t: 4, v: null },
      ]),
    ).toBe(-2.5);
    expect(change([{ t: 0, v: null }])).toBeNull();
    expect(
      firstReading([
        { t: 0, v: null },
        { t: 1, v: 3 },
      ]),
    ).toBe(3);
    expect(firstReading([])).toBeNull();
  });

  it('carries a running total from the start through each step to the end', () => {
    const { bars, domain } = waterfallBars(
      { value: 4.2, index: 0 },
      [
        { value: 6.1, index: 1 },
        { value: -3.4, index: 2 },
        { value: null, index: 3 },
      ],
      true,
    );
    expect(bars.map((b) => [b.kind, b.from, +b.to.toFixed(2), b.index, b.missing])).toEqual([
      ['start', 0, 4.2, 0, false],
      ['step', 4.2, 10.3, 1, false],
      ['step', 10.3, 6.9, 2, false],
      ['step', 6.9, 6.9, 3, true],
      ['total', 0, 6.9, undefined, false],
    ]);
    expect(domain[0]).toBe(0);
    expect(domain[1]).toBeCloseTo(10.3);
  });

  it('reaches below zero, and gives a flat chart some height', () => {
    expect(waterfallBars(null, [{ value: -5, index: 0 }], false).domain).toEqual([-5, 0]);
    expect(waterfallBars(null, [], false).domain).toEqual([0, 1]);
    expect(waterfallBars({ value: null, index: 0 }, [], true).bars[0]).toMatchObject({ to: 0, missing: true });
  });

  it('signs changes with a real minus', () => {
    expect(signed(6.12, 1)).toBe('+6.1');
    expect(signed(-3.4, 1)).toBe('−3.4');
    expect(signed(-0.01, 1)).toBe('0.0');
  });
});

describe('waterfall chart', () => {
  it('draws a column per entity from its change over the period, then the total', async () => {
    const card = await mount({});
    expect(text(card, '.bar-name')).toEqual(['Solar', 'House', 'Total']);
    expect(text(card, '.bar-label')).toEqual(['+6.0', '+4.0', '10.0']);
    const bars = qa(card, '.bar');
    expect(bars.map((b) => b.dataset.index)).toEqual(['0', '1', undefined]);
    expect(bars[0].classList.contains('entity')).toBe(true);
    expect(bars[2].classList.contains('entity')).toBe(false);
    expect(qa(card, '.connector')).toHaveLength(2);
    expect(qa(card, '.wf.vertical')).toHaveLength(1);
    expect(qa(card, '.wf-plot')[0].getAttribute('role')).toBe('img');
    expect(qa(card, '.wf-plot')[0].getAttribute('aria-label')).toBe(
      'Waterfall chart: Solar +6.0 kWh, House +4.0 kWh, Total 10.0 kWh',
    );
    expect(card.hass!.callWS).toHaveBeenCalledTimes(1);
  });

  it('starts from the first entity, counts inverted entities down, and ends', async () => {
    const card = await mount({
      start_from_first: true,
      entities: ['sensor.battery', 'sensor.solar', { entity: 'sensor.house', invert: true }],
    } as Partial<CardConfig>);
    expect(text(card, '.bar-name')).toEqual(['Start', 'Solar', 'House', 'End']);
    expect(text(card, '.bar-label')).toEqual(['4.0', '+6.0', '−4.0', '6.0']);
    const bars = qa(card, '.bar');
    expect(bars[0].dataset.index).toBe('0');
    expect(bars[2].classList.contains('fall')).toBe(true);
    expect(bars[2].getAttribute('style')).toContain('--error-color');
    expect(bars[1].getAttribute('style')).toContain('--success-color');
  });

  it('uses current values as rows without loading history, and can leave out the total', async () => {
    const hass = hassWith(history);
    const card = await mount(
      {
        steps: 'current',
        orientation: 'horizontal',
        total: false,
        entities: ['sensor.solar', 'sensor.off', 'sensor.missing'],
      } as Partial<CardConfig>,
      hass,
    );
    expect(hass.callWS).not.toHaveBeenCalled();
    expect(qa(card, '.wf.horizontal')).toHaveLength(1);
    expect(text(card, '.bar-label')).toEqual(['+10.0', 'Unavailable', 'Entity not found']);
    expect(qa(card, '.bar.missing')).toHaveLength(2);
  });

  it('shows a dash for a column with no readings, and says when history is loading or failed', async () => {
    const card = await mount({ entities: ['sensor.solar', 'sensor.off'] });
    expect(text(card, '.bar-label')).toEqual(['+6.0', '–', '6.0']);
    expect(qa(card, '.bar')[1].getAttribute('aria-label')).toBe('Off, Unavailable');
    const loading = document.createElement('chartdeck-card') as Card;
    loading.setConfig({ type: 'custom:chartdeck-card', style: 'waterfall', entities: ['sensor.solar'] } as CardConfig);
    loading.hass = hassWith(history);
    document.body.appendChild(loading);
    await loading.updateComplete;
    expect(text(loading, '.chart-message')).toEqual(['Loading history…']);
    const failed = await mount({}, hassWith(history, true));
    expect(text(failed, '.chart-message.error')).toEqual(["Couldn't load history: boom"]);
  });

  it('says when an available entity has no readings in the period', async () => {
    const card = await mount({
      steps: 'current',
      start_from_first: true,
      orientation: 'horizontal',
      entities: ['sensor.off', 'sensor.solar'],
    } as Partial<CardConfig>);
    expect(text(card, '.bar-label')[0]).toBe('No readings');
  });

  it('opens more-info from a column', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const bar = qa(card, '.bar')[1];
    bar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    bar.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.house']);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'waterfall', entities: ['sensor.solar'], ...extra } as CardConfig);
    expect(set({ steps: 'sum' })).toThrow(/"steps" must be one of: change, current/);
    expect(set({ orientation: 'diagonal' })).toThrow(/orientation/);
    expect(set({ total: 'yes' })).toThrow(/"total" must be true or false/);
    expect(set({ start_from_first: 1 })).toThrow(/start_from_first/);
    expect(set({ entities: [{ entity: 'sensor.solar', invert: 'yes' }] })).toThrow(/invert/);
    expect(set({ source: 'cloud' })).toThrow(/source/);
    expect(set({ steps: 'current', orientation: 'horizontal', total: false })).not.toThrow();
  });
});

describe('waterfall editor', () => {
  it('writes period, steps, direction, start and total, and each entity counting down', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = hassWith({});
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'waterfall',
      entities: ['sensor.solar', { entity: 'sensor.house', invert: true }],
    } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form[data-section="chart"]') as Stub;
    expect(form.data).toEqual({
      period_last: 24,
      period_unit: 'hour',
      source: 'history',
      steps: 'change',
      orientation: 'vertical',
      start_from_first: false,
      total: true,
    });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: { ...(form.data as object), orientation: 'horizontal', start_from_first: true, total: false },
        },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, orientation: 'horizontal', start_from_first: true, total: false });

    const list = ed.shadowRoot!.querySelector('.entity-options[data-section="waterfall_invert"] ha-form') as Stub;
    expect(list.data).toEqual({ e0: false, e1: true });
    expect((list.computeLabel as (s: { name: string }) => string)({ name: 'e0' })).toBe('Solar');
    list.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { e0: true, e1: false } } }));
    expect(events.at(-1)!.entities).toEqual([{ entity: 'sensor.solar', invert: true }, 'sensor.house']);
  });
});
