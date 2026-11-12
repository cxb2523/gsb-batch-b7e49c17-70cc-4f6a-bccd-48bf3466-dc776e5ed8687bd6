// Checks the radio navigation geometry against cases worked out by hand, then
// flies the real flight model down a coupled ILS and along a VOR radial.
//   node test/nav.mjs
import { FlightModel, Autopilot, KT, FT, D2R, stillAir } from '../js/fdm.js';
import { Geo } from '../js/geo.js';
import { Nav, Coupler, parseNavaids, variationAt, ilsChannel } from '../js/nav.js';

const DT = 1 / 240, NM = 1852;
const rows = [];
const row = (name, got, want, unit = '', tol = 0) => {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
  rows.push({ name, got, want, unit, ok });
};
const yes = (name, cond) => row(name, cond ? 1 : 0, 1);
const section = (title) => rows.push({ title });

// ---- a small world: one runway pointing north from the origin, at sea level,
// and four stations written out in the real column layout of navaids.csv
const geo = new Geo(46, 7);
const airport = { id: 'TEST', elev: 0 };
const runways = [{ le: { id: '36' }, he: { id: '18' }, e0: 0, n0: 0, e1: 0, n1: 2000, elev0: 0, elev1: 0, heading: 0, length: 2000, width: 30 }];
const HEAD = '"id","filename","ident","name","type","frequency_khz","latitude_deg","longitude_deg","elevation_ft","iso_country","dme_frequency_khz","dme_channel","dme_latitude_deg","dme_longitude_deg","dme_elevation_ft","slaved_variation_deg","magnetic_variation_deg","usageType","power","associated_airport"';
const line = (ident, name, type, khz, e, n, elevFt, dme, slaved, mag, usage, power) =>
  `1,"${name}_${type}","${ident}","${name}","${type}",${khz},${geo.lat(n)},${geo.lon(e)},${elevFt},"XX",${dme},"",,,,${slaved},${mag},"${usage}","${power}",`;
const VOR = { e: 20000, n: 30000 }, NDB = { e: -10000, n: 10000 };
const csv = (extra = []) => [HEAD,
  line('TST', 'Test, Upper', 'VOR-DME', 113000, VOR.e, VOR.n, 0, 113000, 2.0, 2.5, 'BOTH', 'HIGH'),
  line('NB', 'Beacon', 'NDB', 375, NDB.e, NDB.n, '', '', '', 1.0, 'BOTH', 'MEDIUM'),
  line('FAR', 'Faraway', 'VOR', 114500, 150000, -90000, 0, '', '', 4.0, 'BOTH', 'LOW'),
  line('MIL', 'Military', 'TACAN', 134000, 5000, 5000, 0, 134000, '', 1.0, 'BOTH', 'HIGH'),
  line('BAD', 'Broken', 'VOR', -1, 6000, 6000, 0, '', '', 1.0, 'BOTH', 'HIGH'),
  ...extra, ''].join('\n');

let clock = 0;
// a stand-in for the flight model: somewhere, pointing somewhere, a second later
const at = (nav, e, n, alt, hdg = 0, dt = 1) => { clock += dt; return nav.update({ pos: [n, e, -alt], out: { heading: hdg * D2R, gs: 0 }, time: clock }); };

// ---------------------------------------------------------------- the data file
section('Data file');
const raw = parseNavaids(csv());
row('Stations parsed, unusable frequencies dropped', raw.length, 3);
yes('A comma inside a quoted name survives', raw[0].name === 'Test, Upper');
row('VOR elevation, feet to metres', parseNavaids(csv([line('HI', 'High', 'VOR', 115000, 0, 0, 1000, '', '', 0, 'BOTH', 'LOW')])).at(-1).elev, 304.8, 'm', 0.01);
row('Variation of the nearest station to a point', variationAt(raw, geo.lat(NDB.n + 500), geo.lon(NDB.e)), 1.0, 'deg E', 1e-9);

const nav = new Nav();
nav.setAirport(airport, runways, geo, '36');
const before = nav.ils.map((s) => s.khz);
nav.setData(raw);
const ils36 = nav.ils.find((s) => s.rwy === '36'), ils18 = nav.ils.find((s) => s.rwy === '18');

// ---------------------------------------------------------------- ILS assignment
section('ILS assigned by the sim');
row('One ILS per runway end', nav.ils.length, 2);
const inBand = (k) => { for (let i = 0; i < 40; i++) if (ilsChannel(i) === k) return true; return false; };
yes('Frequencies are localizer channels (108.10 to 111.95, odd tenths)', nav.ils.every((s) => inBand(s.khz) && Math.floor(s.khz / 100) % 2 === 1));
yes('The two ends differ', ils36.khz !== ils18.khz);
{
  const again = new Nav(); again.setData(raw); again.setAirport(airport, runways, geo);
  yes('Same frequencies every time, whichever loads first', before.join() === nav.ils.map((s) => s.khz).join() && before.slice().sort().join() === again.ils.map((s) => s.khz).sort().join());
}
yes('The preferred end is tuned first', nav.nav1.khz === ils36.khz && nav.ils[0] === ils36);
row('OBS set to the inbound course, magnetic', nav.nav1.obs, 359, 'deg', 0);     // 000 true, nearest station says 1 E
{
  // a real DME already on that channel pushes the sim ILS to the next one, and NAV1 follows
  const n2 = new Nav();
  n2.setAirport(airport, runways, geo, '36');
  n2.setData(parseNavaids(csv([line('DM', 'Clash', 'DME', ils36.khz, 3000, 3000, 0, ils36.khz, '', 1.0, 'BOTH', 'LOW')])));
  const moved = n2.ils.find((s) => s.rwy === '36');
  yes('Steps aside for a real station on the same channel', moved.khz !== ils36.khz && inBand(moved.khz) && n2.nav1.khz === moved.khz);
}

// ---------------------------------------------------------------- VOR
section('VOR');
nav.tuneNav(113000);
nav.setObs(88);
let o = at(nav, VOR.e + 20000, VOR.n, 1500);                 // due east of the station: 090 true, 088 by the station's own north
row('Radial, 20 km due east of the station', o.nav1.radial, 88, 'deg', 0.01);
row('Bearing to the station', o.nav1.bearing, 268, 'deg', 0.01);
row('On the selected radial: needle centred', o.nav1.dots, 0, 'dots', 0.01);
row('  and the flag reads FROM', o.nav1.toFrom, -1);
nav.setObs(268); o = at(nav, VOR.e + 20000, VOR.n, 1500);
row('Reciprocal course selected: centred, TO', o.nav1.dots + (o.nav1.toFrom === 1 ? 0 : 9), 0, 'dots', 0.01);
nav.setObs(84); o = at(nav, VOR.e + 20000, VOR.n, 1500);
row('4 degrees right of course: needle 2 dots left', o.nav1.dots, -2, 'dots', 0.01);
nav.setObs(264); o = at(nav, VOR.e + 20000, VOR.n, 1500);
row('Same radial flown TO, course 264: needle 2 dots right', o.nav1.dots, 2, 'dots', 0.01);
nav.setObs(60); o = at(nav, VOR.e + 20000, VOR.n, 1500);
row('28 degrees off: pegged at full scale', o.nav1.dots, -5, 'dots', 0);
nav.setObs(178); o = at(nav, VOR.e + 20000, VOR.n, 1500);
row('Abeam the course: neither TO nor FROM', o.nav1.toFrom, 0);
row('DME, 20 km out and 1500 m up', o.nav1.dmeNm, Math.hypot(20000, 1500) / NM, 'NM', 0.001);

// crossing the station northbound at 1000 m, course 358 (north by the station)
nav.setObs(358);
o = at(nav, VOR.e, VOR.n - 5000, 1000);
row('5 km before the station: TO', o.nav1.toFrom + (o.nav1.valid ? 0 : 9), 1);
o = at(nav, VOR.e + 100, VOR.n - 200, 1000);
yes('Overhead, in the cone of confusion: NAV flag', !o.nav1.valid);
row('  DME there reads the height', o.nav1.dmeNm, Math.hypot(100, 200, 1000) / NM, 'NM', 0.001);
o = at(nav, VOR.e, VOR.n + 5000, 1000);
row('5 km past it: FROM', o.nav1.toFrom + (o.nav1.valid ? 0 : 9), -1);

// DME speed and time: flying at 60 m/s straight at the station, 3000 m above it, 4000 m to run
for (let i = 0; i <= 80; i++) o = at(nav, VOR.e, VOR.n - 4400 + i * 6, 3000, 0, 0.1);
row('DME speed is the closing rate (flying at 117 kt, 3000 m above)', o.nav1.dmeKt, 60 * (3920 / Math.hypot(3920, 3000)) / KT, 'kt', 1.5);
row('DME time to station', o.nav1.dmeMin, Math.hypot(3920, 3000) / (60 * 3920 / Math.hypot(3920, 3000)) / 60, 'min', 0.03);

// ---------------------------------------------------------------- radio horizon
section('Reception');
o = at(nav, VOR.e - 100000, VOR.n, 300);
yes('100 km out at 300 m: below the radio horizon, nothing', !o.nav1.valid && !o.nav1.dme && o.nav1.ident === '');
o = at(nav, VOR.e - 100000, VOR.n, 1500);
yes('Same place at 1500 m: received', o.nav1.valid && o.nav1.dme && o.nav1.ident === 'TST');
o = at(nav, VOR.e - 250000, VOR.n, 9000);
yes('250 km out, in sight, past its 130 NM service range: nothing', !o.nav1.valid);
nav.tuneNav(114500);
o = at(nav, 150000 - 60000, -90000, 3000);
yes('A low-power VOR (40 NM) heard at 60 km', o.nav1.valid && o.nav1.ident === 'FAR' && !o.nav1.dme);
o = at(nav, 150000 - 80000, -90000, 3000);
yes('  and not at 80 km', !o.nav1.valid);

// ---------------------------------------------------------------- ADF
section('ADF');
yes('ADF tuned to the nearest NDB at the start', nav.adf.khz === 375);
o = at(nav, NDB.e - 5000, NDB.n - 5000, 500, 90);            // station bears 045, heading 090
row('Relative bearing, station at 045, heading 090', o.adf.rel, 315, 'deg', 0.01);
o = at(nav, NDB.e, NDB.n - 80000, 30, 0);
yes('80 km away at 30 m: still heard (no line of sight needed)', o.adf.valid);
o = at(nav, NDB.e, NDB.n - 100000, 3000, 0);
yes('Past its 50 NM range: needle parks, flag', !o.adf.valid && o.adf.rel === 90);

// ---------------------------------------------------------------- localizer and glideslope
section('ILS runway 36: aerial 300 m past the far end, glidepath from 300 m past the threshold');
const tan = (d) => Math.tan(d * D2R);
const LOC_N = 2300, GS_N = 300;                              // where the aerials are, north of the threshold
const loc = (deg, d) => ({ e: (LOC_N + d) * tan(deg), n: -d });       // deg right of the centreline as the aerial sees it, d metres before the threshold
const glide = (deg, d) => (d + GS_N) * tan(deg);             // height on a path of that angle
nav.tuneNav(ils36.khz);
o = at(nav, 0, -8000, glide(3, 8000));
row('On the centreline 8 km out: needle centred', o.nav1.dots + (o.nav1.valid && o.nav1.isLoc ? 0 : 9), 0, 'dots', 1e-6);
row('On the 3 degree path: glideslope centred', o.nav1.gsDots + (o.nav1.gsValid ? 0 : 9), 0, 'dots', 1e-6);
row('DME reads from the touchdown zone', o.nav1.dmeNm, Math.hypot(8300, glide(3, 8000)) / NM, 'NM', 0.001);
let q = loc(1, 8000); o = at(nav, q.e, q.n, glide(3, 8000));
row('1 degree right of the centreline: needle 2 dots left', o.nav1.dots, -2, 'dots', 0.01);
q = loc(-0.5, 8000); o = at(nav, q.e, q.n, glide(3, 8000));
row('Half a degree left: needle 1 dot right', o.nav1.dots, 1, 'dots', 0.01);
q = loc(4, 8000); o = at(nav, q.e, q.n, glide(3, 8000));
row('4 degrees right: pegged, still flagged valid', o.nav1.dots + (o.nav1.valid ? 0 : 9), -5, 'dots', 0);
q = loc(40, 8000); o = at(nav, q.e, q.n, 600);
yes('40 degrees off the centreline: outside the beam, NAV flag', !o.nav1.valid);
q = loc(20, 28000); o = at(nav, q.e, q.n, 1500);
yes('20 degrees off at 18 NM: outside the wide sector, NAV flag', !o.nav1.valid);
o = at(nav, 0, -8000, glide(3.35, 8000));
row('0.35 degrees above the path: needle 2.5 dots down', o.nav1.gsDots, -2.5, 'dots', 0.01);
o = at(nav, 0, -8000, glide(2.86, 8000));
row('0.14 degrees below: needle 1 dot up', o.nav1.gsDots, 1, 'dots', 0.01);
row('  which is this far under the path', o.nav1.gsErr, glide(3, 8000) - glide(2.86, 8000), 'm', 0.01);
o = at(nav, 0, -8000, glide(1.2, 8000));
yes('Far below the path (1.2 degrees): GS flag, localizer still good', !o.nav1.gsValid && o.nav1.valid);
o = at(nav, 0, -8000, glide(5.5, 8000));
yes('Far above it (5.5 degrees): GS flag', !o.nav1.gsValid);
o = at(nav, 0, -20000, glide(3, 20000));
yes('On the path 11 NM out: GS flag, localizer still good', !o.nav1.gsValid && o.nav1.valid);
o = at(nav, 0, -60000, 3500);
yes('32 NM out: nothing', !o.nav1.valid && !o.nav1.dme);
// the back course: north of the aerial, east of the centreline, flying south towards it
o = at(nav, 6000 * tan(1), LOC_N + 6000, 400, 180);
yes('Back course is received, with no glideslope', o.nav1.valid && o.nav1.back && !o.nav1.gsValid);
row('  aircraft is left of its inbound course, needle says fly left: reversed', o.nav1.dots, -2, 'dots', 0.01);
// tuning list
at(nav, 0, -8000, 600);
const list = nav.navChoices().map((s) => s.ident);
yes('Tuning order: ILS of the airport first, then VORs by distance', list.join() === 'I36,I18,TST');
nav.tuneNav(ils18.khz); nav.stepNav(1);
yes('Stepping on from the last ILS reaches the nearest VOR', nav.nav1.khz === 113000);
nav.stepNav(1);
yes('  and wraps back to the first ILS, OBS on its course', nav.nav1.khz === ils36.khz && nav.nav1.obs === 359);
nav.tuneNav(113000); at(nav, 0, 0, 1000);
nav.setObs(10); for (let i = 0; i < 30; i++) nav.turnObs(12 / 60);
row('OBS knob held for half a second at 12 degrees a second', nav.nav1.obs, 16, 'deg', 0);
row('Centre the OBS: course straight to the station', nav.centreObs(), Math.round(Math.atan2(VOR.e, VOR.n) / D2R - 2), 'deg', 0);

// ---------------------------------------------------------------- closed loop: the real aircraft on the autopilot
// The pilot's part: power for 75 KIAS, flaps 10. Everything else is the autopilot and the coupler.
// Gusts are the sim's own recipe (Air.update in js/weather.js) on a seeded generator, so the run repeats.
function gusts(seed) {
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const ou = (g, tau, sd) => g + (-g / tau) * DT + sd * Math.sqrt(2 * DT / tau) * gauss();
  return (w, V, sigma) => {
    w.gu = ou(w.gu, 260 / V, sigma); w.gv = ou(w.gv, 260 / V, sigma); w.gw = ou(w.gw, 150 / V, sigma * 0.8);
    w.gp = ou(w.gp, 0.5, sigma * 0.10); w.gq = ou(w.gq, 0.6, sigma * 0.035); w.gr = ou(w.gr, 0.8, sigma * 0.03);
  };
}
function fly({ wind = { n: 0, e: 0 }, sigma = 0, start, setup, until, seconds }) {
  const w = { n: wind.n, e: wind.e, d: 0, gu: 0, gv: 0, gw: 0, gp: 0, gq: 0, gr: 0 };
  const gust = gusts(7);
  const fm = new FlightModel({ ...stillAir, wind: () => w });
  fm.reset({ n: start.n, e: start.e, alt: start.alt, heading: start.hdg * D2R, speed: start.kt * KT, pitch: 0.03, throttle: 0.5 });
  fm.vel[0] += w.n; fm.vel[1] += w.e;                         // already moving with the air
  fm.ctl.flaps = start.flaps || 0; fm.flapPos = start.flaps || 0;
  const ap = new Autopilot(fm);
  ap.engage('alt');
  const nv = new Nav();
  nv.setAirport(airport, runways, geo, '36');
  nv.setData(raw);
  const cp = new Coupler(nv, ap);
  setup(nv, cp);
  let thrI = 0;
  const n = Math.round(seconds / DT), log = { fm, ap, nv, cp, t: 0 };
  for (let i = 0; i < n; i++) {
    if (i % 8 === 0) {                                       // the nav and the coupler run once a frame, 30 a second
      nv.update(fm); cp.update();
      const err = start.kt - fm.out.ias / KT;
      thrI = Math.max(-0.4, Math.min(0.5, thrI + 0.01 * err * 8 * DT));
      fm.ctl.throttle = Math.max(0, Math.min(1, 0.4 + 0.05 * err + thrI));
    }
    if (sigma) gust(w, Math.max(fm.out.tas, 15), sigma);
    ap.update(DT); fm.step(DT);
    log.t = i * DT;
    if (until(log) === false) break;
  }
  return log;
}

const summary = [];
const pad = (s, n) => String(s).padEnd(n);
function approach(name, wind, sigma = 0) {
  let maxLoc = 0, maxGs = 0, capAt = null, prev = null, hit = null;
  const TCH = GS_N * tan(3);
  const r = fly({
    wind, sigma, seconds: 400,
    start: { n: -8000, e: 500, alt: 300, hdg: 0, kt: 75, flaps: 1 / 3 },
    setup: (nv, cp) => { cp.toggle('apr'); },
    until: ({ fm, nv, cp }) => {
      const n = fm.pos[0], e = fm.pos[1], alt = -fm.pos[2];
      if (cp.gs === 'captured' && capAt === null) capAt = -n;
      if (n > -4000 && n < 0) { maxLoc = Math.max(maxLoc, Math.abs(nv.out.nav1.dots)); maxGs = Math.max(maxGs, Math.abs(nv.out.nav1.gsDots)); }
      if (prev && prev.n < 0 && n >= 0) {                    // crossing the threshold
        const f = -prev.n / (n - prev.n);
        hit = { e: prev.e + (e - prev.e) * f, alt: prev.alt + (alt - prev.alt) * f, hdg: fm.out.heading, ias: fm.out.ias, tas: fm.out.tas, gs: fm.out.gs, vs: fm.out.vs };
        return false;
      }
      prev = { n, e, alt };
      if (fm.crashed) return false;
    },
  });
  section(`Coupled ILS from 8 km, 500 m right of the centreline, 300 m up: ${name}`);
  yes('Reaches the threshold on the autopilot', !!hit && !r.fm.crashed);
  if (!hit) return;
  // the path reaches 300 m at 5.4 km; the coupler leads it by about five seconds
  row('Glideslope captured this far out', capAt === null ? NaN : capAt / 1000, 5.6, 'km', 0.3);
  row('Lateral error at the threshold', hit.e, 0, 'm', sigma ? 6 : 1);
  row('Height error at the threshold (path is 15.7 m up there)', hit.alt - TCH, 0, 'm', sigma ? 4 : 0.5);
  row('Largest localizer deviation, last 4 km', maxLoc, 0, 'dots', sigma ? 1.5 : 0.2);
  row('Largest glideslope deviation, last 4 km', maxGs, 0, 'dots', sigma ? 5 : 0.2);
  const crab = ((hit.hdg / D2R + 540) % 360) - 180;
  row('Crab angle at the threshold', crab, -Math.asin(wind.e / hit.tas) / D2R, 'deg', sigma ? 6 : 1);
  row('Wind across the course, as the coupler worked it out', r.cp.wind.e, wind.e, 'm/s', sigma ? 3 : 0.5);
  if (!sigma) row('Sink rate at the threshold (ground speed on a 3 degree path)', -hit.vs / FT * 60, hit.gs * tan(3) / FT * 60, 'ft/min', 30);
  summary.push(`  ${pad(name, 52)}lateral ${hit.e.toFixed(2).padStart(6)} m   vertical ${(hit.alt - TCH).toFixed(2).padStart(6)} m   `
    + `${Math.round(hit.ias / KT)} KIAS, crab ${crab.toFixed(1)} deg`);
}
approach('still air', { n: 0, e: 0 });
approach('10 m/s crosswind from the left', { n: 0, e: 10 });
approach('10 m/s crosswind from the right, 5 m/s on the nose', { n: -5, e: -10 });
approach('8 m/s crosswind and gusts of 1 m/s rms', { n: -3, e: 8 }, 1.0);

// NAV mode on a VOR: intercept the 200 radial inbound (course 020 by the station, 022 true),
// cross the station and carry on outbound, with the same crosswind
{
  const course = 22 * D2R, ux = Math.sin(course), uy = Math.cos(course);
  const xtk = (fm) => (fm.pos[1] - VOR.e) * uy - (fm.pos[0] - VOR.n) * ux;
  const along = (fm) => (fm.pos[1] - VOR.e) * ux + (fm.pos[0] - VOR.n) * uy;
  let before = null, after = null, worst = 0, flagged = false, hdgIn = 0;
  const r = fly({
    wind: { n: 0, e: 10 }, seconds: 520,
    start: { n: VOR.n - 12000, e: VOR.e - 7000, alt: 1000, hdg: 0, kt: 95 },
    setup: (nv, cp) => { nv.tuneNav(113000); nv.setObs(20); cp.toggle('nav'); },
    until: ({ fm, nv }) => {
      const a = along(fm);
      if (a > -6000 && a < -1500) worst = Math.max(worst, Math.abs(xtk(fm)));
      if (before === null && a > -2000) { before = xtk(fm); hdgIn = fm.out.heading / D2R; }
      if (Math.abs(a) < 300 && !nv.out.nav1.valid) flagged = true;
      if (a > 4000) { after = xtk(fm); return false; }
    },
  });
  section('NAV mode on a VOR, 10 m/s crosswind: intercept, track inbound, cross the station');
  yes('Gets there', before !== null && after !== null);
  row('Off the course 2 km before the station', before, 0, 'm', 40);
  row('Largest error over the 4.5 km before that', worst, 0, 'm', 60);
  yes('NAV flag over the station, heading held through it', flagged);
  row('Off the course 4 km past the station', after, 0, 'm', 120);
  row('Heading flown inbound (course 022 true, crabbed into the wind)', hdgIn, 22 - Math.asin(10 * Math.cos(course) / r.fm.out.tas) / D2R, 'deg', 1.5);
}

// ---------------------------------------------------------------- report
const fmt = (v) => (typeof v !== 'number' ? String(v) : !Number.isFinite(v) ? 'none' : Math.abs(v) >= 100 ? v.toFixed(0) : Number.isInteger(v) ? String(v) : v.toFixed(2));
let bad = 0, total = 0;
for (const r of rows) {
  if (r.title) { console.log(`\n${r.title}`); continue; }
  total++;
  if (!r.ok) bad++;
  console.log(`${r.ok ? '  ok  ' : ' MISS '}${pad(r.name, 70)}${pad(fmt(r.got), 10)}${pad(fmt(r.want), 9)}${r.unit}`);
}
console.log(`\nCoupled ILS, error at the threshold\n${summary.join('\n')}`);
console.log(`\n${total - bad}/${total} as expected\n`);
process.exitCode = bad ? 1 : 0;
