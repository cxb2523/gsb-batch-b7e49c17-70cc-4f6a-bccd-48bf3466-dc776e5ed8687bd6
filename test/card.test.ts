import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartdeckCard } from '../src/chartdeck-card';
import { resetLimitWarnings } from '../src/resolve';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

type Card = ChartdeckCard & {
  shouldUpdate(changed: Map<string, unknown>): boolean;
  render(): unknown;
};

const base = (extra: Partial<CardConfig> = {}): CardConfig => ({
  type: 'custom:chartdeck-card',
  entities: ['sensor.load', 'sensor.solar'],
  ...extra,
});

const states = () =>
  makeHass({
    'sensor.load': ['42.25', { unit_of_measurement: 'W', friendly_name: 'Load' }],
    'sensor.solar': ['80', { unit_of_measurement: 'W', friendly_name: 'Solar' }],
    'sensor.cap': '200',
    'sensor.other': '1',
  });

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function mount(config: CardConfig, hass: HomeAssistant = states()): Promise<Card> {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig(config);
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

describe('chartdeck-card', () => {
  beforeEach(() => resetLimitWarnings());
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws one meter per entity with aria values', async () => {
    const card = await mount(base());
    const meters = qa(card, '[role=meter]');
    expect(meters).toHaveLength(2);
    expect(meters[0].getAttribute('aria-valuenow')).toBe('42.25');
    expect(meters[0].getAttribute('aria-valuemin')).toBe('0');
    expect(meters[0].getAttribute('aria-valuemax')).toBe('100');
    expect(meters[0].getAttribute('aria-label')).toBe('Load, 42.3 W');
    expect(meters[0].getAttribute('tabindex')).toBe('0');
    const style = meters[0].getAttribute('style')!;
    expect(style).toContain('--start:0');
    expect(style).toContain('--end:0.4225');
    expect(style).toContain('--pos:0.4225');
    expect(style).toContain('--c-start:');
    expect(style).toContain('--c-end:');
    expect(meters[0].textContent).toContain('Load');
    expect(meters[0].textContent).toContain('42.3 W');
    expect(q(card, '.content')!.classList.contains('style-bar')).toBe(true);
  });

  it('shows the hint when there are no entities', async () => {
    const card = await mount(base({ entities: [] }));
    expect(qa(card, '[role=meter]')).toHaveLength(0);
    expect(card.shadowRoot!.textContent).toContain('Add an entity in the editor to get started.');
  });

  it('shows "Entity not found" for a missing entity and sorts it last', async () => {
    const card = await mount(base({ entities: ['sensor.nope', 'sensor.solar', 'sensor.load'], sort: 'ascending' }));
    const meters = qa(card, '[role=meter]');
    expect(meters.map((m) => m.getAttribute('aria-label'))).toEqual([
      'Load, 42.3 W',
      'Solar, 80.0 W',
      'sensor.nope, Entity not found',
    ]);
    expect(meters[2].hasAttribute('aria-valuenow')).toBe(false);
    expect(meters[2].classList.contains('unavailable')).toBe(true);
  });

  it('keeps each entity on its own element when the sort order changes', async () => {
    const card = await mount(base({ sort: 'ascending' }));
    const [load, solar] = qa(card, '[role=meter]');
    expect(load.getAttribute('aria-label')).toBe('Load, 42.3 W');
    const next = states();
    next.states['sensor.load'] = { ...next.states['sensor.load'], state: '90' };
    card.hass = next;
    await card.updateComplete;
    const after = qa(card, '[role=meter]');
    expect(after[0]).toBe(solar);
    expect(after[1]).toBe(load);
    expect(after.map((m) => m.getAttribute('data-index'))).toEqual(['0', '1']);
  });

  it('renders an entity listed twice once per listing', async () => {
    const card = await mount(base({ entities: ['sensor.load', 'sensor.load'], sort: 'descending' }));
    expect(qa(card, '[role=meter]')).toHaveLength(2);
  });

  it('ignores unrelated entity updates', async () => {
    const hass = states();
    const card = await mount(base(), hass);
    const render = vi.spyOn(card, 'render');
    const next = {
      ...hass,
      states: { ...hass.states, 'sensor.other': { ...hass.states['sensor.other'], state: '2' } },
    };
    card.hass = next;
    expect(card.shouldUpdate(new Map([['hass', hass]]))).toBe(false);
    await card.updateComplete;
    expect(render).not.toHaveBeenCalled();
  });

  it('re-renders on own entity, limit entity, or theme change', async () => {
    const hass = states();
    const card = await mount(base({ max: 'sensor.cap' }), hass);
    const own = { ...hass, states: { ...hass.states, 'sensor.load': { ...hass.states['sensor.load'], state: '50' } } };
    const limit = { ...hass, states: { ...hass.states, 'sensor.cap': { ...hass.states['sensor.cap'], state: '300' } } };
    const theme = { ...hass, themes: { darkMode: true } };
    const themeName = { ...hass, themes: { darkMode: false, theme: 'midnight' } };
    const locale = { ...hass, locale: { language: 'de' } };
    for (const next of [own, limit, theme, themeName, locale]) {
      card.hass = next;
      expect(card.shouldUpdate(new Map([['hass', hass]]))).toBe(true);
    }
    card.hass = limit;
    await card.updateComplete;
    expect(q(card, '[role=meter]')!.getAttribute('aria-valuemax')).toBe('300');
    expect(card.shouldUpdate(new Map([['_config', undefined]]))).toBe(true);
  });

  it('does not drop the ready attribute on setConfig', async () => {
    const card = await mount(base());
    expect(card.hasAttribute('ready')).toBe(false);
    expect(card.hasAttribute('static')).toBe(false);
    await frame();
    await frame();
    expect(card.hasAttribute('ready')).toBe(true);
    card.setConfig(base({ title: 'x' }));
    await card.updateComplete;
    expect(card.hasAttribute('ready')).toBe(true);
  });

  it('restarts the draw-in when moved in the page while it is still playing', async () => {
    // Masonry re-lays out its columns after the first render and can move a card that has
    // just started drawing in; a moved element loses its running transition and would snap
    // to the final value, so the draw-in starts over instead.
    // The restart only happens within DRAW_IN_MS of the draw-in starting; on a busy machine the
    // two frames can take longer than that, so hold performance.now() still for the test.
    vi.spyOn(performance, 'now').mockReturnValue(performance.now());
    const card = await mount(base());
    await frame();
    await frame();
    expect(card.hasAttribute('ready')).toBe(true);
    const other = document.createElement('div');
    document.body.appendChild(other);
    other.appendChild(card);
    expect(card.hasAttribute('ready')).toBe(false);
    await frame();
    await frame();
    expect(card.hasAttribute('ready')).toBe(true);
  });

  it('does not replay the draw-in when re-attached after it finished', async () => {
    const card = await mount(base());
    await frame();
    await frame();
    expect(card.hasAttribute('ready')).toBe(true);
    const now = performance.now();
    vi.spyOn(performance, 'now').mockReturnValue(now + 5000);
    card.remove();
    document.body.appendChild(card);
    expect(card.hasAttribute('ready')).toBe(true);
  });

  it('skips the draw-in in an editor preview', async () => {
    // Home Assistant builds a new preview card on every editor change and marks it `preview`;
    // drawing in each one would replay the animation on every keystroke.
    const card = document.createElement('chartdeck-card') as Card;
    card.preview = true;
    card.setConfig(base());
    card.hass = states();
    document.body.appendChild(card);
    await card.updateComplete;
    expect(card.hasAttribute('ready')).toBe(true);
    // Value changes still animate.
    expect(card.hasAttribute('static')).toBe(false);
  });

  it('waits for entities to be drawn before setting ready', async () => {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig(base());
    document.body.appendChild(card);
    await card.updateComplete;
    await frame();
    expect(card.hasAttribute('ready')).toBe(false);
    card.hass = states();
    await card.updateComplete;
    expect(card.hasAttribute('ready')).toBe(false);
    await frame();
    await frame();
    expect(card.hasAttribute('ready')).toBe(true);
  });

  it('is static under reduced motion or animate: false', async () => {
    const plain = await mount(base({ animate: false }));
    expect(plain.hasAttribute('static')).toBe(true);
    expect(plain.hasAttribute('ready')).toBe(true);

    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })),
    );
    const reduced = await mount(base());
    expect(reduced.hasAttribute('static')).toBe(true);
    expect(reduced.hasAttribute('ready')).toBe(true);
  });

  it('renders the legend only when show.legend and bands exist', async () => {
    const severity = [
      { from: 0, color: 'green' },
      { from: 60, color: 'red', label: 'High' },
    ];
    const withLegend = await mount(base({ severity, show: { legend: true } }));
    const items = qa(withLegend, '.legend .legend-item');
    expect(items.map((i) => i.textContent!.trim())).toEqual(['0.0–60.0 W', 'High']);
    expect(qa(withLegend, '.legend .dot')).toHaveLength(2);

    const hidden = await mount(base({ severity }));
    expect(q(hidden, '.legend')).toBeNull();

    const noBands = await mount(base({ show: { legend: true } }));
    expect(q(noBands, '.legend')).toBeNull();
  });

  it('moves the legend and the colours when a band start entity changes', async () => {
    const severity = [
      { from: 0, color: 'green' },
      { from: 'sensor.cap', color: 'red' },
    ];
    const card = await mount(base({ severity, show: { legend: true } }));
    const legend = () => qa(card, '.legend .legend-item').map((i) => i.textContent!.trim());
    expect(legend()).toEqual(['0.0–200.0 W', '200.0 W+']);
    const next = states();
    next.states['sensor.cap'] = { ...next.states['sensor.cap'], state: '50' };
    const prev = card.hass!;
    card.hass = next;
    expect(card.shouldUpdate(new Map([['hass', prev]]))).toBe(true);
    await card.updateComplete;
    expect(legend()).toEqual(['0.0–50.0 W', '50.0 W+']);
    const solar = qa(card, '.entity').find((e) => e.getAttribute('aria-label')!.startsWith('Solar'))!;
    expect((solar as HTMLElement).style.getPropertyValue('--c-start')).toContain('--error-color');
  });

  it("swaps in the band's icon and, with color_icon, colours icons by band", async () => {
    const severity = [
      { from: 0, color: 'green', icon: 'mdi:battery-high' },
      { from: 60, color: 'red' },
    ];
    const card = await mount(
      base({ entities: ['sensor.load', { entity: 'sensor.solar', icon: 'mdi:solar-power' }, 'sensor.u'], severity }),
      makeHass({ 'sensor.load': '42', 'sensor.solar': '80', 'sensor.u': 'unavailable' }),
    );
    const icons = qa(card, 'ha-state-icon') as (HTMLElement & { icon?: string })[];
    expect(icons.map((i) => i.icon)).toEqual(['mdi:battery-high', 'mdi:solar-power', undefined]);
    expect(qa(card, '.entity.icon-band')).toHaveLength(0);
    const coloured = await mount(
      base({ entities: ['sensor.load', 'sensor.u'], severity, color_icon: true }),
      makeHass({ 'sensor.load': '42', 'sensor.u': 'unavailable' }),
    );
    expect(qa(coloured, '.entity').map((e) => e.classList.contains('icon-band'))).toEqual([true, false]);
  });

  it('fills from rules: updates when a match changes or arrives, and keeps the top N', async () => {
    const battery = (id: string, v: string) => ({
      entity_id: id,
      state: v,
      attributes: { device_class: 'battery', unit_of_measurement: '%', friendly_name: id.slice(7).toUpperCase() },
    });
    const hass = makeHass({ 'sensor.x': '5' });
    hass.states['sensor.a'] = battery('sensor.a', '30');
    hass.states['sensor.b'] = battery('sensor.b', '70');
    const card = await mount(
      { type: 'custom:chartdeck-card', include: { device_class: 'battery' }, sort: 'descending', limit: 2 },
      hass,
    );
    const labels = () => qa(card, '.entity').map((e) => e.getAttribute('aria-label'));
    expect(labels()).toEqual(['B, 70 %', 'A, 30 %']);

    const step = (prev: HomeAssistant, id: string, state: HomeAssistant['states'][string]) => {
      const next = { ...prev, states: { ...prev.states, [id]: state } };
      card.hass = next;
      return { next, update: card.shouldUpdate(new Map([['hass', prev]])) };
    };
    const unrelated = step(hass, 'sensor.x', { ...hass.states['sensor.x'], state: '6' });
    expect(unrelated.update).toBe(false);
    const changed = step(unrelated.next, 'sensor.a', battery('sensor.a', '90'));
    expect(changed.update).toBe(true);
    await card.updateComplete;
    const arrived = step(changed.next, 'sensor.c', battery('sensor.c', '99'));
    expect(arrived.update).toBe(true);
    await card.updateComplete;
    expect(labels()).toEqual(['C, 99 %', 'A, 90 %']);
  });

  it('says when a rule matches nothing, or every entity is hidden as unavailable', async () => {
    const none = await mount({ type: 'custom:chartdeck-card', include: { device_class: 'moisture' } });
    expect(q(none, '.hint')!.textContent).toBe('No entities match right now.');
    const hidden = await mount(
      { type: 'custom:chartdeck-card', entities: ['sensor.u'], hide_unavailable: true },
      makeHass({ 'sensor.u': 'unavailable' }),
    );
    expect(q(hidden, '.hint')!.textContent).toBe('None of these entities are available.');
  });

  it('hides name/value/icon/target per show options', async () => {
    const shown = await mount(base({ target: 50 }));
    expect(qa(shown, '.text:not(.on-fill) .name')).toHaveLength(2);
    expect(qa(shown, '.text:not(.on-fill) .value')).toHaveLength(2);
    expect(qa(shown, 'ha-state-icon')).toHaveLength(2);
    expect(qa(shown, '.target')).toHaveLength(2);
    expect(q(shown, '[role=meter]')!.getAttribute('style')).toContain('--target:0.5');

    const hidden = await mount(base({ target: 50, show: { name: false, value: false, icon: false, target: false } }));
    expect(qa(hidden, '.name')).toHaveLength(0);
    expect(qa(hidden, '.value')).toHaveLength(0);
    expect(qa(hidden, 'ha-state-icon')).toHaveLength(0);
    expect(qa(hidden, '.target')).toHaveLength(0);

    const noTarget = await mount(base());
    expect(qa(noTarget, '.target')).toHaveLength(0);
  });

  it('counts the card header at its measured 73 px when sizing for masonry', async () => {
    const card = await mount(base({ title: 'Tank', style: 'tank', entities: ['sensor.load'] }));
    // 73 header + 16 padding + 230 tank tile = 319 px -> 7 rows of 50 px.
    expect(card.getCardSize()).toBe(7);
  });

  it('sizes for masonry and sections', async () => {
    const card = await mount(
      base({ title: 'Power', entities: ['sensor.load', 'sensor.solar', 'sensor.cap', 'sensor.other'] }),
    );
    expect(card.getCardSize()).toBe(6);
    // Sections: the real height depends on title wrapping and the card's width, so let the
    // grid size the card to its content rather than reserve an estimated row count.
    expect(card.getGridOptions()).toEqual({ columns: 6, rows: 'auto', min_columns: 6, min_rows: 1 });

    const two = await mount(
      base({
        columns: 2,
        show: { legend: true },
        severity: [
          { from: 0, color: 'green' },
          { from: 50, color: 'red' },
        ],
      }),
    );
    // 16 + 1 row × 46 + 32 legend = 94
    expect(two.getCardSize()).toBe(2);
    expect(two.getGridOptions().rows).toBe('auto');
  });

  it('treats columns as a maximum, dropping to fewer when the card is too narrow', async () => {
    const grid = (card: Card) => (q(card, '.entities') as HTMLElement).getAttribute('style');
    const bar = await mount(base({ columns: 3 }));
    expect(grid(bar)).toBe(
      'grid-template-columns: repeat(auto-fill, minmax(max(min(160px, 100%), calc((100% - 32px) / 3 - 0.5px)), 1fr))',
    );
    const ring = await mount(base({ style: 'ring', columns: 3 }));
    expect(grid(ring)).toBe(
      'grid-template-columns: repeat(auto-fill, minmax(max(min(128px, 100%), calc((100% - 16px) / 3 - 0.5px)), 1fr))',
    );
    const mins = { bar: 160, thin: 140, segmented: 180, tank: 80, ring: 128, arc: 128, needle: 134 };
    for (const [style, min] of Object.entries(mins)) {
      const card = await mount(base({ style: style as CardConfig['style'], columns: 1 }));
      expect(grid(card)).toBe(
        `grid-template-columns: repeat(auto-fill, minmax(max(min(${min}px, 100%), calc((100% - 0px) / 1 - 0.5px)), 1fr))`,
      );
    }
    // A card narrower than one minimum column shrinks the column instead of overflowing
    // (min(…, 100%)); the 0.5 px keeps N columns fitting where a browser rounds to nearest.
    // Unset: rows stay one column and tiles keep wrapping on their own.
    expect(grid(await mount(base()))).toBe('grid-template-columns: repeat(1, minmax(0, 1fr))');
    expect(grid(await mount(base({ style: 'ring' })))).toBe('');
  });

  it('keeps row styles at least half a section wide', async () => {
    // Below 6 columns a row's icon, cells and value can't fit (48 px of content at 3 columns).
    const row = await mount(base({ style: 'segmented' }));
    expect(row.getGridOptions().min_columns).toBe(6);
    const tiles = await mount(base({ style: 'ring' }));
    expect(tiles.getGridOptions().min_columns).toBe(3);
  });

  it('builds a stub from battery sensors first', () => {
    const hass = makeHass({
      'sensor.a_temp': '20',
      'sensor.b_text': 'hello',
      'sensor.c_power': '5',
      'sensor.z_battery': ['80', { device_class: 'battery' }],
      'sensor.d_humidity': '50',
      'light.kitchen': '1',
    });
    expect(ChartdeckCard.getStubConfig(hass)).toEqual({
      type: 'custom:chartdeck-card',
      style: 'bar',
      entities: ['sensor.z_battery', 'sensor.a_temp', 'sensor.c_power'],
    });
  });

  it('returns the editor element', () => {
    expect(ChartdeckCard.getConfigElement().tagName.toLowerCase()).toBe('chartdeck-card-editor');
  });

  it('dispatches hass-action on tap', async () => {
    const card = await mount(
      base({ entities: ['sensor.load', { entity: 'sensor.solar', tap_action: { action: 'none' } }] }),
    );
    const seen: { action: string; entity: string }[] = [];
    card.addEventListener('hass-action', (e) => {
      const d = (e as CustomEvent).detail;
      seen.push({ action: d.action, entity: d.config.entity });
    });
    const [load, solar] = qa(card, '.entity') as HTMLElement[];
    expect(load.classList.contains('interactive')).toBe(true);
    expect(solar.classList.contains('interactive')).toBe(false);
    expect(solar.hasAttribute('tabindex')).toBe(false);
    for (const el of [load, solar]) {
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    }
    expect(seen).toEqual([{ action: 'tap', entity: 'sensor.load' }]);

    card.setConfig(base());
    await card.updateComplete;
    load.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    load.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(seen).toHaveLength(2);

    card.remove();
    load.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    load.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(seen).toHaveLength(2);
  });
});
