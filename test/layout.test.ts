import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { chartLayout, validateLayout } from '../src/chart/layout';
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

function hass(pending = false) {
  const h = makeHass({ 'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }] });
  h.callWS = vi.fn(() =>
    pending
      ? new Promise(() => undefined)
      : Promise.resolve({
          'sensor.in': [
            { s: '19', lu: (now - 20 * H) / 1000 },
            { s: '21', lu: (now - 2 * H) / 1000 },
          ],
        }),
  ) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown>, pending = false) {
  const el = document.createElement('chartdeck-card') as Card;
  el.setConfig({ type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'], ...extra } as CardConfig);
  el.hass = hass(pending);
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}
const q = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('chart layout', () => {
  it('reads and checks its options', () => {
    const base = { type: 'x' } as CardConfig;
    expect(chartLayout(base)).toEqual({ compact: false, header: 'above' });
    expect(chartLayout({ ...base, compact: true, header: 'over' })).toEqual({ compact: true, header: 'over' });
    expect(() => validateLayout({ ...base, compact: 'yes' })).toThrow('"compact" must be true or false');
    expect(() => validateLayout({ ...base, header: 'left' })).toThrow('"header" must be one of: above, over, hidden');
  });

  it('puts the header above the chart by default', async () => {
    const el = await mount({});
    const frame = q(el, '.frame')!;
    expect(frame.classList.contains('compact')).toBe(false);
    expect(q(el, '.frame > .series-header')).not.toBeNull();
    expect(q(el, '.header-over')).toBeNull();
  });

  it('lays the header over the plot, where tapping it opens the entity but leaves the tooltip alone', async () => {
    const el = await mount({ header: 'over', compact: true });
    expect(q(el, '.frame')!.classList.contains('compact')).toBe(true);
    expect(q(el, '.frame > .series-header')).toBeNull();
    const item = q(el, '.plot-area .header-over .series-item') as HTMLElement;
    expect(item.textContent!.replace(/\s+/g, ' ').trim()).toBe('Inside 21.0 °C');
    const fired: string[] = [];
    el.addEventListener('hass-action', (e) => fired.push((e as CustomEvent).detail.config.entity));
    item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 500 }));
    item.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await el.updateComplete;
    expect(fired).toEqual(['sensor.in']);
    expect(q(el, '.tooltip')).toBeNull();
  });

  it('keeps an over header above a loading message, and can hide it entirely', async () => {
    const loading = await mount({ header: 'over' }, true);
    expect(q(loading, '.frame > .series-header')).not.toBeNull();
    expect(q(loading, '.chart-message')).not.toBeNull();
    const hidden = await mount({ header: 'hidden' });
    expect(q(hidden, '.series-header')).toBeNull();
    expect(q(hidden, 'path.line')).not.toBeNull();
    // Hiding the names and values the Display way also leaves nothing to lay over the plot.
    const bare = await mount({ header: 'over', show: { name: false, value: false } });
    expect(q(bare, '.header-over')).toBeNull();
  });

  it('is set from the Chart section', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(form.data).toMatchObject({ header: 'above', compact: false });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), header: 'over', compact: true } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, header: 'over', compact: true });
  });
});
