import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  conditionEntities,
  conditionOf,
  conditionalPoints,
  flips,
  heldSpans,
  maskPoints,
  meets,
  validateConditions,
} from '../src/history/condition';
import { conditionText } from '../src/chart/condition-strip';
import { CONDITION_FIELDS, cardConditionFields, conditionFields } from '../src/editor/condition-fields';
import type { CardConfig, EntityConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';
import { stubEditorElements } from './helpers/chart';
import type { Stub } from './helpers/chart';

stubEditorElements();
await import('../src/editor/chartdeck-card-editor');

const check = (when: unknown) => () =>
  validateConditions({ type: 'x', entities: ['sensor.a', { entity: 'sensor.b', when }] } as CardConfig);

describe('condition options', () => {
  it('accepts a state, a list of states, above and below, and explains bad ones', () => {
    expect(check({ entity: 'person.john', state: 'home' })).not.toThrow();
    expect(check({ entity: 'person.john', state: ['home', 'work'] })).not.toThrow();
    expect(check({ entity: 'sensor.t', above: 1, below: 5.5 })).not.toThrow();
    expect(check(undefined)).not.toThrow();
    // Half filled in from the editor: ignored, not an error.
    expect(check({ state: 'home' })).not.toThrow();
    expect(check('person.john')).toThrow('"entities[1].when" must have an "entity"');
    expect(check({ entity: 'John' })).toThrow('"entities[1].when.entity" must be an entity id');
    expect(check({ entity: 'person.john', state: [{}] })).toThrow('must be a state or a list of states');
    expect(check({ entity: 'sensor.t', above: 'ten' })).toThrow('"entities[1].when.above" must be a number');
  });

  it('reads an entity condition, ignoring unusable ones', () => {
    const c = (when: unknown) => conditionOf({ entity: 'sensor.x', when } as EntityConfig);
    expect(c({ entity: ' person.john ', state: 'home, work' })).toEqual({
      entity: 'person.john',
      state: ['home', 'work'],
    });
    expect(c({ entity: 'sensor.t', state: [1, 'on'], above: 2 })).toEqual({
      entity: 'sensor.t',
      state: ['1', 'on'],
      above: 2,
    });
    expect(c({ entity: 'sensor.t' })).toBeUndefined();
    expect(c({ state: 'on' })).toBeUndefined();
    expect(c(undefined)).toBeUndefined();
    expect(
      conditionEntities([
        'sensor.a',
        { entity: 'sensor.b', when: { entity: 'person.john', state: 'home' } } as EntityConfig,
        { entity: 'sensor.c', when: { entity: 'person.john', above: 1 } } as EntityConfig,
      ]),
    ).toEqual(['person.john']);
  });

  it("checks the card's condition and its drawing switches", () => {
    const card = (extra: Record<string, unknown>) => () =>
      validateConditions({ type: 'x', entities: ['sensor.a'], ...extra } as CardConfig);
    expect(card({ when: { entity: 'person.john', state: 'home' }, when_ghost: true, when_strip: false })).not.toThrow();
    expect(card({ when: 'person.john' })).toThrow('"when" must have an "entity"');
    expect(card({ when: { entity: 'sensor.t', below: 'x' } })).toThrow('"when.below" must be a number');
    expect(card({ when_ghost: 'yes' })).toThrow('"when_ghost" must be true or false');
    expect(card({ when_strip: 1 })).toThrow('"when_strip" must be true or false');
  });

  it("uses the card's condition for series without their own", () => {
    const raw = { type: 'x', when: { entity: 'person.john', state: 'home' } } as CardConfig;
    expect(conditionOf({ entity: 'sensor.a' }, raw)).toEqual({ entity: 'person.john', state: ['home'] });
    const own = { entity: 'sensor.b', when: { entity: 'sensor.t', above: 1 } } as EntityConfig;
    expect(conditionOf(own, raw)).toEqual({ entity: 'sensor.t', above: 1 });
    // Half filled in: the card's still applies.
    expect(conditionOf({ entity: 'sensor.c', when: { state: 'on' } } as EntityConfig, raw)!.entity).toBe('person.john');
    expect(conditionEntities(['sensor.a', own], raw)).toEqual(['sensor.t', 'person.john']);
    expect(conditionEntities(['sensor.a'], { type: 'x', when: { entity: 'person.john' } } as CardConfig)).toEqual([]);
  });

  it('describes a condition in words', () => {
    const h = makeHass({ 'person.john': ['home', { friendly_name: 'John' }] });
    expect(conditionText({ entity: 'person.john', state: ['home', 'work'] }, h)).toBe('John: home / work');
    expect(conditionText({ entity: 'sensor.t', above: 18.5 }, h)).toBe('sensor.t > 18.5');
    expect(conditionText({ entity: 'sensor.t', below: 3 }, h)).toBe('sensor.t < 3');
    expect(conditionText({ entity: 'sensor.t', above: 1, below: 3 }, h)).toBe('1 < sensor.t < 3');
  });

  it('tests a state against the condition', () => {
    expect(meets({ entity: 'p.x', state: ['home'] }, 'home')).toBe(true);
    expect(meets({ entity: 'p.x', state: ['home'] }, 'away')).toBe(false);
    expect(meets({ entity: 'p.x', state: ['home'] }, undefined)).toBe(false);
    expect(meets({ entity: 's.t', above: 18 }, '18.5')).toBe(true);
    expect(meets({ entity: 's.t', above: 18 }, '18')).toBe(false);
    expect(meets({ entity: 's.t', above: 18, below: 20 }, '21')).toBe(false);
    expect(meets({ entity: 's.t', below: 20 }, 'unavailable')).toBe(false);
  });
});

describe('masking readings', () => {
  const c = { entity: 'person.john', state: ['home'] };
  const states = [
    { t: 0, v: null, s: 'away' },
    { t: 10, v: null, s: 'home' },
    { t: 15, v: null, s: 'home' },
    { t: 30, v: null, s: 'away' },
  ];

  it('turns states into the moments the condition starts and stops', () => {
    expect(flips(c, states)).toEqual([
      { t: 0, ok: false },
      { t: 10, ok: true },
      { t: 30, ok: false },
    ]);
    expect(flips(c, [])).toEqual([]);
  });

  it('keeps readings while it holds, carrying the line to each edge and breaking it outside', () => {
    const points = [
      { t: 0, v: 1 },
      { t: 5, v: 2 },
      { t: 20, v: 3 },
      { t: 40, v: 4 },
    ];
    expect(maskPoints(points, flips(c, states))).toEqual([
      { t: 10, v: 2, carried: true },
      { t: 20, v: 3 },
      { t: 30, v: 3, carried: true },
      { t: 30, v: null },
    ]);
    // Never held: nothing kept. Always held: everything kept.
    expect(maskPoints(points, [{ t: 0, ok: false }])).toEqual([]);
    expect(maskPoints(points, [{ t: -1, ok: true }])).toEqual(points);
    // Nothing known about the condition yet: nothing kept.
    expect(maskPoints(points, [])).toEqual([]);
  });

  it('copes with a gap in the readings and a condition that changes after the last one', () => {
    const points = [
      { t: 0, v: 1 },
      { t: 5, v: null },
      { t: 8, v: 2 },
    ];
    expect(
      maskPoints(points, [
        { t: 0, ok: true },
        { t: 6, ok: false },
        { t: 12, ok: true },
      ]),
    ).toEqual([
      { t: 0, v: 1 },
      { t: 5, v: null },
      { t: 12, v: 2, carried: true },
    ]);
  });

  it('masks text series too, leaving gaps without words', () => {
    const points = [
      { t: 0, v: null, s: 'heat' },
      { t: 20, v: null, s: 'idle' },
    ];
    expect(
      maskPoints(points, [
        { t: 0, ok: true },
        { t: 10, ok: false },
      ]),
    ).toEqual([
      { t: 0, v: null, s: 'heat' },
      { t: 10, v: null, s: 'heat', carried: true },
      { t: 10, v: null },
    ]);
  });

  it('lists the stretches the condition held, cut to the range and the present', () => {
    const changes = flips(c, states);
    expect(heldSpans(changes, { start: 0, end: 100 }, 100)).toEqual([[10, 30]]);
    expect(heldSpans(changes, { start: 12, end: 100 }, 20)).toEqual([[12, 20]]);
    expect(heldSpans([{ t: 5, ok: true }], { start: 0, end: 100 }, 50)).toEqual([[5, 50]]);
    expect(heldSpans([], { start: 0, end: 100 }, 50)).toEqual([]);
  });

  it('leaves a series without a condition alone', () => {
    const points = [{ t: 0, v: 1 }];
    expect(conditionalPoints({ entity: 'sensor.a' }, points, undefined)).toBe(points);
    expect(conditionalPoints({ entity: 'sensor.a' }, points, { pending: false, states: new Map() })).toBe(points);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
const now = Date.now();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass(fail = false) {
  const h = makeHass({
    'sensor.power': ['3', { friendly_name: 'Power', unit_of_measurement: 'kW' }],
    'sensor.other': ['1', { friendly_name: 'Other', unit_of_measurement: 'kW' }],
    'person.john': ['home', { friendly_name: 'John' }],
    'switch.heater': 'off',
  });
  h.callWS = vi.fn(async (msg: Record<string, unknown>) => {
    const ids = msg.entity_ids as string[];
    if (ids.includes('person.john')) {
      if (fail) throw new Error('nope');
      return {
        'person.john': [
          { s: 'away', lu: sec(30 * H) },
          { s: 'home', lu: sec(20 * H) },
          { s: 'away', lu: sec(12 * H) },
          { s: 'home', lu: sec(4 * H) },
        ],
      };
    }
    return {
      'sensor.power': [
        { s: '1', lu: sec(23 * H) },
        { s: '9', lu: sec(16 * H) },
        { s: '30', lu: sec(8 * H) },
        { s: '3', lu: sec(2 * H) },
      ],
      'sensor.other': [{ s: '1', lu: sec(23 * H) }],
      'switch.heater': [
        { s: 'on', lu: sec(18 * H) },
        { s: 'off', lu: sec(14 * H) },
        { s: 'on', lu: sec(10 * H) },
        { s: 'off', lu: sec(6 * H) },
      ],
    };
  }) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'line',
    entities: [{ entity: 'sensor.power', when: { entity: 'person.john', state: 'home' } }, 'sensor.other'],
    ...extra,
  } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  for (let i = 0; i < 4; i++) {
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const runCount = (el: Element) => el.getAttribute('d')!.match(/M/g)?.length ?? 0;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('conditional series on a chart', () => {
  it('draws a series only while its condition holds, and its highs and lows from those readings', async () => {
    const card = await mount({ extremes: { max: true } });
    const lines = qa(card, 'path.line');
    expect(lines).toHaveLength(2);
    // Home 20 h to 12 h ago, and from 4 h ago: two stretches. The other series is whole.
    expect(runCount(lines[0])).toBe(2);
    expect(runCount(lines[1])).toBe(1);
    // The 30 kW reading came while away, so the high mark is the 9 kW one.
    const marks = qa(card, '.extreme-label').map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
    expect(marks.join(' ')).toContain('9');
    expect(marks.join(' ')).not.toContain('30');
    const calls = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].entity_ids);
    expect(calls).toContainEqual(['person.john']);
  });

  it('groups only the kept readings', async () => {
    const card = await mount({ style: 'column', group_by: 'hour', period: { last: 24, unit: 'hour' } });
    const bars = qa(card, '.col[data-series="0"]');
    const other = qa(card, '.col[data-series="1"]');
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.length).toBeLessThan(other.length);
  });

  it('hides the series if the condition cannot be loaded, and keeps the others', async () => {
    const card = await mount({}, hass(true));
    const lines = qa(card, 'path.line');
    expect(runCount(lines[0])).toBe(0);
    expect(runCount(lines[1])).toBe(1);
  });

  it('redraws when the condition entity changes', async () => {
    const card = await mount({});
    const h = card.hass!;
    const before = qa(card, 'path.line')[0].getAttribute('d');
    card.hass = {
      ...h,
      states: {
        ...h.states,
        'person.john': {
          ...h.states['person.john'],
          state: 'away',
          last_changed: new Date(now - H).toISOString(),
          last_updated: new Date(now - H).toISOString(),
        },
      },
    };
    await card.updateComplete;
    expect(qa(card, 'path.line')[0].getAttribute('d')).not.toBe(before);
  });
});

describe("the card's condition, the faint line and the strip", () => {
  const both = ['sensor.power', 'sensor.other'];

  it("applies the card's condition to every series without its own", async () => {
    const card = await mount({ entities: both, when: { entity: 'person.john', state: 'home' } });
    const lines = qa(card, 'path.line');
    expect(runCount(lines[0])).toBe(2);
    expect(runCount(lines[1])).toBe(2);
    const own = await mount({
      entities: [{ entity: 'sensor.power', when: { entity: 'person.john', state: 'away' } }, 'sensor.other'],
      when: { entity: 'person.john', state: 'home' },
    });
    const [a, b] = qa(own, 'path.line');
    // Away 30 h to 20 h ago (the range starts at 24 h) and 12 h to 4 h ago; home for the other.
    expect(runCount(a)).toBe(2);
    expect(runCount(b)).toBe(2);
    expect(a.getAttribute('d')).not.toBe(b.getAttribute('d'));
  });

  it('draws every reading faintly behind a conditional series when asked', async () => {
    const off = await mount({});
    expect(qa(off, 'path.ghost')).toHaveLength(0);
    const card = await mount({ when_ghost: true });
    const ghosts = qa(card, 'path.ghost');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].dataset.series).toBe('0');
    expect(runCount(ghosts[0])).toBe(1);
    // Behind the lines.
    const paths = qa(card, '.plot path');
    expect(paths.indexOf(ghosts[0])).toBeLessThan(paths.indexOf(qa(card, 'path.line')[0]));
    // The 30 kW reading was hidden, but the axis still fits it so the faint line stays on the plot.
    const top = qa(card, '.y-axis .axis-label').map((e) => Number(e.textContent!.trim()));
    expect(Math.max(...top)).toBeGreaterThanOrEqual(30);
  });

  it('draws the faint line in small multiples too', async () => {
    const card = await mount({ when_ghost: true, multiples: true });
    expect(qa(card, 'path.ghost')).toHaveLength(1);
  });

  it('draws the faint line on an unstacked area chart only', async () => {
    expect(qa(await mount({ style: 'area', when_ghost: true }), 'path.ghost')).toHaveLength(1);
    expect(qa(await mount({ style: 'area', when_ghost: true, stack: 'normal' }), 'path.ghost')).toHaveLength(0);
  });

  it('shows when each condition held in a strip under the plot', async () => {
    expect(qa(await mount({}), '.cond-row')).toHaveLength(0);
    const card = await mount({ when_strip: true });
    const rows = qa(card, '.cond-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute('aria-label')).toBe('Shown while John: home');
    expect(rows[0].querySelector('.cond-label')!.textContent).toBe('John: home');
    // Home 20 h to 12 h ago and from 4 h ago.
    expect(rows[0].querySelectorAll('rect')).toHaveLength(2);
    const wrap = card.shadowRoot!.querySelector('.plot-wrap') as HTMLElement;
    expect(wrap.classList.contains('has-strip')).toBe(true);
    expect(wrap.getAttribute('style')).toContain('--cd-strip:18px');
    // Two conditions, two rows; the same one twice, one row. With the overview, both stack.
    const two = await mount({
      when_strip: true,
      overview: true,
      entities: [
        { entity: 'sensor.power', when: { entity: 'person.john', state: 'home' } },
        { entity: 'sensor.other', when: { entity: 'person.john', state: 'away' } },
      ],
    });
    expect(qa(two, '.cond-row')).toHaveLength(2);
    expect(qa(two, '.cond-below .overview')).toHaveLength(1);
    expect(two.shadowRoot!.querySelector('.plot-wrap')!.classList.contains('strip-overview')).toBe(true);
    const same = await mount({ when_strip: true, entities: both, when: { entity: 'person.john', state: 'home' } });
    expect(qa(same, '.cond-row')).toHaveLength(1);
    expect(qa(await mount({ style: 'area', when_strip: true }), '.cond-row')).toHaveLength(1);
  });

  const differs = async (extra: Record<string, unknown>, sel: string) => {
    const plain = await mount({ ...extra, entities: ['sensor.power'] });
    const masked = await mount({
      ...extra,
      entities: ['sensor.power'],
      when: { entity: 'person.john', state: 'home' },
    });
    const html = (card: Card) => qa(card, sel).map((e) => e.outerHTML.replace(/<!--[^]*?-->/g, ''));
    expect(html(plain).length).toBeGreaterThan(0);
    expect(html(masked)).not.toEqual(html(plain));
    const calls = (masked.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].entity_ids);
    expect(calls).toContainEqual(['person.john']);
  };

  it('applies to the box plot, candlestick and wind rose, which load their own history', async () => {
    await differs({ style: 'box' }, 'g.box');
    await differs(
      { style: 'candlestick', source: 'history', period: { last: 1, unit: 'day' }, group_by: 'hour' },
      '.candle',
    );
    await differs({ style: 'wind_rose' }, 'path');
  });

  it('applies to the day clock, counting only the time while it held', async () => {
    const ring = async (extra: Record<string, unknown>) => {
      const card = await mount({ style: 'day_clock', days: 2, entities: [{ entity: 'switch.heater', ...extra }] });
      return card.shadowRoot!.textContent!.replace(/\s+/g, ' ');
    };
    const all = await ring({});
    const kept = await ring({ when: { entity: 'person.john', state: 'home' } });
    // On 18 h to 14 h ago and 10 h to 6 h ago; John was home for the first only.
    expect(all).toContain('4 h a day');
    expect(kept).toContain('2 h a day');
  });
});

describe('conditional series in the editor', () => {
  it('offers the condition on history charts that load through the frame only', () => {
    expect(conditionFields('line')!.fields).toEqual(CONDITION_FIELDS);
    expect(conditionFields('waterfall')).toBe(conditionFields('line'));
    expect(conditionFields('pie')).toBeUndefined();
    expect(conditionFields(undefined)).toBeUndefined();
    for (const style of ['box', 'candlestick', 'day_clock', 'wind_rose']) expect(conditionFields(style)).toBeDefined();
    // The climate chart is one thermostat's own record: no condition there.
    expect(conditionFields('climate')).toBeUndefined();
    expect(cardConditionFields('climate')).toBeUndefined();
    expect(cardConditionFields('pie')).toBeUndefined();
    const names = (style: string) => cardConditionFields(style)!.fields.map((f) => f.name);
    expect(names('line')).toEqual([
      'when_card_entity',
      'when_card_state',
      'when_card_above',
      'when_card_below',
      'when_ghost',
      'when_strip',
    ]);
    expect(names('area')).toEqual(names('line'));
    expect(names('box')).not.toContain('when_ghost');
  });

  it("writes the card's condition and the drawing switches from the Chart section", async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => {
      const config = (e as CustomEvent).detail.config as CardConfig;
      events.push(config);
      ed.setConfig(config);
    });
    ed.hass = makeHass({ 'sensor.power': '1' });
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.power'] } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form[data-section="card-condition"]') as Stub;
    expect(form).not.toBeNull();
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: {
            ...(form.data as object),
            when_card_entity: 'person.john',
            when_card_state: 'home',
            when_strip: true,
          },
        },
      }),
    );
    expect(events.at(-1)).toMatchObject({ when: { entity: 'person.john', state: 'home' }, when_strip: true });
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'climate', entities: ['climate.x'] } as CardConfig);
    await ed.updateComplete;
    expect(ed.shadowRoot!.querySelector('ha-form[data-section="card-condition"]')).toBeNull();
  });

  it('writes the condition on the entity', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => {
      const config = (e as CustomEvent).detail.config as CardConfig;
      events.push(config);
      ed.setConfig(config);
    });
    ed.hass = makeHass({ 'sensor.power': '1' });
    ed.setConfig({
      type: 'custom:chartdeck-card',
      style: 'line',
      entities: [{ entity: 'sensor.power', name: 'P' }],
    } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as HTMLElement & {
      updateComplete: Promise<boolean>;
      shadowRoot: ShadowRoot;
    };
    await list.updateComplete;
    (list.shadowRoot.querySelector('.expand') as HTMLElement).click();
    await list.updateComplete;
    const form = list.shadowRoot.querySelector('ha-form[data-section="entity-condition"]') as Stub;
    expect(form).not.toBeNull();
    // The line chart's own per-entity fields are untouched.
    expect(JSON.stringify((list as unknown as Stub).chartFields)).not.toContain('when_');
    const names = JSON.stringify(form.schema);
    expect(names).toContain('when_entity');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), when_entity: 'person.john', when_state: 'home' } },
      }),
    );
    expect((events.at(-1)!.entities as EntityConfig[])[0]).toMatchObject({
      entity: 'sensor.power',
      when: { entity: 'person.john', state: 'home' },
    });
  });
});
