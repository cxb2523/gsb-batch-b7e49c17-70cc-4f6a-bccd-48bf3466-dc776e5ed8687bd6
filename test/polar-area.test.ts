import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { normalizeConfig } from '../src/config';
import { resolveEntities } from '../src/resolve';
import { sliceAngles, sliceColor, sliceLength } from '../src/styles/polar-area';
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

const hass = () =>
  makeHass({
    'sensor.oven': ['1200', { friendly_name: 'Oven', unit_of_measurement: 'W' }],
    'sensor.ev': ['3600', { friendly_name: 'EV', unit_of_measurement: 'W' }],
    'sensor.tv': ['400', { friendly_name: 'TV', unit_of_measurement: 'W' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off' }],
  });

const ENTITIES = ['sensor.oven', 'sensor.ev', 'sensor.tv', 'sensor.off', 'sensor.missing'];

async function mount(config: Partial<CardConfig>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'polar_area', entities: ENTITIES, ...config } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('polar area maths', () => {
  const items = resolveEntities(normalizeConfig({ type: 'x', entities: ENTITIES, max: 4000 } as CardConfig), hass());

  it('measures slice length against the largest value or the entity limits', () => {
    expect(sliceLength(items[0], 'shared', 3600)).toBeCloseTo(1 / 3);
    expect(sliceLength(items[0], 'limits', 3600)).toBeCloseTo(0.3);
    expect(sliceLength(items[0], 'shared', 0)).toBe(0);
    expect(sliceLength(items[3], 'shared', 3600)).toBeNull();
  });

  it('centres each slice on its spoke with a gap, and fills the circle with one', () => {
    const [a0, a1] = sliceAngles(0, 4);
    expect(a0).toBeCloseTo(-Math.PI / 4 + 0.02);
    expect(a1).toBeCloseTo(Math.PI / 4 - 0.02);
    expect(sliceAngles(0, 1)).toEqual([0, Math.PI * 2]);
  });

  it('colours by series, shade or band', () => {
    expect(sliceColor(items[1], 1, 1, 'series', 'primary')).toContain('--warning-color');
    expect(sliceColor(items[1], 1, 1, 'shades', 'red')).toBe('var(--error-color, #ef3b5a)');
    expect(sliceColor(items[1], 1, 0.5, 'shades', '#123456')).toBe(
      'color-mix(in srgb, #123456 65%, var(--card-background-color, #fff))',
    );
    expect(sliceColor(items[1], 1, 1, 'bands', 'primary')).toContain('--primary-color');
  });
});

describe('polar area chart', () => {
  it('draws a slice per value, sized against the largest, with names, values and ring values', async () => {
    const card = await mount({});
    const slices = qa(card, 'path.slice.entity');
    expect(slices.map((s) => s.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(slices[1].getAttribute('aria-label')).toBe('EV, 3,600.0 W');
    expect(slices[0].getAttribute('fill')).toContain('--primary-color');
    const labels = qa(card, '.slice-label').map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(labels).toEqual([
      'Oven 1,200.0 W',
      'EV 3,600.0 W',
      'TV 400.0 W',
      'Off Unavailable',
      'sensor.missing Entity not found',
    ]);
    expect(qa(card, '.slice-label.muted')).toHaveLength(2);
    expect(qa(card, 'circle.ring')).toHaveLength(3);
    expect(qa(card, '.ring-label').map((t) => t.textContent)).toEqual(['1,200.0 W', '2,400.0 W', '3,600.0 W']);
    expect(q(card, 'svg.polar-plot')!.getAttribute('aria-label')).toBe(
      'Polar area chart of Oven, EV, TV, Off, sensor.missing',
    );
  });

  it('shades one colour, uses limits without ring values, and hides labels when asked', async () => {
    const card = await mount({
      color_by: 'shades',
      color: 'green',
      scale: 'limits',
      max: 4000,
      show: { name: false, value: false },
    });
    expect(qa(card, 'path.slice')[1].getAttribute('fill')).toContain('color-mix(in srgb, var(--success-color');
    expect(qa(card, '.ring-label')).toHaveLength(0);
    expect(qa(card, '.slice-label')).toHaveLength(0);
  });

  it('colours by band and shows values alone', async () => {
    const card = await mount({
      color_by: 'bands',
      show: { name: false },
      severity: [
        { from: 0, color: 'green' },
        { from: 1000, color: 'red' },
      ],
    });
    const fills = qa(card, 'path.slice').map((s) => s.getAttribute('fill'));
    expect(fills[2]).toContain('--success-color');
    expect(fills[0]).toContain('--error-color');
    expect(q(card, '.slice-label')!.textContent!.trim()).toBe('1,200.0 W');
  });

  it('draws one entity as a disc, and nothing for a zero', async () => {
    const card = await mount({ entities: ['sensor.ev'] });
    expect(q(card, 'path.slice')!.getAttribute('d')!.match(/A/g)).toHaveLength(4);
    document.body.innerHTML = '';
    const none = await mount({ entities: ['sensor.off'] });
    expect(qa(none, 'path.slice')).toHaveLength(0);
    expect(qa(none, '.ring-label')).toHaveLength(0);
  });

  it('opens more-info from a slice', async () => {
    const card = await mount({});
    const fired: string[] = [];
    card.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    const slice = qa(card, 'path.slice')[2] as HTMLElement;
    slice.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    slice.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toEqual(['sensor.tv']);
  });

  it('checks its options', () => {
    const card = document.createElement('chartdeck-card') as Card;
    const set = (extra: Record<string, unknown>) => () =>
      card.setConfig({ type: 'x', style: 'polar_area', entities: ['sensor.a'], ...extra } as CardConfig);
    expect(set({ scale: 'log' })).toThrow(/"scale" must be one of: shared, limits/);
    expect(set({ color_by: 'mood' })).toThrow(/"color_by" must be one of: series, shades, bands/);
    expect(set({ color: 4 })).toThrow(/color/);
    expect(set({ color: '#fa0', color_by: 'shades', scale: 'limits' })).not.toThrow();
  });
});

describe('polar area editor', () => {
  it('writes scale, colouring and the shade colour', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = hass();
    const raw = { type: 'custom:chartdeck-card', style: 'polar_area', entities: ['sensor.ev'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toEqual({ polar_scale: 'shared', polar_color_by: 'series', polar_color: 'primary' });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { polar_scale: 'limits', polar_color_by: 'shades', polar_color: 'purple' } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, scale: 'limits', color_by: 'shades', color: 'purple' });
    const button = ed.shadowRoot!.querySelector('button[data-style="polar_area"]')!;
    expect(button.closest('.styles')!.getAttribute('data-group')).toBe('compare');
    expect(button.textContent).toContain('Polar area');
  });
});
