import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { SYNC_EVENT, onSync, syncGroup, syncSend, validateSyncOptions } from '../src/chart/sync';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

describe('sync options', () => {
  it('reads and checks the group name', () => {
    expect(syncGroup({ type: 'x', sync: ' house ' } as CardConfig)).toBe('house');
    expect(syncGroup({ type: 'x' } as CardConfig)).toBeUndefined();
    expect(() => validateSyncOptions({ type: 'x', sync: 'a' } as CardConfig)).not.toThrow();
    expect(() => validateSyncOptions({ type: 'x', sync: 3 } as unknown as CardConfig)).toThrow(
      '"sync" must be a group name',
    );
    expect(() => validateSyncOptions({ type: 'x', sync: ' ' } as CardConfig)).toThrow('"sync" must be a group name');
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
// The chart's span ends at the moment it renders, and the fixture is relative to the moment the
// file loads. On a busy machine seconds pass between the two, so the guides drift off the
// expected position. Pin the clock; only Date is faked, timers stay real.
const now = new Date(2026, 10, 7, 15, 0, 0).getTime();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass() {
  const h = makeHass({
    'sensor.in': ['21', { friendly_name: 'Inside', unit_of_measurement: '°C' }],
    'sensor.out': ['9', { friendly_name: 'Outside', unit_of_measurement: '°C' }],
  });
  h.callWS = vi.fn(async () => ({
    'sensor.in': [
      { s: '19', lu: sec(20 * H) },
      { s: '21', lu: sec(2 * H) },
    ],
    'sensor.out': [
      { s: '5', lu: sec(20 * H) },
      { s: '9', lu: sec(4 * H) },
    ],
  })) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'], ...extra } as CardConfig);
  card.hass = hass();
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel) as HTMLElement | null;

function point(el: Element, type: string, frac: number) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 160, right: 1000, bottom: 160 }) as DOMRect;
  const ev = new MouseEvent(type, { bubbles: true, clientX: frac * 1000 });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(ev);
}

const settle = async (...cards: Card[]) => {
  for (let i = 0; i < 2; i++) for (const c of cards) await c.updateComplete;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('synced charts', () => {
  it('shows the guide on every chart in the group while the pointer is over one', async () => {
    const a = await mount({ sync: 'house', entities: ['sensor.in', 'sensor.out'] });
    const b = await mount({ sync: 'house' });
    const c = await mount({ sync: 'garden' });
    const d = await mount({});
    // 0.6 across is 9.6 h ago, nearer the readings 4 h ago than those 20 h ago. (Half way would
    // be a dead heat between them, settled only by however much real time had passed.)
    point(q(a, '.plot-area')!, 'pointermove', 0.6);
    await settle(a, b, c, d);
    // a snaps to its reading 4 h ago (five sixths across); b's guide is at that same moment.
    expect(q(a, '.crosshair')!.getAttribute('style')).toMatch(/left:83.33%/);
    expect(q(b, '.crosshair')!.getAttribute('style')).toMatch(/left:83.33%/);
    expect(q(b, '.tooltip-value')!.textContent).toBe('21.0 °C');
    expect(q(c, '.crosshair')).toBeNull();
    expect(q(d, '.crosshair')).toBeNull();
    // b's own pointer wins over a's.
    point(q(b, '.plot-area')!, 'pointermove', 0.9);
    await settle(a, b);
    expect(q(b, '.crosshair')!.getAttribute('style')).toMatch(/left:9\d/);
    expect(q(a, '.crosshair')!.getAttribute('style')).toMatch(/left:83.33%/);
    point(q(b, '.plot-area')!, 'pointerleave', 0.9);
    point(q(a, '.plot-area')!, 'pointerleave', 0.6);
    await settle(a, b);
    expect(q(a, '.crosshair')).toBeNull();
    expect(q(b, '.crosshair')).toBeNull();
  });

  it('steps charts with the same period together', async () => {
    const period = { last: 24, unit: 'hour', navigate: true };
    const a = await mount({ sync: 'house', period });
    const b = await mount({ sync: 'house', period });
    const other = await mount({ sync: 'house', period: { last: 7, unit: 'day', navigate: true } });
    const fixed = await mount({ sync: 'house', period: { last: 24, unit: 'hour' } });
    q(a, '.period-prev')!.click();
    await settle(a, b, other, fixed);
    expect(q(a, '.period-return')).not.toBeNull();
    expect(q(b, '.period-return')).not.toBeNull();
    expect(q(other, '.period-return')).toBeNull();
    // b stepping back again moves a with it.
    q(b, '.period-prev')!.click();
    await settle(a, b);
    expect(q(a, '.period-label')!.textContent).toBe(q(b, '.period-label')!.textContent);
    q(a, '.period-return')!.click();
    await settle(a, b);
    expect(q(b, '.period-return')).toBeNull();
  });

  it('passes other messages to a feature that listens, and leaves the group when it should', async () => {
    const a = await mount({ sync: 'house' });
    const b = await mount({ sync: 'house' });
    const heard = vi.fn();
    onSync(b, 'zoom', heard);
    syncSend(a, { type: 'zoom', period: '{}', from: 0.2, to: 0.4 });
    expect(heard).toHaveBeenCalledWith({ type: 'zoom', period: '{}', from: 0.2, to: 0.4 });
    // Messages from other groups, and stray events, are ignored.
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENT, { detail: { group: 'other', source: a, message: { type: 'zoom' } } }),
    );
    expect(heard).toHaveBeenCalledTimes(1);
    // A new group name, then none at all, then leaving the page.
    b.setConfig({
      type: 'custom:chartdeck-card',
      style: 'line',
      entities: ['sensor.in'],
      sync: 'garden',
    } as CardConfig);
    await settle(b);
    point(q(a, '.plot-area')!, 'pointermove', 0.5);
    await settle(a, b);
    expect(q(b, '.crosshair')).toBeNull();
    b.setConfig({ type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'] } as CardConfig);
    await settle(b);
    syncSend(b, { type: 'hover', t: now });
    a.remove();
    point(q(b, '.plot-area')!, 'pointermove', 0.5);
    await settle(b);
    expect(q(b, '.crosshair')).not.toBeNull();
  });
});

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

describe('sync in the editor', () => {
  it('sets and clears the group name', async () => {
    await import('../src/editor/chartdeck-card-editor');
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
    expect(JSON.stringify(form.schema)).toContain('"sync"');
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), sync: 'house' } } }),
    );
    expect(events.at(-1)).toEqual({ ...raw, sync: 'house' });
    ed.setConfig({ ...raw, sync: 'house' });
    await ed.updateComplete;
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), sync: '' } } }));
    expect(events.at(-1)).toEqual(raw);
  });
});
