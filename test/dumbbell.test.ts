import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { agoText, labelledMarks, rowMarks, stepDecimals } from '../src/styles/dumbbell';
import type { ResolvedEntity } from '../src/resolve';
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
const H = 3_600_000;
const sec = (msAgo: number) => (now - msAgo) / 1000;

const entity = (value: number | null, target: number | null = null) =>
  ({ available: value !== null, value, target }) as unknown as ResolvedEntity;

describe('dumbbell maths', () => {
  const points = [
    { t: 10, v: 18 },
    { t: 20, v: null },
    { t: 30, v: 23 },
  ];

  it('takes low and high over the period, stretched to the current value, with now between', () => {
    expect(rowMarks(entity(20), 'range', points, 0, true)).toEqual([
      { kind: 'low', value: 18 },
      { kind: 'now', value: 20 },
      { kind: 'high', value: 23 },
    ]);
    expect(rowMarks(entity(25), 'range', points, 0, false)).toEqual([
      { kind: 'low', value: 18 },
      { kind: 'high', value: 25 },
    ]);
    // No history: the current value alone, even when it isn't asked for.
    expect(rowMarks(entity(20), 'range', [], 0, false)).toEqual([{ kind: 'now', value: 20 }]);
    expect(rowMarks(entity(null), 'range', [], 0, true)).toEqual([]);
  });

  it('compares the start of the period with now', () => {
    expect(rowMarks(entity(21), 'then', points, 15, true)).toEqual([
      { kind: 'then', value: 18 },
      { kind: 'now', value: 21 },
    ]);
    // Statistics start after the period does: the first reading stands in.
    expect(rowMarks(entity(16), 'then', points, 5, true)).toEqual([
      { kind: 'now', value: 16 },
      { kind: 'then', value: 18 },
    ]);
    expect(rowMarks(entity(null), 'then', [], 0, true)).toEqual([]);
  });

  it('compares the target with now', () => {
    expect(rowMarks(entity(21, 19), 'target', [], 0, true)).toEqual([
      { kind: 'target', value: 19 },
      { kind: 'now', value: 21 },
    ]);
    expect(rowMarks(entity(21), 'target', [], 0, true)).toEqual([{ kind: 'now', value: 21 }]);
  });

  it('labels the two ends, skipping the current value in range mode', () => {
    const low = { kind: 'low' as const, value: 1 };
    const now = { kind: 'now' as const, value: 2 };
    const high = { kind: 'high' as const, value: 3 };
    expect(labelledMarks([low, now, high])).toEqual([low, high]);
    expect(labelledMarks([now])).toEqual([now]);
    expect(labelledMarks([])).toEqual([]);
    const then = { kind: 'then' as const, value: 0 };
    expect(labelledMarks([then, now])).toEqual([then, now]);
  });

  it('formats ticks with the decimals their step needs, and names the period', () => {
    expect(stepDecimals([0, 5, 10])).toBe(0);
    expect(stepDecimals([15, 17.5])).toBe(1);
    expect(stepDecimals([0, 0.25])).toBe(2);
    expect(stepDecimals([3])).toBe(0);
    expect(agoText(undefined, { last: 1, unit: 'week' })).toBe('A week ago');
    expect(agoText(undefined, { last: 3, unit: 'day' })).toBe('3 days ago');
  });
});

function hassWith(history: Record<string, { s: string; lu: number }[]>, fail = false) {
  const hass = makeHass({
    'sensor.lounge': ['21', { friendly_name: 'Lounge', unit_of_measurement: '°C' }],
    'sensor.kitchen': ['19.5', { friendly_name: 'Kitchen', unit_of_measurement: '°C' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off', unit_of_measurement: '°C' }],
    'sensor.set': ['20', {}],
  });
  hass.callWS = vi.fn(async () => {
    if (fail) throw new Error('boom');
    return history;
  }) as HomeAssistant['callWS'];
  return hass;
}

const history = {
  'sensor.lounge': [
    { s: '18', lu: sec(20 * H) },
    { s: '23', lu: sec(10 * H) },
    { s: '21', lu: sec(2 * H) },
  ],
  'sensor.kitchen': [
    { s: '17', lu: sec(30 * H) },
    { s: '19.5', lu: sec(5 * H) },
  ],
};

async function mount(config: Partial<CardConfig>, hass = hassWith(history)) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'dumbbell',
    entities: ['sensor.lounge', 'sensor.kitchen', 'sensor.off', 'sensor.gone'],
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
const dots = (row: Element) => [...row.querySelectorAll('.db-dot')].map((d) => d.classList[1]);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('dumbbell chart', () => {
  it("draws each entity's low, now and high on a shared axis, with rows for the unavailable and missing", async () => {
    const card = await mount({});
    const rows = qa(card, '.entity.db-row');
    expect(rows.map((r) => r.getAttribute('data-index'))).toEqual(['0', '1', '2', '3']);
    expect(dots(rows[0])).toEqual(['low', 'now', 'high']);
    expect(rows[0].getAttribute('aria-label')).toBe('Lounge: Low 18.0 °C, Now 21.0 °C, High 23.0 °C');
    expect([...rows[0].querySelectorAll('.db-label')].map((l) => l.textContent)).toEqual(['18.0', '23.0']);
    // Kitchen's history starts before the period: the carried reading counts.
    expect(dots(rows[1])).toEqual(['low', 'high', 'now']);
    expect(rows[2].querySelector('.db-status')!.textContent).toBe('Unavailable');
    expect(rows[2].classList.contains('unavailable')).toBe(true);
    expect(rows[3].querySelector('.db-status')!.textContent).toBe('Entity not found');
    expect(qa(card, '.db-tick').map((t) => t.textContent)).toEqual(['16', '18', '20', '22', '24']);
    expect(q(card, '.db-unit')!.textContent).toBe('°C');
    expect(qa(card, '.db-key').map((k) => k.textContent)).toEqual(['Low', 'Now', 'High']);
    expect(q(card, '.db')!.getAttribute('aria-label')).toBe('Dumbbell chart of Lounge, Kitchen, Off, sensor.gone');
  });

  it('leaves the current value out when asked, and draws columns', async () => {
    const card = await mount({ show_now: false, orientation: 'vertical', show: { name: false, value: false } });
    expect(q(card, '.db.vertical.no-names.no-values')).not.toBeNull();
    expect(dots(qa(card, '.db-row')[0])).toEqual(['low', 'high']);
    expect(qa(card, '.db-label')).toHaveLength(0);
    expect(qa(card, '.db-name')).toHaveLength(0);
    expect(qa(card, '.db-key').map((k) => k.textContent)).toEqual(['Low', 'High']);
  });

  it('compares the start of the period with now', async () => {
    const card = await mount({ ends: 'then', period: { last: 1, unit: 'day' } });
    const rows = qa(card, '.db-row');
    expect(dots(rows[0])).toEqual(['then', 'now']);
    expect(rows[0].getAttribute('aria-label')).toBe('Lounge: A day ago 18.0 °C, Now 21.0 °C');
    expect(qa(card, '.db-key').map((k) => k.textContent)).toEqual(['A day ago', 'Now']);
  });

  it('compares the target with now without loading history', async () => {
    const hass = hassWith(history);
    const card = await mount(
      {
        ends: 'target',
        entities: [{ entity: 'sensor.lounge', target: 'sensor.set' }, { entity: 'sensor.kitchen' }],
      } as Partial<CardConfig>,
      hass,
    );
    expect(hass.callWS).not.toHaveBeenCalled();
    const rows = qa(card, '.db-row');
    expect(dots(rows[0])).toEqual(['target', 'now']);
    expect(rows[0].querySelector('.db-dot.target')!.classList.contains('ring')).toBe(true);
    expect(dots(rows[1])).toEqual(['now']);
    expect(rows[1].querySelector('.db-bar')).toBeNull();
    expect(qa(card, '.db-key').map((k) => k.textContent)).toEqual(['Target', 'Now']);
  });

  it('says when history is loading or failed', async () => {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({ type: 'custom:chartdeck-card', style: 'dumbbell', entities: ['sensor.lounge'] } as CardConfig);
    card.hass = hassWith(history);
    document.body.appendChild(card);
    await card.updateComplete;
    expect(q(card, '.chart-message')!.textContent).toBe('Loading history…');
    const failed = await mount({}, hassWith(history, true));
    expect(q(failed, '.chart-message.error')!.textContent!.trim()).toBe("Couldn't load history: boom");
  });

  it('draws rows without marks when nothing has a value', async () => {
    const card = await mount({ entities: ['sensor.off'] }, hassWith({}));
    expect(q(card, '.db-status')!.textContent).toBe('Unavailable');
    expect(q(card, '.db-legend')).toBeNull();
    expect(q(card, '.db-axis')).toBeNull();
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'dumbbell', entities: ['sensor.lounge'], ...extra } as CardConfig);
    expect(set({ ends: 'both' })).toThrow(/"ends" must be one of: range, then, target/);
    expect(set({ orientation: 'diagonal' })).toThrow(/orientation/);
    expect(set({ show_now: 'yes' })).toThrow(/show_now/);
    expect(set({ source: 'cloud' })).toThrow(/source/);
    expect(set({ ends: 'target', orientation: 'vertical', show_now: false })).not.toThrow();
  });

  it('opens more-info from a row', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const row = qa(card, '.db-row')[1] as HTMLElement;
    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.kitchen']);
  });
});

describe('dumbbell editor', () => {
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
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    return { form, events };
  }
  const names = (schema: unknown) =>
    (schema as { name: string; schema?: { name: string }[] }[]).flatMap((s) =>
      s.schema ? s.schema.map((x) => x.name) : [s.name],
    );

  it('sets what to compare, the direction, the period and the current-value mark', async () => {
    const raw = { type: 'custom:chartdeck-card', style: 'dumbbell', entities: ['sensor.a'] } as CardConfig;
    const { form, events } = await editor(raw);
    expect(form.data).toMatchObject({ ends: 'range', orientation: 'horizontal', show_now: true, period_last: 24 });
    expect(names(form.schema)).toEqual(['ends', 'orientation', 'period_last', 'period_unit', 'source', 'show_now']);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), orientation: 'vertical', show_now: false, period_unit: 'week' } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, orientation: 'vertical', show_now: false, period: { unit: 'week' } });
  });

  it('hides the period for a target and the mark for a start-of-period comparison', async () => {
    const target = await editor({ type: 'x', style: 'dumbbell', ends: 'target', entities: [] } as CardConfig);
    expect(names(target.form.schema)).toEqual(['ends', 'orientation']);
    document.body.innerHTML = '';
    const then = await editor({ type: 'x', style: 'dumbbell', ends: 'then', entities: [] } as CardConfig);
    expect(names(then.form.schema)).toEqual(['ends', 'orientation', 'period_last', 'period_unit', 'source']);
  });
});
