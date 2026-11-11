import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/chartdeck-card';
import {
  MIN_NEIGHBOURS,
  noiseFloor,
  anomaliesOf,
  anomalyOptions,
  bandPath,
  parseWindow,
  pickLabels,
  rollingStats,
  validateAnomalies,
  zText,
} from '../src/chart/anomaly';
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

const M = 60_000;
const H = 3_600_000;
const cfg = (raw: Record<string, unknown>) => ({ type: 'custom:chartdeck-card', style: 'line', ...raw }) as CardConfig;

/** A steady wobble around 50 every 10 minutes, with a spike and a dip. */
function series(n = 60, spikes: Record<number, number> = { 20: 90, 40: 10 }) {
  return Array.from({ length: n }, (_, i) => ({ t: i * 10 * M, v: spikes[i] ?? 50 + (i % 2 ? 1 : -1) }));
}

describe('anomaly maths', () => {
  it('reads windows as times, or minutes for a bare number', () => {
    expect(parseWindow('30min')).toBe(30 * M);
    expect(parseWindow(' 2h ')).toBe(2 * H);
    expect(parseWindow('1.5d')).toBe(36 * H);
    expect(parseWindow('1w')).toBe(7 * 24 * H);
    expect(parseWindow('45s')).toBe(45_000);
    expect(parseWindow(90)).toBe(90 * M);
    expect(parseWindow(0)).toBeUndefined();
    expect(parseWindow('0h')).toBeUndefined();
    expect(parseWindow('2 hours')).toBeUndefined();
    expect(parseWindow(true)).toBeUndefined();
  });

  it('works out each reading against its neighbours, leaving itself out', () => {
    const stats = rollingStats(series(), 2 * H);
    expect(stats).toHaveLength(60);
    // 2 h window: six neighbours either side, twelve in all (fewer at the edges).
    const spike = stats[20]!;
    expect(spike.mid).toBeCloseTo(50, 5);
    // Every neighbour is 1 from the median (a deviation of 1.4826); the series' step noise is a
    // floor under that, and the larger counts.
    const sd = Math.max(1.4826, noiseFloor(series()));
    expect(noiseFloor(series())).toBeGreaterThan(0);
    expect(spike.sd).toBeCloseTo(sd, 5);
    expect(spike.z).toBeCloseTo(40 / sd, 5);
    expect(stats[40]!.z).toBeCloseTo(-40 / sd, 5);
    // A steady slope has no noise; nor have two readings.
    expect(noiseFloor([0, 1, 2, 3, 4].map((v) => ({ v })))).toBe(0);
    expect(noiseFloor([{ v: 1 }, { v: 2 }])).toBe(0);
    const calm = stats[30]!;
    expect(Math.abs(calm.z)).toBeLessThan(2);
    const found = anomaliesOf(stats, 2);
    expect(found.map((a) => a.t)).toEqual([20 * 10 * M, 40 * 10 * M]);
  });

  it('still finds a spike several readings wide (the neighbours it sits among do not hide it)', () => {
    const stats = rollingStats(series(60, { 20: 90, 21: 92, 22: 91 }), 2 * H);
    const found = anomaliesOf(stats, 3).map((a) => a.t / (10 * M));
    expect(found.sort((a, b) => a - b)).toEqual([20, 21, 22]);
  });

  it('falls back to the mean deviation when most neighbours share one value', () => {
    const mostlyZero = Array.from({ length: 13 }, (_, i) => ({ t: i * M, v: i === 6 ? 50 : i % 4 === 0 ? 1 : 0 }));
    const s6 = rollingStats(mostlyZero, H)[6]!;
    expect(s6.mid).toBe(0);
    expect(s6.sd).toBeGreaterThan(0);
    expect(Number.isFinite(s6.z)).toBe(true);
    expect(s6.z).toBeGreaterThan(10);
  });

  it('skips gaps and carried values, and readings with too few neighbours', () => {
    const pts = [
      { t: 0, v: 5, carried: true },
      { t: M, v: null },
      ...Array.from({ length: MIN_NEIGHBOURS + 1 }, (_, i) => ({ t: (i + 2) * M, v: i })),
    ];
    const stats = rollingStats(pts, 3 * M);
    expect(stats).toHaveLength(pts.length);
    expect(stats.every((s) => s === null)).toBe(true);
    // With room: the gap and carried value stay empty, as do the two readings at either end.
    const wide = rollingStats(pts, H);
    expect(wide.map((s) => s !== null)).toEqual([false, false, false, false, true, true, false, false]);
    expect(rollingStats([], H)).toEqual([]);
  });

  it('marks any change in a flat stretch as infinitely far out, and none for no change', () => {
    const flat = Array.from({ length: 10 }, (_, i) => ({ t: i * M, v: i === 5 ? 3 : 2 }));
    const stats = rollingStats(flat, H);
    expect(stats[5]!.z).toBe(Infinity);
    expect(stats[5]!.sd).toBe(0);
    expect(Math.abs(stats[2]!.z)).toBeLessThan(1);
    const still = rollingStats(
      flat.map((p) => ({ ...p, v: 2 })),
      H,
    );
    expect(still[4]!.z).toBe(0);
    const big = Array.from({ length: 10 }, (_, i) => ({ t: i * M, v: 1e9 + (i === 4 ? -10 : 0) }));
    expect(rollingStats(big, H)[4]!.z).toBe(-Infinity);
  });

  it('labels z-scores with a sign, one decimal and a ceiling', () => {
    expect(zText(3.44)).toBe('+3.4σ');
    expect(zText(-2.06)).toBe('−2.1σ');
    expect(zText(10)).toBe('+10.0σ');
    expect(zText(Infinity)).toBe('over +10σ');
    expect(zText(-12)).toBe('under −10σ');
  });

  describe('picking labels', () => {
    const W = 400;
    const Hp = 200;
    const texts = (n: number) => Array.from({ length: n }, () => 'over +10σ');

    it('gives a spike a few readings wide one label, on its furthest-out mark', () => {
      const marks = [
        { x: 0.5, y: 0.5, z: 11 },
        { x: 0.505, y: 0.48, z: 14 },
        { x: 0.51, y: 0.52, z: 12 },
      ];
      const picked = pickLabels(marks, texts(3), W, Hp);
      expect(picked.map((p) => p.index)).toEqual([1]);
    });

    it('labels marks far apart, the furthest out first, at most three', () => {
      const marks = [0.1, 0.3, 0.5, 0.7, 0.9].map((x, i) => ({ x, y: 0.5, z: 4 + i }));
      const picked = pickLabels(marks, texts(5), W, Hp);
      expect(picked.map((p) => p.index)).toEqual([4, 3, 2]);
      // Two series spiking at the same time but far apart up and down each get one.
      const stacked = pickLabels(
        [
          { x: 0.5, y: 0.2, z: 5 },
          { x: 0.5, y: 0.8, z: -6 },
        ],
        texts(2),
        W,
        Hp,
      );
      expect(stacked.map((p) => p.index)).toEqual([1, 0]);
    });

    it('keeps every label inside the plot and off dots and obstacles, or leaves it out', () => {
      // At the top-right corner the label goes below and is held against the right edge.
      const [corner] = pickLabels([{ x: 0.99, y: 0.01, z: 5 }], texts(1), W, Hp);
      expect(corner.placed).toEqual({ side: 'below', align: 'end', tier: 0 });
      // A plot too short for a label: none, though the mark is still there to draw.
      expect(pickLabels([{ x: 0.5, y: 0.5, z: 5 }], texts(1), W, 20)).toEqual([]);
      // Header over the whole top half, mark just under it: below, never into the header.
      const [under] = pickLabels([{ x: 0.5, y: 0.55, z: 5 }], texts(1), W, Hp, [{ l: 0, r: W, t: 0, b: 100 }]);
      expect(under.placed.side).toBe('below');
      // Covered everywhere: left out.
      expect(pickLabels([{ x: 0.5, y: 0.5, z: 5 }], texts(1), W, Hp, [{ l: 0, r: W, t: 0, b: Hp }])).toEqual([]);
    });
  });

  it('draws one closed band per unbroken stretch', () => {
    const s = (t: number) => ({ t, v: 0, mid: 10, sd: 1, z: 0 });
    const d = bandPath(
      [s(0), s(1), null, s(3), null, s(5), s(6)],
      2,
      (t) => t * 10,
      (v) => v,
    );
    expect(d).toBe('M0,12L10,12L10,8L0,8ZM50,12L60,12L60,8L50,8Z');
    expect(
      bandPath(
        [],
        2,
        (t) => t,
        (v) => v,
      ),
    ).toBe('');
  });

  it('checks its options and fills defaults', () => {
    const v = (raw: Record<string, unknown>) => () => validateAnomalies(cfg(raw));
    expect(v({ anomalies: 'yes' })).toThrow('"anomalies" must be true or false');
    expect(v({ anomalies_band: 1 })).toThrow('"anomalies_band" must be true or false');
    expect(v({ anomalies_window: 'soon' })).toThrow(
      '"anomalies_window" must be a time such as 30min, 2h or 1d (or auto)',
    );
    expect(v({ anomalies_sigma: 0 })).toThrow('"anomalies_sigma" must be a number above 0');
    expect(v({ anomalies_color: 3 })).toThrow('"anomalies_color" must be text');
    expect(
      v({ anomalies: true, anomalies_window: 'auto', anomalies_sigma: 3, anomalies_color: 'amber' }),
    ).not.toThrow();
    expect(anomalyOptions(cfg({}))).toBeUndefined();
    expect(anomalyOptions(cfg({ anomalies: true }))).toEqual({ window: undefined, sigma: 3, color: 'red', band: true });
    expect(
      anomalyOptions(
        cfg({
          anomalies: true,
          anomalies_window: '3h',
          anomalies_sigma: 3,
          anomalies_band: false,
          anomalies_color: 'blue',
        }),
      ),
    ).toEqual({ window: 3 * H, sigma: 3, color: 'blue', band: false });
  });
});

const now = Date.now();

function hassFor() {
  const rows = Array.from({ length: 145 }, (_, i) => {
    const t = now - (144 - i) * 10 * M;
    const v = i === 60 ? 95 : i === 100 ? 5 : 50 + 2 * Math.sin(i / 3);
    return { s: String(v), lu: t / 1000 };
  });
  const hass = makeHass({
    'sensor.humidity': ['51', { friendly_name: 'Humidity', unit_of_measurement: '%' }],
    'sensor.flat': ['20', { friendly_name: 'Flat', unit_of_measurement: '°C' }],
  });
  hass.callWS = vi.fn(async () => ({
    'sensor.humidity': rows,
    'sensor.flat': [{ s: '20', lu: (now - 23 * H) / 1000 }],
  })) as HomeAssistant['callWS'];
  return hass;
}

async function mount(config: Record<string, unknown>) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig(cfg({ entities: ['sensor.humidity', 'sensor.flat'], ...config }));
  card.hass = hassFor();
  document.body.appendChild(card);
  await card.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await card.updateComplete;
  return card;
}

const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('anomalies on the line chart', () => {
  it('draws nothing extra until asked', async () => {
    const card = await mount({});
    expect(qa(card, '.anomaly-band')).toHaveLength(0);
    expect(qa(card, '.anomaly-dot')).toHaveLength(0);
  });

  it('shades the normal band and marks the spike and the dip, labelled with how far out they are', async () => {
    const card = await mount({ anomalies: true, anomalies_window: '2h', anomalies_color: 'amber' });
    // The flat series has too few readings to judge: only the humidity gets a band.
    const bands = qa(card, 'path.anomaly-band');
    expect(bands).toHaveLength(1);
    expect(bands[0].getAttribute('fill')).toContain('--primary-color');
    const dots = qa(card, '.anomaly-dot');
    expect(dots).toHaveLength(2);
    const said = dots.map((d) => d.getAttribute('aria-label')).sort();
    expect(said).toEqual(['Humidity: 5 %, under −10σ from normal', 'Humidity: 95 %, over +10σ from normal']);
    const layer = card.shadowRoot!.querySelector('.anomaly-layer') as HTMLElement;
    expect(layer.getAttribute('style')).toContain('--warning-color');
    const labels = qa(card, '.anomaly-label').map((l) => l.textContent!.trim());
    expect(labels).toHaveLength(2);
    expect(labels.some((l) => l.includes('+'))).toBe(true);
    expect(labels.some((l) => l.includes('−'))).toBe(true);
  });

  it('leaves out the band when asked, and finds less at a higher sigma with the automatic window', async () => {
    const card = await mount({ anomalies: true, anomalies_band: false, anomalies_sigma: 6 });
    expect(qa(card, '.anomaly-band')).toHaveLength(0);
    expect(qa(card, '.anomaly-dot').length).toBeGreaterThan(0);
    const strict = await mount({ anomalies: true, anomalies_sigma: 6, anomalies_window: '20min' });
    expect(qa(strict, '.anomaly-dot')).toHaveLength(0);
  });
});

describe('anomaly editor', () => {
  it('shows a switch, then its options once on, and writes them', async () => {
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
    const names = (form.schema as { name: string }[]).map((f) => f.name);
    expect(names).toContain('anomalies');
    expect(JSON.stringify(form.schema)).not.toContain('anomalies_sigma');
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { ...(form.data as object), anomalies: true } } }),
    );
    expect(events.at(-1)).toEqual({ ...raw, anomalies: true });
    ed.setConfig(events.at(-1)!);
    await ed.updateComplete;
    form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect(JSON.stringify(form.schema)).toContain('anomalies_sigma');
    form.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...(form.data as object), anomalies_sigma: 4, anomalies_window: '2h' } },
      }),
    );
    expect(events.at(-1)).toEqual({ ...raw, anomalies: true, anomalies_sigma: 4, anomalies_window: '2h' });
  });
});
