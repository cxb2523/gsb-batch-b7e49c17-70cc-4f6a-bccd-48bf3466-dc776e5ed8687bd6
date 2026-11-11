import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { directionColor, slopeEnds, spreadLabels } from '../src/styles/slope';
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

describe('slope maths', () => {
  it('spreads labels apart, keeping order and staying in bounds', () => {
    expect(spreadLabels([50, 52, 100], 10, 0, 200)).toEqual([50, 60, 100]);
    // Input order is kept in the output; ties keep their input order.
    expect(spreadLabels([52, 50], 10, 0, 200)).toEqual([60, 50]);
    expect(spreadLabels([10, 10], 10, 0, 200)).toEqual([10, 20]);
    // Pushed past the bottom: the stack moves up.
    expect(spreadLabels([195, 198, 199], 10, 0, 200)).toEqual([180, 190, 200]);
    // Below the top edge: clamped.
    expect(spreadLabels([-20], 10, 0, 200)).toEqual([0]);
    // More than fit: start at the top and run on.
    expect(spreadLabels([5, 5, 5], 10, 0, 15)).toEqual([0, 10, 20]);
    expect(spreadLabels([], 10, 0, 100)).toEqual([]);
  });

  it('takes the reading then and now, or the rise over each period', () => {
    const points = [
      { t: 0, v: 10 },
      { t: 50, v: 16 },
      { t: 70, v: null },
    ];
    const times = { start: 0, middle: 60 };
    expect(slopeEnds('value', points, times, 30)).toEqual([10, 30]);
    expect(slopeEnds('value', [], times, 30)).toEqual([null, 30]);
    expect(slopeEnds('change', points, times, 30)).toEqual([6, 14]);
    expect(slopeEnds('change', points, times, null)).toEqual([6, null]);
    expect(slopeEnds('change', points, { start: -5, middle: 60 }, 30)).toEqual([null, 14]);
  });

  it('colours by direction', () => {
    expect(directionColor(1, 2, 'bad')).toBe('red');
    expect(directionColor(2, 1, 'bad')).toBe('green');
    expect(directionColor(1, 2, 'good')).toBe('green');
    expect(directionColor(2, 1, 'good')).toBe('red');
    expect(directionColor(2, 2, 'good')).toBe('grey');
  });
});

const history = {
  'sensor.a': [
    { s: '10', lu: sec(1700 * H) },
    { s: '10', lu: sec(30 * H) },
    { s: '16', lu: sec(18 * H) },
  ],
  'sensor.b': [{ s: '50', lu: sec(1700 * H) }],
  'sensor.u': [{ s: '5', lu: sec(30 * H) }],
};

function hassWith(data: Record<string, { s: string; lu: number }[]> = history, fail = false) {
  const hass = makeHass({
    'sensor.a': ['30', { friendly_name: 'Alpha', unit_of_measurement: 'kWh' }],
    'sensor.b': ['40', { friendly_name: 'Beta', unit_of_measurement: 'kWh' }],
    'sensor.u': ['unavailable', { friendly_name: 'Gone quiet', unit_of_measurement: 'kWh' }],
  });
  hass.callWS = vi.fn(async () => {
    if (fail) throw new Error('boom');
    return data;
  }) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Partial<CardConfig>, hass = hassWith()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'slope',
    entities: ['sensor.a', 'sensor.b'],
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
/** A label's parts (name, value, change), spaced the way the flex gap shows them. */
const lbl = (el: Element | null) => [...el!.children].map((c) => c.textContent!.trim()).join(' ');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('slope chart', () => {
  it('joins the reading a period ago to now, coloured by which way it went', async () => {
    const card = await mount({});
    const entities = qa(card, '.slope-plot .entity');
    expect(entities.map((e) => e.getAttribute('data-index'))).toEqual(['0', '1']);
    const [a, b] = entities.map((e) => e.querySelector('line')!);
    expect(a.getAttribute('stroke')).toContain('--error-color');
    expect(b.getAttribute('stroke')).toContain('--success-color');
    expect(Number(a.getAttribute('y1'))).toBeGreaterThan(Number(a.getAttribute('y2')));
    expect(lbl(entities[0].querySelector('.lbl.from'))).toBe('Alpha 10.0');
    expect(lbl(entities[0].querySelector('.lbl.to'))).toBe('30.0 Alpha +200 %');
    expect(lbl(entities[1].querySelector('.lbl.to'))).toBe('40.0 Beta −20 %');
    expect(entities[0].getAttribute('aria-label')).toBe('Alpha, 10.0 to 30.0');
    expect(text(q(card, '.slope-head'))).toBe('24 hours ago kWh Now');
    expect(q(card, '.slope-plot')!.getAttribute('aria-label')).toBe('Slope chart of Alpha, Beta');
    expect(q(card, '.slope-legend')).toBeNull();
  });

  it('turns the colours round when a rise is good, and hides names or values when asked', async () => {
    const card = await mount({ increase: 'good', show: { name: false }, period: { last: 1, unit: 'week' } });
    const [a, b] = qa(card, '.slope-plot line');
    expect(a.getAttribute('stroke')).toContain('--success-color');
    expect(b.getAttribute('stroke')).toContain('--error-color');
    expect(qa(card, '.lbl .name')).toHaveLength(0);
    expect(text(q(card, '.slope-head .from'))).toBe('A week ago');
    const plain = await mount({ show: { value: false } });
    expect(qa(plain, '.lbl .value')).toHaveLength(0);
    expect(qa(plain, '.lbl .pct')).toHaveLength(0);
  });

  it('colours by group, sharing a colour within a group, with a legend', async () => {
    const card = await mount({
      color_by: 'group',
      entities: [
        { entity: 'sensor.a', group: 'Kitchen' },
        { entity: 'sensor.b', group: 'Kitchen' },
        { entity: 'sensor.u', group: 'Garage', color: '#123456' },
      ],
    } as Partial<CardConfig>);
    const [a, b] = qa(card, '.slope-plot line');
    expect(a.getAttribute('stroke')).toBe(b.getAttribute('stroke'));
    expect(a.getAttribute('stroke')).toContain('--primary-color');
    expect(qa(card, '.slope-legend-item').map(text)).toEqual(['Kitchen', 'Garage']);
    // Ungrouped entities each get their own colour and no legend.
    const solo = await mount({ color_by: 'group' });
    const [x, y] = qa(solo, '.slope-plot line');
    expect(x.getAttribute('stroke')).not.toBe(y.getAttribute('stroke'));
    expect(q(solo, '.slope-legend')).toBeNull();
  });

  it('compares the rise over the previous period with the latest one', async () => {
    const card = await mount({ measure: 'change', period: { last: 12, unit: 'hour' } });
    const first = q(card, '.slope-plot .entity')!;
    // 10 → 16 in the previous 12 hours, 16 → 30 in the last 12.
    expect(lbl(first.querySelector('.lbl.from'))).toBe('Alpha 6.0');
    expect(lbl(first.querySelector('.lbl.to'))).toBe('14.0 Alpha +133 %');
    expect(text(q(card, '.slope-head'))).toBe('Previous 12 hours kWh Last 12 hours');
    const call = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Date.parse(call.end_time) - Date.parse(call.start_time)).toBeCloseTo(24 * H, -4);
    const monthly = await mount({ measure: 'change', period: { last: 1, unit: 'month' } });
    expect(text(q(monthly, '.slope-head'))).toBe('Previous month kWh Last month');
  });

  it('draws a lone dot for an entity without a reading at one end, and leaves out ones with none', async () => {
    const card = await mount({ entities: ['sensor.a', 'sensor.u', 'sensor.missing'] });
    const entities = qa(card, '.slope-plot .entity');
    expect(entities.map((e) => e.getAttribute('data-index'))).toEqual(['0', '1']);
    const quiet = entities[1];
    expect(quiet.querySelector('line')).toBeNull();
    expect(quiet.querySelector('.dot.from')).not.toBeNull();
    expect(quiet.querySelector('.dot.to')).toBeNull();
    expect(quiet.getAttribute('aria-label')).toBe('Gone quiet, 5.0 to no reading');
  });

  it('adds units to values when the entities differ', async () => {
    const hass = hassWith();
    hass.states['sensor.b'].attributes.unit_of_measurement = 'W';
    const card = await mount({}, hass);
    expect(q(card, '.slope-head .unit')).toBeNull();
    expect(lbl(q(card, '.lbl.from'))).toBe('Alpha 10.0 kWh');
  });

  it('says when history is loading, failed, or empty', async () => {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'slope', entities: ['sensor.a'] } as CardConfig);
    card.hass = hassWith();
    document.body.appendChild(card);
    await card.updateComplete;
    expect(text(q(card, '.chart-message'))).toBe('Loading history…');
    const failed = await mount({}, hassWith(history, true));
    expect(text(q(failed, '.chart-message.error'))).toBe("Couldn't load history: boom");
    const empty = await mount({ entities: ['sensor.u', 'sensor.missing'] }, hassWith({}));
    expect(text(q(empty, '.chart-message'))).toBe('No readings in this period.');
  });

  it('runs the entity actions from any part of a slope', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const dot = qa(card, '.slope-plot .entity')[1].querySelector('.dot.to') as HTMLElement;
    dot.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    dot.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.b']);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'slope', entities: ['sensor.a'], ...extra } as CardConfig);
    expect(set({ measure: 'ratio' })).toThrow(/"measure" must be one of: value, change/);
    expect(set({ color_by: 'series' })).toThrow(/"color_by" must be one of: direction, group/);
    expect(set({ increase: 'meh' })).toThrow(/"increase"/);
    expect(set({ entities: [{ entity: 'sensor.a', group: 3 }] })).toThrow(/"group" must be text/);
    expect(set({ period: { last: 0 } })).toThrow(/period/);
    expect(set({ measure: 'change', color_by: 'group', increase: 'good' })).not.toThrow();
  });
});

describe('slope chart editor', () => {
  async function editor(raw: CardConfig) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events };
  }

  it('writes period, measure and colouring from the Chart section', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'slope', entities: ['sensor.a'] } as CardConfig;
    const { ed, events } = await editor(raw);
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({
      period_last: 24,
      period_unit: 'hour',
      source: 'history',
      measure: 'value',
      color_by: 'direction',
      increase: 'bad',
    });
    const names = JSON.stringify(form.schema);
    for (const name of ['measure', 'color_by', 'increase', 'period_last']) expect(names).toContain(`"${name}"`);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), measure: 'change', color_by: 'group', period_unit: 'month' } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, measure: 'change', color_by: 'group', period: { unit: 'month' } });
  });

  it("puts each entity's group in its own options", async () => {
    const raw = {
      type: 'custom:chartdeck-card',
      style: 'slope',
      entities: [{ entity: 'sensor.a', group: 'Kitchen' }],
    } as CardConfig;
    const { ed, events } = await editor(raw);
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as HTMLElement & {
      updateComplete: Promise<boolean>;
      shadowRoot: ShadowRoot;
    };
    await list.updateComplete;
    (list.shadowRoot.querySelector('.expand') as HTMLElement).click();
    await list.updateComplete;
    const form = list.shadowRoot.querySelector('ha-form[data-section="entity-chart"]') as Stub;
    expect(form).not.toBeNull();
    expect(form.data).toEqual({ group: 'Kitchen' });
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { group: 'Garage' } } }));
    expect(events.at(-1)!.entities).toEqual([{ entity: 'sensor.a', group: 'Garage' }]);
  });

  it('shows no per-entity chart options for a style without any', async () => {
    const { ed } = await editor({ type: 'custom:chartdeck-card', style: 'bar', entities: ['sensor.a'] } as CardConfig);
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    expect(list.chartFields).toBeUndefined();
  });

  it('lets the first statistics row stand in for the start when it begins just after it', () => {
    const points = [
      { t: 1_800_000, v: 10 },
      { t: 5_400_000, v: 12 },
    ];
    expect(slopeEnds('value', points, { start: 0, middle: 0 }, 20)).toEqual([null, 20]);
    expect(slopeEnds('value', points, { start: 0, middle: 0 }, 20, 3_600_000)).toEqual([10, 20]);
    expect(slopeEnds('value', points, { start: 0, middle: 0 }, 20, 1_000_000)).toEqual([null, 20]);
  });
});
