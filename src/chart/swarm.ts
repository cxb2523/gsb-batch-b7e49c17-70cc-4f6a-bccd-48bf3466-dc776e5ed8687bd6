/**
 * Beeswarm packing: dots placed along a value axis at their value, each nudged sideways as little
 * as it can be so no two overlap. Everything here is in px, so dots stay round on screen.
 */

export interface SwarmDot {
  /** Position along the value axis (px). */
  at: number;
  /** Radius (px). */
  r: number;
}

/** Room left between neighbouring dots (px). */
const GAP = 0.75;

/**
 * Sideways offsets (px, 0 is the axis line) for `dots`, in the order given. Dots are placed from
 * one end of the axis to the other; each takes the free spot nearest the line, touching a dot
 * already placed or on the line itself (the classic greedy beeswarm), the positive side first on a tie.
 */
export function swarm(dots: SwarmDot[]): number[] {
  const order = dots.map((_, i) => i).sort((a, b) => dots[a].at - dots[b].at || a - b);
  const out = new Array<number>(dots.length).fill(0);
  const placed: { at: number; r: number; y: number }[] = [];
  let first = 0;
  const largest = maxR(dots);
  for (const i of order) {
    const { at, r } = dots[i];
    // Placed dots are in order along the axis: skip those too far behind to touch this one.
    while (first < placed.length && at - placed[first].at > r + largest + GAP) first++;
    const near = placed.slice(first).filter((q) => Math.abs(q.at - at) < q.r + r + GAP);
    const candidates = [0];
    for (const q of near) {
      const reach = q.r + r + GAP;
      const dy = Math.sqrt(Math.max(0, reach * reach - (q.at - at) ** 2));
      candidates.push(q.y + dy, q.y - dy);
    }
    const ok = candidates
      .sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)
      .find((y) => near.every((q) => (q.at - at) ** 2 + (q.y - y) ** 2 >= (q.r + r + GAP) ** 2 - 1e-6));
    const y = ok ?? 0;
    out[i] = y;
    placed.push({ at, r, y });
  }
  return out;
}

/** The largest radius among `dots` (for how far back a neighbour might reach). */
function maxR(dots: { r: number }[]): number {
  let m = 0;
  for (const d of dots) if (d.r > m) m = d.r;
  return m;
}

/** How far the swarm spreads from its line (px): the furthest dot's edge. */
export function swarmReach(dots: SwarmDot[], offsets: number[]): number {
  let m = 0;
  dots.forEach((d, i) => {
    m = Math.max(m, Math.abs(offsets[i]) + d.r);
  });
  return m;
}

/**
 * Pack dots into a band `half` px either side of the line. A swarm too tall for its band is
 * packed again with smaller dots (down to `minR`); one still too tall after that is squeezed
 * into the band, letting its dots overlap rather than spill into the next row.
 * Returns the offsets and the scale the radii were drawn at.
 */
export function fitSwarm(dots: SwarmDot[], half: number, minR = 1): { offsets: number[]; scale: number } {
  let scale = 1;
  let offsets = swarm(dots);
  const reachAt = (s: number) =>
    swarmReach(
      dots.map((d) => ({ ...d, r: d.r * s })),
      offsets,
    );
  const smallest = Math.min(...dots.map((d) => d.r));
  const floor = Math.min(1, minR / Math.max(smallest, 1e-9));
  for (let tries = 0; tries < 4; tries++) {
    const reach = reachAt(scale);
    if (reach <= half) return { offsets, scale };
    const next = Math.max(floor, scale * Math.sqrt(half / reach) * 0.95);
    if (next >= scale) break;
    scale = next;
    offsets = swarm(dots.map((d) => ({ ...d, r: d.r * scale })));
  }
  const reach = reachAt(scale);
  if (reach > half) {
    const room = Math.max(0, half - Math.max(...dots.map((d) => d.r * scale)));
    const furthest = Math.max(...offsets.map(Math.abs));
    if (furthest > 0) offsets = offsets.map((y) => (y * room) / furthest);
  }
  return { offsets, scale };
}

/**
 * Dot radius for a value when dots are sized by value: the dot's area grows from 12 % at the
 * lowest value in the row (`lo`) to all of it at the highest (`hi`).
 */
export function sizeFor(v: number, lo: number, hi: number, r: number): number {
  if (!(hi > lo)) return r;
  const share = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return r * Math.sqrt(0.12 + 0.88 * share);
}
