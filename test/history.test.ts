import { afterEach, describe, expect, it, vi } from 'vitest';
import { downsample } from '../src/chart/downsample';
import { runPath, runs } from '../src/chart/paths';
import { extent, linear, padDomain } from '../src/chart/scale';
import {
  key,
  loadHistory,
  loadStatistics,
  parseHistory,
  parseStatistics,
  statisticsPeriod,
  toReading,
} from '../src/history/fetch';
import { DEFAULT_PERIOD, parsePeriod, rollingRange } from '../src/history/period';
import { HistoryStore, trim } from '../src/history/store';
import type { HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

const H = 3_600_000;

describe('period', () => {
  it('defaults to the last 24 hours and checks its keys', () => {
    expect(parsePeriod(undefined)).toEqual(DEFAULT_PERIOD);
    expect(parsePeriod({ last: '7', unit: 'day' } as never)).toEqual({ ...DEFAULT_PERIOD, last: 7, unit: 'day' });
    expect(() => parsePeriod({ last: 0 } as never)).toThrow(/period.last/);
    expect(() => parsePeriod({ unit: 'year' } as never)).toThrow(/period.unit/);
    expect(() => parsePeriod('today' as never)).toThrow(/period/);
  });

  it('rolls back from now, by calendar month for months', () => {
    const now = Date.UTC(2026, 9, 29, 12);
    expect(rollingRange({ last: 24, unit: 'hour' }, now)).toEqual({ start: now - 24 * H, end: now });
    expect(rollingRange({ last: 1, unit: 'week' }, now).start).toBe(now - 7 * 24 * H);
    const month = new Date(rollingRange({ last: 1, unit: 'month' }, now).start);
    expect(month.getMonth()).toBe(new Date(now).getMonth() - 1);
  });
});

describe('fetch', () => {
  it('reads numbers and on / off, and turns everything else into gaps', () => {
    expect(toReading('21.5')).toBe(21.5);
    expect(toReading(3)).toBe(3);
    expect(toReading('unavailable')).toBeNull();
    expect(toReading('on')).toBe(1);
    expect(toReading('off')).toBe(0);
    expect(toReading('')).toBeNull();
    expect(toReading(Infinity)).toBeNull();
  });

  it("parses Home Assistant's compressed history, from the state or an attribute", () => {
    const rows = [
      { s: '20', a: { temp: 1 }, lu: 100 },
      { s: 'unavailable', lu: 101.5 },
      { s: '22', a: { temp: 3 }, lc: 102 },
      { s: '23' },
    ];
    expect(parseHistory(rows)).toEqual([
      { t: 100000, v: 20 },
      { t: 101500, v: null },
      { t: 102000, v: 22 },
    ]);
    expect(parseHistory(rows, 'temp').map((p) => p.v)).toEqual([1, null, 3]);
    expect(parseHistory(undefined)).toEqual([]);
  });

  it('parses statistics: mean, or state for meters, with min and max', () => {
    expect(
      parseStatistics([
        { start: 1000, mean: 5, min: 1, max: 9 },
        { start: '1970-01-01T00:00:02Z', state: 7 },
        { start: 3000, mean: null },
      ]),
    ).toEqual([
      { t: 1000, v: 5, min: 1, max: 9 },
      { t: 2000, v: 7, min: null, max: null },
      { t: 3000, v: null, min: null, max: null },
    ]);
  });

  it('picks a statistics period that fits the span', () => {
    const r = (days: number) => ({ start: 0, end: days * 24 * H });
    expect(statisticsPeriod(r(1))).toBe('5minute');
    expect(statisticsPeriod(r(30))).toBe('hour');
    expect(statisticsPeriod(r(365))).toBe('day');
    expect(statisticsPeriod(r(800))).toBe('month');
  });

  it('asks for plain history compactly and attribute history in full', async () => {
    const callWS = vi.fn(async (msg: Record<string, unknown>) => {
      const ids = msg.entity_ids as string[];
      return Object.fromEntries(ids.map((id) => [id, [{ s: '1', a: { x: 9 }, lu: 1 }]]));
    });
    const hass = { ...makeHass({}), callWS } as HomeAssistant;
    const data = await loadHistory(hass, [{ entity: 'sensor.a' }, { entity: 'climate.b', attribute: 'x' }], {
      start: 0,
      end: 1000,
    });
    expect(callWS).toHaveBeenCalledTimes(2);
    expect(callWS.mock.calls[0][0]).toMatchObject({
      entity_ids: ['sensor.a'],
      minimal_response: true,
      no_attributes: true,
    });
    expect(callWS.mock.calls[1][0]).toMatchObject({ entity_ids: ['climate.b'], no_attributes: false });
    expect(data.get('sensor.a')).toEqual([{ t: 1000, v: 1 }]);
    expect(data.get(key({ entity: 'climate.b', attribute: 'x' }))).toEqual([{ t: 1000, v: 9 }]);
    expect((await loadHistory(makeHass({}), [{ entity: 'sensor.a' }], { start: 0, end: 1 })).size).toBe(0);
  });

  it('asks for statistics with mean, min, max and state', async () => {
    const callWS = vi.fn(async () => ({ 'sensor.a': [{ start: 0, mean: 2 }] }));
    const hass = { ...makeHass({}), callWS } as HomeAssistant;
    const data = await loadStatistics(hass, [{ entity: 'sensor.a' }], { start: 0, end: 30 * 24 * H });
    expect(callWS.mock.calls[0][0]).toMatchObject({
      statistic_ids: ['sensor.a'],
      period: 'hour',
      types: ['mean', 'min', 'max', 'state'],
    });
    expect(data.get('sensor.a')![0].v).toBe(2);
  });
});

describe('store', () => {
  afterEach(() => vi.useRealTimers());

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('keeps the reading from before the start, moved to the start', () => {
    const pts = [
      { t: 0, v: 1 },
      { t: 50, v: 2 },
      { t: 150, v: 3 },
      { t: 300, v: 4 },
    ];
    expect(trim(pts, { start: 100, end: 200 })).toEqual([
      { t: 100, v: 2, carried: true },
      { t: 150, v: 3 },
    ]);
  });

  it('loads once, appends live states, and reloads only when the request changes shape', async () => {
    let calls = 0;
    const hass = makeHass({ 'sensor.a': '1' });
    hass.callWS = vi.fn(async () => {
      calls++;
      return { 'sensor.a': [{ s: '1', lu: 10 }] };
    }) as HomeAssistant['callWS'];
    const changed = vi.fn();
    const store = new HistoryStore(changed);
    const series = [{ entity: 'sensor.a' }];
    expect(store.get(hass, series, { start: 0, end: 20_000 }, 'history').status).toBe('loading');
    await flush();
    expect(changed).toHaveBeenCalled();
    let loaded = store.get(hass, series, { start: 1000, end: 21_000 }, 'history');
    expect(loaded.status).toBe('ready');
    expect(calls).toBe(1);
    const next = {
      ...hass,
      states: {
        ...hass.states,
        'sensor.a': { ...hass.states['sensor.a'], state: '5', last_updated: new Date(15_000).toISOString() },
      },
    };
    loaded = store.get(next, series, { start: 1000, end: 21_000 }, 'history');
    expect(loaded.data.get('sensor.a')!.map((p) => p.v)).toEqual([1, 5]);
    store.get(next, series, { start: 1000, end: 21_000 }, 'history');
    expect(store.get(next, series, { start: 1000, end: 21_000 }, 'history').data.get('sensor.a')).toHaveLength(2);
    store.get(next, [...series, { entity: 'sensor.b' }], { start: 1000, end: 21_000 }, 'history');
    expect(calls).toBe(2);
    store.get(next, [...series, { entity: 'sensor.b' }], { start: -1000, end: 21_000 }, 'history');
    expect(calls).toBe(3);
  });

  it('reports a failed load, and ignores a load that finishes after a newer one started', async () => {
    const hass = makeHass({});
    let fail = true;
    hass.callWS = vi.fn(async () => {
      if (fail) throw { message: 'Unknown command' };
      return {};
    }) as HomeAssistant['callWS'];
    const store = new HistoryStore(() => {});
    store.get(hass, [{ entity: 'sensor.a' }], { start: 0, end: 1 }, 'history');
    await flush();
    const loaded = store.get(hass, [{ entity: 'sensor.a' }], { start: 0, end: 1 }, 'history');
    expect(loaded).toMatchObject({ status: 'error', error: 'Unknown command' });
    expect(hass.callWS).toHaveBeenCalledTimes(1);
    fail = false;
    store.dispose();
    expect(store.get(hass, [{ entity: 'sensor.a' }], { start: 0, end: 1 }, 'history').status).toBe('loading');
  });

  it('keeps its readings through a short absence and reloads after a long one', async () => {
    vi.useFakeTimers();
    const hass = makeHass({});
    hass.callWS = vi.fn(async () => ({ 'sensor.a': [{ s: '1', lu: 1 }] })) as HomeAssistant['callWS'];
    const store = new HistoryStore(() => {});
    const get = () => store.get(hass, [{ entity: 'sensor.a' }], { start: 0, end: 10_000 }, 'history');
    get();
    await vi.advanceTimersByTimeAsync(0);
    store.pause();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(get().status).toBe('ready');
    expect(hass.callWS).toHaveBeenCalledTimes(1);
    store.pause();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(get().status).toBe('loading');
    expect(hass.callWS).toHaveBeenCalledTimes(2);
  });

  it('keeps drawing statistics while they are read again, and through a failed read', async () => {
    vi.useFakeTimers();
    const hass = makeHass({});
    let fail = false;
    let value = 1;
    hass.callWS = vi.fn(async () => {
      if (fail) throw new Error('gone');
      return { 'sensor.a': [{ start: 0, mean: value }] };
    }) as HomeAssistant['callWS'];
    const store = new HistoryStore(() => {});
    const get = () => store.get(hass, [{ entity: 'sensor.a' }], { start: 0, end: H }, 'statistics');
    get();
    await vi.advanceTimersByTimeAsync(0);
    // Back on the page: read again, the old rows still shown meanwhile.
    store.pause();
    value = 2;
    expect(get()).toMatchObject({ status: 'ready' });
    expect(get().data.get('sensor.a')![0].v).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(get().data.get('sensor.a')![0].v).toBe(2);
    // The next period: a read that fails keeps what it had, and tries again a period later.
    fail = true;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(get().status).toBe('ready');
    await vi.advanceTimersByTimeAsync(0);
    expect(get()).toMatchObject({ status: 'ready' });
    expect(get().data.get('sensor.a')![0].v).toBe(2);
    expect(hass.callWS).toHaveBeenCalledTimes(3);
    fail = false;
    value = 3;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    get();
    await vi.advanceTimersByTimeAsync(0);
    expect(get().data.get('sensor.a')![0].v).toBe(3);
    store.dispose();
  });

  it('reloads statistics once a period, on a timer that dispose stops', async () => {
    vi.useFakeTimers();
    const hass = makeHass({});
    hass.callWS = vi.fn(async () => ({ 'sensor.a': [] })) as HomeAssistant['callWS'];
    const changed = vi.fn();
    const store = new HistoryStore(changed);
    store.get(hass, [{ entity: 'sensor.a' }], { start: 0, end: H }, 'statistics');
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(changed).toHaveBeenCalledTimes(2);
    store.get(hass, [{ entity: 'sensor.a' }], { start: 0, end: H }, 'statistics');
    expect(hass.callWS).toHaveBeenCalledTimes(2);
    store.dispose();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe('chart geometry', () => {
  it('finds the extent across series, ignoring gaps, and pads it', () => {
    expect(
      extent([
        [
          { t: 0, v: 2 },
          { t: 1, v: null },
        ],
        [{ t: 0, v: 8, min: -1, max: 9 }],
      ]),
    ).toEqual([-1, 9]);
    expect(extent([[{ t: 0, v: null }]])).toBeUndefined();
    expect(padDomain([0, 10])).toEqual([-0.8, 10.8]);
    expect(padDomain([5, 5])).toEqual([4, 6]);
    expect(linear([0, 10], [100, 0])(5)).toBe(50);
    expect(linear([1, 1], [0, 10])(1)).toBe(0);
  });

  it('splits runs at gaps and draws straight, step, smooth and single points', () => {
    const r = runs([{ v: 1 }, { v: null }, { v: 2 }, { v: 3 }]);
    expect(r.map((x) => x.length)).toEqual([1, 2]);
    expect(
      runPath(
        [
          [0, 0],
          [10, 5],
        ],
        'straight',
      ),
    ).toBe('M0,0L10,5');
    expect(
      runPath(
        [
          [0, 0],
          [10, 5],
        ],
        'step',
      ),
    ).toBe('M0,0H10V5');
    expect(runPath([[3, 4]], 'smooth')).toBe('M3,4h0');
    expect(runPath([], 'smooth')).toBe('');
    expect(
      runPath(
        [
          [0, 0],
          [10, 5],
        ],
        'smooth',
      ),
    ).toBe('M0,0L10,5');
    expect(
      runPath(
        [
          [0, 0],
          [10, 10],
          [20, 0],
        ],
        'smooth',
      ),
    ).toMatch(/^M0,0C/);
  });

  it("smooth curves don't overshoot a flat stretch", () => {
    const d = runPath(
      [
        [0, 10],
        [10, 10],
        [20, 0],
        [30, 0],
      ],
      'smooth',
    );
    const ys = [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0])).filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(10);
  });

  it('thins long runs but keeps every gap and both ends', () => {
    const pts = Array.from({ length: 2000 }, (_, i) => ({ t: i, v: i === 1000 ? null : Math.sin(i / 50) }));
    const out = downsample(pts, 200);
    expect(out.length).toBeLessThan(260);
    expect(out.some((p) => p.v === null)).toBe(true);
    expect(out[0]).toBe(pts[0]);
    expect(out.at(-1)).toBe(pts.at(-1));
    expect(downsample(pts.slice(0, 10), 200)).toHaveLength(10);
  });
});
