import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import { chordFlows, chordLayout, ribbonPath, ringPath } from '../src/chart/chord';
import type { Flow } from '../src/chart/sankey';
import { chordColors, drawChord, validateChord } from '../src/styles/chord';
import { STYLES, isChart } from '../src/styles/index';
import type { CardConfig } from '../src/types';
import { makeHass } from './helpers/hass';
import { stubEditorElements } from './helpers/chart';
import type { Card, Editor, Stub } from './helpers/chart';

stubEditorElements();
await import('../src/editor/chartdeck-card-editor');

const flow = (index: number, from: string, to: string, value: number | null): Flow => ({ index, from, to, value });

/** Movement between rooms: both ways between living room and kitchen, and a loop through the office. */
const ROOMS: Flow[] = [
  flow(0, 'Living', 'Kitchen', 4),
  flow(1, 'Kitchen', 'Living', 2),
  flow(2, 'Kitchen', 'Office', 1),
  flow(3, 'Office', 'Living', 1),
];

const sum = (n: { start: number; end: number }) => n.end - n.start;

describe('chord maths', () => {
  it('keeps flows going both ways and round loops, and drops empty or self flows', () => {
    const kept = chordFlows([
      ...ROOMS,
      flow(4, 'A', 'A', 3),
      flow(5, '', 'B', 3),
      flow(6, 'A', 'B', 0),
      flow(7, 'A', 'B', null),
      flow(8, 'A', 'B', -2),
    ]);
    expect(kept.map((f) => f.index)).toEqual([0, 1, 2, 3]);
  });

  it('sizes each arc by what flows in and out, with the gaps between them', () => {
    const l = chordLayout(ROOMS, 4);
    expect(l.total).toBe(8);
    expect(l.nodes.map((n) => [n.name, n.in, n.out, n.total])).toEqual([
      ['Living', 3, 4, 7],
      ['Kitchen', 4, 3, 7],
      ['Office', 1, 1, 2],
    ]);
    const room = 360 - 3 * 4;
    expect(sum(l.nodes[0])).toBeCloseTo((7 / 16) * room);
    expect(sum(l.nodes[2])).toBeCloseTo((2 / 16) * room);
    expect(l.nodes[0].start).toBe(2);
    expect(l.nodes[1].start).toBeCloseTo(l.nodes[0].end + 4);
    expect(l.nodes[2].end + 2).toBeCloseTo(360);
  });

  it('gives each ribbon end a width in proportion to its flow, filling its node', () => {
    const l = chordLayout(ROOMS, 0);
    const per = 360 / 16;
    for (const r of l.ribbons) {
      expect(sum(r.s)).toBeCloseTo(r.value * per);
      expect(sum(r.t)).toBeCloseTo(r.value * per);
    }
    // Every end on a node, together, covers the node.
    for (const n of l.nodes) {
      const ends = l.ribbons.flatMap((r) => [r.source === n ? r.s : [], r.target === n ? r.t : []].flat());
      expect(ends.reduce((a, e) => a + sum(e), 0)).toBeCloseTo(sum(n));
      expect(Math.min(...ends.map((e) => e.start))).toBeCloseTo(n.start);
    }
  });

  it('stacks the end to the nearest node clockwise last, sending before receiving', () => {
    const l = chordLayout(ROOMS, 0);
    const living = l.nodes[0];
    const ends = l.ribbons
      .flatMap((r) => [
        r.source === living ? { e: r.s, f: r.flow.index } : [],
        r.target === living ? { e: r.t, f: r.flow.index } : [],
      ])
      .flat()
      .sort((a, b) => a.e.start - b.e.start)
      .map((x) => x.f);
    // Office is two steps clockwise (the far side), then Kitchen one step: send (0) before receive (1).
    expect(ends).toEqual([3, 0, 1]);
  });

  it('orders nodes by total when sorted, and caps the gaps at half the circle', () => {
    expect(chordLayout(ROOMS, 0, 'ascending').nodes.map((n) => n.name)).toEqual(['Office', 'Living', 'Kitchen']);
    expect(chordLayout(ROOMS, 0, 'descending').nodes.map((n) => n.name)).toEqual(['Living', 'Kitchen', 'Office']);
    const l = chordLayout(ROOMS, 200);
    expect(l.nodes.reduce((a, n) => a + sum(n), 0)).toBeCloseTo(180);
    expect(chordLayout([], 3)).toEqual({ nodes: [], ribbons: [], total: 0 });
  });

  it('draws ribbons and ring segments as closed paths', () => {
    const p = ribbonPath(100, 100, 50, { start: 0, end: 30 }, { start: 180, end: 200 });
    expect(p.startsWith('M100.00 50.00 A50.00 50.00 0 0 1')).toBe(true);
    expect(p).toContain('Q100.00 100.00 100.00 150.00');
    expect(p.endsWith('Z')).toBe(true);
    expect(ringPath(0, 0, 40, 50, 0, 270)).toMatch(
      /^M0\.00 -50\.00 A50\.00 50\.00 0 1 1 .* L.* A40\.00 40\.00 0 1 0 0\.00 -40\.00Z$/,
    );
  });
});

describe('chord drawing', () => {
  const text = { name: true, value: true, format: (v: number) => `${v} x` };

  it('fits the circle beside its labels, labels each arc and cuts long names', () => {
    const l = chordLayout(ROOMS, 3);
    const wide = drawChord(l, 480, text);
    expect(wide.r).toBe(120);
    expect(wide.labels.map((x) => [x.name, x.value])).toEqual([
      ['Living', '7 x'],
      ['Kitchen', '7 x'],
      ['Office', '2 x'],
    ]);
    expect(wide.labels[0].anchor).toBe('start');
    expect(wide.labels[2].anchor).toBe('end');
    const narrow = drawChord(chordLayout([flow(0, 'A really long room name', 'B', 1)], 3), 200, text);
    expect(narrow.r).toBeGreaterThanOrEqual(50);
    expect(narrow.labels[0].name.endsWith('…')).toBe(true);
    const bare = drawChord(l, 480, { ...text, name: false, value: false });
    expect(bare.labels).toEqual([]);
    expect(bare.height).toBe(2 * (bare.r + 4));
  });

  it('colours nodes in order of first appearance and ribbons by source, or their own colour', () => {
    const l = chordLayout(ROOMS, 0, 'ascending');
    const c = chordColors(l, (i) => (i === 2 ? 'purple' : undefined));
    expect(c.node.get('Living')).toContain('--primary-color');
    expect(c.node.get('Kitchen')).toContain('--warning-color');
    expect(c.ribbon.get(0)).toBe(c.node.get('Living'));
    expect(c.ribbon.get(1)).toBe(c.node.get('Kitchen'));
    expect(c.ribbon.get(2)).toContain('--purple-color');
  });
});

describe('chord validation', () => {
  const v = (raw: Partial<CardConfig>) => () => validateChord({ type: 'x', ...raw } as CardConfig);
  it('accepts flows both ways and its options', () => {
    expect(
      v({
        pad: 0,
        ribbon_opacity: 1,
        entities: [
          'sensor.x',
          { entity: 'sensor.a', from: 'A', to: 'B' },
          { entity: 'sensor.b', from: 'B', to: 'A' },
        ] as CardConfig['entities'],
      }),
    ).not.toThrow();
  });

  it('explains what is wrong', () => {
    expect(v({ pad: 30 })).toThrow('"pad" must be a number of degrees from 0 to 20');
    expect(v({ pad: 'x' })).toThrow(/"pad"/);
    expect(v({ ribbon_opacity: 0 })).toThrow('"ribbon_opacity" must be a number above 0, up to 1');
    expect(v({ entities: [{ entity: 'sensor.a', from: 3 }] as CardConfig['entities'] })).toThrow(
      'Entity 1: "from" must be a node name',
    );
    expect(v({ entities: [{ entity: 'sensor.a', from: 'A', to: ' A ' }] as CardConfig['entities'] })).toThrow(
      'Entity 1: "from" and "to" must be different nodes',
    );
  });

  it('is checked when the card is set up', () => {
    const card = document.createElement('chartdeck-card') as Card;
    expect(() => card.setConfig({ type: 'x', style: 'chord', pad: -1 } as CardConfig)).toThrow(/pad/);
  });
});

const hass = (overrides: Record<string, string> = {}) =>
  makeHass({
    'sensor.lk': [overrides.lk ?? '4', { friendly_name: 'Living to kitchen', unit_of_measurement: 'times' }],
    'sensor.kl': [overrides.kl ?? '2', { friendly_name: 'Kitchen to living', unit_of_measurement: 'times' }],
    'sensor.ko': [overrides.ko ?? '1', { friendly_name: 'Kitchen to office', unit_of_measurement: 'times' }],
    'sensor.off': ['unavailable', { friendly_name: 'Garden' }],
  });

const ENTITIES = [
  { entity: 'sensor.lk', from: 'Living', to: 'Kitchen' },
  { entity: 'sensor.kl', from: 'Kitchen', to: 'Living' },
  { entity: 'sensor.ko', from: 'Kitchen', to: 'Office', color: 'purple' },
  { entity: 'sensor.off', from: 'Garden', to: 'Living' },
  { entity: 'sensor.missing', from: 'Bed', to: 'Living' },
];

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'chord', entities: ENTITIES, ...config } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('chord card', () => {
  it('is a chart in the parts-of-a-total group', () => {
    expect(isChart(STYLES.chord)).toBe(true);
    expect(STYLES.chord.group).toBe('totals');
  });

  it('draws a ribbon per flow with something flowing, each opening its entity, and an arc per node', async () => {
    const card = await mount({});
    const ribbons = qa(card, 'g.ribbon.entity');
    expect(ribbons.map((r) => r.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(ribbons[0].getAttribute('tabindex')).toBe('0');
    expect(text(ribbons[0].querySelector('title')!)).toBe('Living to Kitchen 4.0 times');
    expect(ribbons[2].querySelector('path')!.getAttribute('fill')).toContain('--purple-color');
    expect(qa(card, 'path.node')).toHaveLength(3);
    const svg = q(card, 'svg.chord')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe(
      'Chord diagram: Living to Kitchen 4.0 times, Kitchen to Living 2.0 times, Kitchen to Office 1.0 times',
    );
    expect(qa(card, 'text.label').map(text)).toEqual(['Living 6.0 times', 'Kitchen 7.0 times', 'Office 1.0 times']);
  });

  it('raises a ribbon and shows its value while hovered or focused, and a node its ribbons', async () => {
    const card = await mount({});
    const ribbon = qa(card, 'g.ribbon')[1];
    ribbon.dispatchEvent(new Event('pointerenter'));
    await card.updateComplete;
    expect(q(card, 'svg.chord')!.classList.contains('hovering')).toBe(true);
    expect(qa(card, 'g.ribbon')[1].classList.contains('active')).toBe(true);
    expect(text(q(card, '.chord-tip')!)).toBe('Kitchen → Living 2.0 times');
    ribbon.dispatchEvent(new Event('pointerleave'));
    await card.updateComplete;
    expect(q(card, '.chord-tip')).toBeNull();
    ribbon.dispatchEvent(new Event('focus'));
    await card.updateComplete;
    expect(q(card, '.chord-tip')).not.toBeNull();
    ribbon.dispatchEvent(new Event('blur'));
    await card.updateComplete;
    qa(card, 'path.node')[2].dispatchEvent(new Event('pointerenter'));
    await card.updateComplete;
    expect(qa(card, 'g.ribbon').map((r) => r.classList.contains('active'))).toEqual([false, false, true]);
    expect(q(card, '.chord-tip')).toBeNull();
  });

  it('sets the ribbon opacity, and hides names or values with the Display switches', async () => {
    const card = await mount({ ribbon_opacity: 0.6, show: { value: false } } as Partial<CardConfig>);
    expect(q(card, 'svg.chord')!.getAttribute('style')).toBe('--cd-ribbon-opacity:0.6');
    expect(qa(card, 'text.label tspan.value')).toHaveLength(0);
    expect(qa(card, 'text.label tspan.name')).toHaveLength(3);
  });

  it('says so when nothing flows, or no entity has from and to', async () => {
    const idle = await mount({}, hass({ lk: '0', kl: '-1', ko: '0' }));
    expect(text(q(idle, '.chart-message')!)).toBe('Nothing is flowing right now.');
    document.body.innerHTML = '';
    const none = await mount({ entities: ['sensor.lk'] });
    expect(text(q(none, '.chart-message')!)).toContain('"Flows from"');
  });
});

describe('chord editor', () => {
  async function editor(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as Editor;
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'chord', ...config } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return ed;
  }

  it('sets the gap and ribbon opacity in the Chart section, dropping the default', async () => {
    const ed = await editor({ entities: ENTITIES } as Partial<CardConfig>);
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    const grid = (form.schema as { schema: { name: string }[] }[])[0].schema;
    expect(grid.map((s) => s.name)).toEqual(['chord_pad', 'chord_ribbon_opacity']);
    expect(form.data).toEqual({ chord_pad: 3 });
    const changed: CardConfig[] = [];
    ed.addEventListener('config-changed', (ev) => changed.push((ev as CustomEvent).detail.config));
    form.dispatchEvent(
      new CustomEvent('value-changed', { detail: { value: { chord_pad: 6, chord_ribbon_opacity: 0.5 } } }),
    );
    expect(changed.at(-1)!.pad).toBe(6);
    expect(changed.at(-1)!.ribbon_opacity).toBe(0.5);
    ed.setConfig(changed.at(-1)!);
    await ed.updateComplete;
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { chord_pad: 3 } } }));
    expect('pad' in changed.at(-1)!).toBe(false);
  });

  it("puts the Sankey's from, to and flow colour in each entity's options", async () => {
    const ed = await editor({ entities: ENTITIES } as Partial<CardConfig>);
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = list.chartFields as { fields: { name: string; path: string[] }[] };
    expect(fields.fields.map((f) => [f.name, f.path.join('.')])).toEqual([
      ['from', 'from'],
      ['to', 'to'],
      ['flow_color', 'color'],
    ]);
  });
});
