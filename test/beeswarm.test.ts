import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { fitSwarm, sizeFor, swarm, swarmReach } from '../src/chart/swarm';
import { hourOfDay, onEvents, swarmOptions } from '../src/styles/beeswarm';
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

const overlaps = (dots: { at: number; r: number }[], ys: number[]) => {
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      const d = Math.hypot(dots[i].at - dots[j].at, ys[i] - ys[j]);
      if (d < dots[i].r + dots[j].r - 1e-6) return true;
    }
  }
  return false;
};

describe('swarm packing', () => {
  it('leaves dots on the line when they have room', () => {
    expect(
      swarm([
        { at: 0, r: 3 },
        { at: 10, r: 3 },
        { at: 20, r: 3 },
      ]),
    ).toEqual([0, 0, 0]);
  });

  it('nudges crowded dots sideways, either way, never overlapping', () => {
    const dots = Array.from({ length: 30 }, (_, i) => ({ at: (i % 5) * 2, r: 3 }));
    const ys = swarm(dots);
    expect(overlaps(dots, ys)).toBe(false);
    expect(ys.some((y) => y > 0)).toBe(true);
    expect(ys.some((y) => y < 0)).toBe(true);
    // Two dots in the same place: one on the line, the next just touching it.
    const [a, b] = swarm([
      { at: 5, r: 2 },
      { at: 5, r: 2 },
    ]);
    expect(a).toBe(0);
    expect(Math.abs(b)).toBeCloseTo(4.75);
    expect(
      swarmReach(
        [
          { at: 5, r: 2 },
          { at: 5, r: 2 },
        ],
        [a, b],
      ),
    ).toBeCloseTo(6.75);
  });

  it('shrinks a swarm that is too tall for its band, then squeezes it in', () => {
    const dots = Array.from({ length: 40 }, () => ({ at: 50, r: 3 }));
    const roomy = fitSwarm(dots.slice(0, 2), 20);
    expect(roomy.scale).toBe(1);
    const shrunk = fitSwarm(dots.slice(0, 6), 10);
    expect(shrunk.scale).toBeLessThan(1);
    const squeezed = fitSwarm(dots, 10, 1);
    expect(Math.max(...squeezed.offsets.map(Math.abs))).toBeLessThanOrEqual(10);
  });

  it('sizes dots by value, by area, across the row', () => {
    expect(sizeFor(30, 10, 30, 4)).toBe(4);
    expect(sizeFor(10, 10, 30, 4)).toBeCloseTo(4 * Math.sqrt(0.12));
    expect(sizeFor(20, 10, 30, 4)).toBeCloseTo(4 * Math.sqrt(0.56));
    expect(sizeFor(5, 5, 5, 4)).toBe(4);
  });
});

describe('beeswarm helpers', () => {
  it('reads its options', () => {
    expect(swarmOptions({} as CardConfig)).toEqual({ placeBy: 'value', dot: 6, sized: false });
    expect(swarmOptions({ place_by: 'time_of_day', dot_size: 4, size_by_value: true } as CardConfig)).toEqual({
      placeBy: 'time_of_day',
      dot: 4,
      sized: true,
    });
  });

  it('finds the times something turned on', () => {
    const events = onEvents([
      { t: 0, v: 1, carried: true },
      { t: 1, v: 0 },
      { t: 2, v: 1 },
      { t: 3, v: 1 },
      { t: 4, v: null },
      { t: 5, v: 1 },
    ]);
    // Back on after unavailable, when it was on before, is a restart, not a new event.
    expect(events.map((p) => p.t)).toEqual([2]);
  });

  it('gives the hour of the day in a time zone', () => {
    const t = Date.UTC(2026, 6, 1, 6, 30);
    expect(hourOfDay(t, 'UTC')).toBe(6.5);
    expect(hourOfDay(t, 'Europe/London')).toBe(7.5);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const now = Date.now();
const H = 3_600_000;

function hassWith(history: Record<string, unknown>) {
  const hass = makeHass({
    'sensor.hall': ['20', { friendly_name: 'Hall', unit_of_measurement: '°C' }],
    'binary_sensor.motion': ['off', { friendly_name: 'Motion' }],
    'sensor.gone': ['unavailable', { friendly_name: 'Gone' }],
  });
  hass.config = { time_zone: 'UTC' } as HomeAssistant['config'];
  hass.callWS = vi.fn(async () => history) as HomeAssistant['callWS'];
  return hass;
}

const hall = Array.from({ length: 40 }, (_, i) => ({
  s: String(18 + (i % 8) / 2),
  lu: (now - 20 * H + i * 20 * 60_000) / 1000,
}));
const motion = Array.from({ length: 12 }, (_, i) => ({ s: i % 2 ? 'off' : 'on', lu: (now - 22 * H + i * H) / 1000 }));
const history = {
  'sensor.hall': hall,
  'binary_sensor.motion': motion,
  'sensor.gone': [{ s: 'unavailable', lu: (now - 20 * H) / 1000 }],
};

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'beeswarm',
    entities: ['sensor.hall', 'sensor.gone'],
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
const text = (e: Element) => e.textContent!.replace(/\s+/g, ' ').trim();
const dotCount = (el: Element) =>
  [...el.querySelectorAll('path.dots')].reduce((a, p) => a + p.getAttribute('d')!.split('M').length - 1, 0);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('beeswarm chart', () => {
  it('shows a sensor that held one value all day as one dot at that value, not as no readings', async () => {
    const flat = { 'sensor.hall': [{ s: '21.4', lu: (now - 30 * H) / 1000 }], 'sensor.gone': [] };
    const card = await mount({ period: { last: 24, unit: 'hour' } } as Partial<CardConfig>, hassWith(flat));
    expect(qa(card, '.cat-label').map(text)).toEqual(['Hall No change: 21.4 °C', 'Gone No readings']);
    const swarms = qa(card, 'g.swarm');
    expect(swarms).toHaveLength(1);
    expect(dotCount(swarms[0])).toBe(1);
    const ticks = qa(card, '.axis-label').map((e) => Number(text(e)));
    expect(Math.min(...ticks)).toBeLessThanOrEqual(21.4);
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(21.4);
    expect(Math.min(...ticks)).toBeGreaterThan(15);
    // By time of day it was read at no particular time: the row says so, with no dot.
    const clock = await mount(
      { period: { last: 24, unit: 'hour' }, place_by: 'time_of_day' } as Partial<CardConfig>,
      hassWith(flat),
    );
    expect(qa(clock, 'g.swarm')).toHaveLength(0);
    expect(text(q(clock, '.cat-label')!)).toBe('Hall No change: 21.4 °C');
  });

  it('packs every reading of each entity in its own row, counting them', async () => {
    const card = await mount({});
    const swarms = qa(card, 'g.swarm');
    expect(swarms).toHaveLength(1);
    expect(swarms[0].getAttribute('data-index')).toBe('0');
    expect(swarms[0].getAttribute('stroke')).toContain('--primary-color');
    expect(dotCount(swarms[0])).toBe(40);
    expect(qa(card, '.cat-label').map(text)).toEqual(['Hall 40 readings', 'Gone No readings']);
    expect(q(card, 'svg.plot')!.getAttribute('aria-label')).toBe('Beeswarm chart of Hall, Gone');
    expect(q(card, 'svg.plot')!.getAttribute('viewBox')).toBe('0 0 1000 200');
  });

  it('places motion by the time of day it turned on, on a clock axis', async () => {
    const card = await mount({
      place_by: 'time_of_day',
      entities: ['binary_sensor.motion', 'sensor.hall'],
    } as Partial<CardConfig>);
    expect(qa(card, '.cat-label').map(text)[0]).toBe('Motion 6 times on');
    expect(dotCount(qa(card, 'g.swarm')[0])).toBe(6);
    const ticks = qa(card, '.cat-axis .axis-label').map(text);
    expect(ticks[0]).toMatch(/^(0?0:00|12:00 AM)$/);
    expect(ticks.length).toBeGreaterThan(2);
  });

  it('sizes dots by value, and stands up', async () => {
    const card = await mount({ size_by_value: true, orientation: 'vertical', dot_size: 8 } as Partial<CardConfig>);
    const sizes = qa(card, 'g.swarm path.dots').map((p) => p.getAttribute('style'));
    expect(new Set(sizes).size).toBeGreaterThan(1);
    expect(q(card, '.cat-plot.vertical')).not.toBeNull();
  });

  it('shows count, median, middle half and range for the row under the pointer', async () => {
    const card = await mount({});
    const area = q(card, '.plot-area')!;
    area.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 300, height: 192, right: 300, bottom: 192 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 20 }));
    await card.updateComplete;
    const rows = qa(card, '.band-tooltip .tooltip-row').map(text);
    expect(rows[0]).toBe('Readings 40');
    expect(rows[1]).toMatch(/^Median [\d.]+ °C$/);
    const clock = await mount({ place_by: 'time_of_day', entities: ['binary_sensor.motion'] } as Partial<CardConfig>);
    const plot = q(clock, '.plot-area')!;
    plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 96, right: 300, bottom: 96 }) as DOMRect;
    plot.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 20 }));
    await clock.updateComplete;
    expect(qa(clock, '.band-tooltip .tooltip-row').map(text)[1]).toMatch(/^Median \d{1,2}:\d\d/);
  });

  it('says when sampling leaves dots out', async () => {
    const many = Array.from({ length: 900 }, (_, i) => ({ s: String(i % 50), lu: (now - 20 * H + i * 60_000) / 1000 }));
    const card = await mount({ entities: ['sensor.hall'] }, hassWith({ 'sensor.hall': many }));
    expect(dotCount(q(card, 'g.swarm')!)).toBe(400);
    const area = q(card, '.plot-area')!;
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 96, right: 300, bottom: 96 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 20 }));
    await card.updateComplete;
    expect(qa(card, '.band-tooltip .tooltip-row').map(text)[1]).toBe('Dots shown 400');
  });

  it('opens an entity from its swarm', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const swarmEl = q(card, 'g.swarm')!;
    swarmEl.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    swarmEl.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.hall']);
  });

  it('says when there is nothing to draw', async () => {
    const card = await mount({}, hassWith({}));
    expect(q(card, '.chart-message')!.textContent).toBe('No readings in this period.');
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'beeswarm', entities: ['sensor.hall'], ...extra } as CardConfig);
    expect(set({ place_by: 'weekday' })).toThrow(/"place_by" must be one of: value, time_of_day/);
    expect(set({ dot_size: 40 })).toThrow(/"dot_size" must be a number from 2 to 16/);
    expect(set({ size_by_value: 'yes' })).toThrow(/size_by_value/);
    expect(set({ orientation: 'diagonal' })).toThrow(/orientation/);
    expect(set({ place_by: 'time_of_day', dot_size: 4, size_by_value: true })).not.toThrow();
  });
});

describe('beeswarm editor', () => {
  it('writes placement, dot size and sizing, hiding the value range for time of day', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'beeswarm', entities: ['sensor.hall'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({
      place_by: 'value',
      dot_size: 6,
      size_by_value: false,
      orientation: 'horizontal',
    });
    expect(JSON.stringify(form.schema)).toContain('value_min');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), place_by: 'time_of_day', dot_size: 4, size_by_value: true } },
      }),
    );
    const next = events.at(-1)!;
    expect(next).toEqual({ ...raw, place_by: 'time_of_day', dot_size: 4, size_by_value: true });
    ed.setConfig(next);
    await ed.updateComplete;
    const clock = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(JSON.stringify(clock.schema)).not.toContain('value_min');
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    expect((list.chartFields as { fields: { name: string }[] }).fields.map((f) => f.name)).toEqual(['fill_color']);
  });
});
