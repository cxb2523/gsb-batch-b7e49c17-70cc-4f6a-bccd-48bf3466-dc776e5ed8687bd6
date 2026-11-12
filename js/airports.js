// Airports. A short list of places worth flying, plus any airport in the world
// by ICAO code: runway thresholds, elevations and widths come from the
// OurAirports open data (public domain), fetched once and cached by the browser.
import * as THREE from '../vendor/three.module.js';

const FT = 0.3048;
const RUNWAYS_URL = 'https://davidmegginson.github.io/ourairports-data/runways.csv';

// lat, lon, elevation (m) and one approximate runway, used only if the data file cannot be reached
export const AIRPORTS = [
  { id: 'LSGS', name: 'Sion', where: 'Swiss Alps', lat: 46.2196, lon: 7.3267, elev: 482, hdg: 67, len: 2000 },
  { id: 'LOWI', name: 'Innsbruck', where: 'Austria', lat: 47.2602, lon: 11.3439, elev: 581, hdg: 79, len: 2000 },
  { id: 'LFLJ', name: 'Courchevel', where: 'French Alps', lat: 45.3967, lon: 6.6347, elev: 2008, hdg: 42, len: 537 },
  { id: 'LFMN', name: 'Nice', where: 'Côte d\'Azur', lat: 43.6584, lon: 7.2159, elev: 4, hdg: 44, len: 2960 },
  { id: 'LFPB', name: 'Le Bourget', where: 'Paris', lat: 48.9694, lon: 2.4414, elev: 66, hdg: 72, len: 3000 },
  { id: 'EGLC', name: 'London City', where: 'London', lat: 51.5053, lon: 0.0553, elev: 6, hdg: 93, len: 1500 },
  { id: 'LPMA', name: 'Madeira', where: 'Portugal', lat: 32.6979, lon: -16.7745, elev: 58, hdg: 47, len: 2780 },
  { id: 'KSFO', name: 'San Francisco', where: 'California', lat: 37.6189, lon: -122.375, elev: 4, hdg: 298, len: 3600 },
  { id: 'KTEX', name: 'Telluride', where: 'Colorado', lat: 37.9538, lon: -107.9085, elev: 2767, hdg: 95, len: 2100 },
  { id: 'KSEZ', name: 'Sedona', where: 'Arizona', lat: 34.8486, lon: -111.7884, elev: 1472, hdg: 45, len: 1560 },
  { id: 'PHOG', name: 'Kahului', where: 'Maui', lat: 20.8986, lon: -156.4305, elev: 16, hdg: 35, len: 2130 },
  { id: 'TNCM', name: 'Princess Juliana', where: 'Sint Maarten', lat: 18.0410, lon: -63.1089, elev: 4, hdg: 96, len: 2300 },
  { id: 'SBRJ', name: 'Santos Dumont', where: 'Rio de Janeiro', lat: -22.9105, lon: -43.1631, elev: 3, hdg: 356, len: 1320 },
  { id: 'NZQN', name: 'Queenstown', where: 'New Zealand', lat: -45.0211, lon: 168.7392, elev: 357, hdg: 55, len: 1890 },
  { id: 'VNLK', name: 'Lukla', where: 'Nepal', lat: 27.6869, lon: 86.7297, elev: 2846, hdg: 63, len: 527 },
  { id: 'FACT', name: 'Cape Town', where: 'South Africa', lat: -33.9648, lon: 18.6017, elev: 46, hdg: 356, len: 3200 },
];

let table = null, loading = null;
function parseCsv(text) {
  const map = new Map();
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row) continue;
    const f = [];
    let cur = '', q = false;
    for (let k = 0; k < row.length; k++) {
      const ch = row[k];
      if (ch === '"') q = !q; else if (ch === ',' && !q) { f.push(cur); cur = ''; } else cur += ch;
    }
    f.push(cur);
    if (f[7] === '1' || f[9] === '' || f[10] === '' || f[15] === '' || f[16] === '') continue;
    const num = (s) => (s === '' ? null : Number(s));
    const rw = {
      length: num(f[3]) * FT, width: (num(f[4]) || 60) * FT, surface: f[5], lighted: f[6] === '1',
      le: { id: f[8], lat: num(f[9]), lon: num(f[10]), elev: f[11] === '' ? null : num(f[11]) * FT },
      he: { id: f[14], lat: num(f[15]), lon: num(f[16]), elev: f[17] === '' ? null : num(f[17]) * FT },
    };
    if (!map.has(f[2])) map.set(f[2], []);
    map.get(f[2]).push(rw);
  }
  return map;
}
export function loadRunwayData() {
  if (!loading) {
    loading = fetch(RUNWAYS_URL).then((r) => { if (!r.ok) throw new Error('runways'); return r.text(); })
      .then((t) => { table = parseCsv(t); return table; })
      .catch(() => { table = new Map(); return table; });
  }
  return loading;
}

// Resolve an ICAO code to a place with runways. Returns null if unknown.
export async function resolveAirport(ident) {
  ident = ident.trim().toUpperCase();
  const known = AIRPORTS.find((a) => a.id === ident);
  const data = await loadRunwayData();
  let runways = data.get(ident) || [];
  if (!runways.length && !known) return null;
  let lat, lon, elev;
  if (runways.length) {
    const r = runways.slice().sort((a, b) => b.length - a.length)[0];
    lat = (r.le.lat + r.he.lat) / 2; lon = (r.le.lon + r.he.lon) / 2;
    const es = runways.flatMap((x) => [x.le.elev, x.he.elev]).filter((x) => x != null);
    elev = es.length ? es.reduce((a, b) => a + b, 0) / es.length : known ? known.elev : 0;
  } else {
    lat = known.lat; lon = known.lon; elev = known.elev;
    const rad = Math.PI / 180, R = 6371008.8, h = known.len / 2;
    const dLat = (Math.cos(known.hdg * rad) * h) / R / rad, dLon = (Math.sin(known.hdg * rad) * h) / (R * Math.cos(lat * rad)) / rad;
    const n = Math.round(known.hdg / 10) || 36;
    runways = [{
      length: known.len, width: 30, lighted: true, approximate: true,
      le: { id: String(n).padStart(2, '0'), lat: lat - dLat, lon: lon - dLon, elev },
      he: { id: String(((n + 17) % 36) + 1).padStart(2, '0'), lat: lat + dLat, lon: lon + dLon, elev },
    }];
  }
  return { id: ident, name: known ? known.name : ident, where: known ? known.where : '', lat, lon, elev, runways };
}

// Runways in the local frame, plus the departure end that best faces the wind.
export function layoutRunways(airport, geo) {
  return airport.runways.map((r) => {
    const a = geo.toLocal(r.le.lat, r.le.lon), b = geo.toLocal(r.he.lat, r.he.lon);
    return {
      ...r, e0: a.e, n0: a.n, e1: b.e, n1: b.n,
      elev0: r.le.elev != null ? r.le.elev : airport.elev, elev1: r.he.elev != null ? r.he.elev : airport.elev,
      heading: Math.atan2(b.e - a.e, b.n - a.n),
    };
  });
}
export function pickRunway(runways, windFromDeg, windSpd) {
  let best = null;
  for (const r of runways) {
    for (const end of [0, 1]) {
      const hdg = end === 0 ? r.heading : r.heading + Math.PI;
      const head = windSpd * Math.cos(windFromDeg * Math.PI / 180 - hdg);
      const score = head + r.length / 1000 + (r.lighted ? 0.5 : 0);
      if (!best || score > best.score) {
        best = {
          score, runway: r, heading: (hdg + 2 * Math.PI) % (2 * Math.PI), headwind: head,
          id: end === 0 ? r.le.id : r.he.id,
          e: end === 0 ? r.e0 : r.e1, n: end === 0 ? r.n0 : r.n1,
          elev: end === 0 ? r.elev0 : r.elev1, farElev: end === 0 ? r.elev1 : r.elev0, length: Math.hypot(r.e1 - r.e0, r.n1 - r.n0),
        };
      }
    }
  }
  return best;
}

// Edge lights, threshold bars and a PAPI for every runway.
export class RunwayLights {
  constructor(runways) {
    const pos = [], col = [];
    this.papis = [];
    const add = (e, n, u, r, g, b) => { pos.push(e, u, -n); col.push(r, g, b); return pos.length / 3 - 1; };
    for (const rw of runways) {
      const L = Math.hypot(rw.e1 - rw.e0, rw.n1 - rw.n0);
      const ux = (rw.e1 - rw.e0) / L, uy = (rw.n1 - rw.n0) / L, px = uy, py = -ux; // p = right of the le->he direction
      const hw = rw.width / 2 + 1.5;
      const elev = (s) => rw.elev0 + (rw.elev1 - rw.elev0) * (s / L) + 0.45;
      for (let s = 0; s <= L; s += 60) {
        const amber = s < 600 || s > L - 600 ? 0.55 : 1;
        for (const side of [-1, 1]) add(rw.e0 + ux * s + px * hw * side, rw.n0 + uy * s + py * hw * side, elev(s), 1, 0.92 * (0.6 + 0.4 * amber), 0.75 * amber);
      }
      for (let t = -hw; t <= hw; t += 3) {
        add(rw.e0 + px * t - ux * 3, rw.n0 + py * t - uy * 3, elev(0), 0.15, 1, 0.3);
        add(rw.e1 + px * t + ux * 3, rw.n1 + py * t + uy * 3, elev(L), 0.15, 1, 0.3);
      }
      // approach lights: a short white centreline row before each threshold
      for (let s = 60; s <= 420; s += 60) { add(rw.e0 - ux * s, rw.n0 - uy * s, elev(0), 1, 1, 1); add(rw.e1 + ux * s, rw.n1 + uy * s, elev(L), 1, 1, 1); }
      for (const end of [0, 1]) {
        const dir = end === 0 ? 1 : -1;
        const be = (end === 0 ? rw.e0 : rw.e1) + ux * 300 * dir, bn = (end === 0 ? rw.n0 : rw.n1) + uy * 300 * dir;
        const u = elev(end === 0 ? 300 : L - 300);
        const idx = [];
        for (let k = 0; k < 4; k++) {
          const off = -(hw + 15 + k * 9) * dir;          // left of the landing direction
          idx.push(add(be + px * off, bn + py * off, u, 1, 1, 1));
        }
        this.papis.push({ e: be, n: bn, u, idx });
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.color = new THREE.Float32BufferAttribute(col, 3);
    g.setAttribute('color', this.color);
    this.uniforms = { uGain: { value: 1 }, uScale: { value: 1000 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      vertexShader: /* glsl */`
        attribute vec3 color; uniform float uScale; uniform float uGain; varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = length(mv.xyz);
          gl_PointSize = clamp(uScale * 0.55 / d, 1.6, 9.0);
          vC = color * uGain * min(1.0, 2600.0 / d + 0.25) * smoothstep(60000.0, 20000.0, d);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC;
        void main() { vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.05, length(q)); gl_FragColor = vec4(vC * a * a, 0.0); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
  }
  // cam: local east/north/up of the eye. gain: how bright (night, murk)
  update(cam, gain, pixelScale) {
    this.points.position.set(-cam.e, -cam.u, cam.n);
    this.uniforms.uGain.value = gain;
    this.uniforms.uScale.value = pixelScale;
    const steps = [2.5, 2.83, 3.17, 3.5];
    for (const p of this.papis) {
      const d = Math.hypot(cam.e - p.e, cam.n - p.n);
      const ang = Math.atan2(cam.u - p.u, d) * 180 / Math.PI;
      for (let k = 0; k < 4; k++) {
        const white = ang > steps[k];
        this.color.setXYZ(p.idx[k], 1.6, white ? 1.6 : 0.08, white ? 1.5 : 0.05);
      }
    }
    this.color.needsUpdate = true;
  }
  dispose() { this.points.geometry.dispose(); this.points.material.dispose(); this.points.parent && this.points.parent.remove(this.points); }
}
