import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  LEGEND_HOLD_MS,
  configHash,
  isolated,
  legendToggleActive,
  seriesKey,
  toggled,
} from '../src/chart/legend-toggle';
import type { CardConfig, HomeAssistant, NormalizedConfig } from '../src/types';
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

function hassWith() {
  const hass = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
    'sensor.loft': ['40', { friendly_name: 'Loft', unit_of_measurement: '°C' }],
  });
  hass.callWS = vi.fn(async () => ({
    'sensor.in': [
      { s: '19', lu: sec(20 * H) },
      { s: '21', lu: sec(2 * H) },
    ],
    'sensor.out': [
      { s: '5', lu: sec(20 * H) },
      { s: '9', lu: sec(4 * H) },
    ],
    'sensor.loft': [
      { s: '35', lu: sec(20 * H) },
      { s: '40', lu: sec(3 * H) },
    ],
  })) as HomeAssistant['callWS'];
  return hass;
}

const BASE = {
  type: 'custom:chartdeck-card',
  style: 'line',
  entities: ['sensor.in', 'sensor.out', 'sensor.loft'],
  legend_toggle: true,
};

async function settle(card: Card) {
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
}

async function mount(config: Partial<CardConfig> = {}) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ ...BASE, ...config } as CardConfig);
  card.hass = hassWith();
  document.body.appendChild(card);
  await settle(card);
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const toggles = (card: Card) => qa(card, 'button.series-toggle') as HTMLButtonElement[];
const ticks = (card: Card) => qa(card, '.y-axis .axis-label').map((l) => Number(l.textContent));

async function tap(card: Card, el: HTMLElement, init: MouseEventInit = {}) {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  await settle(card);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('legend toggle maths', () => {
  it('flips one key and leaves the set it was given alone', () => {
    const before = new Set(['a']);
    expect([...toggled(before, 'b')]).toEqual(['a', 'b']);
    expect([...toggled(before, 'a')]).toEqual([]);
    expect([...before]).toEqual(['a']);
  });

  it('isolates one key, and brings everything back when it is already alone', () => {
    const keys = ['a', 'b', 'c'];
    expect([...isolated(new Set(), keys, 'b')]).toEqual(['a', 'c']);
    expect([...isolated(new Set(['a', 'c']), keys, 'b')]).toEqual([]);
    // Hidden itself, it is shown alone.
    expect([...isolated(new Set(['b', 'c']), keys, 'b')]).toEqual(['a', 'c']);
  });

  it('keys a series by entity and attribute, and fingerprints a config stably', () => {
    expect(seriesKey({ entityId: 'sensor.a', config: {} as never })).toBe('sensor.a');
    expect(seriesKey({ entityId: 'climate.x', config: { attribute: 'current_temperature' } as never })).toBe(
      'climate.x|current_temperature',
    );
    expect(configHash({ a: 1 })).toBe(configHash({ a: 1 }));
    expect(configHash({ a: 1 })).not.toBe(configHash({ a: 2 }));
    expect(configHash(undefined)).toMatch(/^[0-9a-z]+$/);
  });

  it('is only on while the header can be reached', () => {
    const show = (name: boolean, value: boolean) => ({ show: { name, value } }) as unknown as NormalizedConfig;
    const on = (raw: Record<string, unknown>, config = show(true, true)) =>
      legendToggleActive({ raw: raw as CardConfig, config });
    expect(on({ legend_toggle: true })).toBe(true);
    expect(on({})).toBe(false);
    expect(on({ legend_toggle: true, header: 'hidden' })).toBe(false);
    expect(on({ legend_toggle: true, multiples: true })).toBe(false);
    expect(on({ legend_toggle: true }, show(false, false))).toBe(false);
    expect(on({ legend_toggle: true, header: 'over' }, show(false, true))).toBe(true);
  });
});

describe('legend toggles on a chart', () => {
  it('leaves the header opening entities when the option is off', async () => {
    const card = await mount({ legend_toggle: undefined });
    expect(toggles(card)).toHaveLength(0);
    expect(qa(card, '.series-item.entity')).toHaveLength(3);
  });

  it('hides a tapped series, refits the axis to the rest, and shows it again on a second tap', async () => {
    const card = await mount();
    expect(qa(card, 'path.line')).toHaveLength(3);
    const top = Math.max(...ticks(card));
    expect(top).toBeGreaterThanOrEqual(40);
    const fired: unknown[] = [];
    card.addEventListener('hass-action', (e) => fired.push(e));
    const loft = toggles(card)[2];
    expect(loft.getAttribute('aria-pressed')).toBe('true');
    await tap(card, loft);
    expect(fired).toHaveLength(0);
    expect(qa(card, 'g.series').map((g) => g.getAttribute('data-series'))).toEqual(['0', '1']);
    expect(Math.max(...ticks(card))).toBeLessThan(top);
    const off = toggles(card)[2];
    expect(off.classList.contains('off')).toBe(true);
    expect(off.getAttribute('aria-pressed')).toBe('false');
    // The others keep their own colours.
    const strokes = qa(card, 'path.line').map((p) => p.getAttribute('stroke'));
    expect(strokes[1]).toContain('--warning-color');
    expect(JSON.parse(localStorage.getItem(Object.keys(localStorage)[0]!)!)).toEqual(['sensor.loft']);
    await tap(card, off);
    expect(qa(card, 'path.line')).toHaveLength(3);
    expect(localStorage.length).toBe(0);
  });

  it('shows only a held series, and everything again when it is held a second time', async () => {
    const card = await mount();
    vi.useFakeTimers();
    const hold = async (i: number) => {
      const el = toggles(card)[i];
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      vi.advanceTimersByTime(LEGEND_HOLD_MS + 10);
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.useRealTimers();
      await settle(card);
      vi.useFakeTimers();
    };
    await hold(1);
    expect(qa(card, 'g.series').map((g) => g.getAttribute('data-series'))).toEqual(['1']);
    await hold(1);
    expect(qa(card, 'path.line')).toHaveLength(3);
  });

  it('isolates on shift-click, and a press let go early or dragged away is only a tap or nothing', async () => {
    const card = await mount();
    await tap(card, toggles(card)[0], { shiftKey: true });
    expect(qa(card, 'g.series').map((g) => g.getAttribute('data-series'))).toEqual(['0']);
    const el = toggles(card)[1];
    vi.useFakeTimers();
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    vi.advanceTimersByTime(LEGEND_HOLD_MS * 2);
    vi.useRealTimers();
    await settle(card);
    expect(qa(card, 'path.line')).toHaveLength(1);
    // A right-button press starts nothing; the context menu stays shut.
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }));
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('says so when every series is hidden, keeping the names to bring one back', async () => {
    const card = await mount();
    for (let i = 0; i < 3; i++) await tap(card, toggles(card)[i]);
    expect(q(card, '.chart-message')!.textContent).toBe('Every series is hidden. Tap a name to show it again.');
    expect(toggles(card)).toHaveLength(3);
    await tap(card, toggles(card)[0]);
    expect(qa(card, 'path.line')).toHaveLength(1);
  });

  it('comes back hidden on a new card with the same config, and not with another config', async () => {
    const first = await mount();
    await tap(first, toggles(first)[0]);
    document.body.innerHTML = '';
    const again = await mount();
    expect(qa(again, 'path.line')).toHaveLength(2);
    const other = await mount({ title: 'Other' });
    expect(qa(other, 'path.line')).toHaveLength(3);
  });

  it('keeps working on the card when storage is unavailable or holds junk', async () => {
    localStorage.setItem(`chartdeck-legend-${configHash({ ...BASE })}`, '{"not":"a list"}');
    const junk = await mount();
    expect(qa(junk, 'path.line')).toHaveLength(3);
    document.body.innerHTML = '';
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const card = await mount({ title: 'Blocked' });
    await tap(card, toggles(card)[0]);
    expect(qa(card, 'path.line')).toHaveLength(2);
  });

  it('draws everything when the header is hidden or split into small multiples', async () => {
    localStorage.setItem(`chartdeck-legend-${configHash({ ...BASE, header: 'hidden' })}`, '["sensor.in"]');
    const hidden = await mount({ header: 'hidden' });
    expect(qa(hidden, 'path.line')).toHaveLength(3);
    const multiples = await mount({ multiples: true });
    expect(toggles(multiples)).toHaveLength(0);
  });

  it('toggles on the other charts that share the header, keeping each mark tied to its entity', async () => {
    const stream = await mount({ style: 'streamgraph' });
    await tap(stream, toggles(stream)[0]);
    expect(qa(stream, 'path.stream').map((p) => p.getAttribute('data-index'))).toEqual(
      expect.arrayContaining(['1', '2']),
    );
    expect(qa(stream, 'path.stream[data-index="0"]')).toHaveLength(0);
    for (const style of ['column', 'area', 'range_area', 'histogram', 'combined', 'box']) {
      const card = await mount({ style } as Partial<CardConfig>);
      expect(toggles(card), style).toHaveLength(3);
      await tap(card, toggles(card)[1]);
      expect(qa(card, '.series-toggle.off'), style).toHaveLength(1);
    }
  }, 30_000);

  it('never hides the candles: their name still opens the entity', async () => {
    const card = await mount({ style: 'candlestick' } as Partial<CardConfig>);
    expect(toggles(card)).toHaveLength(2);
    expect(qa(card, '.series-item.entity[data-index="0"]')).toHaveLength(1);
    await tap(card, toggles(card)[0]);
    expect(qa(card, '.series-toggle.off')).toHaveLength(1);
  });

  it('checks the option', () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() => card.setConfig({ ...BASE, legend_toggle: 'yes' } as CardConfig)).toThrow(
      '"legend_toggle" must be true or false',
    );
  });
});

describe('legend toggle editor', () => {
  const names = (schema: unknown[]): string[] =>
    schema.flatMap((s) => {
      const item = s as { name: string; schema?: unknown[] };
      return item.schema ? names(item.schema) : [item.name];
    });

  async function form(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', entities: ['sensor.in'], ...config } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return { events, form: ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub };
  }

  it('sets it from the chart section of every chart drawn with the shared header', async () => {
    for (const style of ['line', 'column', 'area', 'streamgraph', 'candlestick', 'box']) {
      const { form: f } = await form({ style } as Partial<CardConfig>);
      expect(names(f.schema as unknown[]), style).toContain('legend_toggle');
    }
    const { events, form: f } = await form({ style: 'line' });
    expect((f.data as Record<string, unknown>).legend_toggle).toBe(false);
    f.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(f.data as object), legend_toggle: true } } }),
    );
    expect(events.at(-1)!.legend_toggle).toBe(true);
  });

  it('leaves it out of charts with a header of their own', async () => {
    for (const style of ['scatter', 'climate']) {
      const { form: f } = await form({ style } as Partial<CardConfig>);
      expect(names(f.schema as unknown[]), style).not.toContain('legend_toggle');
    }
  });
});
