import { afterEach, describe, expect, it } from 'vitest';
import '../src/chartdeck-card';
import {
  acceptFlows,
  findCycle,
  fitText,
  flowValue,
  linkPath,
  nodeColumns,
  sankeyLayout,
  spreadLabels,
  textWidth,
} from '../src/chart/sankey';
import type { Flow } from '../src/chart/sankey';
import { drawSankey, sankeyColors, validateSankey } from '../src/styles/sankey';
import { STYLES, isChart } from '../src/styles/index';
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

const flow = (index: number, from: string, to: string, value: number | null): Flow => ({ index, from, to, value });

/** The mockup's house: solar and grid in, battery and export out of solar, circuits out of the house. */
const HOUSE: Flow[] = [
  flow(0, 'Solar', 'House', 3),
  flow(1, 'Solar', 'Battery', 0.4),
  flow(2, 'Solar', 'Export', 0.7),
  flow(3, 'Grid', 'House', 0.9),
  flow(4, 'House', 'Heat pump', 1.6),
  flow(5, 'House', 'EV', 1.2),
  flow(6, 'House', 'Kitchen', 0.7),
  flow(7, 'House', 'Other', 0.4),
];

const OPTS = { width: 400, height: 200, left: 50, right: 60, nodeWidth: 10, gap: 10 };

describe('sankey maths', () => {
  it('counts nothing flowing as 0', () => {
    expect([flowValue(2), flowValue(0), flowValue(-3), flowValue(null), flowValue(NaN)]).toEqual([2, 0, 0, 0, 0]);
  });

  it('leaves out flows without both ends, to themselves, or closing a loop', () => {
    const kept = acceptFlows([
      { from: 'A', to: 'B' },
      { from: '', to: 'B' },
      { from: 'B', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
      { from: 'A', to: 'C' },
    ]);
    expect(kept.map((f) => `${f.from}${f.to}`)).toEqual(['AB', 'BC', 'AC']);
  });

  it('finds a loop in from/to pairs', () => {
    expect(
      findCycle([
        ['A', 'B'],
        ['B', 'C'],
      ]),
    ).toBeUndefined();
    expect(
      findCycle([
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'A'],
      ]),
    ).toEqual(['A', 'B', 'C', 'A']);
    expect(
      findCycle([
        ['X', 'Y'],
        ['A', 'B'],
        ['B', 'A'],
      ]),
    ).toEqual(['A', 'B', 'A']);
    expect(findCycle([['A', 'A']])).toEqual(['A', 'A']);
  });

  it('puts each node in the column of its longest path from a source', () => {
    const cols = nodeColumns(HOUSE);
    expect(Object.fromEntries(cols)).toEqual({
      Solar: 0,
      Grid: 0,
      House: 1,
      Battery: 1,
      Export: 1,
      'Heat pump': 2,
      EV: 2,
      Kitchen: 2,
      Other: 2,
    });
    // A shortcut doesn't pull a node back: C is reached through B as well.
    expect(nodeColumns([flow(0, 'A', 'C', 1), flow(1, 'A', 'B', 1), flow(2, 'B', 'C', 1)]).get('C')).toBe(2);
  });

  it('values each node at the larger of what comes in and what goes out', () => {
    const { nodes, columns } = sankeyLayout(HOUSE, OPTS);
    expect(columns).toBe(3);
    const house = nodes.find((n) => n.name === 'House')!;
    expect(house.in).toBeCloseTo(3.9);
    expect(house.out).toBeCloseTo(3.9);
    expect(nodes.find((n) => n.name === 'Solar')!.value).toBeCloseTo(4.1);
    expect(nodes.find((n) => n.name === 'Other')!.value).toBeCloseTo(0.4);
    const lop = sankeyLayout([flow(0, 'A', 'B', 5), flow(1, 'B', 'C', 2)], OPTS).nodes.find((n) => n.name === 'B')!;
    expect(lop.value).toBe(5);
  });

  it('scales heights by the fullest column, centres columns and spaces them across the width', () => {
    const { nodes } = sankeyLayout(HOUSE, OPTS);
    const col = (c: number) => nodes.filter((n) => n.column === c);
    // Middle column: 3.9 + 0.4 + 0.7 = 5, with two gaps; it fills the height exactly.
    const mid = col(1);
    const scale = (200 - 20) / 5;
    expect(mid[0].y).toBeCloseTo(0);
    expect(mid[0].h).toBeCloseTo(3.9 * scale);
    expect(mid[2].y + mid[2].h).toBeCloseTo(200);
    // Left column: 5.0 tall too, with one gap, so it sits centred.
    const left = col(0);
    expect(left[0].y).toBeCloseTo(5);
    expect(left.map((n) => n.x)).toEqual([50, 50]);
    expect(mid[0].x).toBe(50 + (400 - 50 - 60 - 10) / 2);
    expect(col(2)[0].x).toBe(400 - 60 - 10);
  });

  it('stacks links at each end in the order of the nodes at their other end', () => {
    const { links, nodes } = sankeyLayout(HOUSE, OPTS);
    const solar = nodes.find((n) => n.name === 'Solar')!;
    const fromSolar = links.filter((l) => l.source === solar).sort((a, b) => a.y0 - b.y0);
    expect(fromSolar.map((l) => l.target.name)).toEqual(['House', 'Battery', 'Export']);
    expect(fromSolar[0].y0).toBeCloseTo(solar.y + fromSolar[0].width / 2);
    expect(fromSolar[1].y0).toBeCloseTo(solar.y + fromSolar[0].width + fromSolar[1].width / 2);
    const house = nodes.find((n) => n.name === 'House')!;
    const intoHouse = links.filter((l) => l.target === house).sort((a, b) => a.y1 - b.y1);
    expect(intoHouse.map((l) => l.source.name)).toEqual(['Solar', 'Grid']);
    expect(intoHouse[1].y1).toBeCloseTo(house.y + intoHouse[0].width + intoHouse[1].width / 2);
    const w = fromSolar[0].width / 2;
    const d = linkPath(fromSolar[0], 10);
    expect(d.startsWith(`M60,${Math.round((fromSolar[0].y0 - w) * 10) / 10}C125,`)).toBe(true);
    expect(d).toMatch(/ 190,[\d.]+L190,[\d.]+C.* 60,[\d.]+Z$/);
  });

  it('drops zero, negative and missing flows, and closes up an emptied column', () => {
    const { nodes, links, columns } = sankeyLayout(
      [flow(0, 'A', 'B', 0), flow(1, 'B', 'C', 2), flow(2, 'B', 'D', -1), flow(3, 'B', 'E', null)],
      OPTS,
    );
    expect(links.map((l) => l.flow.index)).toEqual([1]);
    expect(nodes.map((n) => [n.name, n.column])).toEqual([
      ['B', 0],
      ['C', 1],
    ]);
    expect(columns).toBe(2);
  });

  it('ignores a flow that would make a loop instead of failing', () => {
    const { links } = sankeyLayout([flow(0, 'A', 'B', 1), flow(1, 'B', 'A', 1)], OPTS);
    expect(links.map((l) => l.flow.index)).toEqual([0]);
    expect(sankeyLayout([], OPTS)).toEqual({ nodes: [], links: [], columns: 0 });
  });

  it('leaves room above a node when asked', () => {
    const { nodes } = sankeyLayout([flow(0, 'A', 'B', 1), flow(1, 'A', 'C', 1)], {
      ...OPTS,
      above: (n) => (n.name === 'C' ? 20 : 0),
    });
    const [b, c] = nodes.filter((n) => n.column === 1);
    expect(c.y - (b.y + b.h)).toBeCloseTo(10 + 20);
  });

  it('fits and spreads labels', () => {
    expect(textWidth('abcd', 10)).toBeCloseTo(23.2);
    expect(fitText('Heat pump', 100, 12)).toBe('Heat pump');
    expect(fitText('Heat pump', 30, 12)).toBe('Hea…');
    expect(fitText('Heat pump', 5, 12)).toBe('');
    expect(spreadLabels([50, 55, 200], 20, 300)).toEqual([50, 70, 200]);
    expect(spreadLabels([290, 295], 20, 300)).toEqual([270, 290]);
    expect(spreadLabels([0], 20, 300)).toEqual([10]);
  });
});

describe('sankey drawing', () => {
  const format = (v: number) => `${v.toFixed(1)} kW`;

  it('puts labels left, right and above the middle node, and cuts long names on a narrow card', () => {
    const d = drawSankey(HOUSE, 500, { name: true, value: true, format });
    const side = Object.fromEntries(d.labels.map((l) => [l.node.name, l.side]));
    expect(side).toMatchObject({ Solar: 'left', House: 'above', Battery: 'right', 'Heat pump': 'right' });
    expect(d.labels.find((l) => l.node.name === 'House')!.value).toBe('3.9 kW');
    expect(d.height).toBeGreaterThanOrEqual(200);
    const long = [flow(0, 'A very long source name indeed', 'Somewhere far away from here', 1)];
    const narrow = drawSankey(long, 240, { name: true, value: true, format });
    const names = narrow.labels.map((l) => l.name);
    expect(names.every((n) => n.endsWith('…'))).toBe(true);
    for (const l of narrow.labels) expect(textWidth(l.name, narrow.font)).toBeLessThanOrEqual(240 * 0.3);
  });

  it('draws no labels when names and values are hidden', () => {
    const d = drawSankey(HOUSE, 500, { name: false, value: false, format });
    expect(d.labels).toEqual([]);
    expect(d.layout.nodes[0].x).toBe(2);
  });

  it('colours nodes in order, and links by source or, out of a middle node, by target', () => {
    const { node, link } = sankeyColors(HOUSE, 'auto', () => undefined);
    expect(node.get('Solar')).toContain('--primary-color');
    expect(node.get('House')).toContain('--warning-color');
    expect(link.get(0)).toBe(node.get('Solar'));
    expect(link.get(4)).toBe(node.get('Heat pump'));
    expect(sankeyColors(HOUSE, 'source', () => undefined).link.get(4)).toBe(node.get('House'));
    expect(sankeyColors(HOUSE, 'target', () => undefined).link.get(0)).toBe(node.get('House'));
  });

  it("uses a flow's own colour for its link and the node it is coloured by", () => {
    const { node, link } = sankeyColors(HOUSE, 'auto', (i) => (i === 4 ? 'red' : i === 0 ? '#123456' : undefined));
    expect(link.get(4)).toContain('--error-color');
    expect(node.get('Heat pump')).toContain('--error-color');
    expect(node.get('Solar')).toBe('#123456');
    expect(link.get(1)).toBe(node.get('Solar'));
    expect(link.get(2)).toBe(node.get('Solar'));
  });
});

describe('sankey validation', () => {
  const v = (raw: Partial<CardConfig>) => () => validateSankey({ type: 'x', ...raw } as CardConfig);

  it('accepts flows and the link colour choices', () => {
    expect(
      v({
        link_color: 'target',
        entities: ['sensor.a', { entity: 'sensor.b', from: 'A', to: 'B' }, { entity: 'sensor.c', from: 'B' }],
      }),
    ).not.toThrow();
  });

  it('explains what is wrong', () => {
    expect(v({ link_color: 'rainbow' })).toThrow('"link_color" must be one of: auto, source, target');
    expect(v({ entities: [{ entity: 'sensor.a', from: 3 }] as CardConfig['entities'] })).toThrow(
      'Entity 1: "from" must be a node name',
    );
    expect(v({ entities: [{ entity: 'sensor.a', from: 'A', to: ' A ' }] as CardConfig['entities'] })).toThrow(
      'Entity 1: "from" and "to" must be different nodes',
    );
    expect(
      v({
        entities: [
          { entity: 'sensor.a', from: 'A', to: 'B' },
          { entity: 'sensor.b', from: 'B', to: 'A' },
        ] as CardConfig['entities'],
      }),
    ).toThrow("Flows can't go round in a loop: A → B → A");
  });

  it('is checked when the card is set up', () => {
    const card = document.createElement('chartdeck-card') as HTMLElement & { setConfig(c: CardConfig): void };
    expect(() => card.setConfig({ type: 'x', style: 'sankey', link_color: 'x' } as CardConfig)).toThrow(/link_color/);
  });
});

type Card = HTMLElement & { setConfig(c: CardConfig): void; hass?: HomeAssistant; updateComplete: Promise<boolean> };

const hass = (overrides: Record<string, string> = {}) =>
  makeHass({
    'sensor.solar': [overrides.solar ?? '3', { friendly_name: 'Solar to house', unit_of_measurement: 'kW' }],
    'sensor.grid': [overrides.grid ?? '0.9', { friendly_name: 'Grid import', unit_of_measurement: 'kW' }],
    'sensor.heat': [overrides.heat ?? '1.6', { friendly_name: 'Heat pump', unit_of_measurement: 'kW' }],
    'sensor.off': ['unavailable', { friendly_name: 'Wind' }],
  });

const ENTITIES = [
  { entity: 'sensor.solar', from: 'Solar', to: 'House' },
  { entity: 'sensor.grid', from: 'Grid', to: 'House', color: 'purple' },
  { entity: 'sensor.heat', from: 'House', to: 'Heat pump' },
  { entity: 'sensor.off', from: 'Wind', to: 'House' },
  { entity: 'sensor.missing', from: 'Battery', to: 'House' },
];

async function mount(config: Partial<CardConfig>, h = hass()) {
  const card = document.createElement('chartdeck-card') as Card;
  card.setConfig({ type: 'custom:chartdeck-card', style: 'sankey', entities: ENTITIES, ...config } as CardConfig);
  card.hass = h;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

const q = (card: Card, sel: string) => card.shadowRoot!.querySelector(sel);
const qa = (card: Card, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('sankey card', () => {
  it('is a chart in the parts-of-a-total group', () => {
    expect(isChart(STYLES.sankey)).toBe(true);
    expect(STYLES.sankey.group).toBe('totals');
  });

  it('draws a band per flow that has something flowing, each one opening its entity', async () => {
    const card = await mount({});
    const flows = qa(card, 'g.flow.entity');
    expect(flows.map((f) => f.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    expect(flows[0].getAttribute('tabindex')).toBe('0');
    expect(flows[0].querySelector('title')!.textContent).toBe('Solar to House 3.0 kW');
    expect(flows[1].querySelector('path')!.getAttribute('fill')).toContain('--purple-color');
    // Out of the middle node, the band takes the heat pump's colour.
    const heatNode = qa(card, 'rect.node')[3];
    expect(flows[2].querySelector('path')!.getAttribute('fill')).toBe(heatNode.getAttribute('fill'));
    expect(qa(card, 'rect.node')).toHaveLength(4);
    const svg = q(card, 'svg.sankey')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe(
      'Flow chart: Solar to House 3.0 kW, Grid to House 0.9 kW, House to Heat pump 1.6 kW',
    );
    const labels = qa(card, 'text.label').map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(labels).toEqual(['Solar 3.0 kW', 'House 3.9 kW', 'Grid 0.9 kW', 'Heat pump 1.6 kW']);
  });

  it('raises a band and shows its value while it is hovered or focused', async () => {
    const card = await mount({});
    const flow = qa(card, 'g.flow')[2];
    flow.dispatchEvent(new Event('pointerenter'));
    await card.updateComplete;
    expect(q(card, 'svg.sankey')!.classList.contains('hovering')).toBe(true);
    expect(qa(card, 'g.flow')[2].classList.contains('active')).toBe(true);
    expect(q(card, '.sankey-tip')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('House → Heat pump 1.6 kW');
    flow.dispatchEvent(new Event('pointerleave'));
    await card.updateComplete;
    expect(q(card, '.sankey-tip')).toBeNull();
    flow.dispatchEvent(new Event('focus'));
    await card.updateComplete;
    expect(q(card, '.sankey-tip')).not.toBeNull();
    flow.dispatchEvent(new Event('blur'));
    await card.updateComplete;
    expect(q(card, '.sankey-tip')).toBeNull();
  });

  it('treats a negative flow as nothing, and says so when nothing flows at all', async () => {
    const card = await mount({}, hass({ heat: '-2' }));
    expect(qa(card, 'g.flow')).toHaveLength(2);
    document.body.innerHTML = '';
    const idle = await mount({}, hass({ solar: '0', grid: '-1', heat: '0' }));
    expect(q(idle, '.chart-message')!.textContent).toBe('Nothing is flowing right now.');
  });

  it('asks for from and to when no entity has them', async () => {
    const card = await mount({ entities: ['sensor.solar'] });
    expect(q(card, '.chart-message')!.textContent).toContain('"Flows from"');
  });

  it('hides names or values with the Display switches', async () => {
    const card = await mount({ show: { value: false } } as Partial<CardConfig>);
    expect(qa(card, 'text.label tspan.value')).toHaveLength(0);
    expect(qa(card, 'text.label tspan.name')).toHaveLength(4);
  });
});

describe('sankey editor', () => {
  async function editor(config: Partial<CardConfig>) {
    const ed = document.createElement('chartdeck-card-editor') as HTMLElement & {
      setConfig(c: CardConfig): void;
      hass?: unknown;
      updateComplete: Promise<boolean>;
    };
    ed.hass = makeHass({});
    ed.setConfig({ type: 'custom:chartdeck-card', style: 'sankey', ...config } as CardConfig);
    document.body.appendChild(ed);
    await ed.updateComplete;
    return ed;
  }

  it('sets the link colouring in the Chart section, dropping the default', async () => {
    const ed = await editor({ entities: ENTITIES } as Partial<CardConfig>);
    const form = ed.shadowRoot!.querySelector('.section-chart ha-form') as Stub;
    expect((form.schema as { name: string }[]).map((s) => s.name)).toEqual(['source', 'link_color']);
    expect(form.data).toMatchObject({ source: 'current', link_color: 'auto' });
    const changed: CardConfig[] = [];
    ed.addEventListener('config-changed', (ev) => changed.push((ev as CustomEvent).detail.config));
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { link_color: 'target' } } }));
    expect(changed.at(-1)!.link_color).toBe('target');
    ed.setConfig(changed.at(-1)!);
    await ed.updateComplete;
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { link_color: 'auto' } } }));
    expect('link_color' in changed.at(-1)!).toBe(false);
  });

  it("puts from, to and the flow's colour in each entity's options", async () => {
    const ed = await editor({ entities: ENTITIES } as Partial<CardConfig>);
    const list = ed.shadowRoot!.querySelector('cd-entities-editor') as Stub;
    const fields = list.chartFields as { schema: unknown[]; fields: { name: string; path: string[] }[] };
    expect(fields.fields.map((f) => [f.name, f.path.join('.')])).toEqual([
      ['from', 'from'],
      ['to', 'to'],
      ['flow_color', 'color'],
    ]);
  });
});
