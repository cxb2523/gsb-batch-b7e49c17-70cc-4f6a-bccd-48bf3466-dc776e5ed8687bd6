import type { Blog } from "../../shared/blogs";
import { buildingMetrics, rand01 } from "./metrics";
import type { CityBuilding, CityLayout, CityRoad, CityTree } from "./types";

// ─── City plan ─────────────────────────────────────────────────
// No grid. A radial road plan (eight avenues + three ring roads) gives the
// city its shape; towers are scattered between the lanes with a minimum gap
// between them (rejection sampling against a spatial hash). Placement runs
// from the centre outwards, and blogs are taken freshest-first, so the newest
// writing always ends up downtown and the quiet ones drift to the edge.

const GAP = 15; // minimum air between two towers
const MAX_ATTEMPTS = 96;
const HASH = 18;

const SPOKES = 8;
const SPOKE_WIDTH = 12;
const RING_WIDTH = 9.5;
const RING_FRACS = [0.34, 0.62, 0.88];
// a tower keeps this much distance from the asphalt edge
const ROAD_PAD = 4.2;
const SPOKE_OFFSET = 0.14; // avenues are rotated slightly off the axes
// downtown is kept clear: a roundabout with the city's sign in the middle
export const PLAZA = 96;

interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 && Math.abs(a.z - b.z) * 2 < a.d + b.d + gap * 2;
}

export function buildCity(blogs: Blog[]): CityLayout {
  const members = [...blogs].sort((a, b) => b.fresh - a.fresh || a.num - b.num);
  const n = members.length;
  const specs = members.map((b) => buildingMetrics(b));

  // footprints up front, so the city radius can be budgeted before placement
  const feet = specs.map((s) => {
    const size = 7.6 + s.breadth * 3.8 + rand01(s.seed ^ 0x2f) * 1.8;
    return { w: size, d: size * (0.9 + rand01(s.seed ^ 0x1b3f) * 0.22) };
  });

  // area budget → radius; the packing factor stays low on purpose, the city
  // should read as scattered towers with air between them
  const area = feet.reduce((sum, f) => sum + (f.w + GAP) * (f.d + GAP), 0);
  const radius = Math.max(60, Math.sqrt(area / (Math.PI * 0.205)));

  // ── road plan ──
  const rings = RING_FRACS.map((f) => radius * f);
  const reach = radius * 1.16;
  const spokeBase = SPOKE_OFFSET;
  const lane = SPOKE_WIDTH / 2;

  /** perpendicular distance from the nearest avenue centreline */
  const spokeDist = (x: number, z: number): number => {
    const d = Math.hypot(x, z);
    const a = Math.atan2(z, x) - spokeBase;
    const step = (Math.PI * 2) / SPOKES;
    let off = ((a % step) + step) % step;
    if (off > step / 2) off -= step;
    return Math.abs(Math.sin(off)) * d;
  };

  const onRoad = (x: number, z: number, pad: number): boolean => {
    const d = Math.hypot(x, z);
    if (d <= reach && spokeDist(x, z) < lane + pad) return true;
    for (const r of rings) if (Math.abs(d - r) < RING_WIDTH / 2 + pad) return true;
    return false;
  };

  const buckets = new Map<string, Rect[]>();
  const key = (gx: number, gz: number) => `${gx},${gz}`;
  const hits = (r: Rect): boolean => {
    const x0 = Math.floor((r.x - r.w / 2 - GAP) / HASH);
    const x1 = Math.floor((r.x + r.w / 2 + GAP) / HASH);
    const z0 = Math.floor((r.z - r.d / 2 - GAP) / HASH);
    const z1 = Math.floor((r.z + r.d / 2 + GAP) / HASH);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const list = buckets.get(key(gx, gz));
        if (!list) continue;
        for (const other of list) if (overlaps(r, other, GAP)) return true;
      }
    }
    return false;
  };

  const buildings: CityBuilding[] = [];

  for (let i = 0; i < n; i++) {
    const blog = members[i];
    const spec = specs[i];
    const foot = feet[i];
    const even = Math.sqrt((i + 0.6) / n); // even coverage, centre first

    let placed: Rect | null = null;
    let pushed = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // after a while, let the tower slip outwards instead of giving up
      if (attempt > MAX_ATTEMPTS * 0.55) pushed += 0.03;
      const ring = radius * Math.min(1.3, even + pushed);
      const angle = rand01(spec.seed + attempt * 7919) * Math.PI * 2;
      const wobble = 1 + (rand01(spec.seed ^ attempt) - 0.5) * 0.14;
      const candidate: Rect = {
        x: Math.cos(angle) * ring * wobble,
        z: Math.sin(angle) * ring * wobble,
        w: foot.w,
        d: foot.d,
      };
      // a building may not sit on a road, and needs the pad around it
      if (onRoad(candidate.x, candidate.z, ROAD_PAD + Math.max(candidate.w, candidate.d) * 0.5)) continue;
      // the roundabout owns the middle of town
      if (Math.hypot(candidate.x, candidate.z) < PLAZA + 26 + Math.max(candidate.w, candidate.d) * 0.5) continue;
      if (hits(candidate)) continue;
      placed = candidate;
      break;
    }

    if (!placed) {
      const angle = rand01(spec.seed) * Math.PI * 2;
      const r = radius * (1.22 + rand01(spec.seed ^ 5) * 0.2);
      placed = { x: Math.cos(angle) * r, z: Math.sin(angle) * r, w: foot.w, d: foot.d };
    }

    const box = placed;
    const k = key(Math.floor(box.x / HASH), Math.floor(box.z / HASH));
    const list = buckets.get(k);
    if (list) list.push(box);
    else buckets.set(k, [box]);

    buildings.push({
      i,
      blog,
      x: box.x,
      z: box.z,
      w: box.w,
      d: box.d,
      h: spec.height,
      lit: spec.lit,
      cols: Math.max(2, Math.round(box.w / 2.7)),
      seed: (spec.seed % 9973) / 9973,
      color: facadeColor(spec.seed, blog.fresh, blog.dead),
    });
  }

  // ── roads, for rendering ──
  const roads: CityRoad[] = [];
  for (let s = 0; s < SPOKES; s++) {
    roads.push({
      kind: "spoke",
      at: spokeBase + (s * Math.PI * 2) / SPOKES,
      width: SPOKE_WIDTH,
      from: PLAZA - 4,
      to: reach,
    });
  }
  for (const r of rings) roads.push({ kind: "ring", at: r, width: RING_WIDTH, from: r, to: r });

  // ── trees: street trees first, then whatever fits in the empty lots ──
  const trees = plantTrees(radius, reach, rings, spokeBase, lane, buildings, buckets, onRoad);

  let minX = 0;
  let maxX = 0;
  let minZ = 0;
  let maxZ = 0;
  for (const b of buildings) {
    minX = Math.min(minX, b.x - b.w / 2);
    maxX = Math.max(maxX, b.x + b.w / 2);
    minZ = Math.min(minZ, b.z - b.d / 2);
    maxZ = Math.max(maxZ, b.z + b.d / 2);
  }

  return { buildings, roads, trees, plaza: PLAZA, extent: { minX, maxX, minZ, maxZ } };
}

// ─── Trees ─────────────────────────────────────────────────────
// Two passes: a formal line of trees along every avenue and ring, then loose
// clusters in the gaps. Both reject anything that would clip a tower.

const TREE_MIN_DIST = 19;
const TREE_HASH = 9;

function plantTrees(
  radius: number,
  reach: number,
  rings: number[],
  spokeBase: number,
  lane: number,
  buildings: CityBuilding[],
  buildingBuckets: Map<string, Rect[]>,
  onRoad: (x: number, z: number, pad: number) => boolean,
): CityTree[] {
  const trees: CityTree[] = [];
  const grid = new Map<string, { x: number; z: number }[]>();
  const gkey = (x: number, z: number) => `${Math.floor(x / TREE_HASH)},${Math.floor(z / TREE_HASH)}`;

  const clear = (x: number, z: number): boolean => {
    // too close to another tree?
    const gx = Math.floor(x / TREE_HASH);
    const gz = Math.floor(z / TREE_HASH);
    for (let a = gx - 1; a <= gx + 1; a++) {
      for (let b = gz - 1; b <= gz + 1; b++) {
        const list = grid.get(`${a},${b}`);
        if (!list) continue;
        for (const t of list) if (Math.hypot(t.x - x, t.z - z) < TREE_MIN_DIST) return false;
      }
    }
    // inside a tower?
    const bx0 = Math.floor((x - 8) / HASH);
    const bx1 = Math.floor((x + 8) / HASH);
    const bz0 = Math.floor((z - 8) / HASH);
    const bz1 = Math.floor((z + 8) / HASH);
    for (let a = bx0; a <= bx1; a++) {
      for (let b = bz0; b <= bz1; b++) {
        const list = buildingBuckets.get(`${a},${b}`);
        if (!list) continue;
        for (const r of list) {
          if (Math.abs(r.x - x) * 2 < r.w + 3 && Math.abs(r.z - z) * 2 < r.d + 3) return false;
        }
      }
    }
    // on the asphalt? the trunk has to stand on the verge, not in the lane
    if (Math.hypot(x, z) < PLAZA + 30) return false;
    return !onRoad(x, z, 1.0);
  };

  let seq = 0;
  const add = (x: number, z: number) => {
    if (!clear(x, z)) return;
    seq += 1;
    const k = gkey(x, z);
    const list = grid.get(k);
    const item = { x, z };
    if (list) list.push(item);
    else grid.set(k, [item]);
    const r1 = rand01(seq * 2654435761);
    const r2 = rand01(seq * 40503 + 17);
    trees.push({
      x,
      z,
      scale: 0.82 + r1 * 0.62,
      rot: r2 * Math.PI * 2,
      kind: r1 > 0.62 ? 1 : 0,
      tint: r2,
    });
  };

  // 1. street trees: both sides of every avenue
  const sideOff = lane + 3.4;
  for (let s = 0; s < SPOKES; s++) {
    const a = spokeBase + (s * Math.PI * 2) / SPOKES;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    for (let t = PLAZA + 34; t < reach - 10; t += 24) {
      for (const sign of [-1, 1]) {
        const jitterA = (rand01(Math.round(t * 13 + s * 97 + sign * 7)) - 0.5) * 2.4;
        const x = dx * t - dz * (sideOff + jitterA) * sign;
        const z = dz * t + dx * (sideOff + jitterA) * sign;
        add(x, z);
      }
    }
  }

  // 2. trees along the ring roads
  for (const r of rings) {
    const rIn = r - (RING_WIDTH / 2 + 3.6);
    const rOut = r + (RING_WIDTH / 2 + 3.6);
    const steps = Math.round((Math.PI * 2 * r) / 26);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 + 0.13;
      add(Math.cos(a) * rIn, Math.sin(a) * rIn);
      if (i % 2 === 0) add(Math.cos(a + 0.05) * rOut, Math.sin(a + 0.05) * rOut);
    }
  }

  // 3. loose clusters in the empty lots
  const scatter = Math.round(radius * 0.45);
  for (let i = 0; i < scatter; i++) {
    const a = rand01(i * 7919 + 3) * Math.PI * 2;
    const rr = Math.sqrt(rand01(i * 104729 + 11)) * radius * 1.02;
    add(Math.cos(a) * rr, Math.sin(a) * rr);
  }

  return trees;
}

// ─── Facade colour ─────────────────────────────────────────────
// Towers get a hue from a small neutral set, then warm up with freshness.
// Downtown reads amber, the outskirts cool blue.

const HUES = ["#5b8cff", "#3fc7c9", "#8b7bff", "#ff9d5c", "#63d6a0"];

function facadeColor(seed: number, fresh: number, dead: boolean): string {
  const hue = HUES[Math.floor(rand01(seed) * HUES.length) % HUES.length];
  const base = shade(hue, 0.14 + rand01(seed ^ 0x77) * 0.1);
  if (dead) return mixHex(base, "#2a3348", 0.55); // silent, forgotten
  return mixHex(base, "#ffb26b", 0.08 + fresh * 0.3);
}

/** Mix a hex colour towards near-black, i.e. "facade at night". */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const base = 0.05;
  const f = (c: number) => Math.round(255 * (base + (c / 255) * amount));
  return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255, f);
}

export function mixHex(a: string, b: string, t: number): string {
  const na = parseInt(a.replace("#", ""), 16);
  const nb = parseInt(b.replace("#", ""), 16);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * Math.max(0, Math.min(1, t)));
  return rgb(
    mix((na >> 16) & 255, (nb >> 16) & 255),
    mix((na >> 8) & 255, (nb >> 8) & 255),
    mix(na & 255, nb & 255),
    (v) => v,
  );
}

function rgb(r: number, g: number, b: number, f: (v: number) => number): string {
  return `#${((1 << 24) | (f(r) << 16) | (f(g) << 8) | f(b)).toString(16).slice(1)}`;
}
