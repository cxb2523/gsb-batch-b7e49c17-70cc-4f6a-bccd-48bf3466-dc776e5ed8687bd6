import { afterEach, describe, expect, it } from 'vitest';
import {
  angleAt,
  arcBox,
  centerContent,
  customAngles,
  gaugeAngles,
  labelPlacement,
  parseGaugeOptions,
  scaleTicks,
  tickDecimals,
  tickStep,
  union,
} from '../src/gauge';
import { arcPath } from '../src/geometry';
import type { CardConfig } from '../src/types';
import { makeHass } from './helpers/hass';

class StubElement extends HTMLElement {
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
  if (!customElements.get(tag)) customElements.define(tag, class extends StubElement {});
}
await import('../src/chartdeck-card');
await import('../src/editor/chartdeck-card-editor');

const cfg = (c: Partial<CardConfig>) => ({ type: 'custom:chartdeck-card', ...c }) as CardConfig;

describe('gauge options', () => {
  it("defaults to the value in the middle, no tick labels, the style's own angles", () => {
    const o = parseGaugeOptions(cfg({ style: 'ring' }));
    expect(o).toEqual({ center: 'value', centerText: '', tickLabels: false });
    expect(customAngles(o)).toBe(false);
    expect(gaugeAngles([-135, 135], o)).toEqual([-135, 135]);
  });

  it('reads angles, numeric strings too, and fills a missing one from the style', () => {
    const o = parseGaugeOptions(cfg({ style: 'needle', start_angle: '-120' }));
    expect(o.startAngle).toBe(-120);
    expect(customAngles(o)).toBe(true);
    expect(gaugeAngles([-90, 90], o)).toEqual([-120, 90]);
    expect(parseGaugeOptions(cfg({ style: 'arc', start_angle: 0, end_angle: 360 })).endAngle).toBe(360);
  });

  it('rejects bad options with readable errors', () => {
    expect(() => parseGaugeOptions(cfg({ style: 'ring', start_angle: 'up' }))).toThrow(
      '"start_angle" must be a number of degrees from -360 to 360',
    );
    expect(() => parseGaugeOptions(cfg({ style: 'ring', end_angle: 400 }))).toThrow(/end_angle/);
    expect(() => parseGaugeOptions(cfg({ style: 'needle', start_angle: 100 }))).toThrow(
      '"end_angle" (90) must be greater than "start_angle" (100)',
    );
    expect(() => parseGaugeOptions(cfg({ style: 'ring', start_angle: -200, end_angle: 200 }))).toThrow(
      /at most 360 degrees/,
    );
    expect(() => parseGaugeOptions(cfg({ style: 'ring', center: 'middle' }))).toThrow(
      '"center" must be one of: value, band, name, text, none',
    );
    expect(() => parseGaugeOptions(cfg({ style: 'ring', center_text: 5 }))).toThrow('"center_text" must be text');
    expect(() => parseGaugeOptions(cfg({ style: 'needle', tick_labels: 'yes' }))).toThrow(/tick_labels/);
    // Not a gauge: the order of the angles isn't checked (there is no default to fill from).
    expect(() => parseGaugeOptions(cfg({ style: 'bar', start_angle: 100 }))).not.toThrow();
  });

  it('chooses the centre content', () => {
    const e = { name: 'Air', band: { label: 'Good' } };
    const opts = (c: Partial<CardConfig>) => parseGaugeOptions(cfg({ style: 'arc', ...c }));
    expect(centerContent(e, undefined)).toEqual({ kind: 'value' });
    expect(centerContent(e, opts({ center: 'band' }))).toEqual({ kind: 'text', text: 'Good', band: true });
    expect(centerContent({ name: 'Air', band: {} }, opts({ center: 'band' }))).toEqual({ kind: 'value' });
    expect(centerContent(e, opts({ center: 'name' }))).toEqual({ kind: 'text', text: 'Air', band: false });
    expect(centerContent(e, opts({ center: 'text', center_text: 'Hi' }))).toEqual({
      kind: 'text',
      text: 'Hi',
      band: false,
    });
    expect(centerContent(e, opts({ center: 'text' }))).toEqual({ kind: 'none' });
    expect(centerContent(e, opts({ center: 'none' }))).toEqual({ kind: 'none' });
  });
});

describe('gauge geometry', () => {
  it('maps a position along the sweep', () => {
    expect(angleAt([-90, 90], 0.5)).toBe(0);
    expect(angleAt([-120, 60], 1)).toBe(60);
  });

  it('boxes an arc by its ends and the compass points it passes', () => {
    // Top half of a circle at (60, 60), radius 10: from 9 o'clock over the top to 3 o'clock.
    expect(arcBox(60, 60, 10, -90, 90, 0)).toEqual({ x0: 50, y0: 50, x1: 70, y1: 60 });
    const full = arcBox(60, 60, 10, -180, 180, 1);
    expect(full.x0).toBeCloseTo(49);
    expect(full.y1).toBeCloseTo(71);
    expect(union({ x0: 0, y0: 5, x1: 3, y1: 6 }, { x0: 1, y0: -1, x1: 2, y1: 9 })).toEqual({
      x0: 0,
      y0: -1,
      x1: 3,
      y1: 9,
    });
  });

  it('makes round tick values from min to max, ends always labelled', () => {
    expect(tickStep(5)).toBe(1);
    expect(tickStep(100)).toBe(20);
    expect(tickStep(0)).toBe(1);
    expect(scaleTicks(0, 5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(scaleTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(scaleTicks(-2000, 2000)).toEqual([-2000, -1000, 0, 1000, 2000]);
    // 13 and 87 are the scale's ends; 20 and 80 sit too close to them (under 40 % of a step).
    expect(scaleTicks(13, 87)).toEqual([13, 40, 60, 87]);
    // Here 20 and 80 are far enough from the ends to keep.
    expect(scaleTicks(11, 99)).toEqual([11, 20, 40, 60, 80, 99]);
    expect(scaleTicks(5, 5)).toEqual([]);
    expect(tickDecimals(2.5, 2.5)).toBe(1);
    expect(tickDecimals(13.25, 20)).toBe(2);
    expect(tickDecimals(1000, 1000)).toBe(0);
  });

  it('anchors labels outward from the dial', () => {
    expect(labelPlacement(-90)).toEqual({ anchor: 'end', dy: 0.35 });
    expect(labelPlacement(90)).toEqual({ anchor: 'start', dy: 0.35 });
    expect(labelPlacement(0)).toEqual({ anchor: 'middle', dy: 0 });
    expect(labelPlacement(180)).toEqual({ anchor: 'middle', dy: 0.75 });
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: unknown; updateComplete: Promise<boolean> };

async function mount(config: Partial<CardConfig>): Promise<Card> {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig(cfg({ entities: ['sensor.a'], ...config }));
  card.hass = makeHass({
    'sensor.a': ['42', { unit_of_measurement: '%', friendly_name: 'Air' }],
    'sensor.b': 'unavailable',
  });
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}
const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('gauges with extras', () => {
  it('leave the default drawing alone', async () => {
    const ring = await mount({ style: 'ring' });
    expect(q(ring, '.dial')!.classList.contains('fitted')).toBe(false);
    expect(q(ring, '.radial svg')!.getAttribute('viewBox')).toBe('0 0 120 120');
    const needle = await mount({ style: 'needle' });
    expect(q(needle, '.needle-gauge svg')!.getAttribute('viewBox')).toBe('0 0 130 104');
    expect(qa(needle, '.tickmark')).toHaveLength(11);
    expect(qa(needle, '.tick-label')).toHaveLength(0);
  });

  it('draw a ring or arc over custom angles, cropped to the sweep', async () => {
    const card = await mount({ style: 'arc', start_angle: -90, end_angle: 90, target: 50 });
    expect(q(card, '.track')!.getAttribute('d')).toBe(arcPath(60, 60, 46, -90, 90));
    const dial = q(card, '.dial') as HTMLElement;
    expect(dial.classList.contains('fitted')).toBe(true);
    // Top half: the arc's top (60 - 46 - 6.5) to the centre disc's bottom (94).
    expect(q(card, '.radial svg')!.getAttribute('viewBox')).toBe('0 7 120 87');
    expect(dial.getAttribute('style')).toContain('--y0: 7');
    // The target at 50 % is straight up.
    const tick = q(card, '.tick')!;
    expect(tick.getAttribute('x1')).toBe('60.00');
  });

  it('show band label, name, own text or nothing in the middle', async () => {
    const bands = [
      { from: 0, color: 'red', label: 'Poor' },
      { from: 30, color: 'green', label: 'Good' },
    ];
    const band = await mount({ style: 'ring', center: 'band', severity: bands });
    expect(q(band, '.center-text')!.textContent).toBe('Good');
    expect(q(band, '.center-text')!.getAttribute('style')).toContain('--success-color');
    expect(q(band, '.value')).toBeNull();

    const name = await mount({ style: 'arc', center: 'name' });
    expect(q(name, '.center-text')!.textContent).toBe('Air');
    expect(q(name, '.name')).toBeNull();

    const text = await mount({ style: 'ring', center: 'text', center_text: 'Comfy' });
    expect(q(text, '.center-text')!.textContent).toBe('Comfy');

    const none = await mount({ style: 'ring', center: 'none' });
    expect(q(none, '.center-text')).toBeNull();
    expect(q(none, '.value')).toBeNull();
    expect(q(none, '.icon')!.classList.contains('centre')).toBe(true);

    const needle = await mount({ style: 'needle', center: 'band', severity: bands });
    expect(q(needle, '.center-text')!.textContent).toBe('Good');
  });

  it('still show status text for an unavailable entity whatever the centre', async () => {
    const card = await mount({ style: 'ring', center: 'text', center_text: 'Hi', entities: ['sensor.b'] });
    expect(q(card, '.na')!.textContent).toContain('Unavailable');
    expect(q(card, '.center-text')).toBeNull();
    const needle = await mount({
      style: 'needle',
      tick_labels: true,
      start_angle: -135,
      end_angle: 135,
      entities: ['sensor.b', 'sensor.missing'],
    });
    expect(qa(needle, '.na')).toHaveLength(2);
    expect(qa(needle, '.needle')).toHaveLength(0);
  });

  it('label the needle scale, following custom angles, outside the target marker', async () => {
    const card = await mount({ style: 'needle', tick_labels: true, max: 5, target: 3 });
    expect(qa(card, '.tick-label').map((t) => t.textContent)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(qa(card, '.tickmark')).toHaveLength(6);
    const gauge = q(card, '.needle-gauge') as HTMLElement;
    expect(gauge.classList.contains('fitted')).toBe(true);
    expect(gauge.getAttribute('style')).toContain('--needle-start: -90deg');
    // Left end label: at 9 o'clock, past the target marker (R + 17 = 67 from the hub at x 65).
    const first = qa(card, '.tick-label')[0];
    expect(first.getAttribute('x')).toBe('-2.00');
    expect(first.getAttribute('text-anchor')).toBe('end');

    const wide = await mount({ style: 'needle', start_angle: -135, end_angle: 135, show: { target: false } });
    expect(q(wide, '.needle g, g.needle')!.getAttribute('style')).toMatch(/rotate\(-21\.6deg\)/);
    // The value line moves under the arc, which now comes down past the hub.
    expect(Number(q(wide, '.value')!.getAttribute('y'))).toBeGreaterThan(110);
  });
});

describe('gauge editor', () => {
  type Editor = HTMLElement & { setConfig(c: CardConfig): void; hass?: unknown; updateComplete: Promise<boolean> };
  async function editor(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as Editor;
    ed.hass = makeHass({ 'sensor.a': '1' });
    ed.setConfig(cfg(config));
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { ed, events };
  }
  const form = (ed: Editor) => ed.shadowRoot!.querySelector('ha-form[data-section="gauge"]') as StubElement | null;
  const names = (schema: unknown) =>
    (schema as { name: string; schema?: { name: string }[] }[]).flatMap((f) =>
      f.schema ? f.schema.map((x) => x.name) : [f.name],
    );

  it('shows gauge options only for gauge styles, tick labels only on the needle', async () => {
    expect(form((await editor({ style: 'bar' })).ed)).toBeNull();
    const ring = form((await editor({ style: 'ring' })).ed)!;
    expect(names(ring.schema)).toEqual(['start_angle', 'end_angle', 'center', 'ghost']);
    const needle = form((await editor({ style: 'needle', center: 'text' })).ed)!;
    expect(names(needle.schema)).toEqual(['start_angle', 'end_angle', 'center', 'center_text', 'tick_labels', 'ghost']);
    expect(needle.data).toEqual({ center: 'text', tick_labels: false, ghost: 'off' });
  });

  it('writes the options to the card, dropping defaults', async () => {
    const { ed, events } = await editor({ style: 'arc', center: 'band' });
    const f = form(ed)!;
    f.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { start_angle: -90, end_angle: 90, center: 'value' } },
        bubbles: true,
        composed: true,
      }),
    );
    const last = events.at(-1)!;
    expect(last.start_angle).toBe(-90);
    expect(last.end_angle).toBe(90);
    expect('center' in last).toBe(false);
  });
});
