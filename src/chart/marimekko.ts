/**
 * Marimekko (mosaic) maths: one column per group, as wide as the group's share of the whole, cut
 * into one segment per entity, as tall as its share of the column. Pure functions in pixel units.
 */

/** One entity as a part of the chart. */
export interface MekkoCell {
  /** Index into the card's items, for tap actions. */
  index: number;
  /** The column it goes in. */
  group: string;
  /** What it is a share of the column for: the colour and the legend. */
  category: string;
  /** Its size; anything not a positive number counts as nothing. */
  value: number | null;
}

export interface MekkoSegment {
  cell: MekkoCell;
  value: number;
  /** Share of its column, 0–1. */
  share: number;
  /** Where the category sits in the legend (and so its colour). */
  category: number;
  y: number;
  h: number;
}

export interface MekkoColumn {
  name: string;
  total: number;
  /** Share of the whole chart, 0–1. */
  share: number;
  x: number;
  w: number;
  segments: MekkoSegment[];
}

export interface MekkoLayout {
  columns: MekkoColumn[];
  /** Categories in legend order. */
  categories: string[];
  total: number;
}

export type MekkoSort = 'none' | 'ascending' | 'descending';

/** A cell's size: its value when that is a positive number, else 0. */
export function cellValue(v: number | null): number {
  return v !== null && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Lay the cells out in a `width` × `height` box with `gap` px between columns. Columns come in the
 * order their group first appears, or by total when sorted. Categories keep the order they first
 * appear in, and every column stacks them the same way from the bottom up, so a colour sits at
 * the same place in each. Columns and cells with nothing to show are left out.
 */
export function marimekkoLayout(
  cells: MekkoCell[],
  width: number,
  height: number,
  gap: number,
  sort: MekkoSort = 'none',
): MekkoLayout {
  const shown = cells.filter((c) => cellValue(c.value) > 0);
  const categories: string[] = [];
  for (const c of shown) if (!categories.includes(c.category)) categories.push(c.category);
  const groups: { name: string; cells: MekkoCell[]; total: number }[] = [];
  for (const c of shown) {
    let g = groups.find((x) => x.name === c.group);
    if (!g) {
      g = { name: c.group, cells: [], total: 0 };
      groups.push(g);
    }
    g.cells.push(c);
    g.total += cellValue(c.value);
  }
  if (sort !== 'none') {
    const order = new Map(groups.map((g, i) => [g, i]));
    const dir = sort === 'ascending' ? 1 : -1;
    groups.sort((a, b) => dir * (a.total - b.total) || order.get(a)! - order.get(b)!);
  }
  const total = groups.reduce((s, g) => s + g.total, 0);
  const room = Math.max(0, width - gap * Math.max(0, groups.length - 1));
  let x = 0;
  const columns = groups.map((g) => {
    const share = total > 0 ? g.total / total : 0;
    const w = share * room;
    const cat = (c: MekkoCell) => categories.indexOf(c.category);
    const ordered = g.cells
      .map((c, i) => ({ c, i }))
      .sort((a, b) => cat(a.c) - cat(b.c) || a.i - b.i)
      .map(({ c }) => c);
    let y = height;
    const segments = ordered.map((cell) => {
      const value = cellValue(cell.value);
      const s = value / g.total;
      const h = s * height;
      y -= h;
      return { cell, value, share: s, category: cat(cell), y, h };
    });
    const column = { name: g.name, total: g.total, share, x, w, segments };
    x += w + gap;
    return column;
  });
  return { columns, categories, total };
}
