import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { groupHistory, groupStatistics, increments, parseGrouping, statisticsQueryFor } from '../src/history/group';
import type { Aggregate } from '../src/history/group';
import { boundaries, startOf } from '../src/history/timezone';
import type { Point } from '../src/history/types';
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

const H = 3_600_000;
const london = { timeZone: 'Europe/London', firstDay: 1 };
const pts = (...pairs: [number, number | null][]): Point[] => pairs.map(([h, v]) => ({ t: h * H, v }));
const values = (points: Point[]) => points.map((p) => (p.v === null ? null : Math.round(p.v * 1000) / 1000));

describe('grouping options', () => {
  it('reads group_by and aggregate, defaulting to the mean, and checks them', () => {
    const raw = (o: Record<string, unknown>) => ({ type: 'x', ...o }) as CardConfig;
    expect(parseGrouping(raw({}))).toBeUndefined();
    expect(parseGrouping(raw({ group_by: 'day' }))).toEqual({ unit: 'day', aggregate: 'mean' });
    expect(parseGrouping(raw({ group_by: 'month', aggregate: 'change' }))).toEqual({
      unit: 'month',
      aggregate: 'change',
    });
    expect(() => parseGrouping(raw({ group_by: 'year' }))).toThrow('"group_by" must be one of: hour, day, week, month');
    expect(() => parseGrouping(raw({ aggregate: 'median' }))).toThrow(/"aggregate" must be one of: mean, sum/);
  });
});

describe('grouping history', () => {
  // Three 10-hour groups; nothing is known after hour 30.
  const bounds = [0, 10 * H, 20 * H, 30 * H];
  const group = (points: Point[], aggregate: Aggregate, until = 30 * H, b = bounds) =>
    values(groupHistory(points, b, aggregate, until));

  it('weights the mean by how long each reading held', () => {
    // 20 for 9 hours, then a one-hour flicker of 30s: about 21, not the 27.5 a plain mean gives.
    const flicker = pts([0, 20], [9, 30], [9.25, 30], [9.5, 30], [9.75, 30], [10, 20]);
    expect(group(flicker, 'mean')).toEqual([21, 20, 20]);
  });

  it('carries the value in from before a group, and leaves out time spent unavailable', () => {
    const points = pts([-5, 10], [5, null], [15, 30]);
    expect(group(points, 'mean')).toEqual([10, 30, 30]);
    expect(group(points, 'min')).toEqual([10, 30, 30]);
    expect(group(points, 'first')).toEqual([10, 30, 30]);
    expect(group(pts([-5, 10], [2, 40], [5, null]), 'max')).toEqual([40, null, null]);
    expect(group(pts([-5, 10], [2, 40], [5, null]), 'last')).toEqual([40, null, null]);
  });

  it('makes a group with no data a gap, not zero', () => {
    const points = pts([12, 5], [14, null], [25, 7]);
    for (const aggregate of ['mean', 'sum', 'min', 'max', 'first', 'last', 'change'] as Aggregate[]) {
      expect(group(points, aggregate)[0]).toBeNull();
    }
    // Groups after now are gaps; the current one counts only up to now.
    expect(group(pts([0, 1], [24, 9]), 'mean', 25 * H)).toEqual([1, 1, 2.6]);
    expect(group(pts([0, 1]), 'last', 5 * H)).toEqual([1, null, null]);
    expect(groupHistory([], bounds, 'mean', 30 * H).map((p) => p.v)).toEqual([null, null, null]);
  });

  it('sums the readings taken in each group, not the one carried in', () => {
    const points: Point[] = [{ t: 0, v: 4, carried: true }, ...pts([1, 2], [3, 3], [12, 1])];
    expect(group(points, 'sum')).toEqual([5, 1, null]);
  });

  it("adds up a meter's rises, counting a reset from zero and ignoring small dips", () => {
    expect(increments(pts([0, 100], [1, 105], [2, null], [3, 104.9], [4, 106], [5, 3], [6, 4]))).toEqual([
      0,
      5,
      null,
      0,
      1,
      3,
      1,
    ]);
    const meter = pts([0, 100], [4, 104], [8, 110], [12, 2], [16, 6], [26, 9]);
    expect(group(meter, 'change')).toEqual([10, 6, 3]);
    // A meter that didn't move all day used nothing: zero, not a gap.
    expect(group(pts([0, 100], [25, 100.5]), 'change')).toEqual([0, 0, 0.5]);
    expect(increments(pts([0, 0], [1, -5]))).toEqual([0, 0]);
  });

  it('gives each group its start and end', () => {
    const out = groupHistory(pts([0, 1]), bounds, 'mean', 30 * H);
    expect(out.map((p) => [p.t / H, p.end! / H])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
  });

  it('groups by calendar day in the time zone, with a 25-hour day', () => {
    const start = Date.UTC(2026, 9, 24, 23);
    const b = boundaries('day', start, start + 3 * 24 * H, london);
    // Sunday 25 October is the day the clocks go back.
    expect(b.slice(1).map((t, i) => (t - b[i]) / H)).toEqual([25, 24, 24]);
    // A steady 1 kW meter read every hour: the long day used 25 kWh.
    const meter = Array.from({ length: 74 }, (_, i) => ({ t: start + i * H - 1, v: i }));
    expect(values(groupHistory(meter, b, 'change', start + 73 * H))).toEqual([25, 24, 24]);
  });
});

describe('grouping statistics', () => {
  const bounds = [0, 3 * H, 6 * H];

  it('combines hourly rows into groups', () => {
    const rows = pts([0, 1], [1, 2], [2, 6], [3, 4], [4, null], [5, 2]);
    expect(values(groupStatistics(rows, bounds, 'mean'))).toEqual([3, 3]);
    expect(values(groupStatistics(rows, bounds, 'sum'))).toEqual([9, 6]);
    expect(values(groupStatistics(rows, bounds, 'change'))).toEqual([9, 6]);
    expect(values(groupStatistics(rows, bounds, 'min'))).toEqual([1, 2]);
    expect(values(groupStatistics(rows, bounds, 'max'))).toEqual([6, 4]);
    expect(values(groupStatistics(rows, bounds, 'last'))).toEqual([6, 2]);
    expect(values(groupStatistics(pts([4, null]), bounds, 'mean'))).toEqual([null, null]);
    expect(values(groupStatistics(rows, bounds, 'max', 2 * H))).toEqual([6, null]);
  });

  it("takes first from the row before the group, and leaves the previous period's row out", () => {
    // State at the end of each hour: the row before a group is the meter at its start.
    const rows: Point[] = [{ t: -H, v: 10 }, ...pts([0, 11], [1, 12], [2, 13], [3, 14])];
    expect(values(groupStatistics(rows, bounds, 'first'))).toEqual([10, 13]);
    const carried: Point[] = [{ t: 0, v: 50, carried: true }, ...pts([0, 2], [1, 4])];
    expect(values(groupStatistics(carried, bounds, 'sum'))).toEqual([6, null]);
    expect(values(groupStatistics(carried, bounds, 'first'))).toEqual([50, null]);
    expect(values(groupStatistics(pts([1, 4]), bounds, 'first'))).toEqual([4, null]);
  });

  it('asks the server for groups when its calendar matches, hours otherwise', () => {
    const day = { unit: 'day', aggregate: 'change' } as const;
    expect(statisticsQueryFor(day, london, 'Europe/London')).toEqual({
      period: 'day',
      types: ['change'],
      value: 'change',
    });
    expect(statisticsQueryFor(day, london, 'America/New_York').period).toBe('hour');
    expect(
      statisticsQueryFor({ unit: 'week', aggregate: 'mean' }, { ...london, firstDay: 7 }, 'Europe/London').period,
    ).toBe('hour');
    expect(statisticsQueryFor({ unit: 'week', aggregate: 'max' }, london, 'Europe/London')).toEqual({
      period: 'week',
      types: ['max'],
      value: 'max',
    });
    expect(statisticsQueryFor({ unit: 'hour', aggregate: 'first' }, london, undefined)).toEqual({
      period: 'hour',
      types: ['state', 'mean'],
      value: 'state',
    });
    expect(statisticsQueryFor({ unit: 'month', aggregate: 'min' }, london, 'Europe/London').types).toEqual(['min']);
    expect(statisticsQueryFor({ unit: 'month', aggregate: 'sum' }, london, 'Europe/London').types).toEqual(['change']);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

describe('grouped line chart', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function hassWith() {
    const hass = makeHass(
      { 'sensor.energy': ['50', { friendly_name: 'Energy' }] },
      { locale: { language: 'en-GB', time_zone: 'server' }, config: { time_zone: 'Europe/London' } },
    );
    hass.callWS = vi.fn(async (msg: Record<string, unknown>) => {
      const start = Date.parse(msg.start_time as string);
      if (msg.type === 'recorder/statistics_during_period') {
        // Daily rows start at local midnight, and the recorder has none for a day not yet begun.
        const day0 = startOf('day', start + 24 * H, london);
        const rows = Array.from({ length: 4 }, (_, i) => ({ start: day0 + i * 24 * H, change: i + 1 }));
        return { 'sensor.energy': rows.filter((r) => r.start <= Date.now()) };
      }
      return {
        'sensor.energy': [
          { s: '1', lu: start / 1000 },
          { s: '3', lu: start / 1000 + 3600 },
        ],
      };
    }) as HomeAssistant['callWS'];
    return hass;
  }

  async function mount(config: Partial<CardConfig>, hass = hassWith()) {
    const card = document.createElement('chartdeck-card') as Card;
    card.setConfig({
      type: 'custom:chartdeck-card',
      style: 'line',
      entities: ['sensor.energy'],
      ...config,
    } as CardConfig);
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    return card;
  }

  it('draws one point per group, from the start of the first group', async () => {
    const hass = hassWith();
    const card = await mount(
      { period: { last: 3, unit: 'day' }, group_by: 'day', aggregate: 'max', labels: true, curve: 'straight' },
      hass,
    );
    const call = (hass.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0] as { start_time: string };
    expect(Date.parse(call.start_time)).toBe(startOf('day', Date.now() - 3 * 24 * H, london));
    const labels = [...card.shadowRoot!.querySelectorAll('.point-label')].map((l) => Number(l.textContent));
    expect(labels).toEqual([3, 3, 3, 3]);
    expect(card.shadowRoot!.querySelector('path.line')!.getAttribute('d')!.match(/[ML]/g)).toHaveLength(4);
  });

  it("asks statistics for the meter's daily change", async () => {
    const hass = hassWith();
    const card = await mount(
      { source: 'statistics', period: { calendar: 'week' }, group_by: 'day', aggregate: 'change' },
      hass,
    );
    expect((hass.callWS as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      period: 'day',
      types: ['change'],
    });
    expect(card.shadowRoot!.querySelector('path.line')).not.toBeNull();
  });

  it('rejects an unknown grouping', () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() =>
      card.setConfig({
        type: 'custom:chartdeck-card',
        style: 'line',
        entities: ['sensor.a'],
        group_by: 'fortnight',
      } as CardConfig),
    ).toThrow(/group_by/);
  });

  it('shows how to combine only once grouping is on, and writes both', async () => {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    const events: CardConfig[] = [];
    ed.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
    ed.hass = makeHass({});
    const names = () => {
      const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
      return (form.schema as { name: string; schema?: { name: string }[] }[]).flatMap((f) =>
        f.schema ? f.schema.map((x) => x.name) : [f.name],
      );
    };
    const raw = { type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.energy'] } as CardConfig;
    ed.setConfig(raw);
    document.body.appendChild(ed);
    await ed.updateComplete;
    expect(names()).toContain('group_by');
    expect(names()).not.toContain('aggregate');
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), group_by: 'day', aggregate: 'change' } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, group_by: 'day', aggregate: 'change' });
    ed.setConfig(events.at(-1)!);
    await ed.updateComplete;
    expect(names()).toContain('aggregate');
  });
});
