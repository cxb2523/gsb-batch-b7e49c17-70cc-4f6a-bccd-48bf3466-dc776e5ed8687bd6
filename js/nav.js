// Radio navigation: VOR, DME, NDB and ILS receivers, a GPS direct-to, and the
// coupling that lets the autopilot fly them. No DOM and no three.js, so all of
// it runs under node (test/nav.mjs).
//
// Real stations come from the OurAirports navaid file, fetched at runtime.
// OurAirports carries no ILS data, so every runway end of the loaded airport is
// given a localizer, a glideslope and a DME by the sim. Their geometry follows
// the surveyed runway; their frequencies and idents are assigned here and are
// not the real ones.
//
// Frames and signs
//   positions    local east/north metres (Geo), altitude metres above sea level
//   bearings     degrees magnetic where a pilot reads them (radial, OBS, course),
//                radians true where the autopilot uses them
//   variation    degrees, east positive: magnetic = true - variation
//   course dots  -5..+5, positive = needle right of centre = the course is to your right
//   glide dots   -5..+5, positive = needle above centre = the glidepath is above you

export const NAVAIDS_URL = 'https://davidmegginson.github.io/ourairports-data/navaids.csv';

const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = 2 * Math.PI;
const NM = 1852, FT = 0.3048, KT = 0.514444;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap360 = (d) => ((d % 360) + 360) % 360;
const wrap180 = (d) => wrap360(d + 180) - 180;

export const DOTS = 5;               // dots from centre to full scale
export const VOR_FULL = 10;          // degrees at full scale
export const LOC_FULL = 2.5;
export const GS_FULL = 0.7;
export const GS_ANGLE = 3;           // degrees
export const GPS_FULL = 1 * NM;      // cross-track at full scale when the indicator follows the GPS

const LOAD_RADIUS = 600e3;           // stations kept around the airport; the flat local frame is no good beyond this
const LOC_BEYOND = 300;              // localizer aerial, metres past the far end of the runway
const GS_AIM = 300;                  // glideslope aerial, metres past the threshold
const CONE = 60;                     // degrees of elevation above which a VOR bearing is unusable
const TAN_GS = Math.tan(GS_ANGLE * D2R);

// Radio horizon over a smooth Earth with 4/3 refraction, both heights in metres.
const horizon = (h1, h2) => 4122 * (Math.sqrt(Math.max(h1, 0)) + Math.sqrt(Math.max(h2, 0)));

// ---------------------------------------------------------------- the data file
function splitCsv(row) {
  const f = [];
  let cur = '', q = false;
  for (let k = 0; k < row.length; k++) {
    const ch = row[k];
    if (ch === '"') q = !q; else if (ch === ',' && !q) { f.push(cur); cur = ''; } else cur += ch;
  }
  f.push(cur);
  return f;
}

// OurAirports navaids.csv -> plain records. Columns are found by name, so a
// reordered file still parses; rows with a frequency no receiver could tune are dropped.
export function parseNavaids(text) {
  const lines = text.split('\n');
  const head = splitCsv(lines[0].trim());
  const col = {};
  for (const name of ['ident', 'name', 'type', 'frequency_khz', 'latitude_deg', 'longitude_deg', 'elevation_ft',
    'dme_frequency_khz', 'slaved_variation_deg', 'magnetic_variation_deg', 'usageType', 'power', 'associated_airport']) {
    col[name] = head.indexOf(name);
  }
  if (col.ident < 0 || col.type < 0 || col.frequency_khz < 0 || col.latitude_deg < 0 || col.longitude_deg < 0) return [];
  const num = (s) => (s === undefined || s === '' || !Number.isFinite(Number(s)) ? null : Number(s));
  const vhf = (k) => k !== null && k >= 108000 && k <= 117950;
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].trim();
    if (!row) continue;
    const f = splitCsv(row);
    const type = f[col.type], lat = num(f[col.latitude_deg]), lon = num(f[col.longitude_deg]);
    if (lat === null || lon === null) continue;
    const khz = num(f[col.frequency_khz]), dmeKhz = num(f[col.dme_frequency_khz]);
    const elevFt = num(f[col.elevation_ft]);
    const base = {
      ident: f[col.ident], name: f[col.name] || f[col.ident], lat, lon, elev: elevFt === null ? null : elevFt * FT,
      magVar: num(f[col.magnetic_variation_deg]), slaved: num(f[col.slaved_variation_deg]),
      usage: f[col.usageType] || '', power: f[col.power] || '', airport: f[col.associated_airport] || '',
    };
    if (type === 'VOR' || type === 'VOR-DME' || type === 'VORTAC') {
      if (vhf(khz)) out.push({ ...base, type, khz });
    } else if (type === 'DME' || type === 'TACAN') {
      // a TACAN gives a civil receiver distance only, and only if its channel pairs with a VHF frequency
      const k = vhf(dmeKhz) ? dmeKhz : khz;
      if (vhf(k)) out.push({ ...base, type, khz: k });
    } else if (type === 'NDB' || type === 'NDB-DME') {
      if (khz !== null && khz >= 150 && khz < 1800) out.push({ ...base, type, khz });
      if (type === 'NDB-DME' && vhf(dmeKhz)) out.push({ ...base, type: 'DME', khz: dmeKhz });
    }
  }
  return out;
}

let loading = null;
// Fetched once and cached by the browser. Resolves to [] if the file cannot be reached.
export function loadNavaids(url = NAVAIDS_URL) {
  if (!loading) {
    loading = fetch(url).then((r) => { if (!r.ok) throw new Error('navaids'); return r.text(); })
      .then(parseNavaids)
      .catch(() => []);
  }
  return loading;
}

// How far a station carries, by the class the data gives it. These are the
// published service volumes, rounded; real reception is usually better.
function vorRange(r) {
  if (r.usage === 'TERMINAL') return 25 * NM;
  return ({ HIGH: 130, MEDIUM: 60, LOW: 40 }[r.power] || 40) * NM;
}
function ndbRange(r) {
  if (r.usage === 'TERMINAL' && r.power === 'LOW') return 15 * NM;       // a compass locator
  return ({ HIGH: 75, MEDIUM: 50, LOW: 25 }[r.power] || 25) * NM;
}

// The 40 localizer channels: 108.10, 108.15, 108.30, 108.35 ... 111.90, 111.95.
export const ilsChannel = (k) => 108100 + 200 * (k >> 1) + 50 * (k & 1);
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const freqText = (khz) => (khz >= 100000 ? (khz / 1000).toFixed(2) : String(Math.round(khz)));

// ---------------------------------------------------------------- the receivers
export class Nav {
  constructor() {
    this.raw = [];                 // every station in the file, as parsed
    this.geo = null; this.airport = null; this.runways = [];
    this.stations = [];            // real stations near the airport, in the local frame
    this.ils = [];                 // one per runway end, the preferred end first
    this.navByKhz = new Map(); this.adfByKhz = new Map();
    this.magnetic = true;          // false: radials, OBS and courses read in degrees true
    this.localVar = 0;             // variation at the airport
    this.nav1 = { khz: 0, obs: 0 };
    this.adf = { khz: 0, auto: true };
    this.gps = { target: null, from: null };
    this.source = 'nav1';          // what the course indicator and the autopilot follow: 'nav1' or 'gps'
    this.epoch = 0;                // bumps whenever the signal being followed changes under the autopilot
    this.pos = { e: 0, n: 0, alt: 0 };
    this.dt = 0;
    this._t = null; this._s1 = null; this._sA = null;
    this._dme = { d: null, rate: 0 };
    this._var = { e: NaN, n: NaN, v: 0 };
    this.out = {
      source: 'NAV1', variation: 0,
      nav1: {
        khz: 0, mhz: '---.--', obs: 0, ident: '', name: '', type: '', rwy: '',
        valid: false, isLoc: false, back: false, toFrom: 0,
        bearing: 0, radial: 0, dev: 0, dots: 0, course: 0, y: 0, dist: 0,
        gsValid: false, gsDev: 0, gsDots: 0, gsErr: 0,
        dme: false, dmeNm: 0, dmeKt: 0, dmeMin: null,
      },
      adf: { khz: 0, ident: '', name: '', valid: false, rel: 90, bearing: 0 },
      gps: { valid: false, ident: '', e: 0, n: 0, bearing: 0, bearingTrue: 0, dtk: 0, dtkTrue: 0, distNm: 0, xtkNm: 0, y: 0, along: 0, eteMin: null },
      // what the course indicator shows, whichever source it follows
      cdi: { valid: false, isLoc: false, back: false, obs: 0, dots: 0, toFrom: 0, gsValid: false, gsDots: 0, gsErr: 0, y: 0, course: 0 },
      ap: { mode: 'off', lat: '', vert: '' },
    };
  }

  // ---- loading
  // The parsed navaid file. Either order works: before or after setAirport.
  setData(raw) {
    this.raw = raw || [];
    if (!this.geo) return;
    const was = this.ils.find((s) => s.khz === this.nav1.khz);
    this._build();
    // a real station on the same channel can move a sim ILS to another one: follow it
    const again = was && this.ils.find((s) => s.rwy === was.rwy);
    if (again) { this.nav1.khz = again.khz; this.setObs(this._ilsCourse(again)); }
    if (this.adf.auto) this._autoAdf();
    this.epoch++;
  }
  // airport: { id, elev }, runways: from layoutRunways, geo: the local frame.
  // prefer: the runway end to list and tune first (the departure end).
  setAirport(airport, runways, geo, prefer = null) {
    this.airport = airport; this.runways = runways || []; this.geo = geo; this.prefer = prefer;
    this.pos.e = 0; this.pos.n = 0; this.pos.alt = airport.elev || 0;
    this.gps.target = null; this.gps.from = null; this.source = 'nav1';
    this._build();
    if (this.ils.length) this._tune(this.ils[0]); else { this.nav1.khz = 0; }
    this.adf.auto = true; this._autoAdf();
    this.epoch++;
  }
  // Move one runway end to the front of the list (and tune it) without rebuilding.
  setPreferred(id) {
    this.prefer = id;
    const i = this.ils.findIndex((s) => s.rwy === id);
    if (i < 0) return;
    this.ils.unshift(this.ils.splice(i, 1)[0]);
    this._tune(this.ils[0]);
  }

  _build() {
    const geo = this.geo, elev0 = this.airport ? this.airport.elev || 0 : 0;
    const st = [];
    for (const r of this.raw) {
      if (Math.abs(r.lat - geo.lat0) > 6) continue;
      let lon = r.lon;
      if (lon - geo.lon0 > 180) lon -= 360; else if (lon - geo.lon0 < -180) lon += 360;
      const p = geo.toLocal(r.lat, lon);
      if (p.e * p.e + p.n * p.n > LOAD_RADIUS * LOAD_RADIUS) continue;
      const ndb = r.type === 'NDB' || r.type === 'NDB-DME';
      const bearing = r.type === 'VOR' || r.type === 'VOR-DME' || r.type === 'VORTAC';
      st.push({
        ident: r.ident, name: r.name, type: r.type, khz: r.khz, kind: ndb ? 'ndb' : bearing ? 'vor' : 'dme',
        e: p.e, n: p.n, elev: r.elev !== null ? r.elev : elev0, mast: 10,
        dme: !ndb && r.type !== 'VOR', range: ndb ? ndbRange(r) : vorRange(r),
        magVar: r.magVar,
        // a VOR's north is where it was aligned, which drifts from today's variation
        decl: r.slaved !== null ? r.slaved : r.magVar !== null ? r.magVar : 0,
      });
    }
    this.stations = st;
    this._var.e = NaN;
    this.localVar = this.variation(0, 0);
    this._buildIls();
    this.navByKhz = new Map(); this.adfByKhz = new Map();
    for (const s of [...this.ils, ...st]) {
      const m = s.kind === 'ndb' ? this.adfByKhz : this.navByKhz;
      if (!m.has(s.khz)) m.set(s.khz, []);
      m.get(s.khz).push(s);
    }
    this._s1 = null; this._sA = null;
  }

  // A localizer, glideslope and DME for both ends of every runway.
  _buildIls() {
    const id = this.airport ? this.airport.id || '' : '';
    const taken = new Set();
    for (const s of this.stations) if (s.kind !== 'ndb' && Math.hypot(s.e, s.n) < 350e3) taken.add(s.khz);
    const list = [];
    for (const r of this.runways) {
      const L = Math.hypot(r.e1 - r.e0, r.n1 - r.n0);
      if (!(L > 1)) continue;
      for (const end of [0, 1]) {
        const sign = end === 0 ? 1 : -1;
        const ux = sign * (r.e1 - r.e0) / L, uy = sign * (r.n1 - r.n0) / L;     // the landing direction
        const thr = end === 0 ? { e: r.e0, n: r.n0, elev: r.elev0 } : { e: r.e1, n: r.n1, elev: r.elev1 };
        const far = end === 0 ? { e: r.e1, n: r.n1, elev: r.elev1 } : { e: r.e0, n: r.n0, elev: r.elev0 };
        const rwy = String((end === 0 ? r.le && r.le.id : r.he && r.he.id) || (end === 0 ? 'A' : 'B'));
        const aim = Math.min(GS_AIM, L / 3);
        let k = hash(`${id}/${rwy}`) % 40;
        for (let tries = 0; tries < 40 && taken.has(ilsChannel(k)); tries++) k = (k + 1) % 40;
        const khz = ilsChannel(k);
        taken.add(khz);
        list.push({
          ident: `I${rwy}`, name: `${id} ILS ${rwy}`.trim(), type: 'ILS', kind: 'ils', khz, rwy, sim: true,
          e: far.e + ux * LOC_BEYOND, n: far.n + uy * LOC_BEYOND, elev: far.elev, mast: 3,
          course: (Math.atan2(ux, uy) + TAU) % TAU, ux, uy, thr, length: L,
          gs: { e: thr.e + ux * aim, n: thr.n + uy * aim, elev: thr.elev + (far.elev - thr.elev) * aim / L },
          dme: true, range: 25 * NM, magVar: null, decl: 0,
        });
      }
    }
    const i = list.findIndex((s) => s.rwy === this.prefer);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
    this.ils = list;
  }

  // ---- magnetic variation
  // Degrees, east positive, taken from the nearest station that carries one.
  // The file has no other source of variation, and a station's figure is as old
  // as its last survey. Returns 0 when no station data is loaded.
  variation(e = this.pos.e, n = this.pos.n) {
    const c = this._var;
    if (Math.hypot(e - c.e, n - c.n) < 5000) return c.v;
    let best = null, bd = Infinity;
    for (const s of this.stations) {
      if (s.magVar === null) continue;
      const d = (s.e - e) * (s.e - e) + (s.n - n) * (s.n - n);
      if (d < bd) { bd = d; best = s.magVar; }
    }
    if (best === null && this.geo && this.raw.length) best = variationAt(this.raw, this.geo.lat(n), this.geo.lon(e));
    c.e = e; c.n = n; c.v = best === null ? 0 : best;
    return c.v;
  }
  _decl(s) { return !this.magnetic ? 0 : s.kind === 'ils' ? this.localVar : s.decl; }
  _ilsCourse(s) { return Math.round(wrap360(s.course * R2D - this._decl(s))) % 360; }

  // ---- reception
  // Horizontal distance to a station if it can be heard from here, else null.
  // VHF needs line of sight: both aerials stand on a smooth Earth at the height of
  // the lower one. Terrain in between is not looked at. An NDB follows the ground.
  _rx(s) {
    const p = this.pos, d = Math.hypot(p.e - s.e, p.n - s.n);
    if (d > s.range) return null;
    if (s.kind !== 'ndb') {
      const datum = Math.min(s.elev, p.alt);
      if (d > horizon(s.elev + s.mast - datum, p.alt - datum)) return null;
    }
    return d;
  }
  // Of the stations on a frequency, the nearest one in reach.
  _pick(list) {
    if (!list) return null;
    let best = null, bd = Infinity;
    for (const s of list) { const d = this._rx(s); if (d !== null && d < bd) { bd = d; best = s; } }
    return best;
  }

  // ---- every frame
  // fm: the flight model. Reads fm.pos = [north, east, down], fm.out and fm.time.
  update(fm) {
    const p = this.pos;
    const n = fm.pos[0], e = fm.pos[1];
    // simulated time since the last call, from the flight model's own clock: zero while paused
    let dt = this._t === null ? 0 : fm.time - this._t;
    this._t = fm.time;
    if (!(dt > 0)) dt = 0;
    // a restart or a reposition is not motion: drop the rates rather than differentiate the jump
    if (dt > 1 || Math.hypot(e - p.e, n - p.n) > 150 * dt + 20) { dt = 0; this._dme.d = null; this.epoch++; }
    this.dt = dt;
    p.n = n; p.e = e; p.alt = -fm.pos[2];
    this.out.variation = this.variation(p.e, p.n);
    this._nav1(dt);
    this._adf(fm.out.heading * R2D);
    this._gps(fm.out.gs);
    this._cdi();
    return this.out;
  }

  _nav1(dt) {
    const o = this.out.nav1, p = this.pos, obs = this.nav1.obs;
    const s = this._pick(this.navByKhz.get(this.nav1.khz));
    if (s !== this._s1) { this._s1 = s; this._dme.d = null; this.epoch++; }
    o.khz = this.nav1.khz; o.mhz = this.nav1.khz ? freqText(this.nav1.khz) : '---.--'; o.obs = obs;
    o.ident = s ? s.ident : ''; o.name = s ? s.name : ''; o.type = s ? s.type : ''; o.rwy = s && s.rwy ? s.rwy : '';
    o.valid = false; o.isLoc = false; o.back = false; o.toFrom = 0; o.dev = 0; o.dots = 0; o.y = 0; o.dist = 0;
    o.gsValid = false; o.gsDev = 0; o.gsDots = 0; o.gsErr = 0;
    o.dme = false; o.dmeNm = 0; o.dmeKt = 0; o.dmeMin = null;
    o.course = (obs + (s ? this._decl(s) : this.magnetic ? this.out.variation : 0)) * D2R;
    if (!s) return;
    const re = p.e - s.e, rn = p.n - s.n, dist = Math.hypot(re, rn);
    const decl = this._decl(s);
    o.dist = dist;
    let dmeAt = s;
    if (s.kind === 'vor') {
      const from = Math.atan2(re, rn) * R2D;                 // true bearing from the station to the aircraft
      o.radial = wrap360(from - decl); o.bearing = wrap360(o.radial + 180);
      // straight overhead the signal is useless: the cone of confusion
      o.valid = Math.atan2(p.alt - s.elev, dist) * R2D < CONE;
      const d = wrap180(o.radial - obs);                     // clockwise from the selected radial
      o.dev = Math.abs(d) <= 90 ? d : Math.sign(d) * (180 - Math.abs(d));     // + = right of the selected course
      o.toFrom = Math.abs(d) < 85 ? -1 : Math.abs(d) > 95 ? 1 : 0;
      o.dots = clamp(-o.dev / (VOR_FULL / DOTS), -DOTS, DOTS);
      o.y = dist * Math.sin(d * D2R);
    } else if (s.kind === 'ils') {
      o.isLoc = true;
      o.course = s.course;                                    // a localizer does not care where the OBS is set
      const along = re * s.ux + rn * s.uy;                    // negative on the approach side of the aerial
      const y = re * s.uy - rn * s.ux;                        // metres right of the centreline, looking down the approach
      const off = Math.atan2(Math.abs(y), Math.abs(along)) * R2D;
      o.back = along > 0;
      o.bearing = wrap360(Math.atan2(-re, -rn) * R2D - decl); o.radial = wrap360(o.bearing + 180);
      // coverage: 10 degrees either side out to 25 NM, 35 degrees out to 17 NM, the same behind the aerial
      o.valid = off <= 10 || (off <= 35 && dist <= 17 * NM);
      // the needle knows which side of the beam it is on, not which way the aircraft points:
      // inbound on the back course it reads reversed
      o.dev = Math.sign(y) * off;
      o.dots = clamp(-o.dev / (LOC_FULL / DOTS), -DOTS, DOTS);
      o.toFrom = 1;
      o.y = y;
      // glideslope: 8 degrees either side of the centreline, 10 NM, from 0.45 to 1.75 times the path angle
      const g = s.gs, ge = p.e - g.e, gn = p.n - g.n, gd = Math.hypot(ge, gn);
      const galong = -(ge * s.ux + gn * s.uy), gy = ge * s.uy - gn * s.ux;
      const ang = Math.atan2(p.alt - g.elev, gd) * R2D;
      o.gsDev = ang - GS_ANGLE;
      o.gsErr = g.elev + gd * TAN_GS - p.alt;                 // metres the glidepath is above the aircraft
      o.gsValid = galong > 0 && Math.atan2(Math.abs(gy), galong) * R2D <= 8 && gd <= 10 * NM
        && ang >= 0.45 * GS_ANGLE && ang <= 1.75 * GS_ANGLE;
      o.gsDots = clamp(-o.gsDev / (GS_FULL / DOTS), -DOTS, DOTS);
      dmeAt = g;                                              // the DME reads from the touchdown zone
    }
    if (s.dme) {
      // slant range, and the speed and time a DME works out from how fast that range closes
      const slant = Math.hypot(p.e - dmeAt.e, p.n - dmeAt.n, p.alt - dmeAt.elev);
      const k = this._dme;
      if (k.d === null) k.rate = NaN;
      else if (dt > 0) { const r = (slant - k.d) / dt; k.rate = Number.isNaN(k.rate) ? r : k.rate + (r - k.rate) * Math.min(1, dt / 1.5); }
      k.d = slant;
      const rate = Number.isNaN(k.rate) ? 0 : k.rate;
      o.dme = true; o.dmeNm = slant / NM; o.dmeKt = Math.abs(rate) / KT;
      o.dmeMin = rate < -2.5 ? slant / -rate / 60 : null;
    }
  }

  _adf(hdgDeg) {
    const o = this.out.adf, p = this.pos;
    const s = this._pick(this.adfByKhz.get(this.adf.khz));
    this._sA = s;
    o.khz = this.adf.khz; o.ident = s ? s.ident : ''; o.name = s ? s.name : ''; o.valid = !!s;
    if (!s) { o.rel = 90; return; }                           // no signal: the needle parks
    const to = Math.atan2(s.e - p.e, s.n - p.n) * R2D;
    o.rel = wrap360(to - hdgDeg);
    o.bearing = wrap360(to - (this.magnetic ? s.magVar !== null ? s.magVar : this.out.variation : 0));
  }

  _gps(gs) {
    const o = this.out.gps, p = this.pos, t = this.gps.target;
    o.valid = !!t;
    if (!t) { o.ident = ''; o.eteMin = null; return; }
    const f = this.gps.from || (this.gps.from = { e: p.e, n: p.n });
    const de = t.e - p.e, dn = t.n - p.n, dist = Math.hypot(de, dn);
    const leg = Math.hypot(t.e - f.e, t.n - f.n) > 50 ? Math.atan2(t.e - f.e, t.n - f.n) : Math.atan2(de, dn);
    const v = this.magnetic ? this.out.variation : 0;
    o.ident = t.ident; o.e = t.e; o.n = t.n;
    o.bearingTrue = wrap360(Math.atan2(de, dn) * R2D); o.bearing = wrap360(o.bearingTrue - v);
    o.dtkTrue = (leg + TAU) % TAU; o.dtk = wrap360(leg * R2D - v);
    o.distNm = dist / NM;
    o.y = -de * Math.cos(leg) + dn * Math.sin(leg);            // metres right of the leg
    o.xtkNm = o.y / NM;
    o.along = de * Math.sin(leg) + dn * Math.cos(leg);         // metres still to run
    o.eteMin = gs > 5 ? dist / gs / 60 : null;
  }

  _cdi() {
    const c = this.out.cdi, n = this.out.nav1, g = this.out.gps;
    if (this.source === 'gps') {
      this.out.source = 'GPS';
      c.valid = g.valid; c.isLoc = false; c.back = false; c.gsValid = false; c.gsDots = 0; c.gsErr = 0;
      c.obs = g.valid ? g.dtk : 0; c.course = g.valid ? g.dtkTrue : 0; c.y = g.valid ? g.y : 0;
      c.dots = g.valid ? clamp(-g.y / (GPS_FULL / DOTS), -DOTS, DOTS) : 0;
      c.toFrom = g.valid ? (g.along >= 0 ? 1 : -1) : 0;
    } else {
      this.out.source = 'NAV1';
      c.valid = n.valid; c.isLoc = n.isLoc; c.back = n.back; c.obs = n.obs; c.dots = n.dots; c.toFrom = n.toFrom;
      c.gsValid = n.gsValid; c.gsDots = n.gsDots; c.gsErr = n.gsErr; c.y = n.y; c.course = n.course;
    }
  }

  // ---- tuning, all of it usable from the keyboard. Each returns a line for a toast.
  _label(s) { return `${freqText(s.khz)} ${s.ident} · ${s.kind === 'ils' ? `ILS runway ${s.rwy}` : `${s.name} ${s.type}`}`; }
  _tune(s) {
    this.nav1.khz = s.khz;
    if (s.kind === 'ils') this.setObs(this._ilsCourse(s));     // a reminder of the inbound course, as a pilot would set it
    this.epoch++;
    return this._label(s);
  }
  tuneNav(khz) { this.nav1.khz = Math.round(khz); this.epoch++; return freqText(this.nav1.khz); }
  tuneAdf(khz) { this.adf.khz = Math.round(khz); this.adf.auto = false; return freqText(this.adf.khz); }
  _near(kind, max) {
    const p = this.pos, seen = new Set(), list = [];
    for (const s of this.stations) {
      if (s.kind !== kind) continue;
      const d = Math.hypot(s.e - p.e, s.n - p.n);
      if (d <= s.range) list.push({ s, d });
    }
    list.sort((a, b) => a.d - b.d);
    // one station per frequency: the receiver could not tell two apart anyway
    return list.filter(({ s }) => (seen.has(s.khz) ? false : seen.add(s.khz))).slice(0, max).map((x) => x.s);
  }
  // What NAV1 can step through: the airport's ILS first, then VORs inside their
  // service range, nearest first. Line of sight is not asked for, so a station
  // can be tuned on the ground before it can be heard.
  navChoices() { return [...this.ils, ...this._near('vor', 12)]; }
  adfChoices() { return this._near('ndb', 12); }
  _step(list, khz, dir) {
    if (!list.length) return null;
    const i = list.findIndex((s) => s.khz === khz);
    return list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + (dir > 0 ? 1 : -1) + list.length) % list.length];
  }
  stepNav(dir = 1) {
    const s = this._step(this.navChoices(), this.nav1.khz, dir);
    return s ? this._tune(s) : 'No station in range';
  }
  stepAdf(dir = 1) {
    const s = this._step(this.adfChoices(), this.adf.khz, dir);
    if (!s) return 'No NDB in range';
    this.adf.khz = s.khz; this.adf.auto = false;
    return `${freqText(s.khz)} ${s.ident} · ${s.name} NDB`;
  }
  _autoAdf() { const s = this.adfChoices()[0]; this.adf.khz = s ? s.khz : 0; }
  // The OBS reads in whole degrees. turnObs takes any fraction, so a held key can
  // turn the knob smoothly (degrees per second times the frame time).
  setObs(deg) {
    this._knob = wrap360(deg);
    const whole = Math.round(this._knob) % 360;
    if (whole !== this.nav1.obs) { this.nav1.obs = whole; this.epoch++; }
    return whole;
  }
  turnObs(delta) { return this.setObs((this._knob === undefined ? this.nav1.obs : this._knob) + delta); }
  // Turn the OBS until the needle centres with a TO flag: the course straight to the station.
  centreObs() {
    const s = this._s1;
    if (!s) return null;
    if (s.kind === 'ils') return this.setObs(this._ilsCourse(s));
    if (s.kind !== 'vor') return null;
    return this.setObs(Math.round(wrap360(Math.atan2(s.e - this.pos.e, s.n - this.pos.n) * R2D - this._decl(s))) % 360);
  }

  // ---- GPS
  // target: { ident, e, n } in the local frame, or null to cancel. The leg runs from where the aircraft is at the time.
  directTo(target) {
    this.gps.target = target ? { ident: target.ident, e: target.e, n: target.n } : null;
    this.gps.from = null;                        // taken from the aircraft's position at the next update
    if (!target && this.source === 'gps') this.source = 'nav1';
    this.epoch++;
    return target ? `Direct ${target.ident}` : 'Direct-to off';
  }
  // One key: direct to the NAV1 station, then the ADF station, then the airport, then off.
  // The GPS knows where a station is whether or not its signal reaches the aircraft.
  stepDirect() {
    const p = this.pos, near = (list) => (list || []).slice().sort((a, b) => Math.hypot(a.e - p.e, a.n - p.n) - Math.hypot(b.e - p.e, b.n - p.n))[0];
    const n1 = near(this.navByKhz.get(this.nav1.khz)), ad = near(this.adfByKhz.get(this.adf.khz));
    const opts = [];
    if (n1) opts.push(n1.kind === 'ils' ? { ident: `RW${n1.rwy}`, e: n1.thr.e, n: n1.thr.n } : n1);
    if (ad) opts.push(ad);
    opts.push({ ident: this.airport ? this.airport.id : 'HOME', e: 0, n: 0 });
    const cur = this.gps.target;
    const i = cur ? opts.findIndex((t) => t.ident === cur.ident && t.e === cur.e && t.n === cur.n) : -1;
    return this.directTo(i + 1 < opts.length ? opts[i + 1] : null);
  }
  // Switch the course indicator, and with it the autopilot's NAV mode, between NAV1 and the GPS leg.
  toggleSource() {
    this.source = this.source === 'nav1' && this.gps.target ? 'gps' : 'nav1';
    this.epoch++;
    return this.source === 'gps' ? `CDI: GPS ${this.gps.target.ident}` : 'CDI: NAV1';
  }
}

// Variation of the station nearest a latitude/longitude, searching the whole file.
export function variationAt(raw, lat, lon) {
  let best = null, bd = Infinity;
  const c = Math.cos(lat * D2R);
  for (const r of raw) {
    if (r.magVar === null) continue;
    const dLon = wrap180(r.lon - lon) * c, dLat = r.lat - lat;
    const d = dLon * dLon + dLat * dLat;
    if (d < bd) { bd = d; best = r.magVar; }
  }
  return best;
}

// ---------------------------------------------------------------- autopilot coupling
// Sits on top of the Autopilot in fdm.js and only ever writes the four things
// that class is steered by: heading, mode, alt and vs.
//
//   NAV  intercepts the selected course at up to 45 degrees and tracks it.
//   APR  does the same and, on an ILS, captures the glideslope as the aircraft
//        flies up to it from below, then holds the path with vertical speed.
//
// Nothing here reads the wind or the ground track. The crab angle comes from
// the needle: how fast the deviation moves, less what heading and airspeed
// account for, is the wind across the course. The descent rate on the
// glidepath is found the same way from the glideslope needle.
//
// One liberty: deviations are angles, and this converts them to metres with the
// distance to the station, as an autopilot fed by DME or GPS can. One driven by
// the needle alone has to guess its gain and gets twitchy close in.
const INTERCEPT = 45 * D2R;
const LOOKAHEAD = 12;        // seconds: the time constant of the last part of the intercept
const TAU_GS = 8;            // seconds to close a height error on the glidepath
const VS_LEAD = 1.5;         // over-drive on the vertical speed command, to tighten the autopilot's slow VS loop

export class Coupler {
  constructor(nav, ap) {
    this.nav = nav; this.ap = ap;
    this.mode = 'off';                 // 'off' | 'nav' | 'apr'
    this.gs = 'off';                   // 'off' | 'armed' | 'captured'
    this.wind = { e: 0, n: 0 };        // what the needle says the air is doing, m/s
    this.pathRate = 0;                 // how fast the glidepath is coming down past the aircraft, m/s
    this._y = null; this._h = null; this._gsT = 0; this._epoch = -1; this._lost = 0; this._on = false;
  }
  // 'nav' or 'apr'. Pressing the active mode again drops back to heading hold.
  // Engages the autopilot if it is off and the aircraft is flying. Returns a line for a toast.
  toggle(mode) {
    const ap = this.ap;
    if (this.mode === mode) { this.release(); return 'Heading hold'; }
    if (!ap.on) {
      if (ap.fm.out.onGround) return 'Autopilot is for the air';
      ap.engage('alt');
    }
    if (this.gs === 'captured') this._level();
    if (this.mode === 'off') { this._y = null; this._h = null; this._gsT = 0; }
    this.mode = mode;
    this.gs = mode === 'apr' ? 'armed' : 'off';
    this._on = false;
    return mode === 'apr' ? 'Approach mode' : 'NAV mode';
  }
  release() {
    if (this.gs === 'captured') this._level();
    this.mode = 'off'; this.gs = 'off';
  }
  _level() { const ap = this.ap; ap.mode = 'alt'; ap.alt = ap.fm.out.alt; ap.vs = 0; }

  // Once a frame, after nav.update and before the autopilot runs.
  update() {
    const nav = this.nav, ap = this.ap, o = ap.fm.out, c = nav.out.cdi, a = nav.out.ap, dt = nav.dt;
    if (!ap.on && this.mode !== 'off') { this.mode = 'off'; this.gs = 'off'; }      // the pilot took it back
    a.mode = this.mode;
    if (this.mode === 'off') { a.lat = ap.on ? 'HDG' : ''; a.vert = ''; return; }
    if (nav.epoch !== this._epoch) { this._epoch = nav.epoch; this._y = null; this._h = null; this._gsT = 0; }
    const V = Math.max(o.tas, 25);

    // ---- lateral
    const sc = Math.sin(c.course), cc = Math.cos(c.course);            // (cc, -sc) points right of the course, in (east, north)
    if (c.valid) {
      if (this._y !== null && dt > 0) {
        const drift = (c.y - this._y) / dt - V * Math.sin(o.heading - c.course) - (this.wind.e * cc - this.wind.n * sc);
        const k = Math.min(1, dt / 5) * drift;
        this.wind.e += k * cc; this.wind.n -= k * sc;
      }
      this._y = c.y;
    } else this._y = null;
    const cross = this.wind.e * cc - this.wind.n * sc;                 // wind pushing the aircraft right of the course
    if (c.valid) {
      const look = clamp(V * LOOKAHEAD, 350, 1500);
      const cut = clamp(Math.atan(c.y / look), -INTERCEPT, INTERCEPT);
      ap.heading = (c.course + Math.asin(clamp(-Math.sin(cut) - cross / V, -0.94, 0.94)) + 2 * TAU) % TAU;
      this._on = Math.abs(cut) < 10 * D2R;
    } else if (this._on) {
      // flag in view while established (station passage, a dropout): hold the course with the crab it had
      ap.heading = (c.course + Math.asin(clamp(-cross / V, -0.94, 0.94)) + 2 * TAU) % TAU;
    }
    a.lat = (nav.source === 'gps' ? 'GPS' : c.isLoc ? (c.back ? 'BC' : 'LOC') : 'VOR') + (c.valid ? '' : ' ?');

    // ---- vertical
    if (this.gs !== 'off') {
      if (c.gsValid) {
        if (this._h !== null && dt > 0) {
          // the path's own rate: how the height error moved, with the aircraft's climb taken back out
          const r = (c.gsErr - this._h) / dt + o.vs;
          this.pathRate = this._gsT > 0 ? this.pathRate + (r - this.pathRate) * Math.min(1, dt / 3) : r;
          this._gsT += dt;
        }
        this._h = c.gsErr; this._lost = 0;
      } else { this._h = null; this._gsT = 0; this._lost += dt; }
      if (this.gs === 'armed' && c.gsValid && this._gsT > 0 && c.valid && c.isLoc && !c.back && Math.abs(c.dots) < 4
        && c.gsErr > -60 && c.gsErr < Math.max(3, -this.pathRate * 5)) this.gs = 'captured';
      if (this.gs === 'captured') {
        if (c.gsValid) {
          const want = clamp(this.pathRate + c.gsErr / TAU_GS, -6, 3);
          ap.mode = 'vs';
          ap.vs = clamp(want + VS_LEAD * (want - o.vs), -8, 4);
        } else if (this._lost > 2) { this._level(); this.gs = 'lost'; }   // no glideslope: level off and say so
      }
    }
    a.vert = this.gs === 'armed' ? 'GS ARM' : this.gs === 'captured' ? 'GS' : this.gs === 'lost' ? 'GS LOST' : '';
  }
}
