// The aeroplane, built from code and from the same definition the physics flies: a lofted fuselage with real window cut-outs,
// aerofoil-section wings and tail, working control surfaces, gear, prop.
// One model serves both views: the cockpit is the inside of this same shell.
// Local axes: +X right, +Y up, -Z nose. Origin at the centre of gravity.
import * as THREE from '../vendor/three.module.js';
import C172S from './aircraft/c172s.js';
import { GlassRain } from './glass-rain.js';

const D2R = Math.PI / 180;
export const PROP_Y = 0.10;

function catmull(p0, p1, p2, p3, t) {
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

// ---- fuselage
// The 172 has a hand-drawn profile. Any other aircraft gets one derived from
// the fuselage stations in its definition: nose at the propeller hub, cabin
// hung under a high wing or sat on a low one, tail cone running to the tailplane.
// Each row: z (aft positive), bottom, top, half-width, squareness.
const STATIONS_172 = [
  [-2.02, -0.16, 0.34, 0.38, 2.6], [-1.80, -0.30, 0.37, 0.48, 2.8], [-1.05, -0.46, 0.39, 0.56, 3.0], [-0.95, -0.47, 0.40, 0.57, 3.0],
  [-0.45, -0.50, 0.86, 0.59, 3.6], [0.90, -0.50, 0.86, 0.59, 3.6], [1.50, -0.45, 0.84, 0.55, 3.4], [2.20, -0.34, 0.52, 0.42, 3.0],
  [3.20, -0.22, 0.38, 0.28, 2.6], [4.40, -0.10, 0.31, 0.16, 2.4], [5.30, 0.00, 0.28, 0.05, 2.2],
];
function glass172(x, y, z) {
  const ax = Math.abs(x);
  if (z > -0.93 && z < -0.47 && y > 0.435 && ax < 0.50) return true;                       // windscreen
  if (z > -0.86 && z < 0.86 && y > 0.40 && y < 0.79 && ax > 0.5 && !(z > 0.17 && z < 0.25) && !(z > -0.50 && z < -0.44)) return true; // doors
  if (z > 0.95 && z < 1.46 && y > 0.42 && y < 0.74 && ax > 0.44) return true;              // rear side windows
  if (z > 1.56 && z < 2.14 && y > 0.50 && ax < 0.36) return true;                          // rear window
  return false;
}
function fuselagePlan(def) {
  const high = def.wing.z < -0.3;
  if (def.id === 'c172s') return { stations: STATIONS_172, glass: glass172, high, crisp: [-1.06, 2.25], eye: [-0.26, 0.66, 0.16] };
  const B = def.body.stations.slice().sort((a, b) => b[0] - a[0]);        // nose to tail
  const deep = B.reduce((m, st) => (st[2] > m[2] ? st : m), B[0]);
  const wingY = -def.wing.z;
  const cabBottom = high ? wingY - 0.06 - deep[2] : wingY - 0.14;
  // a T-tail (tailplane on top of the fin, as on most gliders): the boom ends at the fin's root, not up at the tailplane
  const tTail = -def.htail.z > def.fin.h0 + 0.5 * (def.fin.h1 - def.fin.h0);
  const cabC = cabBottom + deep[2] / 2, tailC = tTail ? def.fin.h0 + 0.04 : -def.htail.z - 0.02;
  // the nose: on the propeller hub, or with no propeller on the cabin's centreline
  const hub = def.prop ? -def.prop.hub[1] : cabC - 0.04;
  const xN = B[0][0] + B[0][1] / 2, xT = Math.min(B[B.length - 1][0] - B[B.length - 1][1] / 2, def.fin.xLE - def.fin.chord[0] * 0.9);
  const row = (x, depth, width) => {
    const fwd = x >= deep[0];
    const t = fwd ? (x - deep[0]) / Math.max(0.01, xN - deep[0]) : (deep[0] - x) / Math.max(0.01, deep[0] - xT);
    // high wings keep a flat roof line; low wings keep a flat belly
    const c = fwd ? cabC + (hub - cabC) * Math.pow(t, 1.4) : cabC + (tailC - cabC) * Math.pow(t, 1.15);
    const anchor = fwd ? c : high ? (cabBottom + deep[2]) - depth / 2 + (tailC + depth / 2 - (cabBottom + deep[2])) * Math.pow(t, 1.6) : c;
    return [-x, anchor - depth / 2, anchor + depth / 2, width / 2, 2.4 + 1.0 * Math.min(1, depth / deep[2])];
  };
  const stations = [row(xN + 0.02, B[0][2] * 0.6, B[0][3] * 0.6)];
  for (const st of B) stations.push(row(st[0], st[2], st[3]));
  stations.push(row(xT, Math.max(0.1, B[B.length - 1][2] * 0.55), 0.07));
  // cabin: the stations nearly as deep as the deepest one
  const cabin = B.filter((st) => st[2] > 0.86 * deep[2]);
  const zF = -(cabin[0][0] + cabin[0][1] / 2), zA = -(cabin[cabin.length - 1][0] - cabin[cabin.length - 1][1] / 2);
  const top = cabBottom + deep[2], sill = cabBottom + deep[2] * (high ? 0.60 : 0.56), hw = deep[3] / 2;
  const glass = (x, y, z) => {
    const ax = Math.abs(x);
    if (y < sill) return false;
    if (z > zF - 0.55 && z < zF + 0.04) return ax < hw * 0.86 || !high;                    // windscreen
    if (z >= zF + 0.04 && z < zA - 0.04) {
      if (high) return y < top - 0.08 && ax > hw * 0.80 && Math.abs(((z - zF) % 0.95) - 0.9) > 0.05;   // side windows between posts
      return Math.abs(((z - zF) % 1.1) - 1.04) > 0.04;                                    // canopy, with a frame bow
    }
    return false;
  };
  const tandem = deep[3] < 0.85;
  const eyeY = high ? top - 0.20 : top - 0.17;
  const eye = [tandem ? 0 : -Math.min(0.26, hw * 0.45), eyeY, zF + 0.72];
  return { stations, glass, high, crisp: [zF - 0.6, zA + 0.3], eye };
}
function stationAt(z, S, crispRange) {
  let i = 0;
  while (i < S.length - 2 && z > S[i + 1][0]) i++;
  const t = Math.min(1, Math.max(0, (z - S[i][0]) / (S[i + 1][0] - S[i][0])));
  const a = S[Math.max(i - 1, 0)], b = S[i], c = S[i + 1], d = S[Math.min(i + 2, S.length - 1)];
  const sm = (k) => catmull(a[k], b[k], c[k], d[k], t);
  const lin = (k) => b[k] + (c[k] - b[k]) * t;
  // the windscreen and the cabin stay crisp; the rest of the skin is faired
  const crisp = z > crispRange[0] && z < crispRange[1];
  return { bottom: crisp ? lin(1) : sm(1), top: lin(2), hw: crisp ? lin(3) : sm(3), n: lin(4) };
}
function buildFuselage(plan) {
  const S = plan.stations, z0 = S[0][0], z1 = S[S.length - 1][0], zs = [];
  for (let z = z0; z < plan.crisp[0]; z += 0.12) zs.push(z);
  for (let z = Math.max(z0, plan.crisp[0]); z < Math.min(z1, plan.crisp[1]); z += 0.05) zs.push(z);
  for (let z = Math.min(z1, plan.crisp[1]); z < z1; z += 0.18) zs.push(z);
  zs.push(z1);
  const M = 48, pos = [];
  for (const z of zs) {
    const st = stationAt(z, S, plan.crisp);
    const yc = 0.5 * (st.bottom + st.top), hh = 0.5 * (st.top - st.bottom);
    for (let k = 0; k < M; k++) {
      const th = (k / M) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th), e = 2 / st.n;
      pos.push(st.hw * Math.sign(cs) * Math.pow(Math.abs(cs), e), yc + hh * Math.sign(sn) * Math.pow(Math.abs(sn), e), z);
    }
  }
  const paint = [], accent = [], glass = [];
  for (let i = 0; i < zs.length - 1; i++) for (let k = 0; k < M; k++) {
    const a = i * M + k, b = i * M + (k + 1) % M, c = (i + 1) * M + k, d = (i + 1) * M + (k + 1) % M;
    const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3] + pos[d * 3]) / 4;
    const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4;
    const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2] + pos[d * 3 + 2]) / 4;
    // k runs anticlockwise seen from behind, starting at the right side
    const stripe = (k === M - 3 || k === M - 4 || k === M / 2 + 2 || k === M / 2 + 3) && cz > z0 + 0.3 && cz < z1 - 0.4;
    (plan.glass(cx, cy, cz) ? glass : stripe ? accent : paint).push(a, b, c, b, d, c);
  }
  const capStart = pos.length / 3;
  pos.push(0, 0.5 * (S[0][1] + S[0][2]), zs[0] - 0.02);
  for (let k = 0; k < M; k++) paint.push(capStart, (k + 1) % M, k);
  const position = new THREE.Float32BufferAttribute(pos, 3);
  const all = new THREE.BufferGeometry();
  all.setAttribute('position', position); all.setIndex([...paint, ...accent, ...glass]); all.computeVertexNormals();
  const out = {};
  for (const [name, idx] of [['paint', paint], ['accent', accent], ['glass', glass]]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position); g.setAttribute('normal', all.getAttribute('normal')); g.setIndex(idx);
    out[name] = g;
  }
  return out;
}

// NACA 4-digit section as a closed loop: upper surface LE->cut, lower surface cut->LE.
function airfoil(t, m, p, cut = 1, n = 12) {
  const pts = [];
  const yt = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  const yc = (x) => (m === 0 ? 0 : x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x));
  for (let i = 0; i <= n; i++) { const x = cut * 0.5 * (1 - Math.cos((i / n) * Math.PI)); pts.push([x, yc(x) + yt(x)]); }
  for (let i = n; i >= 1; i--) { const x = cut * 0.5 * (1 - Math.cos((i / n) * Math.PI)); pts.push([x, yc(x) - yt(x)]); }
  return pts;
}

// Loft a surface through sections. Each: { le: [x,y,z], chord, inc (rad) }.
// chord runs aft (+Z); thickness along `up`.
function loft(sections, profile, up = [0, 1, 0]) {
  const pos = [], idx = [];
  const P = profile.length;
  for (const s of sections) {
    for (const [xc, yc] of profile) {
      const dz = xc * s.chord;
      const dy = yc * s.chord - (xc - 0.25) * s.chord * Math.tan(s.inc || 0);
      pos.push(s.le[0] + up[0] * dy, s.le[1] + up[1] * dy, s.le[2] + dz + up[2] * dy);
    }
  }
  for (let i = 0; i < sections.length - 1; i++) for (let k = 0; k < P; k++) {
    const a = i * P + k, b = i * P + (k + 1) % P, c = (i + 1) * P + k, d = (i + 1) * P + (k + 1) % P;
    idx.push(a, c, b, b, c, d);
  }
  for (const end of [0, sections.length - 1]) {
    const base = end * P;
    for (let k = 1; k < P - 1; k++) end === 0 ? idx.push(base, base + k, base + k + 1) : idx.push(base, base + k + 1, base + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

// A hinged wedge between two hinge points; returns a group whose child `pivot`
// rotates about the hinge (positive x-rotation = trailing edge down).
function surface(p0, p1, c0, c1, t0, t1, mat) {
  const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
  const L = a.distanceTo(b);
  const v = [0, t0 / 2, 0, 0, -t0 / 2, 0, 0, 0, c0, L, t1 / 2, 0, L, -t1 / 2, 0, L, 0, c1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 2, 3, 2, 5, 3, 1, 4, 2, 2, 4, 5, 0, 3, 1, 1, 3, 4, 0, 1, 2, 3, 5, 4]);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  const group = new THREE.Group();
  group.position.copy(a);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(flat, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  pivot.add(mesh);
  group.add(pivot);
  group.pivot = pivot;
  return group;
}

function strut(a, b, r, mat, squash = 1) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 10), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  m.scale.z = squash;
  m.castShadow = true;
  return m;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function discTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, 'rgba(20,20,22,0.0)'); g.addColorStop(0.3, 'rgba(20,20,22,0.20)'); g.addColorStop(0.9, 'rgba(20,20,22,0.12)');
  g.addColorStop(0.955, 'rgba(235,235,230,0.22)'); g.addColorStop(0.985, 'rgba(20,20,22,0.10)'); g.addColorStop(1, 'rgba(20,20,22,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const tab = (t, x) => {
  if (typeof t === 'number') return t;
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
  return t[t.length - 1][1];
};

// One accent colour per aircraft, so a line of them reads as a fleet.
const LIVERY = { c172s: 0x18233c, c152: 0x8f1d21, pa28: 0x1f4a3a, c182t: 0x2b2f66, j3: 0x1a1a1a, sr22: 0x3a3f47, extra300: 0xb3261e, ask21: 0xb3261e, dr400: 0x1c3f6e };

export function buildAircraft(def = C172S) {
  const group = new THREE.Group();
  const cub = def.id === 'j3';
  const paint = new THREE.MeshStandardMaterial({ color: cub ? 0xf2b705 : 0xf1eee6, roughness: 0.42, metalness: 0.0 });
  const accent = new THREE.MeshStandardMaterial({ color: LIVERY[def.id] ?? 0x18233c, roughness: 0.4, metalness: 0.0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.35, metalness: 0.7 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x8fa4b8, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  const trim = new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 1, side: THREE.BackSide });

  // ---- fuselage: outer skin, glazing, and the same skin seen from inside
  const plan = fuselagePlan(def), high = plan.high;
  const fus = buildFuselage(plan);
  const skin = new THREE.Mesh(fus.paint, paint), stripe = new THREE.Mesh(fus.accent, accent);
  const glass = new THREE.Mesh(fus.glass, glassMat);
  const lining = new THREE.Group();
  for (const g of [fus.paint, fus.accent]) { const m = new THREE.Mesh(g, trim); m.receiveShadow = true; lining.add(m); }
  skin.castShadow = stripe.castShadow = true; skin.receiveShadow = stripe.receiveShadow = true;
  glass.renderOrder = 10;
  const rainGlass = new GlassRain(fus.glass);
  group.add(skin, stripe, lining, glass, rainGlass.mesh);

  // ---- wing, from the same planform, twist and dihedral the lifting line uses
  const W = def.wing, half = W.span / 2;
  const lift = high ? 0.07 : 0;                    // a high wing sits on the roof, not through it
  const wingY = (x) => { let y = -W.z + lift; const ax = Math.abs(x), n = 16; for (let k = 0; k < n; k++) y += Math.tan(tab(W.dihedral, (k + 0.5) * ax / n) * D2R) * ax / n; return y; };
  const chord = (x) => tab(W.chord, Math.abs(x));
  const leZ = (x) => -W.x - 0.25 * chord(0) + 0.35 * (chord(0) - chord(x));   // taper taken mostly from the trailing edge
  const inc = (x) => tab(W.twist, Math.abs(x)) * D2R;
  const CUT = 0.70;
  const wingProfile = airfoil(0.12, Math.abs(W.section.alpha0) > 1 ? 0.02 : 0, 0.4, CUT, 12);
  const ys = new Set([0, half]);
  for (const t of [W.chord, W.twist, W.dihedral, W.dihedralEff]) if (Array.isArray(t)) for (const [y] of t) ys.add(Math.min(half, y));
  for (const part of [W.flap, W.aileron, W.spoiler]) if (part) { ys.add(part.y0); ys.add(Math.min(half, part.y1)); }
  const yPos = [...ys].filter((y) => y > 0.01).sort((a, b) => a - b);
  const spanCuts = [...yPos.slice().reverse().map((y) => -y), 0, ...yPos];
  const wing = new THREE.Mesh(loft(spanCuts.map((x) => ({ le: [x, wingY(x), leZ(x)], chord: chord(x), inc: inc(x) })), wingProfile), paint);
  wing.castShadow = wing.receiveShadow = true;
  group.add(wing);
  for (const sd of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), accent);
    tip.scale.set(0.11, 0.06 * chord(half) / 1.13, 0.46 * chord(half)); tip.position.set(sd * half, wingY(half) + 0.01, leZ(half) + 0.44 * chord(half)); tip.castShadow = true;
    group.add(tip);
  }
  const tAt = (x) => (wingProfile[12][1] - wingProfile[13][1]) * chord(x) + 0.012;
  const hinge = (x) => [x, wingY(x) + 0.004 - (CUT - 0.25) * chord(x) * Math.tan(inc(x)), leZ(x) + CUT * chord(x)];
  const cs = (x0, x1, mat = paint) => surface(hinge(x0), hinge(x1), chord(x0) * (1 - CUT), chord(x1) * (1 - CUT), tAt(x0), tAt(x1), mat);
  const parts = { flaps: [], ailR: null, ailL: null };
  // trailing edge: flaps, ailerons and fixed fillers between them
  const segs = [];
  if (W.flap) segs.push([W.flap.y0, Math.min(W.flap.y1, half - 0.02), 'flap']);
  segs.push([W.aileron.y0, Math.min(W.aileron.y1, half - 0.02), 'ail']);
  segs.sort((a, b) => a[0] - b[0]);
  let cur = 0;
  for (const [y0, y1, kind] of [...segs, [half, half, 'end']]) {
    if (y0 - cur > 0.03) { if (cur === 0) group.add(cs(-y0, y0)); else group.add(cs(cur, y0 - 0.01), cs(-(y0 - 0.01), -cur)); }
    if (kind === 'flap') { const r = cs(y0 + 0.01, y1), l = cs(-y1, -(y0 + 0.01)); parts.flaps.push(r, l); group.add(r, l); }
    if (kind === 'ail') { parts.ailR = cs(y0 + 0.01, y1); parts.ailL = cs(-y1, -(y0 + 0.01)); group.add(parts.ailR, parts.ailL); }
    cur = Math.max(cur, y1);
  }

  // ---- tail
  const H = def.htail, HCUT = H.tau >= 0.99 ? 0.985 : 0.58;       // a stabilator moves whole
  const hProfile = airfoil(0.09, 0, 0, HCUT, 9);
  const hChord = (x) => H.chord[0] + (H.chord[1] - H.chord[0]) * (Math.abs(x) / H.halfSpan);
  const hLe = (x) => -H.xLE + (Math.abs(x) / H.halfSpan) * H.sweep;
  const hy = -H.z;
  const stabGeo = loft([-H.halfSpan, -0.08, 0.08, H.halfSpan].map((x) => ({ le: [x, 0, hLe(x) - hLe(0)], chord: hChord(x), inc: H.incidence * D2R })), hProfile);
  const stab = new THREE.Mesh(stabGeo, paint);
  stab.castShadow = stab.receiveShadow = true;
  const stabPivot = new THREE.Group();
  stabPivot.position.set(0, hy, hLe(0) + (H.tau >= 0.99 ? 0.25 * hChord(0) : 0));
  stab.position.z = H.tau >= 0.99 ? -0.25 * hChord(0) : 0;
  stabPivot.add(stab); group.add(stabPivot);
  parts.stab = H.tau >= 0.99 ? stabPivot : null;
  parts.elevs = [];
  if (H.tau < 0.99) {
    const hT = (x) => 0.09 * hChord(x) * 0.62;
    const hHinge = (x) => [x, hy, hLe(x) + HCUT * hChord(x)];
    const er = surface(hHinge(0.12), hHinge(H.halfSpan), hChord(0.12) * (1 - HCUT), hChord(H.halfSpan) * (1 - HCUT), hT(0.12), hT(H.halfSpan), paint);
    const el = surface(hHinge(-H.halfSpan), hHinge(-0.12), hChord(H.halfSpan) * (1 - HCUT), hChord(0.12) * (1 - HCUT), hT(H.halfSpan), hT(0.12), paint);
    parts.elevs.push(er, el); group.add(er, el);
  }
  const Fn = def.fin, VCUT = 0.60;
  const vProfile = airfoil(0.09, 0, 0, VCUT, 9);
  const vt = (y) => (y - Fn.h0) / (Fn.h1 - Fn.h0);
  const vChord = (y) => Fn.chord[0] + (Fn.chord[1] - Fn.chord[0]) * vt(y);
  const vLe = (y) => -Fn.xLE + vt(y) * Fn.sweep;
  const finBase = Math.max(0.05, Fn.h0 - 0.1);
  const fin = new THREE.Mesh(loft([finBase, 0.5 * (Fn.h0 + Fn.h1), Fn.h1].map((y) => ({ le: [0, y, vLe(y)], chord: vChord(y), inc: 0 })), vProfile, [1, 0, 0]), paint);
  fin.castShadow = fin.receiveShadow = true;
  group.add(fin);
  const vHinge = (y) => [0, y, vLe(y) + VCUT * vChord(y)];
  const vT = (y) => 0.09 * vChord(y) * 0.6;
  parts.rudder = surface(vHinge(Fn.h0 + 0.02), vHinge(Fn.h1), vChord(Fn.h0) * (1 - VCUT), vChord(Fn.h1) * (1 - VCUT), vT(Fn.h0), vT(Fn.h1), accent);
  group.add(parts.rudder);

  // ---- struts (braced high wings) and gear, at the points the physics rolls on
  if (high && def.engine) for (const sd of [-1, 1]) group.add(strut([sd * 0.55, -W.z - 1.2, W.x + 0.1], [sd * half * 0.46, wingY(half * 0.46) - 0.09, W.x], 0.045, paint, 0.35));
  parts.wheels = []; parts.steer = null; parts.gear = new THREE.Group();
  for (const cp of def.gear.contacts) {
    if (!cp.wheel) continue;
    const small = cp.steer && (def.gear.tailwheel || Math.abs(cp.r[1]) < 0.05);
    const rad = def.gear.tailwheel && cp.steer ? 0.09 : small ? 0.17 : 0.2;
    const wx = cp.r[1], wy = -cp.r[2] + rad + 0.06, wz = -cp.r[0];
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, rad * 0.65, 18), rubber);
    wheel.rotation.z = Math.PI / 2; wheel.castShadow = true;
    const st = stationAt(wz, plan.stations, plan.crisp);
    if (cp.steer) {
      const leg = new THREE.Group(); leg.position.set(wx, st.bottom + 0.05, wz);
      leg.add(strut([0, 0, 0], [0, wy - st.bottom - 0.05, 0], 0.028, metal));
      wheel.position.set(0, wy - st.bottom - 0.05, 0); leg.add(wheel);
      parts.gear.add(leg); parts.steer = leg; parts.steerSign = cp.steer;
    } else {
      wheel.position.set(wx, wy, wz);
      parts.gear.add(strut([Math.sign(wx) * Math.min(Math.abs(wx), st.hw * 0.8), st.bottom + 0.06, wz + 0.03], [wx, wy, wz], 0.045, paint, 0.3), wheel);
      parts.wheels.push(wheel);
    }
  }
  group.add(parts.gear);

  // ---- nose: spinner and propeller, as many blades as it has
  parts.prop = null;
  if (def.prop) {
    const R = def.prop.D / 2, prop = new THREE.Group();
    prop.position.set(0, -def.prop.hub[1], plan.stations[0][0] - 0.04);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 20), paint);
    spinner.rotation.x = -Math.PI / 2; spinner.position.z = -0.17; spinner.castShadow = true;
    prop.add(spinner);
    const blades = new THREE.Group();
    for (let b = 0; b < def.prop.blades; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, R - 0.06, 0.018), new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.6, transparent: true }));
      blade.geometry.translate(0, (R - 0.06) / 2 + 0.04, 0);
      blade.rotation.set(0, 0.42, 0);
      const holder = new THREE.Group(); holder.rotation.z = b * 2 * Math.PI / def.prop.blades; holder.add(blade);
      blades.add(holder);
    }
    blades.position.z = -0.06;
    prop.add(blades);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshBasicMaterial({ map: discTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    disc.position.z = -0.06; disc.renderOrder = 20;
    prop.add(disc);
    group.add(prop);
    parts.prop = prop; parts.blades = blades; parts.disc = disc;
  }

  // ---- lights
  const glow = glowTexture();
  const lamp = (color, x, y, z, size) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(x, y, z); sp.scale.setScalar(size); sp.userData.size = size;
    group.add(sp);
    return sp;
  };
  const tipZ = leZ(half) + 0.3 * chord(half);
  const lights = {
    navL: lamp(0xff2a1a, -half - 0.1, wingY(half), tipZ, 0.5),
    navR: lamp(0x22ff66, half + 0.1, wingY(half), tipZ, 0.5),
    tail: lamp(0xffffff, 0, hy + 0.15, plan.stations[plan.stations.length - 1][0] + 0.1, 0.4),
    beacon: lamp(0xff2211, 0, Fn.h1 + 0.08, vLe(Fn.h1) + 0.2, 0.9),
    strobeL: lamp(0xffffff, -half - 0.12, wingY(half), tipZ + 0.2, 1.1),
    strobeR: lamp(0xffffff, half + 0.12, wingY(half), tipZ + 0.2, 1.1),
    landing: lamp(0xfff2d8, -half * 0.53, wingY(half * 0.53) - 0.02, leZ(half * 0.53) - 0.02, 1.3),
  };

  let spin = 0;
  return {
    group, parts, lights, glass, rainGlass, lining, exterior: [skin, stripe], eye: new THREE.Vector3(...plan.eye),
    // o: flight model outputs; ctl: controls; night 0..1; light: how brightly the scene is lit
    update(o, ctl, dt, time, night, light = 1, gearPos = 1) {
      if (parts.prop) {
        spin += o.rpm * (Math.PI / 30) * dt;
        parts.prop.rotation.z = -spin;
        const blur = THREE.MathUtils.smoothstep(o.rpm, 250, 900);
        parts.blades.visible = blur < 0.98;
        parts.blades.traverse((m) => { if (m.material) m.material.opacity = 1 - blur; });
        parts.disc.material.opacity = blur * 0.9;
        parts.disc.material.color.setScalar(Math.min(1, light));   // the blur is only as bright as the light on it
      }
      const fl = o.flapPos * (def.wing.flap ? def.wing.flap.detents[def.wing.flap.detents.length - 1] : 0) * D2R;
      for (const f of parts.flaps) f.pivot.rotation.x = fl;
      const r = ctl.roll, A = def.wing.aileron;
      parts.ailR.pivot.rotation.x = -(r > 0 ? r * A.up : r * A.down) * D2R;
      parts.ailL.pivot.rotation.x = (r > 0 ? r * A.down : r * A.up) * D2R;
      for (const e of parts.elevs) e.pivot.rotation.x = o.elevator || 0;
      if (parts.stab) parts.stab.rotation.x = o.elevator || 0;
      parts.rudder.pivot.rotation.x = o.rudder || 0;
      if (parts.steer) parts.steer.rotation.y = -ctl.yaw * 0.25 * parts.steerSign;
      const roll = (o.onGround ? o.wheelSpeed : 0) * dt / 0.2;
      for (const w of parts.wheels) w.rotation.x -= roll;
      parts.gear.visible = gearPos > 0.05;
      parts.gear.scale.y = 0.3 + 0.7 * gearPos;
      // nav lights steady, beacon and strobes flashing
      const lit = 0.22 + 0.78 * night;
      const beat = (time % 1.2) < 0.09 ? 1 : 0, strobe = ((time + 0.35) % 1.1) < 0.045 || ((time + 0.2) % 1.1) < 0.045 ? 1 : 0;
      for (const k of ['navL', 'navR', 'tail', 'landing']) lights[k].scale.setScalar(lights[k].userData.size * lit);
      lights.beacon.scale.setScalar(lights.beacon.userData.size * beat * (0.3 + night));
      lights.strobeL.scale.setScalar(lights.strobeL.userData.size * strobe * (0.2 + night));
      lights.strobeR.scale.setScalar(lights.strobeR.userData.size * strobe * (0.2 + night));
    },
    dispose() { group.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } }); },
  };
}

// The aircraft's shadow on the ground: its plan-form, soft, laid on the terrain.
export function buildGroundShadow() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.filter = 'blur(2.5px)';
  x.fillStyle = '#fff';
  const s = 256 / 12, m = 128;            // 12 m square, nose toward the top
  const poly = (pts) => { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(m + px * s, m + py * s) : x.moveTo(m + px * s, m + py * s))); x.closePath(); x.fill(); };
  poly([[-5.5, -0.35], [-2.6, -0.48], [2.6, -0.48], [5.5, -0.35], [5.5, 0.72], [2.6, 1.15], [-2.6, 1.15], [-5.5, 0.72]]);   // wing
  poly([[-0.4, -2.3], [0.4, -2.3], [0.58, -1.0], [0.58, 1.2], [0.1, 5.3], [-0.1, 5.3], [-0.58, 1.2], [-0.58, -1.0]]);       // fuselage
  poly([[-1.72, 4.4], [-0.1, 4.08], [0.1, 4.08], [1.72, 4.4], [1.72, 5.15], [-1.72, 5.15]]);                                   // tailplane
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000, alphaMap: tex, transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), mat);
  mesh.rotation.order = 'YXZ';
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}
