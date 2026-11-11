import { afterEach, describe, expect, it, vi } from 'vitest';
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
await import('../src/chartdeck-card');
await import('../src/editor/chartdeck-card-editor');
const { pie, sliceArcs } = await import('../src/styles/pie');

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const hass = () =>
  makeHass({
    'sensor.heat': ['8.4', { friendly_name: 'Heat pump', unit_of_measurement: 'kWh' }],
    'sensor.ev': ['6.2', { friendly_name: 'EV charger', unit_of_measurement: 'kWh' }],
    'sensor.kitchen': ['3.1', { friendly_name: 'Kitchen', unit_of_measurement: 'kWh' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off' }],
    'sensor.neg': ['-2', { friendly_name: 'Export', unit_of_measurement: 'kWh' }],
  });

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'pie',
    entities: ['sensor.heat', 'sensor.ev', 'sensor.kitchen'],
    ...config,
  } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  await card.updateComplete;
  return card.shadowRoot!;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('slice maths', () => {
  it('splits the circle by share, leaving out parts with nothing to draw', () => {
    const [a, b, c] = sliceArcs([1, 0, 3], { shape: 'pie', gap: 2, rounded: false });
    expect(a).toEqual({ start: 0, end: 90 });
    expect(b).toBeUndefined();
    expect(c).toEqual({ start: 90, end: 360 });
  });

  it('takes the gap and round ends off each donut slice', () => {
    const [plain] = sliceArcs([1, 1], { shape: 'donut', gap: 0, rounded: false });
    const [gapped] = sliceArcs([1, 1], { shape: 'donut', gap: 2, rounded: false });
    const [round] = sliceArcs([1, 1], { shape: 'donut', gap: 2, rounded: true });
    expect(plain).toEqual({ start: 0, end: 180 });
    expect(gapped!.start).toBeGreaterThan(0);
    expect(round!.start).toBeGreaterThan(gapped!.start);
    expect(round!.end).toBeLessThan(gapped!.end);
  });

  it('leaves a single donut slice whole unless it is rounded', () => {
    expect(sliceArcs([5], { shape: 'donut', gap: 4, rounded: false })[0]).toEqual({ start: 0, end: 360 });
    expect(sliceArcs([5], { shape: 'donut', gap: 4, rounded: true })[0]!.end).toBeLessThan(360);
  });
});

describe('pie and donut', () => {
  it('draws a tappable slice and legend row per entity, with shares adding up to 100', async () => {
    const root = await mount({});
    const slices = root.querySelectorAll('g.entity.slice');
    expect([...slices].map((s) => s.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(slices[0].hasAttribute('tabindex')).toBe(false);
    expect(root.querySelector('.part-row')!.getAttribute('tabindex')).toBe('0');
    expect(slices[0].getAttribute('aria-label')).toBe('Heat pump, 8.4 kWh');
    const shares = [...root.querySelectorAll('.part-share')].map((s) => parseInt(s.textContent!, 10));
    expect(shares).toEqual([47, 35, 18]);
    expect(root.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toBe(
      'Pie / donut of Heat pump, EV charger, Kitchen',
    );
  });

  it('puts the total and its unit in the middle of a donut', async () => {
    const root = await mount({});
    expect(root.querySelector('.centre-value')!.textContent).toBe('17.7');
    expect(root.querySelector('.centre-caption')!.textContent).toBe('kWh');
    const labelled = await mount({ center_label: 'kWh today' });
    expect(labelled.querySelector('.centre-caption')!.textContent).toBe('kWh today');
  });

  it('draws a pie with separators and no centre', async () => {
    const root = await mount({ shape: 'pie', gap: 3 });
    expect(root.querySelector('.centre')).toBeNull();
    expect(root.querySelectorAll('line.separator')).toHaveLength(3);
    expect(root.querySelector('circle.seg')!.getAttribute('stroke-width')).toBe('48');
    expect((await mount({ shape: 'pie', gap: 0 })).querySelector('line.separator')).toBeNull();
  });

  it('leaves the centre empty when asked', async () => {
    expect((await mount({ center: 'none' })).querySelector('.centre')).toBeNull();
  });

  it('rounds the ends and fills with gradients when asked', async () => {
    const root = await mount({ rounded: true, gradient: true });
    const seg = root.querySelector('circle.seg')!;
    expect(seg.getAttribute('stroke-linecap')).toBe('round');
    expect(seg.getAttribute('style')).toContain('url(#cd-pie-0)');
    expect(root.querySelectorAll('radialGradient')).toHaveLength(3);
  });

  it('colours by band or in shades of one colour', async () => {
    const bands = await mount({ color_by: 'bands', severity: [{ from: 0, color: 'red' }] });
    expect(bands.querySelector('circle.seg')!.getAttribute('style')).toContain('--error-color');
    const shades = await mount({ color_by: 'shades', shade_color: 'green' });
    const styles = [...shades.querySelectorAll('circle.seg')].map((s) => s.getAttribute('style'));
    expect(styles[0]).toContain('stroke:var(--success-color');
    expect(styles[2]).toContain('color-mix(in srgb, var(--success-color, #1fae7a) 35%');
  });

  it('lists unavailable, missing and negative entities without drawing them', async () => {
    const root = await mount({ entities: ['sensor.heat', 'sensor.off', 'sensor.gone', 'sensor.neg'] });
    expect(root.querySelectorAll('g.entity.slice')).toHaveLength(1);
    const rows = root.querySelectorAll('.part-row');
    expect(rows).toHaveLength(4);
    expect(rows[1].classList.contains('unavailable')).toBe(true);
    expect(rows[2].textContent).toContain('Entity not found');
    expect(rows[3].querySelector('.part-share')).toBeNull();
    // The total is what the slices show: a negative part isn't drawn, so isn't counted.
    expect(root.querySelector('.centre-value')!.textContent).toBe('8.4');
  });

  it('draws an empty ring when nothing can be drawn', async () => {
    const root = await mount({ entities: ['sensor.off'] });
    expect(root.querySelector('circle.track')).not.toBeNull();
    expect(root.querySelector('.centre')).toBeNull();
  });

  it('hides shares when asked, and the legend with names and values off', async () => {
    expect((await mount({ show_percent: false })).querySelector('.part-share')).toBeNull();
    const bare = await mount({ show_percent: false, show: { name: false, value: false } });
    expect(bare.querySelector('.parts-legend')).toBeNull();
  });

  it('opens more-info when a slice is tapped', async () => {
    const root = await mount({});
    const fired = vi.fn();
    root.addEventListener('hass-action', fired);
    const slice = root.querySelector('g.entity.slice[data-index="1"]')!;
    slice.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    slice.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(fired).toHaveBeenCalledTimes(1);
    expect((fired.mock.calls[0][0] as CustomEvent).detail.config.entity).toBe('sensor.ev');
  });

  it('checks its options', () => {
    const v = (o: Record<string, unknown>) => () => pie.validate!({ type: 'x', ...o } as CardConfig);
    expect(v({ shape: 'donut', center: 'total', color_by: 'shades', gap: 4, rounded: true })).not.toThrow();
    expect(v({ shape: 'square' })).toThrow('"shape" must be one of: donut, pie');
    expect(v({ center: 'average' })).toThrow('"center" must be one of: total, none');
    expect(v({ color_by: 'rainbow' })).toThrow(/color_by/);
    expect(v({ gap: 20 })).toThrow(/gap/);
    expect(v({ gradient: 1 })).toThrow(/gradient/);
    expect(v({ shade_color: 3 })).toThrow(/shade_color/);
    const card = document.createElement('chartdeck-card') as Card;
    expect(() => card.setConfig({ type: 'x', style: 'pie', shape: 'x' } as CardConfig)).toThrow(/shape/);
  });

  it('has a thumbnail', () => {
    expect(pie.thumbnail().strings.join('')).toContain('circle');
  });
});

describe('pie editor', () => {
  it('shows its options in the Chart section and writes them back', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'pie', entities: ['sensor.a'] } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    expect(
      ed.shadowRoot!.querySelector('.style[data-style="pie"]')!.closest('.styles')!.getAttribute('data-group'),
    ).toBe('totals');
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as HTMLElement & {
      schema: { name: string; schema?: { name: string }[] }[];
      data: Record<string, unknown>;
    };
    const names = form.schema.flatMap((f) => (f.schema ? f.schema.map((s) => s.name) : [f.name]));
    expect(names).toEqual([
      'source',
      'shape',
      'color_by',
      'center',
      'center_label',
      'gap',
      'shade_color',
      'rounded',
      'gradient',
      'show_percent',
    ]);
    expect(form.data).toMatchObject({ shape: 'donut', gap: 2, show_percent: true });
    const changed = vi.fn();
    ed.addEventListener('config-changed', changed);
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, shape: 'pie' } } }));
    expect((changed.mock.calls[0][0] as CustomEvent).detail.config.shape).toBe('pie');
  });
});
