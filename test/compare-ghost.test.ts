import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  compareOffsets,
  forwardMapper,
  offsetLabel,
  parseOffset,
  shiftBack,
  shiftForward,
  stopCompare,
  validateCompare,
} from '../src/chart/compare-ghost';
import { STYLES } from '../src/styles/index';
import type { ChartStyleModule } from '../src/styles/index';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

class Stub extends HTMLElement {
  [key: string]: unknown;
}
for (const tag of ['ha-form', 'ha-expansion-panel', 'ha-selector', 'ha-entity-picker', 'ha-icon-picker', 'ha-switch']) {
  if (!customElements.get(tag)) customElements.define(tag, class extends Stub {});
}
await import('../src/editor/chartdeck-card-editor');

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const H = 3_600_000;
const cfg = (raw: Record<string, unknown>) => ({ type: 'custom:chartdeck-card', style: 'line', ...raw }) as CardConfig;
const london = { timeZone: 'Europe/London', firstDay: 1 };

describe('compare maths', () => {
  it('reads offsets by the clock or the calendar', () => {
    expect(parseOffset('1d')).toEqual({ text: '1d', n: 1, unit: 'day' });
    expect(parseOffset(' 12h ')).toEqual({ text: '12h', n: 12, unit: 'hour' });
    expect(parseOffset('2w')).toEqual({ text: '2w', n: 2, unit: 'week' });
    expect(parseOffset('3mo')).toEqual({ text: '3mo', n: 3, unit: 'month' });
    expect(parseOffset('1y')).toEqual({ text: '1y', n: 1, unit: 'year' });
    expect(parseOffset('0d')).toBeUndefined();
    expect(parseOffset('1m')).toBeUndefined();
    expect(parseOffset(7)).toBeUndefined();
  });

  it('moves back keeping the wall-clock time across a clock change', () => {
    // Sunday 26 Oct 2025, the clocks went back in London: a day back from noon is still noon.
    const noon = Date.UTC(2025, 9, 27, 12);
    expect(shiftBack(noon, parseOffset('1d')!, london)).toBe(Date.UTC(2025, 9, 26, 12));
    expect(shiftBack(Date.UTC(2025, 9, 27, 0), parseOffset('1d')!, london)).toBe(Date.UTC(2025, 9, 25, 23));
    expect(shiftBack(noon, parseOffset('6h')!, london)).toBe(noon - 6 * H);
    expect(shiftBack(Date.UTC(2024, 1, 29, 12), parseOffset('1y')!, london)).toBe(Date.UTC(2023, 1, 28, 12));
  });

  it('moves points forward, grouped ones with their ends', () => {
    const utc = { timeZone: 'UTC', firstDay: 1 };
    expect(
      shiftForward(
        [
          { t: 0, v: 1 },
          { t: 10 * H, v: null, end: 11 * H },
        ],
        parseOffset('1d')!,
        utc,
      ),
    ).toEqual([
      { t: 24 * H, v: 1 },
      { t: 34 * H, v: null, end: 35 * H },
    ]);
    expect(shiftForward([{ t: 1234, v: 1 }], parseOffset('6h')!, utc)).toEqual([{ t: 1234 + 6 * H, v: 1 }]);
  });

  describe('across a clock change, each point keeps its wall-clock time', () => {
    const day = parseOffset('1d')!;
    const move = (zone: string, t: number, offset = day) => forwardMapper(offset, { timeZone: zone, firstDay: 1 })(t);
    const sydney = 'Australia/Sydney';

    it('London, clocks forward (Sunday 29 March 2026)', () => {
      // Saturday noon GMT is 12:00 UTC; Sunday noon BST is 11:00 UTC.
      expect(move('Europe/London', Date.UTC(2026, 2, 28, 12))).toBe(Date.UTC(2026, 2, 29, 11));
      // Before the change both days are on GMT.
      expect(move('Europe/London', Date.UTC(2026, 2, 28, 0, 30))).toBe(Date.UTC(2026, 2, 29, 0, 30));
      // 01:30 never happens on Sunday: it lands on the jump (01:00 UTC).
      expect(move('Europe/London', Date.UTC(2026, 2, 28, 1, 30))).toBe(Date.UTC(2026, 2, 29, 1));
      // From the short day itself to Monday: 00:30 GMT Sunday is 00:30 BST Monday (23:30 UTC).
      expect(move('Europe/London', Date.UTC(2026, 2, 29, 0, 30))).toBe(Date.UTC(2026, 2, 29, 23, 30));
      expect(move('Europe/London', Date.UTC(2026, 2, 29, 22))).toBe(Date.UTC(2026, 2, 30, 22));
      // A week back over the change: Sunday 22 March noon GMT to Sunday 29 March noon BST.
      expect(move('Europe/London', Date.UTC(2026, 2, 22, 12), parseOffset('7d')!)).toBe(Date.UTC(2026, 2, 29, 11));
    });

    it('London, clocks back (Sunday 25 October 2026)', () => {
      // Saturday noon BST (11:00 UTC) is Sunday noon GMT (12:00 UTC).
      expect(move('Europe/London', Date.UTC(2026, 9, 24, 11))).toBe(Date.UTC(2026, 9, 25, 12));
      // From the long day to Monday: 00:30 BST Sunday is 00:30 GMT Monday, 18:00 GMT is 18:00.
      expect(move('Europe/London', Date.UTC(2026, 9, 24, 23, 30))).toBe(Date.UTC(2026, 9, 26, 0, 30));
      expect(move('Europe/London', Date.UTC(2026, 9, 25, 18))).toBe(Date.UTC(2026, 9, 26, 18));
      // Sunday's hour from 01:00 happens twice; both land on Monday's one 01:00 to 02:00, and the
      // repeat is left out so the ghost never runs backwards.
      const hourly = Array.from({ length: 6 }, (_, i) => ({ t: Date.UTC(2026, 9, 24, 23) + i * H, v: i }));
      const shifted = shiftForward(hourly, day, london);
      expect(shifted.map((p) => p.v)).toEqual([0, 1, 3, 4, 5]);
      expect(shifted.map((p) => p.t)).toEqual([0, 1, 2, 3, 4].map((h) => Date.UTC(2026, 9, 26, h)));
    });

    it('Sydney, clocks forward (Sunday 4 October 2026) and back (Sunday 5 April 2026)', () => {
      // Forward: Saturday noon AEST (02:00 UTC) is Sunday noon AEDT (01:00 UTC).
      expect(move(sydney, Date.UTC(2026, 9, 3, 2))).toBe(Date.UTC(2026, 9, 4, 1));
      // Before 02:00 both days are on AEST: 01:00 AEST is 15:00 UTC the day before.
      expect(move(sydney, Date.UTC(2026, 9, 2, 15))).toBe(Date.UTC(2026, 9, 3, 15));
      // Back: Saturday noon AEDT (01:00 UTC) is Sunday noon AEST (02:00 UTC).
      expect(move(sydney, Date.UTC(2026, 3, 4, 1))).toBe(Date.UTC(2026, 3, 5, 2));
    });

    it('draws a "yesterday" ghost on a clock-change day at the same wall-clock times', () => {
      // Readings every hour of Saturday 28 March 2026 in London, value = the hour on the clock.
      const sat = Array.from({ length: 24 }, (_, h) => ({ t: Date.UTC(2026, 2, 28, h), v: h }));
      const sun = shiftForward(sat, day, london);
      // Every hour but 01:00 (which Sunday skips) sits on the same hour of Sunday's clock.
      const clock = (t: number) =>
        Number(
          new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(t),
        );
      expect(sun.filter((p) => p.v !== 1).every((p) => clock(p.t) === p.v)).toBe(true);
      expect(sun[sun.length - 1].t).toBe(Date.UTC(2026, 2, 29, 22));
    });
  });

  it('names offsets in words where it can', () => {
    const name = (s: string) => offsetLabel(parseOffset(s)!);
    expect(name('1d')).toBe('Yesterday');
    expect(name('7d')).toBe('Last week');
    expect(name('1w')).toBe('Last week');
    expect(name('1mo')).toBe('Last month');
    expect(name('12mo')).toBe('Last year');
    expect(name('1y')).toBe('Last year');
    expect(name('3d')).toBe('3 days earlier');
    expect(name('6h')).toBe('6 h earlier');
    expect(name('2w')).toBe('2 weeks earlier');
    expect(name('2mo')).toBe('2 months earlier');
    expect(name('2y')).toBe('2 years earlier');
  });

  it('checks its options, and keeps offsets in order without repeats', () => {
    const v = (raw: Record<string, unknown>) => () => validateCompare(cfg(raw));
    expect(v({ compare: ['1d', 'soon'] })).toThrow('"compare" has "soon": use 1d, 7d, 1y, 3mo or 12h');
    expect(v({ compare: ['1d', '2d', '3d', '4d', '5d'] })).toThrow('"compare" can have at most 4 offsets');
    expect(v({ compare_style: 'pink' })).toThrow('"compare_style" must be one of: grey, series');
    expect(v({ compare: '1d', compare_style: 'series' })).not.toThrow();
    expect(compareOffsets(cfg({ compare: ['7d', '1d', '7d', '1w'] })).map((o) => o.text)).toEqual(['7d', '1d', '1w']);
    expect(compareOffsets(cfg({ compare: '1y' })).map((o) => o.text)).toEqual(['1y']);
    expect(compareOffsets(cfg({}))).toEqual([]);
  });
});

const now = Date.now();

/** Each call's history: the value is the hours since the epoch's day began, so a shift shows. */
function hassFor(fail = false) {
  const hass = makeHass({
    'sensor.power': ['300', { friendly_name: 'Power', unit_of_measurement: 'W' }],
    'sensor.other': ['5', { friendly_name: 'Other', unit_of_measurement: 'W' }],
  });
  hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
    if (fail && msg.start_time !== undefined && Date.parse(msg.start_time as string) < now - 25 * H)
      throw new Error('no');
    const start = Date.parse(msg.start_time as string);
    const end = Date.parse(msg.end_time as string);
    const rows = [];
    for (let t = start; t <= end; t += H) rows.push({ s: String(Math.round((now - t) / H)), lu: t / 1000 });
    const out: Record<string, unknown> = {};
    for (const id of msg.entity_ids as string[]) out[id] = rows;
    return out;
  }) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Record<string, unknown>, hass = hassFor()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig(cfg({ entities: ['sensor.power'], ...config }));
  card.hass = hass;
  document.body.appendChild(card);
  for (let i = 0; i < 3; i++) {
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('compare ghosts on the line chart', () => {
  it('draws nothing extra until asked', async () => {
    const card = await mount({});
    expect(qa(card, '.ghost-line')).toHaveLength(0);
    expect(qa(card, '.compare-key')).toHaveLength(0);
    expect(card.hass!.callWS).toHaveBeenCalledTimes(1);
  });

  it('loads each earlier span, draws it grey behind the line, and names it in a key and the tooltip', async () => {
    const card = await mount({ compare: ['1d', '7d'] });
    const calls = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as Record<string, string>);
    expect(calls).toHaveLength(3);
    const starts = calls.map((c) => Math.round((now - Date.parse(c.start_time)) / H)).sort((a, b) => a - b);
    expect(starts).toEqual([24, 48, 192]);
    const ghosts = qa(card, 'path.ghost-line');
    expect(ghosts.map((g) => g.getAttribute('data-offset'))).toEqual(['1d', '7d']);
    expect(ghosts[0].getAttribute('stroke')).toBe('var(--secondary-text-color)');
    expect(ghosts[0].hasAttribute('stroke-dasharray')).toBe(false);
    expect(ghosts[1].getAttribute('stroke-dasharray')).toBe('6 4');
    // Behind: in the plot before the current line.
    const all = qa(card, 'path.ghost-line, path.line');
    expect(all.indexOf(ghosts[1])).toBeLessThan(all.indexOf(qa(card, 'path.line')[0]));
    expect(qa(card, '.compare-item').map((e) => e.textContent!.trim())).toEqual(['Yesterday', 'Last week']);
    const area = card.shadowRoot!.querySelector('.plot-area') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 180 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, bubbles: true }));
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    // Twelve hours ago now read 12; a day earlier it read 36, a week earlier 180.
    expect(rows).toEqual(['Power 12.0 W', 'Yesterday 36.0 W', 'Last week 180.0 W']);
  });

  it("draws the earlier span in the series' shown unit and with its transform", async () => {
    const tip = async (card: Card) => {
      const area = card.shadowRoot!.querySelector('.plot-area') as HTMLElement;
      area.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 180 }) as DOMRect;
      area.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, bubbles: true }));
      await card.updateComplete;
      return qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    };
    const converted = await mount({ compare: '1d', entities: [{ entity: 'sensor.power', unit: 'kW', decimals: 3 }] });
    expect(await tip(converted)).toEqual(['Power 0.012 kW', 'Yesterday 0.036 kW']);
    const total = await mount({ compare: '1d', entities: [{ entity: 'sensor.power', transform: 'cumulative' }] });
    const rows = await tip(total);
    // A running total of W is in Wh, the earlier span's too, not its raw readings in W.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/ Wh$/);
    expect(rows[1]).toMatch(/^Yesterday [\d.,]+ Wh$/);
  });

  it("draws a shown series' own earlier span when the names hide another", async () => {
    localStorage.clear();
    const hass = hassFor();
    const plain = hass.callWS as (msg: Record<string, unknown>) => Promise<Record<string, { s: string; lu: number }[]>>;
    // The other sensor reads 1000 more than the power sensor, so a mix-up shows.
    hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
      const out = await plain(msg);
      if (out['sensor.other'])
        out['sensor.other'] = out['sensor.other'].map((r) => ({ ...r, s: String(Number(r.s) + 1000) }));
      return out;
    }) as HomeAssistant['callWS'];
    const card = await mount({ compare: '1d', legend_toggle: true, entities: ['sensor.power', 'sensor.other'] }, hass);
    const first = card.shadowRoot!.querySelector('button.series-toggle') as HTMLElement;
    first.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 3; i++) {
      await card.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
    }
    const area = card.shadowRoot!.querySelector('.plot-area') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 180 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, bubbles: true }));
    await card.updateComplete;
    const rows = qa(card, '.tooltip-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Other 1,012.0 W', 'Yesterday 1,036.0 W']);
    localStorage.clear();
  });

  it('colours each series its own and names both when there are several, and hides the key with names', async () => {
    const card = await mount({ compare: '1d', compare_style: 'series', entities: ['sensor.power', 'sensor.other'] });
    const ghosts = qa(card, 'path.ghost-line');
    expect(ghosts).toHaveLength(2);
    expect(ghosts[0].getAttribute('stroke')).toContain('--primary-color');
    expect(ghosts[1].getAttribute('stroke')).toContain('--warning-color');
    const area = card.shadowRoot!.querySelector('.plot-area') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 180 }) as DOMRect;
    area.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, bubbles: true }));
    await card.updateComplete;
    const names = qa(card, '.tooltip-name').map((r) => r.textContent!.trim());
    expect(names).toEqual(['Power', 'Other', 'Power, Yesterday', 'Other, Yesterday']);
    const hidden = await mount({ compare: '1d', show: { name: false } });
    expect(qa(hidden, '.compare-key')).toHaveLength(0);
    expect(qa(hidden, 'path.ghost-line')).toHaveLength(1);
  });

  it('groups the earlier span as the chart does, and goes without one that fails to load', async () => {
    const card = await mount({ compare: ['1d'], group_by: 'hour', period: { last: 12, unit: 'hour' } });
    expect(qa(card, 'path.ghost-line')).toHaveLength(1);
    const failing = await mount({ compare: ['1d', '2d'] }, hassFor(true));
    expect(qa(failing, 'path.ghost-line')).toHaveLength(0);
    expect(qa(failing, 'path.line')).toHaveLength(1);
  });

  it('reads statistics for an earlier span, grouped by day', async () => {
    const hass = makeHass({ 'sensor.power': ['3', { friendly_name: 'Power', unit_of_measurement: 'kWh' }] });
    hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
      const start = Date.parse(msg.start_time as string);
      const end = Date.parse(msg.end_time as string);
      const rows = [];
      for (let t = start - (start % H); t < end; t += H) rows.push({ start: t, end: t + H, mean: 2, min: 1, max: 3 });
      return { 'sensor.power': rows };
    }) as HomeAssistant['callWS'];
    const card = await mount(
      { compare: ['7d'], source: 'statistics', group_by: 'day', period: { last: 7, unit: 'day' } },
      hass,
    );
    expect(qa(card, 'path.ghost-line')).toHaveLength(1);
  });

  it('pauses its history when the card leaves the page', async () => {
    const card = await mount({ compare: ['1d'] });
    const line = STYLES.line as ChartStyleModule;
    expect(() => line.disconnect!(card)).not.toThrow();
    expect(() => stopCompare(document.createElement('div'))).not.toThrow();
  });
});

describe('compare editor', () => {
  it('offers the offsets, then their colour once one is set', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const raw = cfg({ entities: ['sensor.a'] });
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    let form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    const compare = (form.schema as { name: string; selector?: { select?: { options: { label: string }[] } } }[]).find(
      (f) => f.name === 'compare',
    )!;
    expect(compare.selector!.select!.options.map((o) => o.label)).toEqual([
      'Yesterday',
      'Last week',
      '28 days earlier',
      'Last year',
    ]);
    expect(JSON.stringify(form.schema)).not.toContain('compare_style');
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), compare: ['1d'] } } }),
    );
    expect(events.at(-1)).toEqual({ ...raw, compare: ['1d'] });
    ed.setConfig(events.at(-1)!);
    await ed.updateComplete;
    form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(JSON.stringify(form.schema)).toContain('compare_style');
    // Clearing the offsets removes the key rather than leaving an empty list.
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), compare: [] } } }),
    );
    expect(events.at(-1)).toEqual(raw);
  });
});
