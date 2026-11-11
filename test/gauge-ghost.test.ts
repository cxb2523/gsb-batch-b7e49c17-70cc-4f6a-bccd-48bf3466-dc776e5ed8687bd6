import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseGaugeOptions } from '../src/gauge';
import {
  GHOST_MS,
  clearGhosts,
  ghostFor,
  ghostMarks,
  ghostPositions,
  ghostTitle,
  historyGhost,
  loadGhost,
  statisticsGhost,
} from '../src/gauge-ghost';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';
import { H, mountCard, mountEditor, q, qa, stubEditorElements } from './helpers/chart';

stubEditorElements();
await import('../src/chartdeck-card');

const NOW = Date.UTC(2026, 10, 8, 12);

/** A hass whose recorder answers with `history` (compressed rows) and `statistics` rows. */
function recorder(
  history: Record<string, { s: string; lu: number; a?: Record<string, unknown> }[]>,
  statistics: Record<string, Record<string, unknown>[]> = {},
  fail = false,
) {
  const hass = makeHass({
    'sensor.hum': ['58', { unit_of_measurement: '%', friendly_name: 'Humidity' }],
    'sensor.fan': ['12', { speed: 40 }],
  });
  hass.callWS = vi.fn(async (msg: { type: string }) => {
    if (fail) throw new Error('boom');
    return msg.type === 'recorder/statistics_during_period' ? statistics : history;
  }) as HomeAssistant['callWS'];
  return hass;
}

const rows = (values: [number, string][]) => values.map(([hAgo, s]) => ({ s, lu: (NOW - hAgo * H) / 1000 }));

describe('ghost maths', () => {
  it('weights the mean by how long each reading held, and finds the extremes', () => {
    const range = { start: 0, end: 4 };
    // 10 for one unit, 30 for three: mean 25, not the plain 20.
    expect(
      historyGhost(
        [
          { t: 0, v: 10 },
          { t: 1, v: 30 },
        ],
        range,
      ),
    ).toEqual({ min: 10, max: 30, mean: 25 });
  });

  it('skips gaps, clips a reading from before the range, and is null with nothing', () => {
    const range = { start: 10, end: 20 };
    const points = [
      { t: 0, v: 50, carried: true },
      { t: 15, v: null },
      { t: 18, v: 0 },
    ];
    // 50 held 10..15 (5 units), the gap 15..18 counts for nothing, 0 held 18..20.
    const ghost = historyGhost(points, range)!;
    expect(ghost.min).toBe(0);
    expect(ghost.max).toBe(50);
    expect(ghost.mean).toBeCloseTo(250 / 7);
    expect(historyGhost([{ t: 1, v: null }], range)).toBeNull();
    expect(historyGhost([], range)).toBeNull();
  });

  it('falls back to a plain mean when every reading lands on the end of the range', () => {
    expect(historyGhost([{ t: 20, v: 4 }], { start: 10, end: 20 })).toEqual({ min: 4, max: 4, mean: 4 });
  });

  it('takes the lowest low, highest high and mean of the means from statistics', () => {
    expect(
      statisticsGhost([
        { t: 0, v: 10, min: 5, max: 12 },
        { t: 1, v: 20, min: null, max: 25 },
        { t: 2, v: null },
      ]),
    ).toEqual({ min: 5, max: 25, mean: 15 });
    expect(statisticsGhost([{ t: 0, v: null }])).toBeNull();
  });

  it('places the ghost on the gauge, clamped to its ends', () => {
    expect(ghostPositions({ min: 22, max: 68, mean: 46 }, 0, 100)).toEqual({ from: 0.22, to: 0.68, mean: 0.46 });
    expect(ghostPositions({ min: -10, max: 150, mean: 50 }, 0, 100)).toEqual({ from: 0, to: 1, mean: 0.5 });
    expect(ghostPositions({ min: 1, max: 2, mean: 1 }, 5, 5)).toEqual({ from: 0, to: 0, mean: 0 });
  });

  it('describes itself in words', () => {
    expect(ghostTitle({ min: 22, max: 68, mean: 46.4 }, '24h', 0, '%', undefined)).toBe(
      'Last 24 hours: 22 % to 68 %, mean 46 %',
    );
    expect(ghostTitle({ min: 1, max: 2, mean: 1.5 }, '7d', 1, '', undefined)).toBe('Last 7 days: 1.0 to 2.0, mean 1.5');
  });
});

describe('ghost loading', () => {
  beforeEach(() => clearGhosts());

  it('reads the last 24 hours from history', async () => {
    const hass = recorder({
      'sensor.hum': rows([
        [24, '40'],
        [12, '60'],
      ]),
    });
    const ghost = await loadGhost(hass, 'sensor.hum', undefined, '24h', NOW);
    expect(ghost).toEqual({ min: 40, max: 60, mean: 50 });
    const call = (hass.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.type).toBe('history/history_during_period');
    expect(Date.parse(call.start_time)).toBe(NOW - GHOST_MS['24h']);
  });

  it('reads 7 days from hourly statistics, or history when there are none', async () => {
    const stats = recorder({}, { 'sensor.hum': [{ start: NOW - H, mean: 50, min: 30, max: 70 }] });
    expect(await loadGhost(stats, 'sensor.hum', undefined, '7d', NOW)).toEqual({ min: 30, max: 70, mean: 50 });
    const call = (stats.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toMatchObject({ type: 'recorder/statistics_during_period', period: 'hour' });

    const none = recorder({ 'sensor.hum': rows([[100, '45']]) }, {});
    expect(await loadGhost(none, 'sensor.hum', undefined, '7d', NOW)).toEqual({ min: 45, max: 45, mean: 45 });
    expect((none.callWS as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].type)).toEqual([
      'recorder/statistics_during_period',
      'history/history_during_period',
    ]);
  });

  it('reads an attribute from history, even for 7 days', async () => {
    const hass = recorder({
      'sensor.fan': [
        { s: '12', lu: (NOW - 2 * H) / 1000, a: { speed: 20 } },
        { s: '12', lu: (NOW - H) / 1000, a: { speed: 80 } },
      ],
    });
    const ghost = await loadGhost(hass, 'sensor.fan', 'speed', '7d', NOW);
    expect(ghost).toMatchObject({ min: 20, max: 80 });
    expect((hass.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0].type).toBe('history/history_during_period');
  });

  it('loads once, redraws when it lands, and reloads only once stale', async () => {
    const hass = recorder({
      'sensor.hum': rows([
        [3, '40'],
        [1, '60'],
      ]),
    });
    const redraw = vi.fn();
    expect(ghostFor(hass, 'sensor.hum', undefined, '24h', redraw, NOW)).toBeNull();
    expect(ghostFor(hass, 'sensor.hum', undefined, '24h', redraw, NOW)).toBeNull();
    await vi.waitFor(() => expect(redraw).toHaveBeenCalledTimes(1));
    expect(ghostFor(hass, 'sensor.hum', undefined, '24h', redraw, NOW + 60_000)).toMatchObject({ min: 40, max: 60 });
    expect(hass.callWS).toHaveBeenCalledTimes(1);
    // Six minutes on, the next draw asks again but keeps showing the old one meanwhile.
    expect(ghostFor(hass, 'sensor.hum', undefined, '24h', redraw, NOW + 6 * 60_000)).toMatchObject({ min: 40 });
    expect(hass.callWS).toHaveBeenCalledTimes(2);
  });

  it('asks for nothing when off, without a recorder, or for a missing entity', () => {
    const hass = recorder({});
    expect(ghostFor(hass, 'sensor.hum', undefined, 'off', undefined)).toBeNull();
    expect(ghostFor(hass, 'sensor.hum', undefined, undefined, undefined)).toBeNull();
    expect(ghostFor(hass, 'sensor.gone', undefined, '24h', undefined)).toBeNull();
    expect(ghostFor(makeHass({ 'sensor.hum': '1' }), 'sensor.hum', undefined, '24h', undefined)).toBeNull();
    expect(hass.callWS).not.toHaveBeenCalled();
  });

  it('keeps what it had when a reload fails', async () => {
    const hass = recorder({}, {}, true);
    const redraw = vi.fn();
    ghostFor(hass, 'sensor.hum', undefined, '24h', redraw, NOW);
    await vi.waitFor(() => expect(redraw).toHaveBeenCalled());
    expect(ghostFor(hass, 'sensor.hum', undefined, '24h', redraw, NOW)).toBeNull();
  });

  it('draws nothing without a ghost', () => {
    const g = { cx: 0, cy: 0, r: 10, width: 2, tick: [8, 12] as [number, number], at: (t: number) => t * 180 };
    const e = { min: 0, max: 100, decimals: 0, unit: '' };
    expect(ghostMarks(null, e, '24h', g, undefined)).toBe(ghostMarks(null, e, 'off', g, undefined));
    expect(ghostMarks({ min: 1, max: 2, mean: 1 }, e, 'off', g, undefined)).toBe(
      ghostMarks(null, e, '24h', g, undefined),
    );
  });
});

describe('ghost option', () => {
  const cfg = (c: Partial<CardConfig>) => ({ type: 'custom:chartdeck-card', ...c }) as CardConfig;

  it('is off unless set, and only takes off, 24h or 7d', () => {
    expect(parseGaugeOptions(cfg({ style: 'needle' })).ghost).toBeUndefined();
    expect(parseGaugeOptions(cfg({ style: 'needle', ghost: 'off' })).ghost).toBeUndefined();
    expect(parseGaugeOptions(cfg({ style: 'needle', ghost: '7d' })).ghost).toBe('7d');
    expect(() => parseGaugeOptions(cfg({ style: 'arc', ghost: '1h' }))).toThrow('"ghost" must be one of: off, 24h, 7d');
  });
});

describe('ghost on the gauges', () => {
  beforeEach(() => {
    clearGhosts();
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const history = {
    'sensor.hum': rows([
      [20, '22'],
      [10, '68'],
      [5, '46'],
    ]),
  };

  // 22 for 10 h, 68 for 5 h, 46 for 5 h: a time-weighted mean of 39.5.
  it.each(['needle', 'arc', 'ring'])('draws the range and mean tick on the %s gauge', async (style) => {
    const hass = recorder(history);
    const card = await mountCard({ style: style as CardConfig['style'], ghost: '24h', entities: ['sensor.hum'] }, hass);
    await vi.waitFor(() => expect(q(card, '.ghost')).not.toBeNull());
    await (card as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(q(card, '.ghost-band')!.getAttribute('d')).toMatch(/^M/);
    expect(q(card, '.ghost-mean')).not.toBeNull();
    expect(q(card, '.ghost title')!.textContent).toBe('Last 24 hours: 22 % to 68 %, mean 40 %');
  });

  it('draws nothing when off, and shares one load between cards', async () => {
    const hass = recorder(history);
    const off = await mountCard({ style: 'needle', entities: ['sensor.hum'] }, hass);
    expect(qa(off, '.ghost')).toHaveLength(0);
    expect(hass.callWS).not.toHaveBeenCalled();
    const a = await mountCard({ style: 'needle', ghost: '24h', entities: ['sensor.hum'] }, hass);
    const b = await mountCard({ style: 'arc', ghost: '24h', entities: ['sensor.hum'] }, hass);
    await vi.waitFor(() => expect(q(a, '.ghost')).not.toBeNull());
    await vi.waitFor(() => expect(q(b, '.ghost')).not.toBeNull());
    expect(hass.callWS).toHaveBeenCalledTimes(1);
  });

  it('widens a steady reading to a visible sliver', async () => {
    const hass = recorder({ 'sensor.hum': rows([[20, '50']]) });
    const card = await mountCard({ style: 'needle', ghost: '24h', entities: ['sensor.hum'] }, hass);
    await vi.waitFor(() => expect(q(card, '.ghost-band')).not.toBeNull());
    const d = q(card, '.ghost-band')!.getAttribute('d')!;
    const [sx, , ex] = d
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number)
      .filter((_, i) => i === 0 || i === 1 || i === 7);
    expect(ex).toBeGreaterThan(sx);
  });
});

describe('ghost in the editor', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sets the span from the gauge options and drops the default', async () => {
    const { ed, events } = await mountEditor(
      { type: 'custom:chartdeck-card', style: 'needle', ghost: '7d', entities: ['sensor.hum'] },
      makeHass({ 'sensor.hum': '1' }),
    );
    const form = ed.shadowRoot!.querySelector('ha-form[data-section="gauge"]') as HTMLElement & {
      schema: { name: string; selector?: { select?: { options: { value: string; label: string }[] } } }[];
      data: Record<string, unknown>;
    };
    const field = form.schema.find((f) => f.name === 'ghost')!;
    expect(field.selector!.select!.options.map((o) => o.label)).toEqual(['Off', 'Last 24 hours', 'Last 7 days']);
    expect(form.data.ghost).toBe('7d');
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...form.data, ghost: 'off' } }, bubbles: true }),
    );
    expect('ghost' in events.at(-1)!).toBe(false);
  });
});
