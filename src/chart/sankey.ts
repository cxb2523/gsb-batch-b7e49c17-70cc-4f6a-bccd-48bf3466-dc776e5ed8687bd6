/**
 * Sankey maths: which flows can be drawn, which column each node goes in, and where every node
 * and link sits. Pure functions in pixel units, so the style only has to draw what comes back.
 */

/** One flow from the card's entities: a link from one named node to another. */
export interface Flow {
  /** Index into the card's items, for tap actions. */
  index: number;
  from: string;
  to: string;
  /** Current value; null, negative or non-finite counts as nothing flowing. */
  value: number | null;
}

export interface SankeyNode {
  name: string;
  /** Order of first appearance in the flows, for its colour and its place in its column. */
  order: number;
  column: number;
  value: number;
  in: number;
  out: number;
  x: number;
  y: number;
  h: number;
}

export interface SankeyLink {
  flow: Flow;
  value: number;
  source: SankeyNode;
  target: SankeyNode;
  /** Band width in px. */
  width: number;
  /** Centre of the band where it leaves the source and where it reaches the target. */
  y0: number;
  y1: number;
}

export interface SankeyLayout {
  nodes: SankeyNode[];
  links: SankeyLink[];
  columns: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Space kept left of the first column and right of the last, for labels. */
  left: number;
  right: number;
  nodeWidth: number;
  /** Space between nodes in a column. */
  gap: number;
  /** Extra space a node needs above it in its column (a label sitting on top). */
  above?(node: SankeyNode, columns: number): number;
}

/** Nodes a node can reach by following links forwards. */
function reaches(edges: Map<string, string[]>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(edges.get(n) ?? []));
  }
  return false;
}

/**
 * The flows that can be drawn, in order: each needs a `from` and a different `to`, and a flow
 * that would close a loop (A → B → A) is left out, as are the ones after it that would.
 */
export function acceptFlows<T extends Pick<Flow, 'from' | 'to'>>(flows: T[]): T[] {
  const edges = new Map<string, string[]>();
  const kept: T[] = [];
  for (const f of flows) {
    if (!f.from || !f.to || f.from === f.to) continue;
    if (reaches(edges, f.to, f.from)) continue;
    edges.set(f.from, [...(edges.get(f.from) ?? []), f.to]);
    kept.push(f);
  }
  return kept;
}

/** The first loop in a list of from → to pairs, as the names round it ("A", "B", "A"), if any. */
export function findCycle(pairs: [string, string][]): string[] | undefined {
  const edges = new Map<string, string[]>();
  for (const [from, to] of pairs) {
    if (from === to) return [from, to];
    edges.set(from, [...(edges.get(from) ?? []), to]);
  }
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (n: string): string[] | undefined => {
    if (state.get(n) === 'open') return [...path.slice(path.indexOf(n)), n];
    if (state.get(n) === 'done') return undefined;
    state.set(n, 'open');
    path.push(n);
    for (const next of edges.get(n) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    state.set(n, 'done');
    return undefined;
  };
  for (const n of edges.keys()) {
    const found = visit(n);
    if (found) return found;
  }
  return undefined;
}

/** Nothing flowing counts as 0: no reading, a negative one, or not a number. */
export function flowValue(v: number | null): number {
  return v !== null && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Each node's column: the longest path to it from a node nothing flows into. A node that only
 * receives stays in the column after its source, rather than being pushed to the far right.
 * Expects loop-free flows (see `acceptFlows`).
 */
export function nodeColumns(flows: Pick<Flow, 'from' | 'to'>[]): Map<string, number> {
  const column = new Map<string, number>();
  for (const f of flows) {
    column.set(f.from, column.get(f.from) ?? 0);
    column.set(f.to, column.get(f.to) ?? 0);
  }
  // Relax until settled; with no loops, at most one pass per node.
  for (let pass = 0; pass <= column.size; pass++) {
    let changed = false;
    for (const f of flows) {
      const next = column.get(f.from)! + 1;
      if (next > column.get(f.to)!) {
        column.set(f.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return column;
}

/**
 * Lay out the flows in a `width` × `height` box. Columns come from every flow (so a node keeps
 * its column while a flow is at 0), but only nodes with something flowing are drawn, and empty
 * columns close up. Node heights share one scale, set by the fullest column; each column is
 * centred. A node's links leave and arrive in the order of the nodes at their other ends, so
 * bands cross as little as they can.
 */
export function sankeyLayout(flows: Flow[], o: LayoutOptions): SankeyLayout {
  const accepted = acceptFlows(flows);
  const columnOf = nodeColumns(accepted);
  const order = new Map<string, number>();
  for (const f of accepted) {
    if (!order.has(f.from)) order.set(f.from, order.size);
    if (!order.has(f.to)) order.set(f.to, order.size);
  }
  const live = accepted.filter((f) => flowValue(f.value) > 0);
  const byName = new Map<string, SankeyNode>();
  const node = (name: string) => {
    let n = byName.get(name);
    if (!n) {
      n = { name, order: order.get(name)!, column: columnOf.get(name)!, value: 0, in: 0, out: 0, x: 0, y: 0, h: 0 };
      byName.set(name, n);
    }
    return n;
  };
  const links: SankeyLink[] = live.map((flow) => {
    const value = flowValue(flow.value);
    const source = node(flow.from);
    const target = node(flow.to);
    source.out += value;
    target.in += value;
    return { flow, value, source, target, width: 0, y0: 0, y1: 0 };
  });
  const nodes = [...byName.values()].sort((a, b) => a.order - b.order);
  for (const n of nodes) n.value = Math.max(n.in, n.out);

  // Close up empty columns.
  const used = [...new Set(nodes.map((n) => n.column))].sort((a, b) => a - b);
  for (const n of nodes) n.column = used.indexOf(n.column);
  const columns = used.length;
  if (columns === 0) return { nodes, links, columns };

  const stacks = used.map((_, c) => nodes.filter((n) => n.column === c));
  const above = (n: SankeyNode) => o.above?.(n, columns) ?? 0;
  const fixed = stacks.map((s) => s.reduce((sum, n) => sum + above(n), 0) + o.gap * (s.length - 1));
  const totals = stacks.map((s) => s.reduce((sum, n) => sum + n.value, 0));
  const scale = Math.max(0, Math.min(...stacks.map((_, c) => (o.height - fixed[c]) / totals[c])));
  const span = o.width - o.left - o.right - o.nodeWidth;
  stacks.forEach((stack, c) => {
    let y = (o.height - (totals[c] * scale + fixed[c])) / 2;
    const x = o.left + (columns > 1 ? (span * c) / (columns - 1) : span / 2);
    for (const n of stack) {
      y += above(n);
      n.x = x;
      n.y = y;
      n.h = n.value * scale;
      y += n.h + o.gap;
    }
  });

  const mid = (n: SankeyNode) => n.y + n.h / 2;
  for (const l of links) l.width = l.value * scale;
  for (const n of nodes) {
    const outs = links.filter((l) => l.source === n).sort((a, b) => mid(a.target) - mid(b.target));
    let y = n.y;
    for (const l of outs) {
      l.y0 = y + l.width / 2;
      y += l.width;
    }
    const ins = links.filter((l) => l.target === n).sort((a, b) => mid(a.source) - mid(b.source));
    y = n.y;
    for (const l of ins) {
      l.y1 = y + l.width / 2;
      y += l.width;
    }
  }
  return { nodes, links, columns };
}

/**
 * A band from source to target as a filled shape, its edges curving half way across. Filled
 * rather than stroked, so a wide band between close columns keeps clean edges. At least 1 px.
 */
export function linkPath(l: SankeyLink, nodeWidth: number): string {
  const x0 = l.source.x + nodeWidth;
  const x1 = l.target.x;
  const mx = (x0 + x1) / 2;
  const h = Math.max(1, l.width) / 2;
  const r = (n: number) => Math.round(n * 10) / 10;
  const [a, b, c, d] = [l.y0 - h, l.y1 - h, l.y1 + h, l.y0 + h].map(r);
  return (
    `M${r(x0)},${a}C${r(mx)},${a} ${r(mx)},${b} ${r(x1)},${b}` +
    `L${r(x1)},${c}C${r(mx)},${c} ${r(mx)},${d} ${r(x0)},${d}Z`
  );
}

/** Rough text width in px: no measuring in a render, so a generous average glyph width. */
export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58;
}

/** `text` cut to fit `max` px, ending in "…" when cut; '' when not even a letter fits. */
export function fitText(text: string, max: number, fontSize: number): string {
  if (textWidth(text, fontSize) <= max) return text;
  const chars = Math.floor(max / (fontSize * 0.58)) - 1;
  return chars >= 1 ? `${text.slice(0, chars).trimEnd()}…` : '';
}

/**
 * Move label centres in one column apart so labels `size` px tall don't overlap, staying within
 * 0..height where they can. Returns the new centres in the same order as given.
 */
export function spreadLabels(centres: number[], size: number, height: number): number[] {
  const idx = centres.map((_, i) => i).sort((a, b) => centres[a] - centres[b]);
  const out = [...centres];
  let prev = -Infinity;
  for (const i of idx) {
    out[i] = Math.max(out[i], prev + size, size / 2);
    prev = out[i];
  }
  // Pushed past the bottom: shift back up from the end.
  let next = Infinity;
  for (const i of [...idx].reverse()) {
    out[i] = Math.min(out[i], next - size, height - size / 2);
    next = out[i];
  }
  return out;
}
