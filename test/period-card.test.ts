import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { startOf } from '../src/history/timezone';
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

const H = 3_600_000;
const zone = { timeZone: 'Europe/London', firstDay: 1 };

function hassWith() {
  const hass = makeHass(
    { 'sensor.in': ['21', { friendly_name: 'Inside' }] },
    { locale: { language: 'en-GB', time_zone: 'server' }, config: { time_zone: 'Europe/London' } },
  );
  hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
    const start = Date.parse(msg.start_time as string) / 1000;
    // Like the recorder, never return a reading from the future (just after midnight the period's
    // first hour hasn't finished yet).
    const second = Math.min(start + 3600, Math.max(start + 1, Date.now() / 1000 - 60));
    return {
      'sensor.in': [
        { s: '20', lu: start },
        { s: '22', lu: second },
      ],
    };
  }) as HomeAssistant['callWS'];
  return hass;
}

const settle = async (card: Card) => {
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
};

async function mount(config: Partial<CardConfig>, hass = hassWith()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'], ...config } as CardConfig);
  card.hass = hass;
  document.body.appendChild(card);
  await settle(card);
  return card;
}

const q = <T extends Element = HTMLElement>(card: Card, sel: string) => card.shadowRoot!.querySelector<T>(sel);
const startTimes = (hass: HomeAssistant) =>
  (hass.callWS as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
    Date.parse((c[0] as { start_time: string }).start_time),
  );

afterEach(() => {
  document.body.innerHTML = '';
});

describe('period navigation on the card', () => {
  it('has no buttons unless asked for', async () => {
    const card = await mount({ period: { calendar: 'day' } });
    expect(q(card, '.period-nav')).toBeNull();
    expect(q(card, 'path.line')).not.toBeNull();
  });

  it('starts today at midnight in the server time zone, and steps back and forward', async () => {
    const hass = hassWith();
    const card = await mount({ period: { calendar: 'day', navigate: true } }, hass);
    const today = startOf('day', Date.now(), zone);
    expect(startTimes(hass)).toEqual([today]);
    expect(q(card, '.period-label')!.textContent).toBe('Today');
    expect(q<HTMLButtonElement>(card, '.period-next')!.disabled).toBe(true);
    expect(q(card, '.period-return')).toBeNull();

    q(card, '.period-prev')!.click();
    await settle(card);
    expect(q(card, '.period-label')!.textContent).toBe('Yesterday');
    // Yesterday starts before what was loaded: it is loaded.
    expect(startTimes(hass).at(-1)).toBe(startOf('day', today - 1, zone));
    expect(q<HTMLButtonElement>(card, '.period-next')!.disabled).toBe(false);
    expect(q(card, '.period-return')!.textContent!.trim()).toBe('Today');
    expect(q(card, '.period-return')!.getAttribute('aria-label')).toBe('Back to Today');

    // A new state while looking at yesterday is not drawn into it.
    const lines = q(card, 'path.line')!.getAttribute('d');
    card.hass = {
      ...hass,
      states: { 'sensor.in': { ...hass.states['sensor.in'], state: '30', last_updated: new Date().toISOString() } },
    };
    await settle(card);
    expect(q(card, 'path.line')!.getAttribute('d')).toBe(lines);

    q(card, '.period-prev')!.click();
    await settle(card);
    expect(q(card, '.period-label')!.textContent).toMatch(/\w{3} \d+ \w{3}/);
    q(card, '.period-next')!.click();
    await settle(card);
    expect(q(card, '.period-label')!.textContent).toBe('Yesterday');
    q(card, '.period-return')!.click();
    await settle(card);
    expect(q(card, '.period-label')!.textContent).toBe('Today');
    expect(q(card, '.period-return')).toBeNull();
    // Back to the present: loaded again, so it keeps up with live states.
    expect(startTimes(hass).at(-1)).toBe(today);
  });

  it('shows the buttons while loading, and an offset span is not live', async () => {
    const hass = hassWith();
    hass.callWS = vi.fn(() => new Promise(() => {})) as HomeAssistant['callWS'];
    const card = await mount({ period: { last: 24, unit: 'hour', offset: 1, navigate: true } }, hass);
    expect(q(card, '.chart-message')).not.toBeNull();
    expect(q(card, '.period-label')!.textContent).toMatch(/–/);
    const [call] = (hass.callWS as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { start_time: string; end_time: string },
    ];
    expect(Date.parse(call.end_time) - Date.parse(call.start_time)).toBe(24 * H);
    expect(Date.now() - Date.parse(call.end_time)).toBeGreaterThanOrEqual(24 * H - 1000);
  });

  it('carries the last reading only up to now when the span runs to the end of today', async () => {
    const card = await mount({ period: { calendar: 'day', until: 'end' }, curve: 'straight' });
    const d = q(card, 'path.line')!.getAttribute('d')!;
    const xs = [...d.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]));
    const start = startOf('day', Date.now(), zone);
    const nowX = ((Date.now() - start) / (24 * H)) * 1000;
    expect(Math.max(...xs)).toBeLessThan(nowX + 2);
  });

  it('rejects a bad period in the card config', async () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() =>
      card.setConfig({
        type: 'custom:chartdeck-card',
        style: 'line',
        entities: ['sensor.in'],
        period: { calendar: 'decade' },
      } as CardConfig),
    ).toThrow(/period.calendar/);
  });
});

describe('period editor', () => {
  async function editor(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.in'], ...config } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    const names = (form.schema as { name: string; schema?: { name: string }[] }[]).flatMap((f) =>
      f.schema ? f.schema.map((x) => x.name) : [f.name],
    );
    return { ed, form, raw, events, names };
  }

  it('asks how far back for a rolling span, and writes a calendar span with navigation', async () => {
    const { form, raw, events, names } = await editor({});
    // The history fields lead the Chart section; the style's own fields follow.
    expect(names.slice(0, 7)).toEqual([
      'period_calendar',
      'period_last',
      'period_unit',
      'period_offset',
      'period_navigate',
      'source',
      'group_by',
    ]);
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: {
          value: { ...(form.data as object), period_calendar: 'week', period_navigate: true, period_offset: 1 },
        },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, period: { calendar: 'week', navigate: true, offset: 1 } });
  });

  it('asks where a calendar span stops, and drops keys set back to their defaults', async () => {
    const { form, raw, events, names } = await editor({ period: { calendar: 'day', until: 'end' } });
    expect(names).toContain('period_until');
    expect(names).not.toContain('period_last');
    expect(form.data).toMatchObject({ period_calendar: 'day', period_until: 'end' });
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), period_calendar: 'rolling', period_until: 'now' } },
      }),
    );
    expect(events.at(-1)).toEqual({ type: raw.type, style: raw.style, entities: raw.entities });
  });
});
