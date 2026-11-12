// Flight dynamics: a 6-DOF rigid body flown by a vortex model of a 180 hp
// high-wing single (Cessna 172S class). Nothing here is a scripted "feel".
//
// The wing is a lifting line: 40 strips, each a horseshoe vortex, each flying
// in the downwash of all the others. The spanwise lift distribution, induced
// drag, roll damping, the way a stall spreads from the root, and ground effect
// (a mirror-image vortex system under the runway) come out of that solve.
// The tail is 12 strips flying in the wake the wing's vortices actually leave
// behind; the fuselage is eight stations in their own local flow; gear and
// struts drag at the places they hang. Adverse yaw, spins and the
// left-turning tendencies emerge from the sum.
//
// Axes: body x forward, y right, z down. World is north-east-down, metres,
// relative to the scenery origin; pos[2] = -altitude MSL.
// No dependencies, so the same file runs headless under node for validation.

import C172S from './aircraft/c172s.js';

export const KT = 0.514444;      // m/s per knot
export const FT = 0.3048;        // m per foot
export const D2R = Math.PI / 180;
const G = 9.80665;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sq = (x) => x * x;
const sat = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function lut(xs, ys) {
  const n = xs.length;
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 1;
    while (xs[i] < x) i++;
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
  };
}

// fuel/air ratio -> fraction of best power
const mixPower = lut([0.035, 0.045, 0.0625, 0.08, 0.095, 0.12, 0.16], [0, 0.55, 0.93, 1.0, 0.975, 0.86, 0.4]);
// fuel/air ratio -> exhaust gas temperature, deg C (peaks just lean of stoichiometric)
const mixEGT = lut([0.035, 0.05, 0.062, 0.067, 0.08, 0.095, 0.12], [300, 690, 770, 790, 745, 700, 640]);

// Separation model: lift = a·α·((1+√f)/2)², f = attached fraction of the chord.
// (kappa() below gives the peak of that curve, so a stall angle can be set from clmax.)
// The stall's sharpness (how fast separation spreads once it starts) differs by
// section: gentle for a thick cambered wing section, abrupt for thin tail surfaces.
// kappa is the peak of the lift curve, so a strip's stall angle can be set from its clmax.
const _kappa = new Map();
function kappa(sepW) {
  let k = _kappa.get(sepW);
  if (k === undefined) {
    k = 0;
    for (let t = 0.2; t < 1.6; t += 0.0005) {
      const f = 0.5 * (1 - Math.tanh((t - 1) / sepW));
      k = Math.max(k, t * sq((1 + Math.sqrt(f)) / 2));
    }
    _kappa.set(sepW, k);
  }
  return k;
}

// Shared section model. Lift follows the attached-flow line until the flow
// separates (f falls from 1 to 0), then blends into flat-plate behaviour.
const _sec = { cl: 0, f: 1, t: 0 };
function section(aeff, a, clmaxP, clmaxN, sepW) {
  const aStall = (aeff >= 0 ? clmaxP : clmaxN) / (a * kappa(sepW));
  const t = Math.abs(aeff) / aStall;
  const f = 0.5 * (1 - Math.tanh((t - 1) / sepW));
  let cl = a * aeff * sq((1 + Math.sqrt(f)) / 2);
  const aa = Math.abs(aeff);
  if (aa > 0.42) {
    const m = smooth(0.42, 0.78, aa);
    cl = cl * (1 - m) + 1.05 * Math.sin(2 * aeff) * m;
  }
  _sec.cl = cl; _sec.f = f; _sec.t = t;
}

// Velocity induced at P by a semi-infinite vortex leg leaving A along unit d,
// per unit circulation and without the 1/4pi. core2 softens the filament.
const _v = [0, 0, 0];
function legVel(ax, ay, az, dx, dy, dz, px, py, pz, core2) {
  const rx = px - ax, ry = py - ay, rz = pz - az;
  const rm = Math.hypot(rx, ry, rz);
  const k = 1 / (rm * (rm - (dx * rx + dy * ry + dz * rz)) + 0.5 * core2 + 1e-9);
  _v[0] = (dy * rz - dz * ry) * k; _v[1] = (dz * rx - dx * rz) * k; _v[2] = (dx * ry - dy * rx) * k;
}
// ...and by a straight bound segment A -> B.
function segVel(ax, ay, az, bx, by, bz, px, py, pz, core2) {
  const r1x = px - ax, r1y = py - ay, r1z = pz - az, r2x = px - bx, r2y = py - by, r2z = pz - bz;
  const m1 = Math.hypot(r1x, r1y, r1z), m2 = Math.hypot(r2x, r2y, r2z);
  const k = (m1 + m2) / (m1 * m2 * (m1 * m2 + r1x * r2x + r1y * r2y + r1z * r2z) + core2 * (m1 + m2) + 1e-9);
  _v[0] = (r1y * r2z - r1z * r2y) * k; _v[1] = (r1z * r2x - r1x * r2z) * k; _v[2] = (r1x * r2y - r1y * r2x) * k;
}

const lerpTable = (tab, x) => {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
  return tab[tab.length - 1][1];
};

// ---- the propeller: every blade is ten stations, each an aerofoil at its
// own blade angle, in the airflow made by the aircraft's speed, the blade's
// rotation and the air the disc is already pulling through itself (momentum
// theory, with Prandtl's tip loss). Thrust, torque, the drop in thrust with
// speed, windmilling and P-factor are sums over the blades. A constant-speed
// propeller is the same blades with a governor turning them.
function buildProp(d) {
  if (!d) return null;
  const R = d.D / 2, n = 10, st = [];
  for (let k = 0; k < n; k++) {
    const x = 0.22 + (k + 0.5) * (0.78 / n), r = x * R;
    st.push({
      r, dr: 0.78 * R / n,
      chord: Math.max(0.4 * d.chord, d.chord * Math.sqrt(Math.max(0, 1 - sq((x - 0.48) / 0.60)))),
      beta: Math.atan(d.pitch / (2 * Math.PI * r)) + 0.5 * D2R,
    });
  }
  // cd0: blade profile drag. 0.013 suits a metal blade; a thick wooden one is nearer 0.02.
  return { R, D: d.D, n, st, hx: d.hub[0], hz: d.hub[1], blades: d.blades, governor: d.governor || null, cd0: d.cd0 ?? 0.013,
    machDD: d.machDD ?? 0.72 };      // where the blade's drag starts to rise: later for thin-tipped blades
}
const PROP_AZ = [0, 1, 2, 3].map((m) => ({ c: Math.cos(m * Math.PI / 2 + 0.3), s: Math.sin(m * Math.PI / 2 + 0.3) }));

// ---- the wing: a lifting line of horseshoe vortices, one per strip.
// Each strip's bound vortex sheds a trailing pair, and every strip flies in
// the downwash of all the others. The spanwise lift distribution, induced
// drag, roll damping, tip relief and ground effect come out of that solve.
function buildWing(d) {
  const N = d.strips || 40, half = d.span / 2, dy = d.span / N, sec = d.section;
  const a2d = 2 * Math.PI * sec.slope;
  let area = 0;
  for (let i = 0; i < N; i++) area += lerpTable(d.chord, Math.abs(-half + (i + 0.5) * dy)) * dy;
  const cs = d.area / area;
  const F = () => new Float64Array(N);
  const W = {
    n: N, dy, a2d, sep: sec.sep, x0: d.x, z0: d.z, S: F(), x: F(), y: F(), z: F(), chord: F(), cx: F(), cz: F(), nx: F(), ny: F(), nz: F(),
    alpha0: F(), clmax: F(), flap: F(), ail: F(), spoil: F(),
    ex: new Float64Array(N + 1), ey: new Float64Array(N + 1), ez: new Float64Array(N + 1),
    A: new Float64Array(N * N), Aimg: new Float64Array(N * N), hasImage: false,
    gamma: F(), wi: F(), lu: F(), lv: F(), lw: F(), a0: F(), cmx: F(), f: F(), cl: F(), tmp: F(),
    edge: new Float64Array(N + 1), warnIdx: 0, relax: 0.1,
  };
  // dihedral may be one angle or a table along the span (a cranked wing)
  const dihAt = (y, v) => (typeof v === 'number' ? v : lerpTable(v, Math.abs(y)));
  const zAt = (y) => { let z = d.z; const n = 24, ay = Math.abs(y); for (let k = 0; k < n; k++) z -= Math.tan(dihAt((k + 0.5) * ay / n, d.dihedral) * D2R) * ay / n; return z; };
  const overlap = (y0, y1, part) => (part ? Math.max(0, Math.min(y1, part.y1) - Math.max(y0, part.y0)) / (y1 - y0) : 0);
  for (let e = 0; e <= N; e++) { const y = -half + e * dy; W.ex[e] = d.x; W.ey[e] = y; W.ez[e] = zAt(y); }
  let warnBest = 1e9;
  for (let i = 0; i < N; i++) {
    const y = -half + (i + 0.5) * dy, ay = Math.abs(y), side = Math.sign(y);
    const inc = lerpTable(d.twist, ay) * D2R, dih = dihAt(ay, d.dihedralEff) * D2R;
    const n = [-Math.sin(inc), -side * Math.sin(dih), -Math.cos(inc) * Math.cos(dih)];
    const nl = Math.hypot(n[0], n[1], n[2]);
    W.x[i] = d.x; W.y[i] = y; W.z[i] = zAt(y);
    W.chord[i] = lerpTable(d.chord, ay) * cs; W.S[i] = W.chord[i] * dy;
    W.cx[i] = Math.cos(inc); W.cz[i] = -Math.sin(inc);
    W.nx[i] = n[0] / nl; W.ny[i] = n[1] / nl; W.nz[i] = n[2] / nl;
    W.alpha0[i] = sec.alpha0 * D2R;
    W.clmax[i] = sec.clmax[0] + (sec.clmax[1] - sec.clmax[0]) * (ay / half);
    W.flap[i] = overlap(ay - dy / 2, ay + dy / 2, d.flap);
    W.ail[i] = side * overlap(ay - dy / 2, ay + dy / 2, d.aileron);
    W.spoil[i] = overlap(ay - dy / 2, ay + dy / 2, d.spoiler);
    const dv = Math.abs(y + 0.27 * half);                     // the stall vane sits inboard on the left wing
    if (dv < warnBest) { warnBest = dv; W.warnIdx = i; }
  }
  // downwash at strip i per unit circulation on strip j: its two trailing legs
  let rowMax = 0;
  for (let i = 0; i < N; i++) {
    let row = 0;
    for (let j = 0; j < N; j++) {
      legVel(W.ex[j + 1], W.ey[j + 1], W.ez[j + 1], -1, 0, 0, W.x[i], W.y[i], W.z[i], 0);
      const right = _v[2];
      legVel(W.ex[j], W.ey[j], W.ez[j], -1, 0, 0, W.x[i], W.y[i], W.z[i], 0);
      W.A[i * N + j] = (right - _v[2]) / (4 * Math.PI);
      row += Math.abs(0.5 * W.chord[i] * a2d * W.A[i * N + j]);
    }
    rowMax = Math.max(rowMax, row);
  }
  W.relax = 1.5 / (1 + rowMax);       // the largest step the circulation iteration stays stable with
  return W;
}

// ---- tail: strips with finite-span lift slopes, flying in the wing's wake
function buildTail(def) {
  const els = [], h = def.htail, v = def.fin;
  const R = def.prop ? def.prop.D / 2 : 0, hubUp = def.prop ? -def.prop.hub[1] : 0;
  const ARh = sq(2 * h.halfSpan) / h.area, a0h = 2 * Math.PI * h.slope;
  const aH = a0h / (1 + a0h / (Math.PI * h.e * ARh));
  const hChord = (y) => h.chord[0] + (h.chord[1] - h.chord[0]) * (y / h.halfSpan), dyh = h.halfSpan / 4;
  let hs = 0;
  for (let k = 0; k < 4; k++) hs += 2 * hChord((k + 0.5) * dyh) * dyh;
  for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
    const y = (k + 0.5) * dyh, ch = hChord(y), inc = h.incidence * D2R;
    els.push({
      r: [h.xLE - (y / h.halfSpan) * h.sweep - 0.25 * ch, side * y, h.z], S: ch * dyh * h.area / hs, chord: ch,
      c: [Math.cos(inc), 0, -Math.sin(inc)], n: [-Math.sin(inc), 0, -Math.cos(inc)],
      a: aH, alpha0: 0, clmax: h.clmax, clmin: h.clmax, cd0: 0.0085, kInd: 1 / (Math.PI * h.e * ARh),
      elev: h.tau, rud: 0, wash: R && y < 0.93 * R ? 0.9 : 0, swirl: 0, wake: [0, 0, 0], f: 1, cl: 0,
    });
  }
  const vChord = (t) => v.chord[0] + (v.chord[1] - v.chord[0]) * t, dh = (v.h1 - v.h0) / 4;
  let vs = 0;
  for (let k = 0; k < 4; k++) vs += vChord((k + 0.5) / 4) * dh;
  for (let k = 0; k < 4; k++) {
    const t = (k + 0.5) / 4, hh = v.h0 + t * (v.h1 - v.h0), ch = vChord(t);
    const dR = R ? Math.abs(hh - hubUp) / R : 9;            // how deep in the slipstream this strip stands
    els.push({
      r: [v.xLE - t * v.sweep - 0.25 * ch, 0, -hh], S: ch * dh * v.area / vs, chord: ch,
      c: [1, 0, 0], n: [0, 1, 0],
      a: v.a, alpha0: 0, clmax: v.clmax, clmin: v.clmax, cd0: 0.0085, kInd: 1 / (Math.PI * 0.8 * 2.3),
      elev: 0, rud: v.tau, wash: R ? clamp(1.45 - 0.78 * dR, 0.2, 1) : 0, swirl: R ? clamp(1.5 - 0.75 * dR, 0.3, 1) : 0, wake: [0, 0, 0], f: 1, cl: 0,
    });
  }
  return els;
}

const ISA = { T0: 288.15, p0: 101325, L: 0.0065 };

// The world the aircraft flies in. The sim replaces these with real terrain,
// real pressure/temperature and the wind field.
export const stillAir = {
  ground: () => 0,
  atmosphere(alt) {
    const T = ISA.T0 - ISA.L * Math.min(alt, 11000);
    const p = ISA.p0 * Math.pow(T / ISA.T0, 5.25588);
    return { T, p, rho: p / (287.053 * T) };
  },
  wind: (() => { const z = { n: 0, e: 0, d: 0, gu: 0, gv: 0, gw: 0, gp: 0, gq: 0, gr: 0 }; return () => z; })(),
};

export class FlightModel {
  // def: an aircraft definition from js/aircraft/. Everything that flies comes from it.
  // (Called with only an environment, it flies the default aircraft.)
  constructor(def, env) {
    if (!def || !def.wing) { env = def; def = C172S; }
    env = env || stillAir;
    this.def = def;
    this.env = env;
    this.wing = buildWing(def.wing);
    this.prop = buildProp(def.prop);
    this.inflow = new Float64Array(10);         // air pulled through each ring of the propeller disc, m/s
    this.bladePitch = 0;                        // constant-speed propellers: how far the governor has coarsened the blades, rad
    this.gearPos = 1;                           // retractable gear: 1 down, 0 up
    // What the aircraft's systems and the weather are doing to the airframe (see js/systems.js).
    // ice: 0 clean .. 1 severe. power: fraction of engine output available. cut: no combustion.
    // Rigging: the bent rudder tab and aileron rig a factory sets so the aircraft flies hands-off in cruise.
    this.rig = { roll: 0, yaw: 0 };
    this.fx = { ice: 0, power: 1, cut: false, rough: 0, starter: true, flapPower: true, flapFrozen: false, trimOffset: 0 };
    this.els = buildTail(def);
    this.body = def.body.stations.map(([x, len, depth, width]) => ({ x, side: len * depth, plan: len * width }));
    this.contacts = def.gear.contacts;
    this.S = def.wing.area; this.b = def.wing.span; this.AR = sq(def.wing.span) / def.wing.area;
    this._tick = 0;
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.q = [1, 0, 0, 0];
    this.w = [0, 0, 0];
    this.ctl = {
      pitch: 0, roll: 0, yaw: 0, trim: 0,       // -1..1, +pitch = pull, +roll = right, +yaw = right pedal
      throttle: 0, mixture: 1, prop: 1, flaps: 0, spoiler: 0, gear: 1,        // flaps: target 0..1 (0, 1/3, 2/3, 1 = 0/10/20/30 deg)
      brakeL: 0, brakeR: 0, park: false,
      mags: true, starter: false,
    };
    this.payload = def.mass.payload;
    this.fuel = def.mass.fuel;
    this.rpm = 0;
    this.flapPos = 0;
    this.kollsman = 101325;
    this.crashed = null;
    this.time = 0;
    this.egt = 20; this.oilT = 20; this.cht = 20;
    this.vsiLag = 0;
    this.touchdowns = 0;
    this.gearLoad = def.gear.contacts.map(() => 0);
    this.out = {
      ias: 0, tas: 0, gs: 0, alt: 0, agl: 0, altInd: 0, vs: 0, vsInd: 0,
      roll: 0, pitch: 0, heading: 0, track: 0,
      alpha: 0, beta: 0, gLoad: 1, slip: 0, turnRate: 0,
      rpm: 0, thrust: 0, power: 0, fuelFlow: 0, egt: 20, oilT: 20, oilP: 0, map: 0,
      stallWarn: 0, stalled: 0, onGround: false, wheelSpeed: 0, groundLoad: 0,
      flapPos: 0, flapMoving: false, firing: false, vi: 0,
      touchdownVs: 0, scrape: 0, mass: 0, rho: 1.225, oat: 15,
    };
  }

  get mass() { return this.def.mass.empty + this.payload + this.fuel + 45 * this.fx.ice; }

  // Place the aircraft. heading in radians true; onGround settles the gear on the terrain.
  reset({ n = 0, e = 0, alt = null, heading = 0, speed = 0, pitch = 0, running = true, throttle = null, rpm = null } = {}) {
    const gh = this.env.ground(n, e);
    const onGround = alt === null;
    this.pos = [n, e, -(onGround ? gh + this.def.gear.rest : alt)];
    const th = onGround ? this.def.gear.restPitch : pitch;
    const cy = Math.cos(heading / 2), sy = Math.sin(heading / 2);
    const cp = Math.cos(th / 2), sp = Math.sin(th / 2);
    this.q = [cy * cp, -sy * sp, cy * sp, sy * cp];
    const fpa = 0;
    this.vel = [speed * Math.cos(heading) * Math.cos(fpa), speed * Math.sin(heading) * Math.cos(fpa), 0];
    this.w = [0, 0, 0];
    const eng = this.def.engine;
    this.rpm = !eng ? 0 : rpm !== null ? rpm : running ? (onGround ? eng.idleRpm + 50 : 0.87 * eng.rpmMax) : 0;
    this.bladePitch = 0; this.gearPos = 1; this.ctl.gear = 1; this.ctl.prop = 1; this.ctl.spoiler = 0;
    this.ctl.throttle = throttle !== null ? throttle : (onGround ? 0 : 0.72);
    this.ctl.mags = running && !!eng;
    this.ctl.mixture = 1;
    this.ctl.park = onGround;
    this.ctl.flaps = 0; this.flapPos = 0;
    this.ctl.pitch = this.ctl.roll = this.ctl.yaw = 0;
    this.ctl.trim = onGround ? 0.06 : 0.0;
    this.crashed = null;
    this.inflow.fill(0); this.wing.gamma.fill(0); this.wing.Aimg.fill(0); this.wing.hasImage = false; this._tick = 0;
    for (const el of this.els) el.wake[0] = el.wake[1] = el.wake[2] = 0;
    this.egt = running ? 600 : this.out.oat; this.oilT = running ? 80 : this.out.oat; this.cht = running ? 150 : this.out.oat;
    this.vsiLag = 0;
    this._wasAir = !onGround;
    this.step(1e-4);
  }

  step(dt) {
    const c = this.ctl, o = this.out, env = this.env, pos = this.pos, vel = this.vel, wb = this.w;
    const qw = this.q[0], qx = this.q[1], qy = this.q[2], qz = this.q[3];
    // body -> world rotation
    const r11 = 1 - 2 * (qy * qy + qz * qz), r12 = 2 * (qx * qy - qw * qz), r13 = 2 * (qx * qz + qw * qy);
    const r21 = 2 * (qx * qy + qw * qz), r22 = 1 - 2 * (qx * qx + qz * qz), r23 = 2 * (qy * qz - qw * qx);
    const r31 = 2 * (qx * qz - qw * qy), r32 = 2 * (qy * qz + qw * qx), r33 = 1 - 2 * (qx * qx + qy * qy);

    const alt = -pos[2];
    const atm = env.atmosphere(alt);
    const rho = atm.rho;
    const wind = env.wind(pos, alt);
    const gh = env.ground(pos[0], pos[1]);
    const agl = alt - gh;
    const mass = this.mass;
    const fx = this.fx, ice = fx.ice;
    const DEF = this.def, PROP = this.prop, WD = DEF.wing, SEC = WD.section, ENG = DEF.engine, CTL = DEF.controls;

    // air-relative velocity and rotation in body axes
    const an = vel[0] - wind.n, ae = vel[1] - wind.e, ad = vel[2] - wind.d;
    const u = r11 * an + r21 * ae + r31 * ad - wind.gu;
    const v = r12 * an + r22 * ae + r32 * ad - wind.gv;
    const w = r13 * an + r23 * ae + r33 * ad - wind.gw;
    const p = wb[0] - wind.gp, q = wb[1] - wind.gq, r = wb[2] - wind.gr;
    const V = Math.hypot(u, v, w);
    const alpha = Math.atan2(w, Math.max(u, 0.01));
    const beta = V > 0.5 ? Math.asin(clamp(v / V, -1, 1)) : 0;

    let Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0;

    // ---------------- propeller
    const omegaNow = Math.max(this.rpm, 25) * Math.PI / 30;
    const sound = Math.sqrt(1.4 * 287.053 * atm.T);
    let thrust = 0, qProp = 0, pFy = 0, pFz = 0, pMy = 0, pMz = 0, viSum = 0, swSum = 0, areaSum = 0;
    const hubU = PROP ? u + q * PROP.hz : 0, hubV = PROP ? v + r * PROP.hx - p * PROP.hz : 0, hubW = PROP ? w - q * PROP.hx : 0;
    for (let k = 0; PROP && k < PROP.n; k++) {
      const st = PROP.st[k], rr = st.r, beta = st.beta + this.bladePitch;
      let ringT = 0, ringQ = 0;
      const Ua0 = hubU + this.inflow[k];
      for (let m = 0; m < 4; m++) {
        const az = PROP_AZ[m];
        // the blade's own motion plus whatever the airflow adds across the disc: the
        // down-going blade meets more air at a positive angle of attack
        const Ut = omegaNow * rr - hubV * az.s + hubW * az.c;
        const Ua = Ua0 + (q * az.s - r * az.c) * rr;
        const W2 = Ua * Ua + Ut * Ut;
        const phi = Math.atan2(Ua, Ut);
        const mach = Math.min(0.92, Math.sqrt(W2) / sound);
        section(beta - phi + 3 * D2R, 5.7 * Math.min(1.7, 1 / Math.sqrt(1 - mach * mach)), 1.38, 0.9, 0.30);
        const cl = _sec.cl * (1 - 0.12 * ice);          // iced blades: less lift, more drag, and it shakes
        const cd = PROP.cd0 + 0.012 * ice + 0.012 * cl * cl + (1 - _sec.f) * 2.0 * sq(Math.sin(beta - phi + 3 * D2R)) + (mach > PROP.machDD ? 2.5 * sq(mach - PROP.machDD) : 0);
        const qc = 0.5 * rho * W2 * st.chord * st.dr * (PROP.blades / 4);
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const dT = qc * (cl * cp - cd * sp), dFt = qc * (cl * sp + cd * cp);
        ringT += dT; ringQ += dFt * rr;
        const fy = dFt * az.s, fz = -dFt * az.c;       // the blade's drag pushes back on the airframe
        pFy += fy; pFz += fz;
        pMy += (PROP.hz + rr * az.s) * dT - PROP.hx * fz;
        pMz += PROP.hx * fy - rr * az.c * dT;
      }
      thrust += ringT; qProp += ringQ;
      // momentum balance for this ring of the disc, relaxed: the inflow takes a moment to build
      const phiM = Math.atan2(Math.abs(Ua0) + 0.5, omegaNow * rr);
      const tip = Math.max(0.15, (2 / Math.PI) * Math.acos(Math.min(1, Math.exp(-(PROP.blades / 2) * (PROP.R - rr) / (rr * Math.sin(phiM))))));
      const Va = Math.max(hubU, 0), ring = Math.PI * rr * rho * tip * st.dr;
      let target = 0.5 * (-Va + Math.sqrt(Va * Va + Math.abs(ringT) / ring));
      if (ringT < 0) target = -Math.min(target, 0.45 * Va);
      this.inflow[k] += (target - this.inflow[k]) * Math.min(1, dt * 30);
      viSum += this.inflow[k] * rr * st.dr; areaSum += rr * st.dr;
      swSum += (ringQ / (4 * ring * rr * rr * Math.max(Va + this.inflow[k], 3))) * rr * st.dr;   // swirl left in the wake
    }
    if (this.crashed) { thrust = 0; pFy = pFz = pMy = pMz = 0; }
    // ---------------- engine
    const sigma = rho / 1.225;
    const lapse = Math.max(0, (sigma - 0.117) / 0.883);
    const fa = 0.095 * c.mixture / Math.max(0.35, sigma);
    const pf = mixPower(fa);
    const firing = !!ENG && c.mags && !fx.cut && this.fuel > 0 && this.rpm > 180 && pf > 0.05 && !this.crashed;
    // a butterfly valve passes most of its air in the first half of its travel
    const thr = 0.115 + 0.885 * (1 - Math.pow(1 - c.throttle, 1.6));
    const shape = ENG ? 1 - 0.18 * sq((this.rpm - ENG.peak) / ENG.peak) : 0;
    const rough = fx.rough > 0 ? 1 - fx.rough * (0.5 + 0.5 * Math.sin(this.time * 61) * Math.sin(this.time * 17.3)) : 1;   // a misfiring engine surges
    const gross = firing ? ENG.gross * shape * lapse * thr * pf * fx.power * rough : 0;
    const fric = ENG && this.rpm > 1 ? ENG.f0 + ENG.f1 * sq(this.rpm / ENG.rpmMax) + (firing ? 0 : 1.2 * ENG.f0) : 0;
    const starter = ENG && c.starter && fx.starter && this.rpm < 620 && !this.crashed ? 0.2 * ENG.gross * (1 - this.rpm / 650) : 0;
    const qEng = gross - fric + starter;
    const rotI = ENG ? ENG.inertia : 1;
    this.rpm = ENG ? Math.max(0, this.rpm + ((qEng - qProp) / rotI) * (30 / Math.PI) * dt) : 0;
    if (PROP && PROP.governor) {
      // the governor coarsens the blades when the engine runs faster than the propeller lever asks, and fines them when slower
      const g = PROP.governor, want = g.min + (g.max - g.min) * clamp(c.prop, 0, 1);
      this.bladePitch = clamp(this.bladePitch + 0.0012 * (this.rpm - want) * dt, 0, g.range * D2R);
    }
    const omegaProp = this.rpm * Math.PI / 30;
    const power = gross * omegaProp;                 // indicated shaft power, W
    // 0.222 kg per indicated kWh at the chemically correct mixture: about 0.49 lb per brake hp per hour at best power
    const fuelFlow = firing ? (power / 1000) * 0.222 * (fa / 0.0667) / 3600 : 0; // kg/s
    this.fuel = Math.max(0, this.fuel - fuelFlow * dt);
    const vi = PROP ? Math.max(0, viSum / areaSum) : 0;          // mean air speed added through the disc
    const swirl = PROP ? Math.max(0, swSum / areaSum) : 0;       // and how fast that air is turning
    Fx += thrust; Fy += pFy; Fz += pFz;
    Mx -= qProp;                                      // torque reaction rolls left
    My += pMy; Mz += pMz;                             // uneven blade loading: P-factor, and the disc's own side force
    const H = rotI * omegaProp;        // gyroscopic precession
    My -= wb[2] * H;
    Mz += wb[1] * H;

    // ---------------- control surfaces
    const flapTarget = clamp(c.flaps, 0, 1);
    const flapRate = WD.flap ? dt / WD.flap.time : 1;
    const fp0 = this.flapPos;
    if (fx.flapPower && !fx.flapFrozen) this.flapPos += clamp(flapTarget - this.flapPos, -flapRate, flapRate);
    const fl = this.flapPos;
    const flapLift = Math.sin(fl * Math.PI / 2);
    const flapDrag = Math.pow(fl, 1.7);
    const de = clamp(-c.pitch * (c.pitch > 0 ? CTL.elevUp : CTL.elevDown) - clamp(c.trim + fx.trimOffset, -1, 1) * CTL.trim, -CTL.elevUp, CTL.elevDown) * D2R; // + = trailing edge down
    const dr = clamp(c.yaw + this.rig.yaw, -1, 1) * CTL.rudder * D2R;
    const FL = WD.flap || { dAlpha0: 0, dClmax: 0, dCd: 0, dCm: 0 }, AIL = WD.aileron, SPL = WD.spoiler || { dAlpha0: 0, dCd: 0 };
    const spoil = clamp(c.spoiler, 0, 1);
    this.gearPos += clamp((c.gear > 0.5 ? 1 : 0) - this.gearPos, -dt / 6, dt / 6);
    const rollIn = clamp(c.roll + this.rig.roll, -1, 1);

    // ---------------- wing
    const W = this.wing, N = W.n, Gm = W.gamma, A = W.A, Aimg = W.Aimg;
    const tick = this._tick++;
    // Ground effect: a mirror-image vortex system under the runway. It is only
    // worth solving within about a span of the surface.
    const gx = r31, gy = r32, gz = r33;                  // world-down in body axes
    const hWing = agl - (WD.x * gx + WD.z * gz);
    const mirror = hWing < 13 && gz > 0.3;
    if (mirror) {
      if ((tick & 7) === 0 || !W.hasImage) {
        // the wake streams back along the airflow, not along the fuselage: mirror that
        const wx = V > 4 ? -u / V : -1, wy = V > 4 ? -v / V : 0, wz = V > 4 ? -w / V : 0;
        const ddg = wx * gx + wy * gy + wz * gz, dix = wx - 2 * ddg * gx, diy = wy - 2 * ddg * gy, diz = wz - 2 * ddg * gz;
        for (let i = 0; i < N; i++) {
          for (let e = 0; e <= N; e++) {
            const h = Math.max(agl - (W.ex[e] * gx + W.ey[e] * gy + W.ez[e] * gz), 0.2);
            legVel(W.ex[e] + 2 * h * gx, W.ey[e] + 2 * h * gy, W.ez[e] + 2 * h * gz, dix, diy, diz, W.x[i], W.y[i], W.z[i], 0);
            W.edge[e] = _v[2];
          }
          for (let j = 0; j < N; j++) Aimg[i * N + j] = -(W.edge[j + 1] - W.edge[j]) / (4 * Math.PI);
        }
        W.hasImage = true;
      }
    } else if (W.hasImage) { Aimg.fill(0); W.hasImage = false; }

    // each strip's own airflow, before the wing's effect on itself
    for (let i = 0; i < N; i++) {
      const rx = W.x[i], ry = W.y[i], rz = W.z[i];
      W.lu[i] = u + q * rz - r * ry + (PROP && Math.abs(ry) < PROP.R ? 0.5 * vi : 0);   // inboard strips sit in the slipstream
      W.lv[i] = v + r * rx - p * rz;
      W.lw[i] = w + p * ry - q * rx;
      const s = W.ail[i] * rollIn;                       // >0: this strip's aileron goes up (20 deg up, 15 down)
      W.a0[i] = W.alpha0[i] - W.flap[i] * flapLift * FL.dAlpha0 * D2R + AIL.tau * (s > 0 ? s * AIL.up : s * AIL.down) * D2R + W.spoil[i] * spoil * SPL.dAlpha0 * D2R;
      W.cmx[i] = (W.clmax[i] + W.flap[i] * flapLift * FL.dClmax - W.spoil[i] * spoil * (SPL.dClmax || 0)) * (1 - 0.27 * ice);   // rough ice trips the flow early
    }
    // Circulation: relax every strip toward the lift its section makes in the
    // downwash of all the others. A few passes per step track the flight
    // condition closely; the small lag left over is the wake's own.
    const hasImg = W.hasImage, relax = W.relax;
    for (let it = 0; it <= 3; it++) {
      for (let i = 0; i < N; i++) {
        let acc = 0;
        const row = i * N;
        if (hasImg) for (let j = 0; j < N; j++) acc += (A[row + j] + Aimg[row + j]) * Gm[j];
        else for (let j = 0; j < N; j++) acc += A[row + j] * Gm[j];
        W.wi[i] = acc;
      }
      if (it === 3) break;
      for (let i = 0; i < N; i++) {
        const vz = W.lw[i] - W.wi[i];
        const vc = W.lu[i] * W.cx[i] + vz * W.cz[i];
        const vn = W.lu[i] * W.nx[i] + W.lv[i] * W.ny[i] + vz * W.nz[i];
        section(Math.atan2(-vn, vc) - W.a0[i], W.a2d, W.cmx[i], SEC.clmin, W.sep);
        Gm[i] += relax * (0.5 * Math.sqrt(vc * vc + vn * vn) * W.chord[i] * _sec.cl - Gm[i]);
        W.f[i] = _sec.f;
      }
      // separated flow smears its circulation along the span instead of holding sharp cells
      for (let i = 0; i < N; i++) {
        const sep = 1 - W.f[i];
        W.tmp[i] = sep > 0.02 ? Gm[i] + 0.22 * sep * (Gm[i > 0 ? i - 1 : 0] - 2 * Gm[i] + Gm[i < N - 1 ? i + 1 : N - 1]) : Gm[i];
      }
      Gm.set(W.tmp);
    }
    // forces on each strip, in the flow it actually sees
    let sepS = 0, warnMax = 0;
    for (let i = 0; i < N; i++) {
      const rx = W.x[i], ry = W.y[i], rz = W.z[i];
      const cx = W.cx[i], cz = W.cz[i], nx = W.nx[i], ny = W.ny[i], nz = W.nz[i];
      const vz = W.lw[i] - W.wi[i];
      const vc = W.lu[i] * cx + vz * cz;
      const vn = W.lu[i] * nx + W.lv[i] * ny + vz * nz;
      const q2 = vc * vc + vn * vn;
      if (q2 < 1e-3) { W.f[i] = 1; W.cl[i] = 0; continue; }
      const al = Math.atan2(-vn, vc);
      const aeff = al - W.a0[i];
      section(aeff, W.a2d, W.cmx[i], SEC.clmin, W.sep);
      const cl = _sec.cl, f = _sec.f;
      // Profile drag only: the drag due to lift is the tilt of the lift vector in the downwash.
      // The cl-squared term is the section's own polar plus the leaks and junctions of a real wing.
      const cd = SEC.cd0 + 0.014 * ice + SEC.k * f * sq(cl - SEC.clmd) + W.flap[i] * flapDrag * FL.dCd + W.spoil[i] * spoil * SPL.dCd + (1 - f) * 1.8 * sq(Math.sin(aeff));
      const cm = SEC.cm0 - W.flap[i] * flapLift * FL.dCm - (1 - f) * 0.10 * Math.sign(aeff);
      const qS = 0.5 * rho * q2 * W.S[i];
      const sa = Math.sin(al), ca = Math.cos(al);
      const L = qS * cl, Dg = qS * cd;
      const fx = L * (sa * cx + ca * nx) - Dg * (ca * cx - sa * nx);
      const fy = L * (ca * ny) - Dg * (-sa * ny);
      const fz = L * (sa * cz + ca * nz) - Dg * (ca * cz - sa * nz);
      Fx += fx; Fy += fy; Fz += fz;
      Mx += ry * fz - rz * fy;
      My += rz * fx - rx * fz + qS * W.chord[i] * cm;
      Mz += rx * fy - ry * fx;
      sepS += (1 - f) * W.S[i];
      if (i === W.warnIdx && aeff > 0) warnMax = _sec.t;
      W.f[i] = f; W.cl[i] = cl;
    }

    // ---------------- the wake at the tail
    // Every other step, find the velocity the wing's vortex system induces at
    // each tail strip: trailing legs streaming back along the airflow, the
    // bound vortex, and their mirror images near the ground.
    const els = this.els;
    if ((tick & 1) === 0) {
      let dx = -1, dy = 0, dz = 0;
      if (V > 4) { dx = -u / V; dy = -v / V; dz = -w / V; }
      const ddg = dx * gx + dy * gy + dz * gz;
      const dix = dx - 2 * ddg * gx, diy = dy - 2 * ddg * gy, diz = dz - 2 * ddg * gz;
      for (let e = 0; e <= N; e++) W.edge[e] = (e > 0 ? Gm[e - 1] : 0) - (e < N ? Gm[e] : 0);   // net strength shed at each strip edge
      const CORE2 = 0.12;
      for (let k = 0; k < els.length; k++) {
        const el = els[k], px = el.r[0], py = el.r[1], pz = el.r[2];
        let sx = 0, sy = 0, sz = 0;
        for (let e = 0; e <= N; e++) {
          const g = W.edge[e];
          legVel(W.ex[e], W.ey[e], W.ez[e], dx, dy, dz, px, py, pz, CORE2);
          sx += g * _v[0]; sy += g * _v[1]; sz += g * _v[2];
          if (e < N) {
            segVel(W.ex[e], W.ey[e], W.ez[e], W.ex[e + 1], W.ey[e + 1], W.ez[e + 1], px, py, pz, CORE2);
            sx += Gm[e] * _v[0]; sy += Gm[e] * _v[1]; sz += Gm[e] * _v[2];
          }
          if (mirror) {
            const h = Math.max(agl - (W.ex[e] * gx + W.ey[e] * gy + W.ez[e] * gz), 0.2);
            const ix = W.ex[e] + 2 * h * gx, iy = W.ey[e] + 2 * h * gy, iz = W.ez[e] + 2 * h * gz;
            legVel(ix, iy, iz, dix, diy, diz, px, py, pz, CORE2);
            sx -= g * _v[0]; sy -= g * _v[1]; sz -= g * _v[2];
          }
        }
        const k4 = 1 / (4 * Math.PI);
        const lag = Math.min(1, 2 * dt * Math.max(V, 6) / Math.max(1, WD.x - px));   // the wake takes time to arrive
        el.wake[0] += (sx * k4 - el.wake[0]) * lag;
        el.wake[1] += (sy * k4 - el.wake[1]) * lag;
        el.wake[2] += (sz * k4 - el.wake[2]) * lag;
      }
    }

    // ---------------- tail surfaces
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const rx = el.r[0], ry = el.r[1], rz = el.r[2];
      const lu = u + q * rz - r * ry - el.wake[0] + el.wash * 2 * vi;       // propwash
      const lv = v + r * rx - p * rz - el.wake[1] - el.swirl * 0.55 * swirl;    // the spiralling slipstream strikes the left of the fin
      const lw = w + p * ry - q * rx - el.wake[2];
      const a0 = el.alpha0 - el.elev * de + el.rud * dr;
      const cx = el.c[0], cy = el.c[1], cz = el.c[2], nx = el.n[0], ny = el.n[1], nz = el.n[2];
      const vc = lu * cx + lv * cy + lw * cz;
      const vn = lu * nx + lv * ny + lw * nz;
      const q2 = vc * vc + vn * vn;
      if (q2 < 1e-3) { el.f = 1; el.cl = 0; continue; }
      const al = Math.atan2(-vn, vc);
      const aeff = al - a0;
      section(aeff, el.a, el.clmax * (1 - 0.38 * ice), el.clmin * (1 - 0.38 * ice), 0.14);   // the tail's small radius ices worst
      const cl = _sec.cl, f = _sec.f;
      const cd = el.cd0 + 0.02 * ice + el.kInd * cl * cl + (1 - f) * 1.8 * sq(Math.sin(aeff));
      const qS = 0.5 * rho * q2 * el.S;
      const sa = Math.sin(al), ca = Math.cos(al);
      const L = qS * cl, Dg = qS * cd;
      const fx = L * (sa * cx + ca * nx) - Dg * (ca * cx - sa * nx);
      const fy = L * (sa * cy + ca * ny) - Dg * (ca * cy - sa * ny);
      const fz = L * (sa * cz + ca * nz) - Dg * (ca * cz - sa * nz);
      Fx += fx; Fy += fy; Fz += fz;
      Mx += ry * fz - rz * fy;
      My += rz * fx - rx * fz;
      Mz += rx * fy - ry * fx;
      el.f = f; el.cl = cl;
    }

    // ---------------- fuselage
    // Each station feels the local crossflow (so the body damps pitch and yaw
    // where its area is): a part linear in the crossflow for small angles and
    // a bluff-body part that takes over when the flow comes from the side.
    const BODY = this.body;
    for (let k = 0; k < BODY.length; k++) {
      const st = BODY[k];
      const sv = v + r * st.x, sw = w - q * st.x;
      const fy = -0.5 * rho * sv * (0.27 * V + 0.8 * Math.abs(sv)) * st.side;
      const fz = -0.5 * rho * sw * (0.40 * V + 1.0 * Math.abs(sw)) * st.plan;
      Fy += fy; Fz += fz;
      My -= st.x * fz;
      Mz += st.x * fy;
    }
    // A slender body at an angle to the flow carries no net force in ideal
    // flow, only a moment that tries to turn it broadside: destabilising in
    // both pitch and yaw. The tail has to overcome it.
    Mz -= rho * DEF.body.munkYaw * u * v;
    My += rho * DEF.body.munkPitch * u * w;
    const windmill = PROP && !firing && this.rpm < 400 ? 0.05 : 0;
    Fx -= 0.5 * rho * V * u * (DEF.body.cda * (1 + 0.2 * ice) + windmill);
    const DRAG_PARTS = DEF.parts;
    for (let k = 0; k < DRAG_PARTS.length; k++) {
      const part = DRAG_PARTS[k], rx = part.r[0], ry = part.r[1], rz = part.r[2];
      if (part.gear && this.gearPos < 0.02) continue;
      const lu = u + q * rz - r * ry, lv = v + r * rx - p * rz, lw = w + p * ry - q * rx;
      const kd = -0.5 * rho * Math.hypot(lu, lv, lw) * part.cda * (part.gear ? this.gearPos : 1);
      const fx = kd * lu, fy = kd * lv, fz = kd * lw;
      Fx += fx; Fy += fy; Fz += fz;
      Mx += ry * fz - rz * fy;
      My += rz * fx - rx * fz;
      Mz += rx * fy - ry * fx;
    }

    // ---------------- ground contact
    let onGround = false, groundLoad = 0, wheelSpeed = 0, scrape = 0;
    if (agl < 12) {
      // heading of the wheels on the ground plane
      let hx = r11, hy = r21;
      const hl = Math.hypot(hx, hy) || 1;
      hx /= hl; hy /= hl;
      const gs = Math.hypot(vel[0], vel[1]);
      const steerMax = (18 - 13 * clamp(gs / 22, 0, 1)) * D2R;
      const park = c.park ? 1 : 0;
      const CONTACTS = this.contacts;
      for (let i = 0; i < CONTACTS.length; i++) {
        const cp = CONTACTS[i];
        if (cp.wheel && cp.retract && this.gearPos < 0.5) continue;
        const rx = cp.r[0], ry = cp.r[1], rz = cp.r[2];
        // contact point offset and velocity in world axes
        const on = r11 * rx + r12 * ry + r13 * rz;
        const oe = r21 * rx + r22 * ry + r23 * rz;
        const od = r31 * rx + r32 * ry + r33 * rz;
        const pn = pos[0] + on, pe = pos[1] + oe;
        const g = cp.wheel && agl < 3 ? env.ground(pn, pe) : gh;
        const pen = pos[2] + od + g;
        this.gearLoad[i] = 0;
        if (pen <= 0) continue;
        const bx = wb[1] * rz - wb[2] * ry, by = wb[2] * rx - wb[0] * rz, bz = wb[0] * ry - wb[1] * rx;
        const pvn = vel[0] + r11 * bx + r12 * by + r13 * bz;
        const pve = vel[1] + r21 * bx + r22 * by + r23 * bz;
        const pvd = vel[2] + r31 * bx + r32 * by + r33 * bz;
        let N = cp.k * pen + cp.c * pvd;
        if (N <= 0) continue;
        N = Math.min(N, mass * G * 9);
        onGround = true;
        groundLoad += N;
        let fn, fe;
        if (cp.wheel && !this.crashed) {
          this.gearLoad[i] = N;
          let fxw = hx, fyw = hy;
          if (cp.steer) {
            const s = clamp(c.yaw, -1, 1) * steerMax * cp.steer;
            const cs = Math.cos(s), sn = Math.sin(s);
            fxw = cs * hx - sn * hy; fyw = sn * hx + cs * hy;
          }
          const vlong = pvn * fxw + pve * fyw;
          const vlat = -pvn * fyw + pve * fxw;
          const brake = cp.brake ? Math.max(park, cp.brake === 'L' ? c.brakeL : c.brakeR) : 0;
          // A locked wheel grips like a tyre (it will hold full power); a rolling one is limited
          // by what small disc brakes can absorb, which is what handbook landing rolls reflect.
          const grip = 0.40 + 0.35 * clamp(1 - Math.abs(vlong) / 1.5, 0, 1);
          let flong = -N * (0.025 + grip * brake) * sat(vlong / 0.06);
          let flat = -N * 0.85 * sat(vlat / (0.25 + 0.05 * Math.abs(vlong)));
          const fm = Math.hypot(flong, flat), fmax = 0.9 * N;
          if (fm > fmax) { flong *= fmax / fm; flat *= fmax / fm; }
          fn = fxw * flong - fyw * flat;
          fe = fyw * flong + fxw * flat;
          wheelSpeed = Math.max(wheelSpeed, Math.abs(vlong));
          if (N > mass * G * 3.2 && !this.crashed) this.crashed = 'Gear collapsed';
        } else {
          const sp = Math.hypot(pvn, pve);
          const mu = 0.55 * sat(sp / 0.3);
          fn = sp > 1e-6 ? -N * mu * pvn / sp : 0;
          fe = sp > 1e-6 ? -N * mu * pve / sp : 0;
          scrape = Math.max(scrape, sp);
          if (!this.crashed && (sp > 4 || pvd > 1.5 || cp.name === 'prop')) {
            this.crashed = cp.name === 'prop' ? 'Prop strike' : cp.name.startsWith('tip') ? 'Wingtip strike' : cp.name === 'tail' ? 'Tail strike' : 'Crashed';
          }
        }
        // world force (north, east, down) -> body
        const wfd = -N;
        const bxF = r11 * fn + r21 * fe + r31 * wfd;
        const byF = r12 * fn + r22 * fe + r32 * wfd;
        const bzF = r13 * fn + r23 * fe + r33 * wfd;
        Fx += bxF; Fy += byF; Fz += bzF;
        Mx += ry * bzF - rz * byF;
        My += rz * bxF - rx * bzF;
        Mz += rx * byF - ry * bxF;
      }
    }
    // a skip during the takeoff roll is not a landing: count time off the ground
    this._airT = onGround ? (this._wasAir ? this._airT : 0) : (this._airT || 0) + dt;
    if (onGround && this._wasAir) {
      this.touchdowns++;
      o.touchdownVs = vel[2];
      o.touchdownAir = this._airT;
      this._tdIas = o.ias;
      if (vel[2] > 4.6 && !this.crashed) this.crashed = 'Hard landing';
    }
    this._wasAir = !onGround;

    // ---------------- integrate
    const ax = Fx / mass, ay = Fy / mass, az = Fz / mass;   // specific force, body
    vel[0] += (r11 * ax + r12 * ay + r13 * az) * dt;
    vel[1] += (r21 * ax + r22 * ay + r23 * az) * dt;
    vel[2] += (r31 * ax + r32 * ay + r33 * az + G) * dt;
    const { Ixx, Iyy, Izz } = DEF.inertia;
    const pd = (Mx - (Izz - Iyy) * wb[1] * wb[2]) / Ixx;
    const qd = (My - (Ixx - Izz) * wb[2] * wb[0]) / Iyy;
    const rd = (Mz - (Iyy - Ixx) * wb[0] * wb[1]) / Izz;
    wb[0] += pd * dt; wb[1] += qd * dt; wb[2] += rd * dt;
    if (this.crashed && onGround) {
      // wreckage: bleed off whatever motion is left
      const k = Math.exp(-dt * 1.5);
      wb[0] *= k; wb[1] *= k; wb[2] *= k;
    }
    pos[0] += vel[0] * dt; pos[1] += vel[1] * dt; pos[2] += vel[2] * dt;
    const hp = 0.5 * dt;
    let nw = qw - hp * (qx * wb[0] + qy * wb[1] + qz * wb[2]);
    let nx = qx + hp * (qw * wb[0] + qy * wb[2] - qz * wb[1]);
    let ny = qy + hp * (qw * wb[1] + qz * wb[0] - qx * wb[2]);
    let nz = qz + hp * (qw * wb[2] + qx * wb[1] - qy * wb[0]);
    const nl = Math.hypot(nw, nx, ny, nz);
    this.q[0] = nw / nl; this.q[1] = nx / nl; this.q[2] = ny / nl; this.q[3] = nz / nl;
    this.time += dt;

    // ---------------- engine thermals (slow first-order lags)
    const pw = power / 134000;
    this.egt += ((firing ? mixEGT(fa) * (0.72 + 0.28 * pw) : atm.T - 273.15) - this.egt) * Math.min(1, dt / 4);
    this.cht += ((firing ? 120 + 110 * pw - 0.35 * Math.min(V, 70) + (fa < 0.07 ? 25 : 0) : atm.T - 273.15) - this.cht) * Math.min(1, dt / 60);
    this.oilT += ((firing ? 62 + 42 * pw : atm.T - 273.15) - this.oilT) * Math.min(1, dt / 120);

    // ---------------- what the instruments and the rest of the sim read
    o.tas = V; o.alpha = alpha; o.beta = beta;
    o.ias = Math.sqrt(sigma) * Math.max(u, 0);
    o.gs = Math.hypot(vel[0], vel[1]);
    o.alt = alt; o.agl = agl; o.vs = -vel[2];
    // altimeter: pressure altitude against the Kollsman setting
    o.altInd = (ISA.T0 / ISA.L) * (1 - Math.pow(atm.p / this.kollsman, 0.190263));
    this.vsiLag += (o.vs - this.vsiLag) * Math.min(1, dt / 1.2);
    o.vsInd = this.vsiLag;
    o.roll = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy));
    o.pitch = Math.asin(clamp(2 * (qw * qy - qz * qx), -1, 1));
    o.heading = (Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz)) + 2 * Math.PI) % (2 * Math.PI);
    o.track = (Math.atan2(vel[1], vel[0]) + 2 * Math.PI) % (2 * Math.PI);
    o.gLoad = -az / G;
    o.ax = ax; o.ay = ay; o.az = az;      // specific force, body axes
    o.slip = Math.atan2(ay, Math.max(-az, 0.5 * G) );   // the ball: lateral vs normal specific force
    o.turnRate = wb[2] * Math.cos(o.roll) + wb[1] * Math.sin(o.roll);
    o.rpm = this.rpm; o.thrust = thrust; o.power = power; o.fuelFlow = fuelFlow;
    o.bhp = Math.max(0, (gross - fric) * omegaProp) / 745.7;
    o.egt = this.egt; o.oilT = this.oilT; o.cht = this.cht;
    o.oilP = clamp(this.rpm / 1000, 0, 1) * (75 - 0.12 * Math.max(0, this.oilT - 80)) * (0.55 + 0.45 * clamp(this.rpm / 2400, 0, 1)) / 0.775 * 0.775;
    o.map = (atm.p / 3386.39) * (0.36 + 0.61 * (1 - Math.pow(1 - c.throttle, 1.6))) * (1 - 0.00003 * Math.max(0, this.rpm - 1000) * (1 - c.throttle));
    o.stallWarn = !onGround && o.ias > 12 ? smooth(0.80, 0.86, warnMax) : 0;
    o.stalled = sepS / this.S;       // fraction of the wing area that has let go
    o.onGround = onGround; o.wheelSpeed = onGround ? wheelSpeed : 0; o.groundLoad = groundLoad; o.scrape = scrape;
    o.flapPos = this.flapPos; o.flapMoving = this.flapPos !== fp0;
    o.firing = firing; o.vi = vi; o.staticP = atm.p; o.dynP = 0.5 * rho * Math.max(u, 0) * Math.max(u, 0); o.swirl = swirl; o.qProp = qProp; o.mass = mass; o.rho = rho; o.oat = atm.T - 273.15;
    o.elevator = de; o.rudder = dr; o.aileron = rollIn;
  }
}

// A plain two-axis autopilot. The sim offers it to the pilot; the validation
// script uses it to hold a condition steady while it measures performance.
export class Autopilot {
  constructor(fm) {
    this.fm = fm;
    this.on = false;
    this.mode = 'alt';        // 'alt' holds altitude, 'ias' holds airspeed with pitch, 'vs' holds a climb rate
    this.alt = 0; this.ias = 0; this.vs = 0; this.heading = 0;
    this.lateral = 'hdg';     // 'hdg' or 'lvl'
    this.thetaI = 0; this.elevI = 0; this.rudI = 0; this.rollI = 0;
  }
  engage(mode = 'alt') {
    const o = this.fm.out;
    this.on = true; this.mode = mode;
    this.alt = o.alt; this.ias = o.ias; this.vs = 0; this.heading = o.heading;
    this.thetaI = o.pitch; this.elevI = this.fm.ctl.pitch; this.rudI = 0; this.rollI = 0;
  }
  update(dt) {
    if (!this.on) return;
    const fm = this.fm, o = fm.out, c = fm.ctl, w = fm.w;
    let thetaCmd;
    if (this.mode === 'ias') {
      const err = (o.ias - this.ias);                       // fast -> pitch up
      this.thetaI = clamp(this.thetaI + 0.004 * err * dt, -0.35, 0.4);
      thetaCmd = this.thetaI + 0.012 * err;
    } else {
      const vsCmd = this.mode === 'vs' ? this.vs : clamp(0.18 * (this.alt - o.alt), -5, 5);
      const err = vsCmd - o.vs;
      this.thetaI = clamp(this.thetaI + 0.006 * err * dt, -0.3, 0.35);
      thetaCmd = this.thetaI + 0.012 * err;
    }
    thetaCmd = clamp(thetaCmd, -0.35, 0.4);
    const pe = thetaCmd - o.pitch;
    this.elevI = clamp(this.elevI + 1.2 * pe * dt, -1, 1);
    c.pitch = clamp(4.0 * pe - 0.9 * w[1] + this.elevI, -1, 1);
    let bankCmd = 0;
    if (this.lateral === 'hdg') {
      let he = this.heading - o.heading;
      while (he > Math.PI) he -= 2 * Math.PI;
      while (he < -Math.PI) he += 2 * Math.PI;
      bankCmd = clamp(1.4 * he, -25 * D2R, 25 * D2R);
    }
    const be = bankCmd - o.roll;
    this.rollI = clamp(this.rollI + 0.5 * be * dt, -0.5, 0.5);
    c.roll = clamp(2.2 * be - 0.5 * w[0] + this.rollI, -1, 1);
    this.rudI = clamp(this.rudI + 2.5 * o.beta * dt, -1, 1);
    c.yaw = clamp(3.0 * o.beta + this.rudI - 0.4 * w[2], -1, 1);
  }
}
