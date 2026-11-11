import { afterEach, describe, expect, it, vi } from 'vitest';
import { BADGE_FIELDS, BADGE_ACTION_FIELDS, badgeSchema } from '../src/editor/badge-editor';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';
import { H, stubEditorElements } from './helpers/chart';

stubEditorElements();
const { ChartdeckBadge, badgeColor, normalizeBadge, sparkPath } = await import('../src/badge');
await import('../src/chartdeck-card');

type Badge = HTMLElement & {
  setConfig(c: Record<string, unknown>): void;
  hass?: HomeAssistant;
  updateComplete: Promise<boolean>;
};

const now = Date.now();
const states = {
  'sensor.grid': ['1.84', { unit_of_measurement: 'kW', friendly_name: 'Grid' }],
  'sensor.battery': ['58', { unit_of_measurement: '%', friendly_name: 'Phone', device_class: 'battery' }],
  'sensor.off': ['unavailable', { friendly_name: 'Off' }],
  'sensor.text': ['hello', {}],
} as const;

function hassWithHistory(rows: Record<string, { s: string; lu: number }[]> = {}) {
  const hass = makeHass(states as never);
  hass.callWS = vi.fn(async () => rows) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Record<string, unknown>, hass = hassWithHistory()): Promise<Badge> {
  const badge = document.createElement('chartdeck-badge') as Badge;
  badge.setConfig({ type: 'custom:chartdeck-badge', ...config });
  badge.hass = hass;
  document.body.appendChild(badge);
  await badge.updateComplete;
  return badge;
}

const q = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('badge config', () => {
  it('reads the card’s options through the card’s own checks', () => {
    const { config, style, hours } = normalizeBadge({
      type: 'custom:chartdeck-badge',
      entity: 'sensor.grid',
      style: 'ring',
      max: 5,
      severity: [{ from: 0, color: 'green' }],
    });
    expect(style).toBe('ring');
    expect(hours).toBe(24);
    expect(config.entities[0]).toMatchObject({ entity: 'sensor.grid', max: 5 });
    expect(config.show).toMatchObject({ name: true, icon: true });
    expect(
      normalizeBadge({ type: 'x', entity: 'sensor.a', attribute: 'speed', show_name: false }).config.entities[0],
    ).toMatchObject({ entity: 'sensor.a', attribute: 'speed' });
  });

  it('rejects bad options with readable errors', () => {
    const bad = (c: Record<string, unknown>) => () => normalizeBadge({ type: 'x', entity: 'sensor.a', ...c });
    expect(() => normalizeBadge({ type: 'x' })).toThrow('"entity" is required');
    expect(bad({ style: 'gauge' })).toThrow('"style" must be one of: value, sparkline, ring, thin');
    expect(bad({ hours: 0 })).toThrow(/"hours"/);
    expect(bad({ hours: 500 })).toThrow(/"hours"/);
    expect(bad({ show_name: 'yes' })).toThrow('"show_name" must be true or false');
    expect(bad({ color: 3 })).toThrow(/"color"/);
    expect(bad({ min: 10, max: 5 })).toThrow(/"max"/);
    expect(() => normalizeBadge(null as never)).toThrow('Invalid configuration');
  });

  it('picks a battery for its stub, then any number', () => {
    expect(ChartdeckBadge.getStubConfig(makeHass(states as never))).toEqual({
      type: 'custom:chartdeck-badge',
      entity: 'sensor.battery',
      style: 'ring',
    });
    expect(ChartdeckBadge.getStubConfig(makeHass({ 'sensor.b': '2', 'sensor.a': '1' })).entity).toBe('sensor.a');
    expect(ChartdeckBadge.getStubConfig(makeHass({})).entity).toBe('sensor.example');
    expect(ChartdeckBadge.getConfigElement().tagName.toLowerCase()).toBe('chartdeck-badge-editor');
  });

  it('is registered as a custom badge', () => {
    const list = (window as unknown as { customBadges: { type: string }[] }).customBadges;
    expect(list.filter((b) => b.type === 'chartdeck-badge')).toHaveLength(1);
    expect(customElements.get('chartdeck-badge')).toBe(ChartdeckBadge);
  });
});

describe('badge maths', () => {
  it('takes the band colour with bands, else its own, else primary', () => {
    const e = { band: { color: 'red' } } as never;
    expect(badgeColor(e, { type: 'x', severity: [{ from: 0, color: 'red' }] })).toBe('var(--error-color, #ef3b5a)');
    expect(badgeColor(e, { type: 'x', color: '#123456' })).toBe('#123456');
    expect(badgeColor(e, { type: 'x' })).toBe('var(--primary-color, #2f6fe4)');
  });

  it('draws a sparkline across the box, broken at gaps, and nothing without readings', () => {
    const range = { start: 0, end: 100 };
    const d = sparkPath(
      [
        { t: 0, v: 1 },
        { t: 40, v: 3 },
        { t: 50, v: null },
        { t: 60, v: 2 },
        { t: 100, v: 2 },
      ],
      range,
    );
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.startsWith('M1,')).toBe(true);
    expect(sparkPath([], range)).toBe('');
    expect(sparkPath([{ t: 1, v: 1 }], { start: 5, end: 5 })).toBe('');
  });
});

describe('badge', () => {
  it('shows the value, name and a tinted icon, and opens more-info on tap', async () => {
    const badge = await mount({ entity: 'sensor.grid', severity: [{ from: 0, color: 'green' }] });
    expect(q(badge, '.value')!.textContent).toBe('1.8 kW');
    expect(q(badge, '.name')!.textContent).toBe('Grid');
    expect(q(badge, 'ha-state-icon')).not.toBeNull();
    expect(q(badge, '.icon-wrap')!.getAttribute('style')).toContain('--success-color');
    const el = q(badge, '.badge') as HTMLElement;
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('aria-label')).toBe('Grid, 1.8 kW');
    const heard = vi.fn();
    badge.addEventListener('hass-action', heard);
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(heard).toHaveBeenCalled());
  });

  it('swaps the icon for a dot, hides the name, and is an image without actions', async () => {
    const badge = await mount({
      entity: 'sensor.grid',
      show_icon: false,
      show_name: false,
      tap_action: { action: 'none' },
    });
    expect(q(badge, '.dot')).not.toBeNull();
    expect(q(badge, '.name')).toBeNull();
    expect(q(badge, '.badge')!.getAttribute('role')).toBe('img');
    expect(q(badge, '.badge')!.hasAttribute('tabindex')).toBe(false);
  });

  it('fills a ring and a thin bar to the value’s place', async () => {
    const ring = await mount({ entity: 'sensor.battery', style: 'ring' });
    expect(q(ring, '.ring .fill')!.getAttribute('style')).toContain('stroke-dasharray: 58 100');
    const thin = await mount({ entity: 'sensor.grid', style: 'thin', max: 4 });
    expect(q(thin, '.thin-fill')!.getAttribute('style')).toContain('width: 46%');
    // A limit can be an entity, as on the card: 1.84 of sensor.battery's 58.
    const byEntity = await mount({ entity: 'sensor.grid', style: 'thin', max: 'sensor.battery' });
    expect(q(byEntity, '.thin-fill')!.getAttribute('style')).toContain('width: 3.2%');
  });

  it('uses its own icon on the value look', async () => {
    const badge = await mount({ entity: 'sensor.grid', icon: 'mdi:flash' });
    expect((q(badge, '.icon') as HTMLElement & { icon?: string }).icon).toBe('mdi:flash');
  });

  it('greys out an unavailable or missing entity without breaking', async () => {
    const off = await mount({ entity: 'sensor.off', style: 'ring' });
    expect(q(off, '.badge')!.classList.contains('unavailable')).toBe(true);
    expect(q(off, '.ring .fill')).toBeNull();
    expect(q(off, '.value')!.textContent).toBe('Unavailable');
    const gone = await mount({ entity: 'sensor.gone', style: 'thin' });
    expect(q(gone, '.value')!.textContent).toBe('Entity not found');
    const text = await mount({ entity: 'sensor.text' });
    expect(q(text, '.value')!.textContent).toBe('hello');
  });

  it('draws a sparkline of the last hours, carrying the last reading to now', async () => {
    const rows = {
      'sensor.grid': [
        { s: '1', lu: (now - 20 * H) / 1000 },
        { s: '3', lu: (now - 10 * H) / 1000 },
        { s: '2', lu: (now - 2 * H) / 1000 },
      ],
    };
    const hass = hassWithHistory(rows);
    const badge = await mount({ entity: 'sensor.grid', style: 'sparkline', hours: 12 }, hass);
    expect(q(badge, '.spark-empty')).not.toBeNull();
    await vi.waitFor(() => expect(q(badge, '.spark path')).not.toBeNull());
    const call = (hass.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(Date.parse(call.start_time)).toBeGreaterThanOrEqual(now - 12 * H - 1000);
    expect(q(badge, '.spark path')!.getAttribute('d')).toMatch(/^M1,/);
  });

  it('redraws only for its own entity, and stops on leaving the page', async () => {
    const hass = hassWithHistory();
    const badge = await mount({ entity: 'sensor.grid' }, hass);
    const update = badge as unknown as { shouldUpdate(c: Map<string, unknown>): boolean };
    const other = { ...hass, states: { ...hass.states, 'sensor.battery': { ...hass.states['sensor.battery'] } } };
    const mine = { ...hass, states: { ...hass.states, 'sensor.grid': { ...hass.states['sensor.grid'], state: '2' } } };
    badge.hass = other;
    expect(update.shouldUpdate(new Map([['hass', hass]]))).toBe(false);
    badge.hass = mine;
    expect(update.shouldUpdate(new Map([['hass', hass]]))).toBe(true);
    expect(update.shouldUpdate(new Map())).toBe(true);
    badge.remove();
    document.body.appendChild(badge);
    await badge.updateComplete;
    expect(q(badge, '.value')!.textContent).toBe('2.0 kW');
  });
});

describe('badge editor', () => {
  type Editor = HTMLElement & { setConfig(c: CardConfig): void; hass?: unknown; updateComplete: Promise<boolean> };

  async function editor(config: Record<string, unknown>) {
    const ed = document.createElement('chartdeck-badge-editor') as Editor;
    ed.hass = makeHass(states as never);
    ed.setConfig({ type: 'custom:chartdeck-badge', ...config } as CardConfig);
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events };
  }
  const names = (schema: unknown[]) =>
    (schema as { name: string; schema?: { name: string }[] }[]).flatMap((f) =>
      f.schema ? f.schema.map((x) => x.name) : [f.name],
    );

  it('shows hours only for the sparkline and the icon switch only for the value look', () => {
    const value = names(badgeSchema(undefined, { type: 'x', entity: 'sensor.grid' }));
    expect(value).toContain('show_icon');
    expect(value).toContain('icon');
    expect(value).toContain('attribute');
    expect(value).not.toContain('hours');
    const spark = names(badgeSchema(undefined, { type: 'x', style: 'sparkline' }));
    expect(spark).toContain('hours');
    expect(spark).not.toContain('show_icon');
    expect(spark).not.toContain('icon');
    expect(spark).not.toContain('attribute');
    expect(names(badgeSchema(undefined, { type: 'x', show_icon: false }))).not.toContain('icon');
    // Min and max are limit fields, not plain number boxes in the form.
    expect(value).not.toContain('min');
    expect(value).not.toContain('max');
    // Every option the form shows is one it writes.
    for (const name of [...value, ...spark]) expect(BADGE_FIELDS.some((f) => f.name === name)).toBe(true);
  });

  it('writes the form, bands and actions, dropping defaults', async () => {
    const { ed, events } = await editor({ entity: 'sensor.grid' });
    const form = ed.shadowRoot!.querySelector('ha-form[data-section="badge"]') as HTMLElement & {
      data: Record<string, unknown>;
      computeLabel(s: { name: string }): string;
    };
    expect(form.data).toMatchObject({ entity: 'sensor.grid', style: 'value', show_name: true, hours: 24 });
    expect(form.computeLabel({ name: 'style' })).toBe('Look');
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...form.data, style: 'ring', show_name: true } } }),
    );
    expect(events.at(-1)).toEqual({ type: 'custom:chartdeck-badge', entity: 'sensor.grid', style: 'ring' });
    await ed.updateComplete;
    const limits = [...ed.shadowRoot!.querySelectorAll('cd-limit-field')] as (HTMLElement & {
      value?: unknown;
      label?: string;
      defaultLabel?: string;
    })[];
    expect(limits.map((l) => [l.dataset.limit, l.label, l.defaultLabel])).toEqual([
      ['min', 'Minimum', '0'],
      ['max', 'Maximum', '100'],
    ]);
    limits[1].dispatchEvent(new CustomEvent('value-changed', { detail: { value: 5 } }));
    expect(events.at(-1)).toMatchObject({ style: 'ring', max: 5 });
    limits[0].dispatchEvent(new CustomEvent('value-changed', { detail: { value: 'sensor.battery' } }));
    expect(events.at(-1)).toMatchObject({ min: 'sensor.battery', max: 5 });
    await ed.updateComplete;
    expect(limits[0].value).toBe('sensor.battery');
    limits[0].dispatchEvent(new CustomEvent('value-changed', { detail: { value: undefined } }));
    expect(events.at(-1)).not.toHaveProperty('min');
    const bands = ed.shadowRoot!.querySelector('cd-bands-editor')!;
    bands.dispatchEvent(new CustomEvent('value-changed', { detail: { value: [{ from: 0, color: 'red' }] } }));
    expect(events.at(-1)!.severity).toEqual([{ from: 0, color: 'red' }]);
    const actions = ed.shadowRoot!.querySelector('ha-form[data-section="actions"]') as HTMLElement & {
      data: Record<string, unknown>;
    };
    expect(Object.keys(actions.data)).toEqual(BADGE_ACTION_FIELDS.map((f) => f.name));
    actions.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...actions.data, hold_action: { action: 'toggle' } } } }),
    );
    expect(events.at(-1)).toMatchObject({ style: 'ring', max: 5, hold_action: { action: 'toggle' } });
  });

  it('draws nothing before it has a config', async () => {
    const ed = document.createElement('chartdeck-badge-editor') as Editor;
    document.body.appendChild(ed);
    await ed.updateComplete;
    expect(ed.shadowRoot!.querySelector('ha-form')).toBeNull();
  });
});
