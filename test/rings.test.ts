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
const { rings, ringLayout, ringArc, dialBottom } = await import('../src/styles/rings');

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const hass = () =>
  makeHass({
    'sensor.phone': ['82', { friendly_name: 'Phone', unit_of_measurement: '%' }],
    'sensor.tablet': ['64', { friendly_name: 'Tablet', unit_of_measurement: '%' }],
    'sensor.watch': ['38', { friendly_name: 'Watch', unit_of_measurement: '%' }],
    'sensor.off': ['unavailable', { friendly_name: 'Off' }],
  });

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({
    type: 'custom:chartdeck-card',
    style: 'rings',
    entities: ['sensor.phone', 'sensor.tablet', 'sensor.watch'],
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

describe('ring maths', () => {
  it('nests rings from the outside in, thinner as there are more', () => {
    const three = ringLayout(3);
    expect(three.radii).toHaveLength(3);
    expect(three.radii[0]).toBeCloseTo(48 - three.width / 2);
    expect(three.radii[1]).toBeLessThan(three.radii[0] - three.width);
    expect(ringLayout(1).width).toBe(9);
    expect(ringLayout(8).width).toBeLessThan(three.width);
    expect(ringLayout(0)).toEqual({ radii: [], width: 0 });
  });

  it('fills each ring to its position along the sweep', () => {
    expect(ringArc(0.5, 0, 270)).toEqual({ start: 0, end: 135 });
    expect(ringArc(2, -90, 90)).toEqual({ start: -90, end: 90 });
    expect(ringArc(-1, 10, 20)).toEqual({ start: 10, end: 10 });
  });

  it('crops the drawing to how far down the sweep reaches', () => {
    expect(dialBottom(0, 270)).toBe(100);
    expect(dialBottom(0, 360)).toBe(100);
    expect(dialBottom(-90, 90)).toBe(66);
    expect(dialBottom(-120, 120)).toBeCloseTo(50 + 48 * 0.5 + 6);
    expect(dialBottom(200, 300)).toBe(100);
    expect(dialBottom(-200, -170)).toBe(100);
  });
});

describe('rings', () => {
  it('draws a tappable ring per entity, each on a track, filled to its value', async () => {
    const root = await mount({});
    const rs = root.querySelectorAll('g.entity.ring');
    expect([...rs].map((r) => r.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(rs[0].getAttribute('aria-label')).toBe('Phone, 82 %');
    expect(rs[0].hasAttribute('tabindex')).toBe(false);
    expect(root.querySelector('.part-row')!.getAttribute('tabindex')).toBe('0');
    expect(rs[0].querySelector('.ring-track')!.getAttribute('style')).toBe('--a:-90.000deg;--len:270.000');
    expect(rs[0].querySelector('.seg')!.getAttribute('style')).toContain('--len:221.400');
    expect(rs[0].querySelector('.seg')!.getAttribute('stroke-linecap')).toBe('round');
    expect(root.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toBe('Rings of Phone, Tablet, Watch');
  });

  it('puts the average in the middle by default, or the total', async () => {
    const root = await mount({});
    expect(root.querySelector('.centre-value')!.textContent).toBe('61%');
    expect(root.querySelector('.centre-caption')!.textContent).toBe('Average');
    const total = await mount({ center: 'total' });
    expect(total.querySelector('.centre-value')!.textContent).toBe('184%');
    expect(total.querySelector('.centre-caption')!.textContent).toBe('Total');
    expect((await mount({ center: 'none' })).querySelector('.centre')).toBeNull();
  });

  it('keeps the middle clear however many rings there are', () => {
    for (const n of [1, 3, 12]) {
      const { radii, width } = ringLayout(n);
      expect(radii[n - 1] - width / 2).toBeGreaterThanOrEqual(20);
    }
  });

  it('honours a custom sweep and square ends', async () => {
    const root = await mount({ start_angle: -120, end_angle: 120, rounded_ends: false });
    expect(root.querySelector('.ring-track')!.getAttribute('style')).toBe('--a:-210.000deg;--len:240.000');
    expect(root.querySelector('.seg')!.getAttribute('stroke-linecap')).toBe('butt');
    expect(root.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 100 80.00');
  });

  it('colours by band when asked', async () => {
    const root = await mount({
      color_by: 'bands',
      severity: [
        { from: 0, color: 'red' },
        { from: 50, color: 'green' },
      ],
    });
    const segs = [...root.querySelectorAll('.seg')].map((s) => s.getAttribute('style'));
    expect(segs[0]).toContain('--success-color');
    expect(segs[2]).toContain('--error-color');
  });

  it('draws only the track for unavailable and missing entities', async () => {
    const root = await mount({ entities: ['sensor.phone', 'sensor.off', 'sensor.gone'] });
    const rs = root.querySelectorAll('g.entity.ring');
    expect(rs[1].classList.contains('unavailable')).toBe(true);
    expect(rs[1].querySelector('.seg')).toBeNull();
    expect(rs[2].querySelector('.ring-track')).not.toBeNull();
    expect(root.querySelectorAll('.part-row')[2].textContent).toContain('Entity not found');
    expect(root.querySelector('.centre-value')!.textContent).toBe('82%');
  });

  it('shows no number when nothing is available', async () => {
    expect((await mount({ entities: ['sensor.off'] })).querySelector('.centre')).toBeNull();
  });

  it('opens more-info when a ring is tapped', async () => {
    const root = await mount({});
    const fired = vi.fn();
    root.addEventListener('hass-action', fired);
    const ring = root.querySelector('g.entity.ring[data-index="2"]')!;
    ring.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    ring.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect((fired.mock.calls[0][0] as CustomEvent).detail.config.entity).toBe('sensor.watch');
  });

  it('checks its options', () => {
    const v = (o: Record<string, unknown>) => () => rings.validate!({ type: 'x', ...o } as CardConfig);
    expect(v({ start_angle: -135, end_angle: 135, center: 'total', color_by: 'bands' })).not.toThrow();
    expect(v({ start_angle: 400 })).toThrow('"start_angle" must be a number from -360 to 360');
    expect(v({ start_angle: 300 })).toThrow(/"end_angle" must be after "start_angle"/);
    expect(v({ start_angle: -180, end_angle: 270 })).toThrow(/at most 360/);
    expect(v({ center: 'median' })).toThrow('"center" must be one of: average, total, none');
    expect(v({ color_by: 'shades' })).toThrow('"color_by" must be one of: series, bands');
    expect(v({ rounded_ends: 'no' })).toThrow(/rounded_ends/);
  });

  it('has a thumbnail', () => {
    expect(rings.thumbnail().strings.join('')).toContain('circle');
  });
});

describe('rings editor', () => {
  it('shows its options in the Chart section and writes them back', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'rings', entities: ['sensor.a'] } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    expect(
      ed.shadowRoot!.querySelector('.style[data-style="rings"]')!.closest('.styles')!.getAttribute('data-group'),
    ).toBe('totals');
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as HTMLElement & {
      schema: { name: string; schema?: { name: string }[] }[];
      data: Record<string, unknown>;
    };
    const names = form.schema.flatMap((f) => (f.schema ? f.schema.map((s) => s.name) : [f.name]));
    expect(names).toEqual(['start_angle', 'end_angle', 'center', 'color_by', 'rounded_ends']);
    expect(form.data).toMatchObject({ start_angle: 0, end_angle: 270, center: 'average', rounded_ends: true });
    const changed = vi.fn();
    ed.addEventListener('config-changed', changed);
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...form.data, end_angle: 360 } } }));
    expect((changed.mock.calls[0][0] as CustomEvent).detail.config.end_angle).toBe(360);
  });
});

describe('rings and pie keep their own center option', () => {
  it('is not checked against the gauge centre modes', async () => {
    const { normalizeConfig } = await import('../src/config');
    for (const style of ['rings', 'pie'] as const) {
      expect(() =>
        normalizeConfig({ type: 'x', style, center: 'total', entities: ['sensor.a'] } as never),
      ).not.toThrow();
    }
    expect(() =>
      normalizeConfig({ type: 'x', style: 'ring', center: 'total', entities: ['sensor.a'] } as never),
    ).toThrow(/center/);
  });
});
