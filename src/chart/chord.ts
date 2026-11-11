/**
 * Chord diagram maths: nodes round a circle, each arc as long as everything flowing in and out of
 * it, and a ribbon per flow joining the two ends. Angles are degrees clockwise from 12 o'clock, as
 * in `polar` and `arcPath`. Pure functions, so the style only has to draw what comes back.
 */
import { polar } from '../geometry';
import { flowValue } from './sankey';
import type { Flow } from './sankey';

export type ChordSort = 'none' | 'ascending' | 'descending';

export interface ChordNode {
  name: string;
  /** Order of first appearance in the flows, for its colour. */
  order: number;
  in: number;
  out: number;
  /** Everything flowing in and out: the arc's length. */
  total: number;
  start: number;
  end: number;
}

/** Where one end of a ribbon sits on its node's arc. */
export interface ChordEnd {
  start: number;
  end: number;
}

export interface ChordRibbon {
  flow: Flow;
  value: number;
  source: ChordNode;
  target: ChordNode;
  s: ChordEnd;
  t: ChordEnd;
}

export interface ChordLayout {
  nodes: ChordNode[];
  ribbons: ChordRibbon[];
  /** The sum of every flow drawn. */
  total: number;
}

/**
 * Flows with both ends, two different nodes and something flowing. Unlike a Sankey, a chord can
 * go both ways between two nodes and round in a loop, so nothing else is turned away.
 */
export function chordFlows(flows: Flow[]): Flow[] {
  return flows.filter((f) => f.from && f.to && f.from !== f.to && flowValue(f.value) > 0);
}

/**
 * Lay the flows out round a circle with `pad` degrees between nodes. Nodes come in the order they
 * first appear (or by total when sorted). On each node the ribbon ends are stacked so the one to
 * the nearest node clockwise is at the clockwise end, which keeps ribbons from crossing where
 * they need not; where a node sends and receives to the same node, what it sends comes first.
 */
export function chordLayout(flows: Flow[], pad: number, sort: ChordSort = 'none'): ChordLayout {
  const kept = chordFlows(flows);
  const byName = new Map<string, ChordNode>();
  const node = (name: string) => {
    let n = byName.get(name);
    if (!n) {
      n = { name, order: byName.size, in: 0, out: 0, total: 0, start: 0, end: 0 };
      byName.set(name, n);
    }
    return n;
  };
  for (const f of kept) {
    const v = flowValue(f.value);
    node(f.from).out += v;
    node(f.to).in += v;
  }
  const nodes = [...byName.values()];
  for (const n of nodes) n.total = n.in + n.out;
  if (sort !== 'none') {
    const dir = sort === 'ascending' ? 1 : -1;
    nodes.sort((a, b) => dir * (a.total - b.total) || a.order - b.order);
  }
  const total = kept.reduce((s, f) => s + flowValue(f.value), 0);
  if (!nodes.length) return { nodes, ribbons: [], total };
  // Gaps may take at most half the circle, so a long list of nodes still has arcs to show.
  const gap = Math.min(Math.max(0, pad), 180 / nodes.length);
  const room = 360 - gap * nodes.length;
  const sum = total * 2;
  let at = gap / 2;
  for (const n of nodes) {
    n.start = at;
    n.end = at + (n.total / sum) * room;
    at = n.end + gap;
  }
  const place = new Map(nodes.map((n, i) => [n, i]));
  const ribbons: ChordRibbon[] = kept.map((flow) => ({
    flow,
    value: flowValue(flow.value),
    source: byName.get(flow.from)!,
    target: byName.get(flow.to)!,
    s: { start: 0, end: 0 },
    t: { start: 0, end: 0 },
  }));
  for (const n of nodes) {
    const here = place.get(n)!;
    const ends = ribbons.flatMap((r, i) => {
      const out: { r: ChordRibbon; i: number; send: boolean; other: ChordNode }[] = [];
      if (r.source === n) out.push({ r, i, send: true, other: r.target });
      if (r.target === n) out.push({ r, i, send: false, other: r.source });
      return out;
    });
    const steps = (o: ChordNode) => (place.get(o)! - here + nodes.length) % nodes.length;
    ends.sort((a, b) => steps(b.other) - steps(a.other) || Number(b.send) - Number(a.send) || a.i - b.i);
    const scale = n.total > 0 ? (n.end - n.start) / n.total : 0;
    let a = n.start;
    for (const e of ends) {
      const end = { start: a, end: a + e.r.value * scale };
      if (e.send) e.r.s = end;
      else e.r.t = end;
      a = end.end;
    }
  }
  return { nodes, ribbons, total };
}

const f2 = (n: number) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);

/** An arc's point list helper: `A` command to the point at `deg`. */
function arcTo(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x, y] = polar(cx, cy, r, to);
  return `A${f2(r)} ${f2(r)} 0 ${to - from > 180 ? 1 : 0} 1 ${f2(x)} ${f2(y)}`;
}

/**
 * A ribbon's outline at radius `r`: along the source end, curving through the middle to the target
 * end, along it, and back through the middle to where it began.
 */
export function ribbonPath(cx: number, cy: number, r: number, s: ChordEnd, t: ChordEnd): string {
  const [sx, sy] = polar(cx, cy, r, s.start);
  const [tx, ty] = polar(cx, cy, r, t.start);
  return (
    `M${f2(sx)} ${f2(sy)} ${arcTo(cx, cy, r, s.start, s.end)} ` +
    `Q${f2(cx)} ${f2(cy)} ${f2(tx)} ${f2(ty)} ${arcTo(cx, cy, r, t.start, t.end)} ` +
    `Q${f2(cx)} ${f2(cy)} ${f2(sx)} ${f2(sy)}Z`
  );
}

/** A filled ring segment from radius `r0` out to `r1`, between two angles. */
export function ringPath(cx: number, cy: number, r0: number, r1: number, start: number, end: number): string {
  const [ax, ay] = polar(cx, cy, r1, start);
  const [bx, by] = polar(cx, cy, r0, end);
  const large = end - start > 180 ? 1 : 0;
  const [ex, ey] = polar(cx, cy, r1, end);
  const [sx, sy] = polar(cx, cy, r0, start);
  return (
    `M${f2(ax)} ${f2(ay)} A${f2(r1)} ${f2(r1)} 0 ${large} 1 ${f2(ex)} ${f2(ey)} ` +
    `L${f2(bx)} ${f2(by)} A${f2(r0)} ${f2(r0)} 0 ${large} 0 ${f2(sx)} ${f2(sy)}Z`
  );
}
