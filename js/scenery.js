// What stands on the land: water that behaves like water, buildings and trees.
// All of it comes from OpenStreetMap, streamed as vector tiles (OpenFreeMap,
// no key) and turned into geometry in the browser a few milliseconds a frame.
//
//   water      the map's water polygons are rasterised into a small mask for
//              every terrain tile; the terrain shader does the rest
//   buildings  footprints from the finest tiles around the aircraft, extruded
//              to their mapped height and merged into one mesh per map tile
//   trees      scattered through mapped woodland, one instanced mesh per tile
//
// Roofs and trees take their colour from the satellite photograph beneath
// them, so they belong to the picture instead of sitting on it.
import * as THREE from '../vendor/three.module.js';
import { atmoUniforms, ATMO_GLSL } from './atmo.js';
import { cloudUniforms, CLOUD_COVER_GLSL } from './clouds.js';
import { readTile, polygons, ringArea, LINE, POLYGON } from './mvt.js';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const LAYERS = ['water', 'building', 'landcover', 'transportation', 'aeroway'];
const WATER_LAG = 2;            // a terrain tile at zoom z reads its water from the vector tile at z - 2
const MAX_FETCH = 6;
const CACHE_BYTES = 48e6;
const R_BUILD = 3800, R_TREES = 2100;   // metres from the eye
const TREE_CAP = 15000, TREE_SPACING = 9.5;
const VERT_BUDGET = 3.2e6;      // building vertices in memory
const EXT = 4096;

// ------------------------------------------------------------------ the tile service
let endpoint = null;
function getEndpoint() {
  if (!endpoint) {
    endpoint = fetch(TILEJSON).then((r) => { if (!r.ok) throw new Error('tilejson ' + r.status); return r.json(); })
      .then((j) => {
        if (!j.tiles || !j.tiles[0]) throw new Error('tilejson');
        return { template: j.tiles[0], maxZoom: Math.min(14, j.maxzoom ?? 14) };
      })
      .catch((err) => { endpoint = null; throw err; });
  }
  return endpoint;
}

class VectorTiles {
  constructor() {
    this.map = new Map();
    this.wanted = [];
    this.active = 0; this.frame = 0; this.bytes = 0; this.failures = 0;
    this.info = null; this.retry = 0; this.dead = false;
    this.connect();
  }
  connect() {
    this.retry = Infinity;
    getEndpoint().then((info) => { this.info = info; }, () => { this.retry = performance.now() + 15000; });
  }
  // Ask for a tile. The entry comes back at once; its state says whether the data is there yet.
  want(z, x, y, prio) {
    const key = z + '/' + x + '/' + y;
    let en = this.map.get(key);
    if (!en) { en = { key, z, x, y, state: 'new', tile: null, used: 0, asked: -1, prio, retry: 0, bytes: 0 }; this.map.set(key, en); }
    en.used = this.frame;
    if (en.state === 'new' && en.asked !== this.frame) { en.asked = this.frame; en.prio = prio; this.wanted.push(en); }
    return en;
  }
  pump() {
    this.frame++;
    const now = performance.now();
    if (!this.info) { if (now > this.retry) this.connect(); this.wanted.length = 0; return; }
    this.wanted.sort((a, b) => a.prio - b.prio);
    for (let i = 0; i < this.wanted.length && this.active < MAX_FETCH; i++) {
      const en = this.wanted[i];
      if (en.state === 'new' && now >= en.retry) this.load(en);
    }
    this.wanted.length = 0;
    if (this.bytes > CACHE_BYTES) this.prune();
  }
  async load(en) {
    en.state = 'loading';
    this.active++;
    try {
      const url = this.info.template.replace('{z}', en.z).replace('{x}', en.x).replace('{y}', en.y);
      const res = await fetch(url, { mode: 'cors' });
      if (res.status === 404 || res.status === 204) en.tile = { layers: new Map(), bytes: 0 };
      else if (!res.ok) throw new Error('tile ' + res.status);
      else en.tile = readTile(await res.arrayBuffer(), LAYERS);
      if (this.dead) return;
      en.bytes = en.tile.bytes; this.bytes += en.bytes;
      en.state = 'ready';
    } catch (err) {
      en.state = 'new'; en.retry = performance.now() + 8000; this.failures++;
    } finally { this.active--; }
  }
  prune() {
    const all = [...this.map.values()].filter((en) => en.state === 'ready' && en.used < this.frame - 120).sort((a, b) => a.used - b.used);
    for (const en of all) {
      if (this.bytes < CACHE_BYTES * 0.75) break;
      this.bytes -= en.bytes;
      this.map.delete(en.key);
    }
  }
}

// ------------------------------------------------------------------ small geometry
function hash2(x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Sutherland-Hodgman: a ring cut down to the tile square.
function clipRing(ring) {
  let a = ring;
  for (let side = 0; side < 4 && a.length >= 6; side++) {
    const axis = side & 1, lim = side < 2 ? 0 : EXT, keepAbove = side < 2;
    const b = [];
    let px = a[a.length - 2], py = a[a.length - 1];
    let pin = keepAbove ? (axis ? py : px) >= lim : (axis ? py : px) <= lim;
    for (let i = 0; i < a.length; i += 2) {
      const x = a[i], y = a[i + 1];
      const v = axis ? y : x;
      const inside = keepAbove ? v >= lim : v <= lim;
      if (inside !== pin) {
        const pv = axis ? py : px, t = (lim - pv) / (v - pv);
        if (axis) b.push(px + (x - px) * t, lim); else b.push(lim, py + (y - py) * t);
      }
      if (inside) b.push(x, y);
      px = x; py = y; pin = inside;
    }
    a = b;
  }
  return a;
}

// Drop repeated and collinear points: fewer walls, and ears that are really ears.
function tidyRing(ring) {
  const out = [];
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const x = ring[i * 2], y = ring[i * 2 + 1];
    const m = out.length;
    if (m >= 2 && Math.abs(out[m - 2] - x) < 0.01 && Math.abs(out[m - 1] - y) < 0.01) continue;
    out.push(x, y);
  }
  while (out.length >= 4 && Math.abs(out[0] - out[out.length - 2]) < 0.01 && Math.abs(out[1] - out[out.length - 1]) < 0.01) out.length -= 2;
  let changed = true;
  while (changed && out.length >= 8) {
    changed = false;
    for (let i = 0, m = out.length / 2; i < m && m > 3; i++) {
      const a = ((i + m - 1) % m) * 2, b = i * 2, c = ((i + 1) % m) * 2;
      const cr = (out[b] - out[a]) * (out[c + 1] - out[a + 1]) - (out[b + 1] - out[a + 1]) * (out[c] - out[a]);
      const len = Math.abs(out[c] - out[a]) + Math.abs(out[c + 1] - out[a + 1]);
      if (Math.abs(cr) <= 0.35 * len) { out.splice(b, 2); changed = true; m--; i--; }
    }
  }
  return out;
}

const cross = (P, a, b, c) => (P[b * 2] - P[a * 2]) * (P[c * 2 + 1] - P[a * 2 + 1]) - (P[b * 2 + 1] - P[a * 2 + 1]) * (P[c * 2] - P[a * 2]);
function loopArea(P, loop) {
  let s = 0;
  for (let i = 0, n = loop.length, j = n - 1; i < n; j = i, i++) s += P[loop[j] * 2] * P[loop[i] * 2 + 1] - P[loop[i] * 2] * P[loop[j] * 2 + 1];
  return s;
}
function segsCross(P, a, b, c, d) {
  const d1 = cross(P, c, d, a), d2 = cross(P, c, d, b), d3 = cross(P, a, b, c), d4 = cross(P, a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function clearPath(P, loop, a, b) {
  for (let i = 0, n = loop.length, j = n - 1; i < n; j = i, i++) if (segsCross(P, a, b, loop[j], loop[i])) return false;
  return true;
}

// Ear clipping for one polygon with holes. P holds every ring's points one
// after another; spans = [start, count, ...] with the outer ring first.
// Triangles (as indices into P, plus off) come out counter-clockwise seen from above.
function triangulate(P, spans, out, off) {
  const loop = [];
  for (let i = 0; i < spans[1]; i++) loop.push(spans[0] + i);
  const sign = loopArea(P, loop) < 0 ? -1 : 1;
  // stitch each hole into the outline with a bridge to the nearest corner that can see it
  const holes = [];
  for (let h = 2; h < spans.length; h += 2) {
    const hl = [];
    for (let i = 0; i < spans[h + 1]; i++) hl.push(spans[h] + i);
    if ((loopArea(P, hl) < 0 ? -1 : 1) === sign) hl.reverse();
    let m = 0;
    for (let i = 1; i < hl.length; i++) if (P[hl[i] * 2] > P[hl[m] * 2]) m = i;
    holes.push({ hl, m, x: P[hl[m] * 2] });
  }
  holes.sort((a, b) => b.x - a.x);
  for (const { hl, m } of holes) {
    if (loop.length * hl.length > 60000) continue;
    const hm = hl[m];
    // nearest corners first: the nearest is nearly always in plain sight
    const cand = [];
    for (let k = 0; k < loop.length; k++) {
      const v = loop[k], dx = P[v * 2] - P[hm * 2], dy = P[v * 2 + 1] - P[hm * 2 + 1], d = dx * dx + dy * dy;
      if (d > 0) cand.push(d, k);
    }
    let best = -1;
    for (let tries = 0; tries < 16 && best < 0; tries++) {
      let j = -1;
      for (let q = 0; q < cand.length; q += 2) if (cand[q] >= 0 && (j < 0 || cand[q] < cand[j])) j = q;
      if (j < 0) break;
      const k = cand[j + 1];
      cand[j] = -1;
      if (clearPath(P, loop, loop[k], hm) && clearPath(P, hl, loop[k], hm)) best = k;
    }
    if (best < 0) continue;
    const ins = [];
    for (let i = 0; i <= hl.length; i++) ins.push(hl[(m + i) % hl.length]);
    ins.push(loop[best]);
    loop.splice(best + 1, 0, ...ins);
  }
  let n = loop.length, i = 0, stall = 0;
  const emit = (a, b, c) => { if (sign < 0) out.push(a + off, b + off, c + off); else out.push(a + off, c + off, b + off); };
  while (n > 3) {
    const a = loop[(i + n - 1) % n], b = loop[i], c = loop[(i + 1) % n];
    const cr = cross(P, a, b, c) * sign;
    if (cr === 0) { loop.splice(i, 1); n--; if (i >= n) i = 0; stall = 0; continue; }
    let ear = cr > 0;
    if (ear) {
      const ax = P[a * 2], ay = P[a * 2 + 1], bx = P[b * 2], by = P[b * 2 + 1], cx = P[c * 2], cy = P[c * 2 + 1];
      for (let k = 0; k < n; k++) {
        const p = loop[k];
        if (p === a || p === b || p === c) continue;
        const x = P[p * 2], y = P[p * 2 + 1];
        if ((x === ax && y === ay) || (x === bx && y === by) || (x === cx && y === cy)) continue;
        const s1 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * sign;
        const s2 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) * sign;
        const s3 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) * sign;
        if (s1 >= 0 && s2 >= 0 && s3 >= 0) { ear = false; break; }
      }
    }
    if (ear) { emit(a, b, c); loop.splice(i, 1); n--; if (i >= n) i = 0; stall = 0; }
    else {
      i = (i + 1) % n;
      if (++stall > n) { for (let k = 1; k < n - 1; k++) emit(loop[0], loop[k], loop[k + 1]); return; }   // tangled data: close it up and move on
    }
  }
  if (n === 3) emit(loop[0], loop[1], loop[2]);
}

// A four-cornered footprint that is near enough a rectangle gets a gabled
// roof. Returns which corner the long side starts at and the eave height.
function gableOf(P, unit, h) {
  const len = (a, b) => Math.hypot(P[b * 2] - P[a * 2], P[b * 2 + 1] - P[a * 2 + 1]) * unit;
  const l0 = len(0, 1), l1 = len(1, 2), l2 = len(2, 3), l3 = len(3, 0);
  if (Math.abs(l0 - l2) > 0.25 * Math.max(l0, l2) || Math.abs(l1 - l3) > 0.25 * Math.max(l1, l3)) return null;
  const dot = ((P[2] - P[0]) * (P[4] - P[2]) + (P[3] - P[1]) * (P[5] - P[3])) * unit * unit / (l0 * l1);
  if (Math.abs(dot) > 0.3) return null;
  const turn = l0 >= l1 ? 0 : 1, short = Math.min(l0 + l2, l1 + l3) * 0.5;
  if (short < 3.5) return null;
  const rise = Math.min(4.5, Math.max(1.2, 0.29 * short));
  return { turn, eave: Math.max(2.4, h - rise) };
}

// How wide a mapped way is on the ground, metres.
function wayWidth(p) {
  switch (p.class) {
    case 'motorway': return 13;
    case 'trunk': return 12;
    case 'primary': return 11;
    case 'secondary': return 10;
    case 'tertiary': return 8.5;
    case 'minor': return 7;
    case 'service': case 'track': return 4.5;
    case 'rail': case 'transit': return 6;
    case 'path': return 3;
    default: return 6;
  }
}
function tracePath(ctx, rings, close) {
  ctx.beginPath();
  for (const r of rings) {
    ctx.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]);
    if (close) ctx.closePath();
  }
}
function bounds(rings) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    const x = r[i], y = r[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// ------------------------------------------------------------------ shaders
const COMMON_FRAG = /* glsl */`
precision highp float;
uniform vec2 uCamXZ;
varying vec3 vRel;
varying float vAlt;
varying vec4 vTint;
${ATMO_GLSL}
${CLOUD_COVER_GLSL}
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float cloudShade() {
  vec2 xz = vRel.xz + uCamXZ;
  float up = max(uLightDir.y, 0.06);
  vec2 sp = xz + uLightDir.xz * ((uLow.x + uLow.y) * 0.5 - vAlt) / up;
  float shade = 1.0 - 0.78 * cloudCover(sp, uLow.z) * step(vAlt, uLow.x);
  return shade * (1.0 - 0.55 * cloudCover(sp * 0.37 + 9000.0, uMid.z));
}`;

const BUILDING_VERT = /* glsl */`
attribute float base;
attribute vec4 tint;
uniform float uRange;
varying vec3 vRel;
varying vec3 vLocal;
varying float vAlt;
varying vec4 vTint;
void main() {
  vec4 wp = modelMatrix * vec4(position.x, base, position.z, 1.0);
  // buildings rise out of the ground at the edge of their range instead of popping
  float grow = 1.0 - smoothstep(uRange * 0.80, uRange, length(wp.xyz));
  float y = position.y > 0.0 ? position.y * grow - (1.0 - grow) * 3.0 : position.y;
  wp.y += y;
  vAlt = base + y;
  wp.y -= dot(wp.xz, wp.xz) * (0.5 / 6371008.8);
  vRel = wp.xyz;
  vLocal = vec3(position.x, y, position.z);
  vTint = tint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BUILDING_FRAG = /* glsl */`
${COMMON_FRAG}
varying vec3 vLocal;
void main() {
  float dist = length(vRel);
  vec3 dir = vRel / dist;
  // walls and roofs share their corners, so the facet normal comes from the surface itself
  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));
  float roof = step(0.7, n.y);
  float id = vTint.a;
  // render, plaster, concrete, the odd ochre or rose one
  float pick = fract(id * 7.31) * 6.0;
  vec3 wall = vec3(0.60, 0.58, 0.54);
  wall = mix(wall, vec3(0.57, 0.51, 0.40), step(1.9, pick));
  wall = mix(wall, vec3(0.44, 0.44, 0.43), step(3.2, pick));
  wall = mix(wall, vec3(0.34, 0.33, 0.31), step(4.3, pick));
  wall = mix(wall, vec3(0.53, 0.40, 0.27), step(5.0, pick));
  wall = mix(wall, vec3(0.56, 0.44, 0.39), step(5.55, pick));
  wall *= 0.86 + 0.28 * fract(id * 3.17);
  vec3 albedo = mix(wall, pow(vTint.rgb, vec3(2.2)), roof);
  // windows: a grid of storeys along each wall, some of them lit after dark
  vec3 glow = vec3(0.0);
  if (roof < 0.5) {
    vec2 t = normalize(vec2(-n.z, n.x) + 1e-5);
    vec2 cell = vec2(dot(vLocal.xz, t) / 2.7 + id * 13.0, vLocal.y / 3.1);
    vec2 f = fract(cell), c = floor(cell);
    float above = step(0.0, vLocal.y);
    float pane = step(0.24, f.x) * step(f.x, 0.76) * step(0.28, f.y) * step(f.y, 0.78) * above;
    float close = 1.0 - smoothstep(500.0, 1800.0, dist);      // further out a pane is finer than a pixel: use the average
    float lit = step(0.76, hash21(c + floor(id * 255.0) * 0.37));
    albedo *= 1.0 - 0.58 * mix(0.26 * above, pane, close);
    albedo *= mix(0.72, 1.0, above);                          // the footing, where the ground falls away
    albedo *= mix(0.74, 1.0, smoothstep(-0.5, 2.6, vLocal.y)); // and the wall darkens toward the ground it stands on
    vec3 lamp = mix(vec3(1.0, 0.66, 0.34), vec3(1.0, 0.86, 0.68), hash21(c + 3.3));
    glow = uNight * lamp * mix(0.022 * above, pane * lit, close) * 0.34;   // far off, a faint wash: the ground's own town lights carry the distance
  }
  float shade = cloudShade();
  float ndl = max(dot(n, uLightDir), 0.0);
  vec3 sky = uAmbient * mix(0.62, 1.0, roof) + uSunLight * (1.0 - roof) * 0.07 * max(uLightDir.y, 0.0) * shade;
  vec3 col = albedo * (uSunLight * ndl * shade * 1.05 + sky) + glow;
  col = applyHaze(col, dir, dist, vAlt);
  gl_FragColor = vec4(col, dist * 0.001);
}`;

const TREE_VERT = /* glsl */`
attribute vec3 posB;
attribute vec3 norB;
attribute vec4 iPos;     // east, ground, south, height (negative: broadleaf)
attribute vec4 iTint;    // colour from the photograph, and a random number
uniform float uRange;
varying vec3 vRel;
varying vec3 vN;
varying float vAlt;
varying float vUp;
varying vec3 vLeaf;
varying vec4 vTint;
void main() {
  float broad = step(iPos.w, 0.0);
  float h = abs(iPos.w);
  float r = iTint.a;
  vec3 p = mix(position, posB, broad);
  vec3 n = mix(normal, norB, broad);
  float a = r * 6.2832, cs = cos(a), sn = sin(a);
  p.xz = vec2(p.x * cs - p.z * sn, p.x * sn + p.z * cs) * (0.85 + 0.5 * fract(r * 9.7));
  n.xz = vec2(n.x * cs - n.z * sn, n.x * sn + n.z * cs);
  vec4 wp = modelMatrix * vec4(iPos.xyz, 1.0);
  // each tree has its own range, so the wood thins out with distance instead of ending at a line
  float reach = uRange * (0.42 + 0.58 * fract(r * 5.3));
  float grow = 1.0 - smoothstep(reach * 0.8, reach, length(wp.xyz));
  wp.xyz += p * (h * grow);
  vAlt = iPos.y + p.y * h * grow;
  vUp = p.y;
  vLeaf = p * h + r * 37.0;
  wp.y -= dot(wp.xz, wp.xz) * (0.5 / 6371008.8);
  vRel = wp.xyz;
  vN = n;
  vTint = iTint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const TREE_FRAG = /* glsl */`
${COMMON_FRAG}
varying vec3 vN;
varying float vUp;
varying vec3 vLeaf;
void main() {
  float dist = length(vRel);
  vec3 dir = vRel / dist;
  vec3 n = normalize(vN);
  vec3 albedo = pow(vTint.rgb, vec3(2.2));
  // clumps of foliage a metre or two across, fading to their average before they are finer than a pixel
  float clump = sin(vLeaf.x * 1.9 + 1.3 * sin(vLeaf.z * 2.3 + vLeaf.y)) * sin(vLeaf.y * 2.6 + 1.1 * sin(vLeaf.x * 1.7 + vLeaf.z * 0.9));
  float fine = sin(vLeaf.x * 7.1 + vLeaf.y * 3.3) * sin(vLeaf.z * 6.7 - vLeaf.y * 4.1);
  float close = 1.0 - smoothstep(120.0, 600.0, dist);
  albedo *= 1.0 + close * (0.26 * clump + 0.12 * fine * (1.0 - smoothstep(40.0, 160.0, dist)));
  float shade = cloudShade();
  float lit = max(dot(n, uLightDir) * 0.72 + 0.28, 0.0);     // foliage lets light through: no hard terminator
  float depth = mix(0.36, 1.0, smoothstep(0.05, 0.75, vUp)); // darker inside and underneath
  vec3 col = albedo * (uSunLight * lit * shade * 1.2 + uAmbient * (0.6 + 0.4 * n.y)) * depth;
  col = applyHaze(col, dir, dist, vAlt);
  gl_FragColor = vec4(col, dist * 0.001);
}`;

// A five-sided crown in two shapes sharing one index list: a fir and a round-headed tree.
function treeGeometry() {
  const SIDES = 5;
  const fir = [[0.03, 0.0], [0.23, 0.13], [0.11, 0.52], [0.0, 1.0]];        // radius, height (of a unit-tall tree)
  const oak = [[0.03, 0.0], [0.34, 0.40], [0.31, 0.74], [0.0, 0.98]];
  const firN = [-0.9, 0.42, 0.42, 1], oakN = [-0.9, -0.25, 0.55, 1];        // how far each ring's normal tips up
  const pos = [], posB = [], nor = [], norB = [], idx = [];
  for (let k = 0; k < 4; k++) {
    for (let s = 0; s < SIDES; s++) {
      const a = (s + (k & 1) * 0.5) / SIDES * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a);
      pos.push(cx * fir[k][0], fir[k][1], sz * fir[k][0]);
      posB.push(cx * oak[k][0], oak[k][1], sz * oak[k][0]);
      const put = (arr, up) => { const h = Math.sqrt(Math.max(0, 1 - up * up)); arr.push(cx * h, up, sz * h); };
      put(nor, firN[k]); put(norB, oakN[k]);
    }
  }
  for (let k = 0; k < 3; k++) for (let s = 0; s < SIDES; s++) {
    const a = k * SIDES + s, b = k * SIDES + (s + 1) % SIDES, c = a + SIDES, d = b + SIDES;
    if (k & 1) idx.push(a, d, b, a, c, d); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('posB', new THREE.Float32BufferAttribute(posB, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('norB', new THREE.Float32BufferAttribute(norB, 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ one map tile of buildings and trees
class Chunk {
  constructor(x, y, z, geo) {
    this.x = x; this.y = y; this.key = x + '/' + y;
    const s = 2 ** z;
    this.e0 = geo.eOfMercX(x / s); this.e1 = geo.eOfMercX((x + 1) / s);
    this.n1 = geo.nOfMercY(y / s); this.n0 = geo.nOfMercY((y + 1) / s);     // n1 is the north edge
    this.ce = 0.5 * (this.e0 + this.e1); this.cn = 0.5 * (this.n0 + this.n1);
    this.se = this.e1 - this.e0; this.sn = this.n1 - this.n0;
    this.mx = (x + 0.5) / s; this.my = (y + 0.5) / s;
    this.d = 0; this.dead = false;
    this.b = 'none'; this.t = 'none';          // none -> job -> ready | empty
    this.bMesh = null; this.tMesh = null;
    this.recs = null;                          // per building: first vertex, count, east, south of the tile centre
    this.sig = 0; this.seating = false;
    this.photo = null; this.photoZ = -1;
    this.verts = 0;
  }
}

export class Scenery {
  constructor(scene, geo, terrain, renderer) {
    this.geo = geo; this.terrain = terrain;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.vt = new VectorTiles();
    this.jobs = [];
    this.chunks = new Map();
    this.frame = 0; this.verts = 0; this.rr = 0;
    this.water = true; this.buildings = true; this.trees = true;
    this.cam = { e: 0, n: 0, u: 0 };
    const cv = () => { const c = new OffscreenCanvas(256, 256); return c.getContext('2d', { willReadFrequently: true }); };
    this.maskCtx = cv(); this.photoCtx = cv();
    const shared = { ...terrain.uniforms, ...atmoUniforms, ...cloudUniforms };
    this.bMat = new THREE.ShaderMaterial({
      vertexShader: BUILDING_VERT, fragmentShader: BUILDING_FRAG,
      uniforms: { uRange: { value: R_BUILD }, ...shared },
      side: THREE.FrontSide, blending: THREE.NoBlending,
    });
    this.tMat = new THREE.ShaderMaterial({
      vertexShader: TREE_VERT, fragmentShader: TREE_FRAG,
      uniforms: { uRange: { value: R_TREES }, ...shared },
      side: THREE.FrontSide, blending: THREE.NoBlending,
    });
    this.treeBase = treeGeometry();
  }

  addJob(prio, gen) {
    const job = { prio, gen };
    let i = this.jobs.length;
    while (i > 0 && this.jobs[i - 1].prio > prio) i--;
    this.jobs.splice(i, 0, job);
  }

  // cam: the eye in local east/north/up metres
  update(cam, dt) {
    if (!Number.isFinite(cam.e + cam.n + cam.u)) return;
    this.frame++;
    this.cam.e = cam.e; this.cam.n = cam.n; this.cam.u = cam.u;
    const T = this.terrain;
    T.uniforms.uTime.value += dt;
    if (this.vt.info) {
      if (this.water) this.updateWater();
      this.updateChunks();
    }
    this.vt.pump();

    // a few milliseconds of decoding and building, nearest things first; the terrain's own queue has right of way
    const budget = T.buildQueue.length ? 1.5 : 3.2;
    const t0 = performance.now();
    while (this.jobs.length && performance.now() - t0 < budget) {
      const job = this.jobs[0];
      let done = true;
      try { done = job.gen.next().done; } catch (err) { console.warn('scenery', err); }
      if (done) { const k = this.jobs.indexOf(job); if (k >= 0) this.jobs.splice(k, 1); }
    }
    this.pending = this.jobs.length + this.vt.active;

    for (const c of this.chunks.values()) {
      if (c.bMesh) c.bMesh.position.set(c.ce - cam.e, -cam.u, -(c.cn - cam.n));
      if (c.tMesh) c.tMesh.position.set(c.ce - cam.e, -cam.u, -(c.cn - cam.n));
    }
  }

  // ---------------------------------------------------------------- water
  updateWater() {
    const vis = this.terrain.visible, maxZ = this.vt.info.maxZoom;
    for (let i = 0; i < vis.length; i++) {
      const node = vis[i], w = node.water;
      if (!w || w.done || node.masking) continue;
      const zv = Math.max(0, Math.min(maxZ, node.z - WATER_LAG)), sh = node.z - zv;
      const en = this.vt.want(zv, node.x >> sh, node.y >> sh, node.d);
      if (en.state !== 'ready') continue;
      if (!en.waterState) { en.waterState = 'busy'; this.addJob(node.d * 0.3, this.readWater(en)); }
      else if (en.waterState === 'done') { node.masking = true; this.addJob(node.d * 0.3, this.maskJob(node, en, sh)); }
    }
  }
  // The water of one vector tile, decoded once: polygons, and the bridges that cross them.
  *readWater(en) {
    const out = { polys: [], bridges: [], decks: [] };
    const L = en.tile.layers.get('water');
    if (L) {
      for (let i = 0; i < L.count; i++) {
        const f = L.feature(i), p = f.props;
        if (f.type !== POLYGON || p.intermittent === 1 || p.brunnel === 'tunnel') continue;
        const rings = L.geometry(f).filter((r) => r.length >= 6);
        if (rings.length) out.polys.push({ rings, box: bounds(rings) });
        if ((i & 7) === 7) yield;
      }
    }
    const R = en.tile.layers.get('transportation');
    if (R && out.polys.length) {
      // metres per tile unit here, to turn road widths into line widths
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (en.y + 0.5) / 2 ** en.z)));
      const unit = 40075016.7 * Math.cos(lat) / 2 ** en.z / EXT;
      for (let i = 0; i < R.count; i++) {
        const f = R.feature(i), p = f.props;
        if ((i & 31) === 31) yield;
        if (p.brunnel !== 'bridge' && p.class !== 'bridge' && p.class !== 'pier') continue;
        const rings = R.geometry(f);
        if (!rings.length) continue;
        if (f.type === POLYGON) out.decks.push({ rings, box: bounds(rings) });
        else if (f.type === LINE) out.bridges.push({ rings, box: bounds(rings), w: Math.max(1.2, wayWidth(p) * 1.15 / unit) });
      }
    }
    en.water = out;
    en.waterState = 'done';
  }
  *maskJob(node, en, sh) {
    if (!node.disposed) this.terrain.setWater(node, this.mask(node, en.water, sh));
    node.masking = false;
  }
  // Rasterise the part of a vector tile's water that lies under one terrain tile.
  mask(node, W, sh) {
    if (!W.polys.length) return 'dry';
    const size = EXT / 2 ** sh;
    const x0 = (node.x - ((node.x >> sh) << sh)) * size, y0 = (node.y - ((node.y >> sh) << sh)) * size;
    const x1 = x0 + size, y1 = y0 + size;
    const hit = (b, m) => b[2] >= x0 - m && b[0] <= x1 + m && b[3] >= y0 - m && b[1] <= y1 + m;
    const polys = W.polys.filter((p) => hit(p.box, 1));
    if (!polys.length) return 'dry';
    const ctx = this.maskCtx, k = 256 / size;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    ctx.fillStyle = '#fff';
    for (const p of polys) { tracePath(ctx, p.rings, true); ctx.fill(); }
    // a bridge is not water, whatever lies under it
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (const d of W.decks) if (hit(d.box, 1)) { tracePath(ctx, d.rings, true); ctx.fill(); }
    for (const b of W.bridges) if (hit(b.box, b.w)) { ctx.lineWidth = b.w; tracePath(ctx, b.rings, false); ctx.stroke(); }
    const px = ctx.getImageData(0, 0, 256, 256).data;
    const out = new Uint8Array(65536);
    let lo = 255, hi = 0;
    for (let i = 0; i < 65536; i++) { const v = px[i * 4]; out[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi < 10 ? 'dry' : lo > 245 ? 'sea' : out;
  }

  // ---------------------------------------------------------------- which map tiles carry 3D scenery
  updateChunks() {
    const g = this.geo, T = this.terrain, cam = this.cam, z = this.vt.info.maxZoom, s = 2 ** z;
    const agl = Math.max(0, cam.u - T.heightAt(cam.e, cam.n));
    const cx = Math.floor(g.mercX(cam.e) * s), cy = Math.floor(g.mercY(cam.n) * s);
    const size = Math.abs(g.eOfMercX((cx + 1) / s) - g.eOfMercX(cx / s));
    const reach = Math.min(6, Math.ceil(R_BUILD / Math.max(size, 100)));
    const on = this.buildings || this.trees;
    if (on && agl < R_BUILD && this.frame % 8 === 1) {
      for (let j = -reach; j <= reach; j++) for (let i = -reach; i <= reach; i++) {
        const x = ((cx + i) % s + s) % s, y = cy + j;
        if (y < 0 || y >= s) continue;
        const key = x + '/' + y;
        if (this.chunks.has(key)) continue;
        const c = new Chunk(x, y, z, g);
        if (this.reach(c, agl) < R_BUILD) this.chunks.set(key, c);
      }
    }
    for (const c of this.chunks.values()) {
      c.d = this.reach(c, agl);
      if (c.d > R_BUILD * 1.25 || !on) { this.dropChunk(c); this.chunks.delete(c.key); continue; }
      if (c.tMesh && c.d > R_TREES * 1.3) this.dropTrees(c);
      const want = (this.buildings && c.b === 'none') || (this.trees && c.t === 'none' && c.d < R_TREES);
      if (!want) continue;
      const en = this.vt.want(z, c.x, c.y, c.d + 400);
      if (en.state !== 'ready' || T.levelAt(c.ce, c.cn) < Math.min(12, z)) continue;
      if (this.buildings && c.b === 'none' && (this.verts < VERT_BUDGET || c.d < 1200)) { c.b = 'job'; this.addJob(c.d + 200, this.buildingJob(c, en)); }
      if (this.trees && c.t === 'none' && c.d < R_TREES) { c.t = 'job'; this.addJob(c.d + 600, this.treeJob(c, en)); }
    }
    // the ground under a tile sharpens as you approach; one tile a frame checks whether it should stand its things again
    const list = [...this.chunks.values()];
    if (list.length) {
      const c = list[this.rr++ % list.length];
      if ((c.bMesh || c.tMesh) && !c.seating) {
        const sig = this.groundSig(c);
        if (sig !== c.sig) { c.seating = true; this.addJob(c.d + 300, this.seatJob(c, sig)); }
      }
    }
  }
  reach(c, agl) {
    const dx = Math.max(Math.abs(this.cam.e - c.ce) - c.se * 0.5, 0), dn = Math.max(Math.abs(this.cam.n - c.cn) - c.sn * 0.5, 0);
    return Math.hypot(dx, dn, agl);
  }
  groundSig(c) {
    let sig = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      sig = (Math.imul(sig, 31) + this.terrain.levelAt(c.e0 + (i + 0.5) / 8 * c.se, c.n0 + (j + 0.5) / 8 * c.sn)) | 0;
    }
    return sig;
  }
  dropTrees(c) {
    if (c.tMesh) { this.group.remove(c.tMesh); c.tMesh.geometry.dispose(); c.tMesh = null; }
    if (c.t !== 'job') c.t = 'none';
  }
  dropChunk(c) {
    c.dead = true;
    if (c.bMesh) { this.group.remove(c.bMesh); c.bMesh.geometry.dispose(); c.bMesh = null; this.verts -= c.verts; }
    if (c.tMesh) { this.group.remove(c.tMesh); c.tMesh.geometry.dispose(); c.tMesh = null; }
    c.photo = null; c.recs = null;
  }

  // The satellite picture over a tile, as pixels, from the terrain's own imagery.
  photoOf(c) {
    const z = this.vt.info.maxZoom;
    const node = this.terrain.nodeAt(c.mx, c.my, z);
    if (!node || !node.bitmap || node.z <= c.photoZ) return c.photo;
    const sh = z - node.z, size = 256 / 2 ** sh;
    const ctx = this.photoCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    try {
      ctx.drawImage(node.bitmap, (c.x - (node.x << sh)) * size, (c.y - (node.y << sh)) * size, size, size, 0, 0, 256, 256);
      c.photo = ctx.getImageData(0, 0, 256, 256).data;
      c.photoZ = node.z;
    } catch (err) { /* the tile went away under us: keep what we had */ }
    return c.photo;
  }

  // ---------------------------------------------------------------- buildings
  *buildingJob(c, en) {
    const L = en.tile.layers.get('building');
    if (!L || !L.count) { c.b = 'empty'; return; }
    const T = this.terrain;
    const photo = this.photoOf(c);
    const ue = c.se / EXT, un = c.sn / EXT;
    const pos = [], base = [], tint = [], idx = [], recs = [];
    let lo = Infinity, hi = -Infinity, top = 0;
    for (let i = 0; i < L.count; i++) {
      const f = L.feature(i), p = f.props;
      if (f.type !== POLYGON || p.hide_3d) continue;
      const mapped = +p.render_height || 0, floor = Math.max(0, +p.render_min_height || 0);
      if (mapped - floor < 1.5) continue;
      const polys = polygons(L.geometry(f));
      for (let q = 0; q < polys.length; q++) {
        yield;
        if (c.dead) return;
        const poly = polys[q];
        const [bx0, by0, bx1, by1] = bounds([poly.outer]);
        if (bx1 <= 0 || bx0 >= EXT || by1 <= 0 || by0 >= EXT) continue;
        const area = poly.area * ue * un;
        if (area < 9) continue;
        // centre of the whole footprint: the same point whichever tile draws it, so its height and colour agree across the seam
        let sx = 0, sy = 0;
        for (let k = 0; k < poly.outer.length; k += 2) { sx += poly.outer[k]; sy += poly.outer[k + 1]; }
        const ux = sx / (poly.outer.length / 2), uy = sy / (poly.outer.length / 2);
        const id = hash2(c.x * EXT + Math.round(ux), c.y * EXT + Math.round(uy));
        const cut = bx0 < 0 || by0 < 0 || bx1 > EXT || by1 > EXT;
        const rings = [];
        for (const src of [poly.outer, ...poly.holes]) {
          let r = cut ? clipRing(src) : src;
          r = tidyRing(r);
          if (r.length < 6) { if (src === poly.outer) { rings.length = 0; break; } continue; }
          const a = ringArea(r);
          if ((src === poly.outer) !== (a > 0)) { const rev = []; for (let k = r.length - 2; k >= 0; k -= 2) rev.push(r[k], r[k + 1]); r = rev; }
          rings.push(r);
        }
        if (!rings.length) continue;
        // 5 m is what the map says when it does not know; guess from the footprint instead
        let h = mapped;
        if (mapped === 5 && floor === 0) h = area < 45 ? 3.2 : area < 220 ? 6 + 3 * id : area < 900 ? 7 + 4.5 * id : 8 + 4 * id;
        const span = Math.hypot((bx1 - bx0) * ue, (by1 - by0) * un);
        const foot = floor > 0 ? floor : -(3 + 0.35 * span);

        const lx = (ux - EXT / 2) * ue, lz = (uy - EXT / 2) * un;
        const ground = T.heightAt(c.ce + lx, c.cn - lz);
        const rgb = this.roofColour(photo, ux / EXT, uy / EXT, id);
        const v0 = pos.length / 3;
        const P = [], spans = [];
        for (const r of rings) { spans.push(P.length / 2, r.length / 2); for (let k = 0; k < r.length; k++) P.push(r[k]); }
        const np = P.length / 2;
        const gable = !cut && floor === 0 && np === 4 && h >= 3.5 && h <= 14 && area < 320 ? gableOf(P, ue, h) : null;
        const eave = gable ? gable.eave : h;
        const put = (x, y, z) => { pos.push(x, y, z); base.push(ground); tint.push(rgb[0], rgb[1], rgb[2], Math.floor(id * 255.99)); };
        for (let lvl = 0; lvl < 2; lvl++) for (let k = 0; k < np; k++) put((P[k * 2] - EXT / 2) * ue, lvl ? foot : eave, (P[k * 2 + 1] - EXT / 2) * un);
        if (gable) {
          // a small rectangle is a house: give it a pitched roof, ridge along the long side
          const j = gable.turn, c0 = v0 + j, c1 = v0 + (j + 1) % 4, c2 = v0 + (j + 2) % 4, c3 = v0 + (j + 3) % 4, A = v0 + 8, B = v0 + 9;
          const mid = (a, b) => put((P[a * 2] + P[b * 2] - EXT) * 0.5 * ue, h, (P[a * 2 + 1] + P[b * 2 + 1] - EXT) * 0.5 * un);
          mid((j + 1) % 4, (j + 2) % 4); mid((j + 3) % 4, j);
          idx.push(c0, B, A, c0, A, c1, A, B, c3, A, c3, c2, c1, A, c2, c3, B, c0);
        } else triangulate(P, spans, idx, v0);
        for (let r = 0; r < spans.length; r += 2) {
          const s0 = spans[r], n = spans[r + 1];
          for (let k = 0; k < n; k++) {
            const a = s0 + k, b = s0 + (k + 1) % n;
            const ax = P[a * 2], ay = P[a * 2 + 1], bx = P[b * 2], by = P[b * 2 + 1];
            if (cut && ((ax === bx && (ax === 0 || ax === EXT)) || (ay === by && (ay === 0 || ay === EXT)))) continue;   // the cut face inside a building that spans two tiles
            idx.push(v0 + np + a, v0 + a, v0 + b, v0 + np + a, v0 + b, v0 + np + b);
          }
        }
        recs.push(v0, pos.length / 3 - v0, lx, lz);
        if (ground < lo) lo = ground;
        if (ground > hi) hi = ground;
        if (h > top) top = h;
      }
    }
    if (c.dead) return;
    if (!recs.length) { c.b = 'empty'; return; }
    yield;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('base', new THREE.BufferAttribute(new Float32Array(base), 1));
    yield;
    g.setAttribute('tint', new THREE.BufferAttribute(new Uint8Array(tint), 4, true));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5 * (lo + hi), 0), Math.hypot(c.se, c.sn) * 0.5 + 0.5 * (hi - lo) + top + 120);
    const mesh = new THREE.Mesh(g, this.bMat);
    mesh.position.set(c.ce - this.cam.e, -this.cam.u, -(c.cn - this.cam.n));
    this.group.add(mesh);
    c.bMesh = mesh; c.recs = new Float32Array(recs);
    c.verts = pos.length / 3; this.verts += c.verts;
    c.sig = this.groundSig(c);
    c.b = 'ready';
  }
  roofColour(photo, u, v, id) {
    if (photo) {
      const i = (Math.min(255, Math.max(0, Math.floor(v * 256))) * 256 + Math.min(255, Math.max(0, Math.floor(u * 256)))) * 4;
      let r = photo[i], g = photo[i + 1], b = photo[i + 2];
      // roofs in shadow or under a tree in the picture: lift them back to something a roof could be
      const lum = 0.3 * r + 0.55 * g + 0.15 * b;
      const k = lum < 70 ? 70 / Math.max(lum, 12) : 1;
      const grey = lum * k;
      return [Math.min(255, (r * k) * 0.8 + grey * 0.2), Math.min(255, (g * k) * 0.8 + grey * 0.2), Math.min(255, (b * k) * 0.8 + grey * 0.2)];
    }
    const pal = [[150, 132, 120], [128, 124, 120], [165, 120, 95], [112, 112, 116]];
    return pal[Math.floor(id * 3.999)];
  }

  // ---------------------------------------------------------------- trees
  *treeJob(c, en) {
    const tile = en.tile, L = tile.layers.get('landcover');
    const woods = [];
    if (L) for (let i = 0; i < L.count; i++) {
      const f = L.feature(i);
      if (f.type === POLYGON && f.props.class === 'wood') woods.push(L.geometry(f));
      if ((i & 15) === 15) yield;
    }
    if (c.dead) return;
    if (!woods.length) { c.t = 'empty'; return; }
    // where trees may stand: woodland, minus water, roads, buildings and anything an aeroplane uses.
    // The drawing is spread over many frames, so it gets a canvas of its own.
    const ctx = new OffscreenCanvas(256, 256).getContext('2d', { willReadFrequently: true });
    const k = 256 / EXT, ue = c.se / EXT;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 256, 256);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = '#fff';
    for (const rings of woods) { tracePath(ctx, rings, true); ctx.fill(); }
    // a 16 x 16 sketch of where the wood is, so the thousands of features nowhere near it are never drawn
    let px = ctx.getImageData(0, 0, 256, 256).data;
    const coarse = new Uint8Array(256);
    let wooded = 0;
    for (let i = 0; i < 65536; i++) if (px[i * 4] > 140) { wooded++; coarse[((i >> 12) << 4) | ((i & 255) >> 4)] = 1; }
    if (!wooded) { c.t = 'empty'; return; }
    yield;
    const near = (box, m) => {
      const i0 = Math.max(0, Math.floor((box[0] - m) * k) >> 4), i1 = Math.min(15, Math.floor((box[2] + m) * k) >> 4);
      const j0 = Math.max(0, Math.floor((box[1] - m) * k) >> 4), j1 = Math.min(15, Math.floor((box[3] + m) * k) >> 4);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (coarse[(j << 4) | i]) return true;
      return false;
    };
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineCap = 'butt'; ctx.lineJoin = 'bevel';
    const carve = [
      ['water', () => 1, 6],
      ['building', () => 1, 8],
      ['transportation', (f) => (f.props.brunnel === 'tunnel' || f.props.class === 'path' ? 0 : wayWidth(f.props) + 7), 0],
      ['aeroway', (f) => (f.props.class === 'runway' ? 90 : 40), 50],
    ];
    let drawn = 0;
    for (const [name, pick, grow] of carve) {
      const layer = tile.layers.get(name);
      if (!layer) continue;
      for (let i = 0; i < layer.count; i++) {
        if ((i & 7) === 7) {
          // the canvas only records what it is asked to draw; reading a pixel makes it do the work now, in small pieces
          if (drawn > 12) { ctx.getImageData(0, 0, 1, 1); drawn = 0; }
          yield;
          if (c.dead) return;
        }
        const f = layer.feature(i);
        const w = pick(f);
        if (!w) continue;
        const rings = layer.geometry(f);
        if (!rings.length) continue;
        if (f.type === POLYGON) {
          // one feature can be every building of a given height in the tile: take it a ring at a time
          for (let r = 0; r < rings.length; r++) {
            if (rings[r].length < 6 || !near(bounds([rings[r]]), grow / ue)) continue;
            tracePath(ctx, [rings[r]], true);
            ctx.fill();
            if (grow) { ctx.lineWidth = grow / ue; ctx.stroke(); }
            if (++drawn > 12) { ctx.getImageData(0, 0, 1, 1); drawn = 0; yield; if (c.dead) return; }
          }
        } else if (f.type === LINE && near(bounds(rings), w / ue)) { ctx.lineWidth = w / ue; tracePath(ctx, rings, false); ctx.stroke(); drawn++; }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const toPx = (e, n) => [(e - c.e0) / c.se * 256, (c.n1 - n) / c.sn * 256];
    for (const r of this.terrain.runways) {
      const a = toPx(r.e0 - r.ux * 400, r.n0 - r.uy * 400), b = toPx(r.e1 + r.ux * 400, r.n1 + r.uy * 400);
      ctx.lineCap = 'butt'; ctx.lineWidth = (r.width + 160) / c.se * 256;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    px = ctx.getImageData(0, 0, 256, 256).data;
    const cover = new Uint8Array(65536);
    wooded = 0;
    for (let i = 0; i < 65536; i++) { cover[i] = px[i * 4]; if (cover[i] > 140) wooded++; }
    if (!wooded) { c.t = 'empty'; return; }
    yield;
    if (c.dead) return;

    const photo = this.photoOf(c), T = this.terrain;
    const spacing = Math.max(TREE_SPACING, Math.sqrt(wooded / 65536 * c.se * c.sn / TREE_CAP));
    const cols = Math.ceil(c.se / spacing), rows = Math.ceil(c.sn / spacing);
    const line = this.firLine(c);
    const iPos = [], iTint = [];
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const seed = (c.x * 7919 + i) | 0, seed2 = (c.y * 104729 + j) | 0;
        const u = (i + hash2(seed, seed2)) / cols, v = (j + hash2(seed2 + 17, seed + 91)) / rows;
        const pi = Math.min(255, Math.floor(v * 256)) * 256 + Math.min(255, Math.floor(u * 256));
        if (cover[pi] < 140) continue;
        const r = hash2(seed + 5, seed2 + 3), r2 = hash2(seed2 + 11, seed + 29);
        const e = c.e0 + u * c.se, n = c.n1 - v * c.sn;
        const ground = T.heightAt(e, n);
        const fir = r2 < Math.min(0.92, Math.max(0.12, 0.25 + (ground - line * 0.5) / Math.max(line * 0.5, 200) * 0.7 + (line === 0 ? 0.7 : 0)));
        const h = fir ? 13 + 13 * r * r + 4 * r2 : 8 + 9 * r;
        let cr = 44, cg = 62, cb = 36;
        if (photo) {
          // the picture's own green, pulled a little toward leaf colour so a tree on a pale pixel is still a tree
          cr = photo[pi * 4] * 0.72 + 44 * 0.28; cg = photo[pi * 4 + 1] * 0.72 + 64 * 0.28; cb = photo[pi * 4 + 2] * 0.72 + 36 * 0.28;
          const lum = 0.3 * cr + 0.55 * cg + 0.15 * cb, lim = lum > 105 ? 105 / lum : lum < 38 ? 38 / Math.max(lum, 10) : 1;
          cr *= lim; cg *= lim; cb *= lim;
        }
        const tone = 0.74 + 0.40 * hash2(seed2 + 41, seed + 7);
        iPos.push(e - c.ce, ground - 0.3, -(n - c.cn), fir ? h : -h);
        iTint.push(Math.min(255, cr * tone), Math.min(255, cg * tone), Math.min(255, cb * tone), Math.floor(r * 255.99));
        if (ground < lo) lo = ground;
        if (ground > hi) hi = ground;
      }
      yield;
      if (c.dead) return;
    }
    const count = iPos.length / 4;
    if (!count) { c.t = 'empty'; return; }
    const g = new THREE.InstancedBufferGeometry();
    // copies, not references: disposing one tile's trees must not pull the buffers from under another's
    g.setIndex(this.treeBase.index.clone());
    for (const name of ['position', 'posB', 'normal', 'norB']) g.setAttribute(name, this.treeBase.getAttribute(name).clone());
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(iPos), 4));
    g.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Uint8Array(iTint), 4, true));
    g.instanceCount = count;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5 * (lo + hi), 0), Math.hypot(c.se, c.sn) * 0.5 + 0.5 * (hi - lo) + 60);
    const mesh = new THREE.Mesh(g, this.tMat);
    mesh.position.set(c.ce - this.cam.e, -this.cam.u, -(c.cn - this.cam.n));
    this.group.add(mesh);
    c.tMesh = mesh;
    if (!c.bMesh) c.sig = this.groundSig(c);
    c.t = 'ready';
  }
  // Fir or broadleaf: firs take over with height and toward the poles. This is
  // the altitude (m) at which a wood is nearly all conifer; 0 means everywhere.
  firLine(c) {
    const lat = Math.abs(this.geo.lat(c.cn));
    return lat > 57 ? 0 : lat < 25 ? 2600 : 2600 - (lat - 25) * 70;
  }

  // Put a tile's buildings and trees back on the ground after the terrain under them changed.
  *seatJob(c, sig) {
    const T = this.terrain;
    if (c.bMesh && c.recs) {
      const base = c.bMesh.geometry.getAttribute('base'), rc = c.recs;
      for (let i = 0; i < rc.length; i += 4) {
        const h = T.heightAt(c.ce + rc[i + 2], c.cn - rc[i + 3]);
        base.array.fill(h, rc[i], rc[i] + rc[i + 1]);
        if ((i & 255) === 252) { yield; if (c.dead) return; }
      }
      base.needsUpdate = true;
      // and if a sharper picture has arrived since, repaint the roofs from it
      const before = c.photoZ, photo = this.photoOf(c);
      if (photo && c.photoZ > before) {
        const tint = c.bMesh.geometry.getAttribute('tint'), ue = c.se / EXT, un = c.sn / EXT;
        for (let i = 0; i < rc.length; i += 4) {
          const id = tint.array[rc[i] * 4 + 3] / 255.99;
          const rgb = this.roofColour(photo, (rc[i + 2] / ue + EXT / 2) / EXT, (rc[i + 3] / un + EXT / 2) / EXT, id);
          for (let v = rc[i], end = rc[i] + rc[i + 1]; v < end; v++) { tint.array[v * 4] = rgb[0]; tint.array[v * 4 + 1] = rgb[1]; tint.array[v * 4 + 2] = rgb[2]; }
          if ((i & 255) === 252) { yield; if (c.dead) return; }
        }
        tint.needsUpdate = true;
      }
    }
    if (c.tMesh) {
      const at = c.tMesh.geometry.getAttribute('iPos'), a = at.array;
      for (let i = 0; i < a.length; i += 4) {
        a[i + 1] = T.heightAt(c.ce + a[i], c.cn - a[i + 2]) - 0.3;
        if ((i & 1023) === 1020) { yield; if (c.dead) return; }
      }
      at.needsUpdate = true;
    }
    c.sig = sig;
    c.seating = false;
  }

  stats() {
    let b = 0, t = 0, trees = 0;
    for (const c of this.chunks.values()) { if (c.bMesh) b++; if (c.tMesh) { t++; trees += c.tMesh.geometry.instanceCount; } }
    return { tiles: this.chunks.size, buildingTiles: b, buildingVerts: this.verts, treeTiles: t, trees, jobs: this.jobs.length, fetching: this.vt.active, cached: this.vt.map.size, cacheMB: +(this.vt.bytes / 1e6).toFixed(1), failures: this.vt.failures };
  }

  dispose() {
    this.vt.dead = true;
    this.jobs.length = 0;
    for (const c of this.chunks.values()) this.dropChunk(c);
    this.chunks.clear();
    this.vt.map.clear();
    this.bMat.dispose(); this.tMat.dispose(); this.treeBase.dispose();
    this.group.parent && this.group.parent.remove(this.group);
  }
}
