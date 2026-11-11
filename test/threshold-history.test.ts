import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import { validateAnnotations } from '../src/chart/annotations';
import {
  holdTo,
  historyEntity,
  stepRuns,
  LONG_SPAN,
  stepValues,
  steppedThreshold,
  thresholdHistoryEntities,
  thresholdQuery,
  zoneBands,
  zoneShapes,
} from '../src/chart/threshold-history';
import type { HistoryFrame } from '../src/chart/frame';
import type { PlotScales } from '../src/chart/grid';
import {
  annotationData,
  annotationFromData,
  annotationSchema,
  annotationsEditor,
  withSeverity,
} from '../src/editor/annotations-editor';
import { render } from 'lit';
import type { CardConfig, HomeAssistant } from '../src/types';
import { makeHass } from './helpers/hass';

const check = (annotations: unknown) => () => validateAnnotations({ type: 'x', annotations } as CardConfig);

describe('threshold history options', () => {
  it('accepts history and a zone on a line, and explains bad ones', () => {
    expect(check([{ type: 'line', value: 'sensor.rate', history: true, zone: 'above' }])).not.toThrow();
    expect(check([{ type: 'line', value: 3, history: false, zone: 'below' }])).not.toThrow();
    expect(check([{ type: 'line', value: 'sensor.rate', history: 'yes' }])).toThrow(
      '"annotations[0].history" must be true or false',
    );
    expect(check([{ type: 'line', value: 1, zone: 'left' }])).toThrow(
      '"annotations[0].zone" must be one of: above, below',
    );
    expect(check([{ type: 'band', from: 1, history: true }])).toThrow('are for a line');
    const bands = [
      { from: 0, color: 'green' },
      { from: '20', color: 'amber' },
      { from: 'input_number.peak', color: 'red' },
    ];
    expect(check([{ type: 'line', value: 'sensor.rate', zone: 'above', severity: bands }])).not.toThrow();
    expect(check([{ type: 'line', value: 1, severity: 'green' }])).toThrow(
      '"annotations[0].severity" must be a list of bands',
    );
    expect(check([{ type: 'line', value: 1, severity: [{ from: 'soon', color: 'red' }] }])).toThrow(
      '"annotations[0].severity[0].from" must be a number or an entity id',
    );
    expect(check([{ type: 'line', value: 1, severity: [{ from: 1 }] }])).toThrow(
      '"annotations[0].severity[0].color" is required',
    );
    expect(check([{ type: 'band', from: 1, severity: [] }])).toThrow('"annotations[0].severity" is for a line');
  });

  it("reads a line's own bands, in order, entity starts included", () => {
    const h = makeHass({ 'input_number.peak': '30' });
    expect(
      zoneBands(
        {
          severity: [
            { from: 'input_number.peak', color: 'red' },
            { from: '20', color: 'amber' },
            { from: 0, color: 'green' },
          ],
        },
        h,
      )!.map((b) => [b.from, b.color]),
    ).toEqual([
      [0, 'green'],
      [20, 'amber'],
      [30, 'red'],
    ]);
    expect(zoneBands({}, h)).toBeUndefined();
    expect(zoneBands({ severity: [] }, h)).toBeUndefined();
  });

  it('knows which lines follow an entity', () => {
    expect(historyEntity({ type: 'line', value: ' sensor.rate ', history: true })).toBe('sensor.rate');
    expect(historyEntity({ type: 'line', value: 'sensor.rate' })).toBeUndefined();
    expect(historyEntity({ type: 'line', value: 4, history: true })).toBeUndefined();
    expect(historyEntity({ type: 'band', value: 'sensor.rate', history: true })).toBeUndefined();
    expect(
      thresholdHistoryEntities({
        type: 'x',
        annotations: [
          { type: 'line', value: 'sensor.a', history: true },
          { type: 'line', value: 'sensor.a', history: true, zone: 'above' },
          { type: 'line', value: 'sensor.b' },
        ],
      } as CardConfig),
    ).toEqual(['sensor.a']);
    expect(thresholdHistoryEntities({ type: 'x' } as CardConfig)).toEqual([]);
  });
});

describe('stepped threshold maths', () => {
  it('holds the last value on to the present', () => {
    expect(holdTo([{ t: 1, v: 5 }], 10)).toEqual([
      { t: 1, v: 5 },
      { t: 10, v: 5 },
    ]);
    expect(holdTo([{ t: 10, v: 5 }], 10)).toHaveLength(1);
    expect(holdTo([{ t: 1, v: null }], 10)).toHaveLength(1);
    expect(holdTo([], 10)).toEqual([]);
  });

  it('holds each value up to a gap, then starts again after it', () => {
    expect(
      stepRuns([
        { t: 0, v: 7 },
        { t: 5, v: 24 },
        { t: 8, v: null },
        { t: 9, v: null },
        { t: 12, v: 36 },
      ]),
    ).toEqual([
      [
        { t: 0, v: 7 },
        { t: 5, v: 24 },
        { t: 8, v: 24 },
      ],
      [{ t: 12, v: 36 }],
    ]);
    expect(stepRuns([{ t: 0, v: null }])).toEqual([]);
  });

  it('lists the values inside the range for the axis', () => {
    const steps = new Map([
      [
        'a',
        [
          { t: 0, v: 1 },
          { t: 5, v: 9 },
          { t: 20, v: 99 },
          { t: 6, v: null },
        ],
      ],
    ]);
    expect(stepValues(steps, { start: 0, end: 10 })).toEqual([1, 9]);
  });

  it('draws a stepped path with a zone up to the top or down to the bottom', () => {
    const scales = { x: (t: number) => t * 10, y: (v: number) => 200 - v * 5, domain: [0, 40] } as PlotScales;
    const pts = [
      { t: 0, v: 7 },
      { t: 50, v: 24 },
      { t: 100, v: 24 },
    ];
    const above = steppedThreshold(pts, scales, 'red', true, 'above')!;
    expect(above.top).toBeCloseTo(80 / 200);
    const d = (tpl: unknown) => JSON.stringify((tpl as { values: unknown[] }).values);
    expect(d(above.line)).toContain('M0,165H500V80H1000V80');
    expect(d(above.zone)).toContain('V0H0Z');
    expect(d(steppedThreshold(pts, scales, 'red', true, 'below')!.zone)).toContain('V200H0Z');
    expect(steppedThreshold(pts, scales, 'red', false, undefined)!.zone).toBeUndefined();
    // With bands, each step is shaded in its band's colour; neighbours of one colour share a shape.
    const banded = steppedThreshold(
      [
        { t: 0, v: 7 },
        { t: 20, v: 9 },
        { t: 50, v: 24 },
        { t: 100, v: 24 },
      ],
      scales,
      'red',
      true,
      'below',
      [
        { from: 0, color: 'green' },
        { from: 20, color: 'red' },
      ],
    )!;
    expect(d(banded.zone)).toContain('--success-color');
    expect(d(banded.zone)).toContain('--error-color');
    const shapes = zoneShapes(
      [
        { t: 0, v: 7 },
        { t: 20, v: 9 },
        { t: 50, v: 24 },
        { t: 50, v: 30 },
        { t: 100, v: 30 },
      ],
      scales,
      200,
      (v) => (v < 20 ? 'g' : 'r'),
    );
    expect(shapes).toEqual([
      { color: 'g', d: 'M0,165H200V200H0ZM200,155H500V200H200Z' },
      { color: 'r', d: 'M500,50H1000V200H500Z' },
    ]);
    expect(steppedThreshold([{ t: 0, v: null }], scales, 'red', false, undefined)).toBeUndefined();
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };
const now = Date.now();
const H = 3_600_000;
const sec = (ago: number) => (now - ago) / 1000;

function hass(rateRows?: { s: string; lu: number }[] | 'fail') {
  const h = makeHass({
    'sensor.power': ['12', { friendly_name: 'Power', unit_of_measurement: 'kW' }],
    'sensor.rate': '24',
  });
  h.callWS = vi.fn(async (msg: Record<string, unknown>) => {
    const ids = msg.entity_ids as string[];
    if (ids.includes('sensor.rate')) {
      if (rateRows === 'fail') throw new Error('nope');
      return {
        'sensor.rate': rateRows ?? [
          { s: '7', lu: sec(30 * H) },
          { s: '24', lu: sec(16 * H) },
          { s: '36', lu: sec(8 * H) },
          { s: 'unavailable', lu: sec(6 * H) },
          { s: '24', lu: sec(5 * H) },
        ],
      };
    }
    return {
      'sensor.power': [
        { s: '10', lu: sec(20 * H) },
        { s: '14', lu: sec(10 * H) },
        { s: '12', lu: sec(2 * H) },
      ],
    };
  }) as HomeAssistant['callWS'];
  return h;
}

async function mount(extra: Record<string, unknown>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'line', entities: ['sensor.power'], ...extra } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  for (let i = 0; i < 3; i++) {
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)] as HTMLElement[];
const axisValues = (card: Card) =>
  qa(card, '.y-axis .axis-label').map((e) => Number(e.textContent!.replace(/[^\d.-]/g, '')));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('stepped thresholds on the line chart', () => {
  it('follows the entity through its history, shades a zone and widens the axis', async () => {
    const card = await mount({
      annotations: [{ type: 'line', value: 'sensor.rate', history: true, zone: 'above', label: 'Tariff' }],
    });
    const step = qa(card, 'path.threshold.stepped');
    expect(step).toHaveLength(1);
    expect(step[0].classList.contains('dashed')).toBe(true);
    // Two runs: up to the gap, then from 5 h ago to now.
    expect(step[0].getAttribute('d')!.match(/M/g)).toHaveLength(2);
    expect(qa(card, 'line.threshold')).toHaveLength(0);
    expect(qa(card, '.threshold-zone.above path')).toHaveLength(1);
    expect(qa(card, '.annotation-label.threshold').map((e) => e.textContent!.trim())).toEqual(['Tariff']);
    // The axis reaches 36 (a past step), well above the readings (10 to 14).
    expect(Math.max(...axisValues(card))).toBeGreaterThanOrEqual(36);
    const calls = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].entity_ids);
    expect(calls).toContainEqual(['sensor.rate']);
    card.remove();
  });

  it('sits at the current state while the history loads, fails or is empty', async () => {
    for (const rows of ['fail', []] as const) {
      const card = await mount(
        { annotations: [{ type: 'line', value: 'sensor.rate', history: true, dash: false }] },
        hass(rows),
      );
      expect(qa(card, 'path.threshold.stepped')).toHaveLength(0);
      const line = qa(card, 'line.threshold');
      expect(line).toHaveLength(1);
      expect(line[0].classList.contains('dashed')).toBe(false);
      card.remove();
    }
  });

  it('keeps a fixed line flat', async () => {
    const card = await mount({ annotations: [{ type: 'line', value: 'sensor.rate' }] });
    expect(qa(card, 'path.threshold.stepped')).toHaveLength(0);
    expect(qa(card, 'line.threshold')).toHaveLength(1);
    const calls = (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].entity_ids);
    expect(calls).not.toContainEqual(['sensor.rate']);
  });
});

describe('stepped thresholds in the editor', () => {
  it('shows history and zone on a line, and leaves defaults out of the config', () => {
    const names = (annotationSchema('line', undefined, []) as { name: string }[]).map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['value', 'dash', 'history', 'zone']));
    expect(annotationData({ type: 'line', value: 'sensor.rate' })).toMatchObject({ history: false, zone: 'none' });
    const line = { type: 'line' as const, value: 'sensor.rate' };
    expect(
      annotationFromData({ type: 'line', value: 'sensor.rate', history: true, zone: 'below', dash: true }, line),
    ).toEqual({ type: 'line', value: 'sensor.rate', history: true, zone: 'below' });
    expect(annotationFromData({ type: 'line', value: 'sensor.rate', history: false, zone: 'none' }, line)).toEqual(
      line,
    );
  });
});

describe('where a stepped threshold loads from', () => {
  const zone = { timeZone: 'UTC', firstDay: 1 };
  const frame = (days: number, source: 'history' | 'statistics', group?: HistoryFrame['group']) =>
    ({ range: { start: 0, end: days * 24 * H }, source, zone, group }) as HistoryFrame;

  it('reads history on a history card over a short span, statistics otherwise', () => {
    expect(thresholdQuery(frame(1, 'history'))).toBeUndefined();
    expect(thresholdQuery(frame(7, 'history'))).toBeUndefined();
    expect(LONG_SPAN).toBe(7 * 24 * H);
    // A year on a history card: daily statistics, not a year of raw states.
    expect(thresholdQuery(frame(365, 'history'))).toEqual({ period: 'day', types: ['mean', 'state'], value: 'mean' });
    expect(thresholdQuery(frame(1, 'statistics'))!.period).toBe('5minute');
    expect(thresholdQuery(frame(30, 'statistics'))!.period).toBe('hour');
    // Grouped by day on statistics, in the server's zone: rows of a day, as the card's own.
    expect(thresholdQuery(frame(30, 'statistics', { unit: 'day', aggregate: 'mean' }), 'UTC')!.period).toBe('day');
  });
});

/** A card on statistics: power has statistics; the rate has them only when `rateStats` is set. */
function statsHass(rateStats: boolean) {
  const h = makeHass({
    'sensor.power': ['12', { friendly_name: 'Power', unit_of_measurement: 'kW' }],
    'sensor.rate': '24',
  });
  h.callWS = vi.fn(async (msg: Record<string, unknown>) => {
    if (msg.type === 'recorder/statistics_during_period') {
      const out: Record<string, unknown> = {};
      const ids = msg.statistic_ids as string[];
      const rows = (values: number[]) =>
        values.map((v, i) => ({ start: now - (values.length - i) * 3 * H, mean: v, min: v, max: v }));
      if (ids.includes('sensor.power')) out['sensor.power'] = rows([10, 14, 12, 11, 13, 12, 12, 10]);
      if (ids.includes('sensor.rate') && rateStats) out['sensor.rate'] = rows([7, 7, 24, 36, 36, 24, 24, 7]);
      return out;
    }
    return {
      'sensor.rate': [
        { s: '9', lu: sec(20 * H) },
        { s: '40', lu: sec(10 * H) },
      ],
    };
  }) as HomeAssistant['callWS'];
  return h;
}

describe('stepped thresholds on a statistics card', () => {
  const annotations = [{ type: 'line', value: 'sensor.rate', history: true, zone: 'below' }];
  const sent = (card: Card) =>
    (card.hass!.callWS as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as Record<string, unknown>);

  it('loads the threshold from statistics, like the series', async () => {
    const card = await mount({ source: 'statistics', annotations }, statsHass(true));
    const msgs = sent(card);
    expect(
      msgs.some((m) => m.type === 'recorder/statistics_during_period' && String(m.statistic_ids) === 'sensor.rate'),
    ).toBe(true);
    expect(msgs.some((m) => m.type === 'history/history_during_period')).toBe(false);
    expect(qa(card, 'path.threshold.stepped')).toHaveLength(1);
    // The axis reaches the statistics' highest step, 36.
    expect(Math.max(...axisValues(card))).toBeGreaterThanOrEqual(36);
    card.remove();
  });

  it('falls back to history for an entity without statistics', async () => {
    const card = await mount({ source: 'statistics', annotations }, statsHass(false));
    for (let i = 0; i < 3; i++) {
      await card.updateComplete;
      await new Promise((r) => setTimeout(r, 0));
    }
    const msgs = sent(card);
    expect(msgs.some((m) => m.type === 'history/history_during_period' && String(m.entity_ids) === 'sensor.rate')).toBe(
      true,
    );
    expect(qa(card, 'path.threshold.stepped')).toHaveLength(1);
    expect(Math.max(...axisValues(card))).toBeGreaterThanOrEqual(40);
    card.remove();
  });

  it("colours the zone by the line's own bands", async () => {
    const card = await mount(
      {
        source: 'statistics',
        annotations: [
          {
            ...annotations[0],
            severity: [
              { from: 0, color: 'green' },
              { from: 20, color: 'amber' },
              { from: 30, color: 'red' },
            ],
          },
        ],
      },
      statsHass(true),
    );
    const fills = qa(card, '.threshold-zone.banded path').map((p) => p.getAttribute('fill'));
    expect(fills.some((f) => f!.includes('--success-color'))).toBe(true);
    expect(fills.some((f) => f!.includes('--warning-color'))).toBe(true);
    expect(fills.some((f) => f!.includes('--error-color'))).toBe(true);
    card.remove();
  });
});

describe('zone bands in the editor', () => {
  it('keeps the bands through form edits, and sets or clears them', () => {
    const bands = [{ from: 0, color: 'green' }];
    const line = { type: 'line' as const, value: 'sensor.rate', zone: 'above' as const, severity: bands };
    expect(annotationFromData({ ...annotationData(line), label: 'Tariff' }, line)).toEqual({
      ...line,
      label: 'Tariff',
    });
    expect(annotationFromData({ type: 'band', from: '1' }, line)).not.toHaveProperty('severity');
    expect(withSeverity({ type: 'line', value: 1 }, bands)).toEqual({ type: 'line', value: 1, severity: bands });
    expect(withSeverity(line, undefined)).not.toHaveProperty('severity');
  });

  it('shows the bands editor under a line with a zone and writes its changes', () => {
    const commits: CardConfig[] = [];
    const host = document.createElement('div');
    const config = {
      type: 'custom:chartdeck-card',
      style: 'line',
      annotations: [
        { type: 'line', value: 'sensor.rate', history: true, zone: 'above' },
        { type: 'line', value: 3 },
      ],
    } as CardConfig;
    render(
      annotationsEditor({ config, hass: makeHass({}), commit: (c: CardConfig) => commits.push(c) } as never),
      host,
    );
    const editors = host.querySelectorAll('cd-bands-editor');
    expect(editors).toHaveLength(1);
    const bands = [{ from: 0, color: 'green' }];
    editors[0].dispatchEvent(new CustomEvent('value-changed', { detail: { value: bands } }));
    expect((commits.at(-1)!.annotations as unknown[])[0]).toEqual({
      ...((config.annotations as unknown[])[0] as object),
      severity: bands,
    });
  });
});

describe('stepped thresholds in another unit', () => {
  it("converts the entity's history to the chart's unit, as a flat line does", async () => {
    const h = hass([
      { s: '7000', lu: sec(30 * H) },
      { s: '36000', lu: sec(8 * H) },
      { s: '24000', lu: sec(5 * H) },
    ]);
    h.states['sensor.rate'] = {
      ...h.states['sensor.rate'],
      state: '24000',
      attributes: { unit_of_measurement: 'W' },
    } as HomeAssistant['states'][string];
    const card = await mount({ annotations: [{ type: 'line', value: 'sensor.rate', history: true }] }, h);
    expect(qa(card, 'path.threshold.stepped')).toHaveLength(1);
    // W steps on a kW chart: the axis reaches 36 kW, not 36 000.
    const top = Math.max(...axisValues(card));
    expect(top).toBeGreaterThanOrEqual(36);
    expect(top).toBeLessThan(100);
    card.remove();
  });
});
