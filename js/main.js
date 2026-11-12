import * as THREE from '../vendor/three.module.js';
import { FlightModel, Autopilot, KT, FT, D2R, stillAir } from './fdm.js';
import { Geo } from './geo.js';
import { Terrain } from './terrain.js';
import { Scenery } from './scenery.js';
import { Clouds } from './clouds.js';
import { Pipeline } from './render.js';
import { makeSky, Precipitation } from './sky.js';
import { updateAtmosphere, sunPosition } from './atmo.js';
import { Air, fetchLive, presetWeather, describe } from './weather.js';
import { buildAircraft, buildGroundShadow } from './aircraft.js';
import { buildCockpit, EYE } from './cockpit.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { Nav, Coupler, loadNavaids } from './nav.js';
import { Systems, FAILURES } from './systems.js';
import { AIRCRAFT, DEFAULT_AIRCRAFT } from './aircraft/index.js';
import { live } from './config.js';
import { AIRPORTS, resolveAirport, layoutRunways, pickRunway, RunwayLights, loadRunwayData } from './airports.js';

const showCredit = () => { document.getElementById('imgCredit').innerHTML = live.source.credit; };
showCredit();
window.addEventListener('cayley-imagery', showCredit);

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NoToneMapping;

const world = new THREE.Scene();
const near = new THREE.Scene();
const worldCam = new THREE.PerspectiveCamera(62, 1, 1, 800000);
const nearCam = new THREE.PerspectiveCamera(62, 1, 0.06, 80);
worldCam.matrixAutoUpdate = true;

const clouds = new Clouds();
const pipeline = new Pipeline(renderer, clouds);
world.add(makeSky());
const groundShadow = buildGroundShadow();
world.add(groundShadow);

let aircraft = null, cockpit = null;      // built per aircraft type in setAircraft()
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 60 });
sunLight.shadow.camera.updateProjectionMatrix();
sunLight.shadow.bias = -0.0006; sunLight.shadow.normalBias = 0.025;
const bounce = new THREE.Color(), glassSky = new THREE.Color(), glassGlint = new THREE.Color();
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
// daylight bouncing around the cabin: without it the interior would be lit by the sky's zenith alone
const cabin = new THREE.PointLight(0xffffff, 0, 3.2, 1.2);
near.add(sunLight, sunLight.target, hemi);
const precip = new Precipitation();
near.add(precip.lines);

const air = new Air();
const nav = new Nav();
let fm = null, ap = null, systems = null, coupler = null;   // one set per aircraft type
const sound = new Sound();
const input = new Input(canvas);

const S = {
  mode: 'menu', view: 'orbit', paused: false, token: 0,
  airport: null, geo: null, terrain: null, scenery: null, lights: null, runways: [], dep: null,
  aircraftId: DEFAULT_AIRCRAFT, def: null,
  weatherMode: 'live', weather: null, timeMode: 'now', date: new Date(), startMode: 'runway',
  settled: false, hud: true, starting: 0, orbit: 0.6, chaseHdg: 0,
  flyby: null, lastTouch: 0, fade: 0, elapsed: 0, hint: false,
};
const cam = { e: 0, n: 0, u: 0 };
const H = 1 / 240;
let frames = 0, slowFrames = 0;
let acc = 0, last = performance.now(), hudT = 0, slowT = 0, frameAvg = 16, pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

// ------------------------------------------------------------------ UI
let toastT = 0;
function toast(msg, sub = '', hold = 2.4) {
  $('toast').innerHTML = msg + (sub ? `<small>${sub}</small>` : '');
  $('toast').classList.add('on');
  toastT = hold;
}
// [key codes, fallback label, what it does]; labels are redrawn from the real keyboard layout where the browser exposes it
const KEYS = [
  [null, '↑ ↓ ← →', 'Yoke'], [['KeyA', 'KeyD'], 'A  D', 'Rudder'], [['KeyW', 'KeyS'], 'W  S', 'Throttle'], [['KeyF', 'KeyV'], 'F  V', 'Flaps'],
  [['KeyI', 'KeyK'], 'I  K', 'Trim'], [null, 'Space', 'Brakes'], [['KeyB'], 'B', 'Parking brake'], [['KeyZ'], 'Z', 'Autopilot'],
  [['KeyM', 'KeyN'], 'M  N', 'Mixture'], [['KeyE'], 'E', 'Engine'], [['KeyC'], 'C', 'View'], [null, 'Drag', 'Look'],
  [['KeyT'], 'T', 'Time'], [['KeyR'], 'R', 'Restart'], [['KeyP'], 'P', 'Pause'], [null, 'Esc', 'Menu'],
  [['KeyU', 'KeyJ'], 'U  J', 'Tune NAV'], [['KeyO', 'KeyL'], 'O  L', 'Course knob'], [['KeyY'], 'Y', 'Centre course'], [['KeyX'], 'X', 'AP follows NAV'],
  [['KeyG'], 'G', 'AP flies approach'], [null, '4  5', 'Tune ADF'], [null, '6  7', 'GPS direct, source'], [null, '8', 'Pitot heat'],
  [null, '9', 'Set gyro to compass'], [null, '0', 'Fuel tank'], [['Comma', 'Period'], ',  .', 'Propeller'], [['KeyQ'], 'Q', 'Altimeter'],
];
function drawKeys(layout) {
  $('keys').innerHTML = KEYS.map(([codes, label, what]) => {
    const l = codes && layout ? codes.map((c) => (layout.get(c) || c.slice(3)).toUpperCase()).join('  ') : label;
    return `<kbd>${l}</kbd><span>${what}</span>`;
  }).join('');
}
drawKeys(null);
if (navigator.keyboard && navigator.keyboard.getLayoutMap) navigator.keyboard.getLayoutMap().then(drawKeys).catch(() => {});
$('keysBtn').onclick = () => { $('keys').hidden = !$('keys').hidden; $('faults').hidden = true; };
$('faultsBtn').onclick = () => { $('faults').hidden = !$('faults').hidden; $('keys').hidden = true; };

$('airportGrid').innerHTML = AIRPORTS.map((a) => `<button data-id="${a.id}">${a.name}<span>${a.where}</span></button>`).join('');
$('airportBtn').onclick = () => { $('airportList').hidden = !$('airportList').hidden; $('planeList').hidden = true; };
$('planeGrid').innerHTML = Object.values(AIRCRAFT).map((a) => `<button data-id="${a.id}">${a.name}<span>${a.power || a.role || ''}</span></button>`).join('');
$('planeBtn').onclick = () => { $('planeList').hidden = !$('planeList').hidden; $('airportList').hidden = true; };
$('planeGrid').onclick = (e) => { const b = e.target.closest('button'); if (b) { $('planeList').hidden = true; setAircraft(b.dataset.id); } };
$('faults').innerHTML = Object.entries(FAILURES).map(([k, f]) => `<button data-f="${k}">${f.name}</button>`).join('') + '<button data-f="fix">Fix everything</button>';
$('faults').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.f === 'fix') { systems.repair(); toast('All faults cleared', '', 1.4); } else { systems.fail(b.dataset.f); toast(FAILURES[b.dataset.f].name, '', 1.6); } };
$('airportGrid').onclick = (e) => { const b = e.target.closest('button'); if (b) { $('airportList').hidden = true; setAirport(b.dataset.id); } };
$('icao').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const id = $('icao').value.trim().toUpperCase();
  if (id.length < 3) return;
  const ok = await setAirport(id);
  if (ok) { $('airportList').hidden = true; $('icao').value = ''; } else { $('icao').value = ''; $('icao').placeholder = 'Not found'; }
});
for (const seg of document.querySelectorAll('.seg')) {
  seg.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const o of seg.children) o.classList.toggle('on', o === b);
    const k = seg.dataset.key;
    if (k === 'time') { S.timeMode = b.dataset.v; applyTime(); }
    if (k === 'weather') setWeather(b.dataset.v).then(place);
    if (k === 'start') { S.startMode = b.dataset.v; place(); }
  };
}
$('fly').onclick = () => startFlight();

// ------------------------------------------------------------------ world setup
async function setAirport(id) {
  const token = ++S.token;
  const a = await resolveAirport(id);
  if (!a) return false;
  if (token !== S.token) return true;
  if (S.scenery) S.scenery.dispose();
  if (S.terrain) S.terrain.dispose();
  if (S.lights) S.lights.dispose();
  S.airport = a;
  S.geo = new Geo(a.lat, a.lon);
  S.runways = layoutRunways(a, S.geo);
  S.terrain = new Terrain(world, S.geo, renderer);
  S.terrain.fallbackH = a.elev;
  S.terrain.setRunways(S.runways);
  air.terrain = S.terrain;
  S.scenery = new Scenery(world, S.geo, S.terrain, renderer);
  S.lights = new RunwayLights(S.runways);
  world.add(S.lights.points);
  $('airportName').textContent = a.name; $('airportId').textContent = a.id;
  await setWeather(S.weatherMode);
  if (token !== S.token) return true;
  applyTime();
  place();
  return true;
}

async function setWeather(mode) {
  S.weatherMode = mode;
  const a = S.airport;
  if (!a) return;
  let w;
  if (mode === 'live') {
    try { w = await fetchLive(a.lat, a.lon, a.elev); } catch (err) { w = presetWeather('fair', a.elev); w.source = 'offline'; }
  } else w = presetWeather(mode, a.elev);
  S.weather = w;
  air.set(w, a.elev);
  clouds.setWeather(w);
  fm.kollsman = w.qnh * 100;
  $('metar').textContent = (w.source === 'offline' ? 'No live weather · ' : '') + describe(w, a.elev);
}

// A date today at which the sun stands where the chosen time of day wants it.
function applyTime() {
  const a = S.airport, now = new Date();
  S.elapsed = 0;
  if (!a || S.timeMode === 'now') { S.date = now; return; }
  const t0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (a.lon / 15) * 3600e3; // local solar midnight
  let noon = t0, night = t0, hi = -9, lo = 9, dawn = null, dusk = null, prev = null;
  for (let m = 0; m <= 1440; m += 4) {
    const t = t0 + m * 60e3, alt = sunPosition(new Date(t), a.lat, a.lon).alt / D2R;
    if (alt > hi) { hi = alt; noon = t; }
    if (alt < lo) { lo = alt; night = t; }
    if (prev !== null) {
      if (prev < 3 && alt >= 3 && dawn === null) dawn = t;
      if (prev > 1.5 && alt <= 1.5) dusk = t;
    }
    prev = alt;
  }
  S.date = new Date({ noon, night, dawn: dawn ?? noon, dusk: dusk ?? noon }[S.timeMode] ?? now.getTime());
}

// Put the aircraft at the start of the runway into wind (or on final to it).
// Swap the aircraft: its definition builds the flight model, the 3D model and the panel.
function setAircraft(id) {
  const def = AIRCRAFT[id] || AIRCRAFT[DEFAULT_AIRCRAFT];
  S.aircraftId = def.id; S.def = def;
  if (aircraft) { near.remove(aircraft.group); aircraft.dispose(); }
  aircraft = buildAircraft(def);
  cockpit = buildCockpit(def);
  cockpit.group.position.copy(aircraft.eye).sub(EYE);        // the panel goes where this aircraft's pilot sits
  cabin.position.set(aircraft.eye.x * 0.3, aircraft.eye.y - 0.16, aircraft.eye.z + 0.1);
  aircraft.group.add(cockpit.group, cabin);
  near.add(aircraft.group);
  fm = new FlightModel(def, air);
  fm.rig = rigFor(def);
  if (S.weather) fm.kollsman = S.weather.qnh * 100;
  ap = new Autopilot(fm);
  systems = new Systems(fm);
  coupler = new Coupler(nav, ap);
  if (window.sim) Object.assign(window.sim, { fm, ap, systems, coupler, aircraft, cockpit });
  $('planeName').textContent = def.name; $('planeRole').textContent = def.power || def.role || '';
  place();
}

// Every aircraft leaves the factory rigged to fly hands-off in cruise: a bent tab on the
// rudder, a tweak to the aileron rigging, set against the engine's torque and slipstream.
// Find the same thing here by flying this one in still air and reading what it needed.
function rigFor(def) {
  const t = new FlightModel(def, stillAir), a = new Autopilot(t), hb = def.handbook || {};
  const v = (hb.handlingKias || def.limits.vs1 * 2) * KT;
  t.reset({ alt: 1000, speed: v, pitch: 0.03, throttle: 0.6 });
  a.engage(def.engine ? 'alt' : 'ias'); a.ias = v;
  for (let i = 0; i < 240 * 20; i++) {
    if (def.engine) t.ctl.throttle = THREE.MathUtils.clamp(t.ctl.throttle + 0.012 * (v - t.out.ias) * H, 0.05, 1);
    a.update(H); t.step(H);
  }
  return { roll: t.ctl.roll, yaw: t.ctl.yaw };
}

// Fly the aircraft for a few seconds on a hidden autopilot until it holds the
// wanted airspeed and vertical speed, then freeze that into the trim and the
// throttle and put it back where it started. Works for any aircraft.
function trimTo(ias, vs) {
  const start = [fm.pos[0], fm.pos[1], fm.pos[2]], hold = new Autopilot(fm), C = S.def.controls;
  // in still air, at the real pressure and temperature: gusts and ridge lift are for the pilot to deal with
  fm.env = { ground: stillAir.ground, atmosphere: air.atmosphere, wind: stillAir.wind };
  // pitch holds the flight path, power holds the speed
  if (S.def.engine) { hold.engage('vs'); hold.vs = vs; } else { hold.engage('ias'); hold.ias = ias; }
  let thrI = fm.ctl.throttle;
  for (let i = 0; i < 240 * 20; i++) {
    if (S.def.engine) {
      const err = ias - fm.out.ias;
      thrI = THREE.MathUtils.clamp(thrI + 0.004 * err * H, 0.03, 1);              // slow: an aeroplane gains speed slowly
      fm.ctl.throttle = THREE.MathUtils.clamp(thrI + 0.03 * err, 0.03, 1);
    }
    hold.update(H); fm.step(H);
  }
  fm.ctl.throttle = thrI;
  // what the trim cannot reach (some aircraft have very little), the pilot holds on the stick
  const p = fm.ctl.pitch, travel = p > 0 ? C.elevUp : C.elevDown, want = fm.ctl.trim + p * travel / C.trim;
  fm.ctl.trim = THREE.MathUtils.clamp(want, -1, 1);
  input.bias = (want - fm.ctl.trim) * C.trim / travel;
  fm.ctl.pitch = fm.ctl.roll = fm.ctl.yaw = 0;
  fm.pos[0] = start[0]; fm.pos[1] = start[1]; fm.pos[2] = start[2];
  // hand it to the real air: it keeps its airspeed, so over the ground it now moves with the wind
  const wind = air.meanWind(-fm.pos[2]);
  fm.vel[0] += wind.n; fm.vel[1] += wind.e;
  air.out.n = wind.n; air.out.e = wind.e; air.out.d = 0; air.out.gu = air.out.gv = air.out.gw = air.out.gp = air.out.gq = air.out.gr = 0;
  fm.env = air;
}

function place() {
  if (!S.airport || !S.weather || !fm) return;
  const w0 = S.weather.wind[0];
  const dep = pickRunway(S.runways, w0.dir, w0.spd);
  S.dep = dep;
  nav.setAirport(S.airport, S.runways, S.geo, dep.id);
  coupler.release();
  const ux = Math.sin(dep.heading), uy = Math.cos(dep.heading);
  ap.on = false;
  input.bias = 0;
  const def = S.def, hb = def.handbook || {}, flap = def.wing.flap;
  fm.fuel = def.mass.fuel; fm.payload = def.mass.payload;
  const vRef = (hb.vs0Kcas || hb.vs1Kcas || [def.limits.vs1 * 1.1])[0] * 1.3 * KT, vCruise = (hb.handlingKias || def.limits.vs1 * 2) * KT;
  const mode = !def.engine && S.startMode === 'runway' ? 'air' : S.startMode;     // a glider needs a launch: start it aloft
  air.hold = null;
  if (mode === 'runway') {
    const back = Math.min(60, dep.length * 0.08);
    // stand on the surveyed runway elevation until the fine terrain arrives
    air.hold = dep.elev + (dep.farElev - dep.elev) * (back / dep.length);
    fm.reset({ n: dep.n + uy * back, e: dep.e + ux * back, heading: dep.heading });
  } else if (mode === 'final') {
    const d = 5556, alt = dep.elev + d * Math.tan(3 * D2R) + 15;
    fm.reset({ n: dep.n - uy * d, e: dep.e - ux * d, alt, heading: dep.heading, speed: vRef / Math.sqrt(air.atmosphere(alt).rho / 1.225), pitch: 0.01, throttle: 0.2 });
    if (flap) { fm.ctl.flaps = flap.detents[1] / flap.detents[flap.detents.length - 1]; fm.flapPos = fm.ctl.flaps; }
    if (!def.engine) fm.ctl.spoiler = 0.35;
    trimTo(vRef, -vRef * Math.tan(3 * D2R));              // a 3 degree path at the approach speed
  } else {
    const d = 9000, alt = Math.max(dep.elev + 900, S.terrain.heightAt(dep.e - ux * d, dep.n - uy * d) + 700);
    fm.reset({ n: dep.n - uy * d, e: dep.e - ux * d, alt, heading: dep.heading, speed: vCruise / Math.sqrt(air.atmosphere(alt).rho / 1.225), pitch: 0.03, throttle: 0.65 });
    trimTo(vCruise, 0);
  }
  if (!def.engine) { fm.ctl.throttle = mode === 'final' ? 0.35 : 0; fm.ctl.spoiler = fm.ctl.throttle; }   // a glider's throttle keys are its airbrake lever
  systems.reset();
  fm.kollsman = S.weather.qnh * 100;
  S.settled = false; S.placedAt = performance.now(); S.flyby = null; S.chaseHdg = dep.heading;
  S.lastTouch = fm.touchdowns;
  input.yoke.pitch = input.yoke.roll = input.yoke.yaw = 0;
  acc = 0;
}

async function startFlight() {
  if (!S.airport) return;
  $('airportList').hidden = true;
  await sound.start();
  place();
  S.mode = 'fly'; S.view = 'cockpit'; S.paused = false;
  input.look.yaw = 0; input.look.pitch = 0; input.zoom = 0;
  $('menu').classList.add('gone');
  document.body.classList.add('flying');
  $('hud').hidden = !S.hud; $('keysBtn').hidden = false; $('faultsBtn').hidden = false;
  if (!S.hint) { S.hint = true; $('keys').hidden = false; setTimeout(() => { $('keys').hidden = true; }, 9000); }
  if (S.startMode === 'runway') toast(`Runway ${S.dep.id}`, 'B releases the parking brake', 4);
}
function toMenu() {
  S.mode = 'menu'; S.view = 'orbit';
  $('menu').classList.remove('gone');
  document.body.classList.remove('flying');
  $('hud').hidden = true; $('keysBtn').hidden = true; $('keys').hidden = true; $('faultsBtn').hidden = true; $('faults').hidden = true;
  sound.setLevel(0);
  place();
}

function handleKeys() {
  for (const code of input.take()) {
    if (S.mode !== 'fly') { if (code === 'Enter') startFlight(); continue; }
    const c = fm.ctl;
    switch (code) {
      case 'KeyC': S.view = { cockpit: 'chase', chase: 'flyby', flyby: 'cockpit' }[S.view] || 'cockpit'; S.flyby = null; input.look.yaw = 0; input.look.pitch = 0; input.zoom = 0; break;
      case 'Digit1': S.view = 'cockpit'; break;
      case 'Digit2': S.view = 'chase'; break;
      case 'Digit3': S.view = 'flyby'; S.flyby = null; break;
      case 'KeyF': case 'KeyV': {
        const det = S.def.wing.flap && S.def.wing.flap.detents;
        if (!det) { toast('No flaps', '', 1.2); break; }
        const n = det.length - 1, i = Math.max(0, Math.min(n, Math.round(c.flaps * n) + (code === 'KeyF' ? 1 : -1)));
        c.flaps = i / n; toast(`Flaps ${det[i]}°`, '', 1.2); break;
      }
      case 'KeyU': toast('NAV 1', nav.stepNav(1), 2); break;
      case 'KeyJ': toast('NAV 1', nav.stepNav(-1), 2); break;
      case 'KeyY': { const r = nav.centreObs(); toast(r == null ? 'No signal' : `Course ${String(Math.round(r)).padStart(3, '0')}°`, '', 1.4); break; }
      case 'KeyX': toast(coupler.toggle('nav') || 'NAV', '', 1.6); break;
      case 'KeyG': toast(coupler.toggle('apr') || 'APR', '', 1.6); break;
      case 'Digit4': toast('ADF', nav.stepAdf(-1), 2); break;
      case 'Digit5': toast('ADF', nav.stepAdf(1), 2); break;
      case 'Digit6': toast(nav.stepDirect() || 'Direct', '', 1.6); break;
      case 'Digit7': toast(nav.toggleSource() || 'Source', '', 1.6); break;
      case 'Digit8': systems.sw.pitotHeat = !systems.sw.pitotHeat; toast(systems.sw.pitotHeat ? 'Pitot heat on' : 'Pitot heat off', '', 1.2); break;
      case 'Digit9': systems.syncHeading(); toast('Heading set to compass', '', 1.4); break;
      case 'Digit0': systems.sw.tank = { both: 'left', left: 'right', right: 'both' }[systems.sw.tank]; toast(`Fuel ${systems.sw.tank}`, '', 1.2); break;
      case 'Minus': if (S.def.engine && S.def.engine.carb) { systems.sw.carbHeat = !systems.sw.carbHeat; toast(systems.sw.carbHeat ? 'Carb heat on' : 'Carb heat off', '', 1.2); } break;
      case 'KeyB': c.park = !c.park; toast(c.park ? 'Parking brake set' : 'Brake released', '', 1.2); break;
      case 'KeyZ':
        if (ap.on) { ap.on = false; coupler.release(); toast('Autopilot off', '', 1.2); }
        else if (!fm.out.onGround) { ap.engage('alt'); toast('Autopilot', 'Arrows change heading and altitude', 2.5); }
        break;
      case 'KeyE':
        if (fm.out.firing) { c.mags = false; toast('Engine off', '', 1.2); }
        else { c.mags = true; c.mixture = Math.max(c.mixture, 0.9); S.starting = 7; }
        break;
      case 'KeyQ': fm.kollsman = S.weather.qnh * 100; toast(`Altimeter ${Math.round(S.weather.qnh)} hPa`, '', 1.4); break;
      case 'KeyH': S.hud = !S.hud; $('hud').hidden = !S.hud; break;
      case 'KeyT': S.date = new Date(S.date.getTime() + (input.keys.has('ShiftLeft') ? -1 : 1) * 3600e3); break;
      case 'KeyR': place(); break;
      case 'KeyP': S.paused = !S.paused; toast(S.paused ? 'Paused' : '', '', S.paused ? 1e6 : 0.01); break;
      case 'Escape': toMenu(); break;
    }
  }
}

// ------------------------------------------------------------------ per-frame pieces
const acQuat = new THREE.Quaternion(), m4 = new THREE.Matrix4();
const vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3(), tmp = new THREE.Vector3();
const lookQ = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
const headLag = new THREE.Vector3();

function aircraftAttitude() {
  const [qw, qx, qy, qz] = fm.q;
  const r11 = 1 - 2 * (qy * qy + qz * qz), r12 = 2 * (qx * qy - qw * qz), r13 = 2 * (qx * qz + qw * qy);
  const r21 = 2 * (qx * qy + qw * qz), r22 = 1 - 2 * (qx * qx + qz * qz), r23 = 2 * (qy * qz - qw * qx);
  const r31 = 2 * (qx * qz - qw * qy), r32 = 2 * (qy * qz + qw * qx), r33 = 1 - 2 * (qx * qx + qy * qy);
  // model X = body right, Y = body up, Z = body aft; scene = (east, up, -north)
  vx.set(r22, -r32, -r12); vy.set(-r23, r33, r13); vz.set(-r21, r31, r11);
  m4.makeBasis(vx, vy, vz);
  acQuat.setFromRotationMatrix(m4);
  aircraft.group.quaternion.copy(acQuat);
}

function updateCamera(dt) {
  const o = fm.out;
  let fov = 62;
  if (S.view === 'cockpit') {
    // the head rides the airframe, with a little give under g and a buzz from the engine
    const gy = THREE.MathUtils.clamp(-(o.gLoad - 1) * 0.014, -0.03, 0.03);
    headLag.y += (gy - headLag.y) * Math.min(1, dt * 6);
    const buzz = o.rpm > 300 ? 0.0006 * (o.rpm / 2400) : 0;
    tmp.copy(aircraft.eye).add(headLag).add(new THREE.Vector3((Math.random() - 0.5) * buzz, (Math.random() - 0.5) * buzz, 0));
    tmp.x += Math.sin(input.look.yaw) * -0.07; tmp.z += (1 - Math.cos(input.look.yaw)) * 0.05;
    nearCam.position.copy(tmp).applyQuaternion(acQuat);
    euler.set(input.look.pitch - 0.16, input.look.yaw, 0);
    lookQ.setFromEuler(euler);
    nearCam.quaternion.copy(acQuat).multiply(lookQ);
    fov = 62 + input.zoom * 30;
    nearCam.near = 0.06; nearCam.far = 80;
  } else if (S.view === 'flyby') {
    const pe = fm.pos[1], pn = fm.pos[0], pu = -fm.pos[2];
    let f = S.flyby;
    const far = f ? Math.hypot(f.e - pe, f.n - pn, f.u - pu) : 0;
    if (!f || far > 1100 || (f.passed && far > 420)) {
      const sp = Math.max(o.gs, 8), hd = o.gs > 3 ? o.track : o.heading;
      const side = Math.random() < 0.5 ? -1 : 1;
      const e = pe + Math.sin(hd) * sp * 4.5 + Math.cos(hd) * side * (22 + Math.random() * 40);
      const n = pn + Math.cos(hd) * sp * 4.5 - Math.sin(hd) * side * (22 + Math.random() * 40);
      const g = S.terrain.heightAt(e, n);
      f = S.flyby = { e, n, u: Math.max(g + 1.7, pu - 6 + Math.random() * 14), passed: false, d: 1e9 };
    }
    if (far < f.d) f.d = far; else if (far > f.d + 20) f.passed = true;
    nearCam.position.set(f.e - pe, f.u - pu, -(f.n - pn));
    nearCam.up.set(0, 1, 0);
    if (f.aim) nearCam.lookAt(f.aim[0], f.aim[1], f.aim[2]); else nearCam.lookAt(0, 0, 0);   // a scripted camera may trail its subject
    const dist = nearCam.position.length();
    fov = f.fov || THREE.MathUtils.clamp(2 * Math.atan(16 / dist) / D2R, 5, 55);
    nearCam.near = Math.max(0.5, dist * 0.3); nearCam.far = dist + 60;
  } else {
    // chase and the start-screen orbit share one rig
    let az, el, radius;
    if (S.view === 'orbit') { S.orbit += dt * 0.07; az = o.heading + Math.PI + S.orbit + input.look.yaw; el = 0.16 + input.look.pitch * 0.5; radius = 15; }
    else {
      const target = o.gs > 6 ? o.track : o.heading;
      let d = target - S.chaseHdg; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      S.chaseHdg += d * Math.min(1, dt * 2.2);
      az = S.chaseHdg + Math.PI - input.look.yaw; el = 0.20 - input.look.pitch * 0.8; radius = 17 + input.zoom * 9;
    }
    el = THREE.MathUtils.clamp(el, -0.4, 1.4);
    nearCam.position.set(Math.sin(az) * Math.cos(el) * radius, Math.sin(el) * radius + 0.8, -Math.cos(az) * Math.cos(el) * radius);
    const g = S.terrain ? S.terrain.heightAt(fm.pos[1] + nearCam.position.x, fm.pos[0] - nearCam.position.z) : 0;
    const minY = g + 1.0 - (-fm.pos[2]);
    if (nearCam.position.y < minY) nearCam.position.y = minY;
    nearCam.up.set(0, 1, 0);
    nearCam.lookAt(0, 0.9, 0);
    fov = S.view === 'orbit' ? 38 : 55;
    nearCam.near = 0.5; nearCam.far = 400;
  }
  cam.e = fm.pos[1] + nearCam.position.x;
  cam.u = -fm.pos[2] + nearCam.position.y;
  cam.n = fm.pos[0] - nearCam.position.z;
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  for (const c of [nearCam, worldCam]) { c.fov = fov; c.aspect = aspect; }
  const agl = S.terrain ? cam.u - S.terrain.heightAt(cam.e, cam.n) : 100;
  worldCam.near = THREE.MathUtils.clamp(agl * 0.25, 0.7, 250);
  worldCam.quaternion.copy(nearCam.quaternion);
  worldCam.position.set(0, 0, 0);
  nearCam.updateProjectionMatrix(); worldCam.updateProjectionMatrix();
  nearCam.updateMatrixWorld(); worldCam.updateMatrixWorld();
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  const v = renderer.getDrawingBufferSize(new THREE.Vector2());
  pipeline.setSize(v.x, v.y);
}
window.addEventListener('resize', resize);

function updateHud(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.1;
  const o = fm.out, c = fm.ctl, ind = systems.ind, det = S.def.wing.flap ? S.def.wing.flap.detents : [0];
  // the HUD repeats the panel, so it is wrong when the panel is
  $('hIas').textContent = Math.round(ind.ias / KT);
  $('hAlt').textContent = Math.round(ind.altInd / FT / 10) * 10;
  $('hHdg').textContent = String(Math.round(ind.heading / D2R) % 360).padStart(3, '0');
  $('hVs').textContent = (o.vs > 0.25 ? '+' : '') + Math.round(o.vs / FT * 60 / 10) * 10;
  const bits = [`Thr ${Math.round(c.throttle * 100)}`, `Flaps ${Math.round(o.flapPos * det[det.length - 1])}`, `Trim ${c.trim >= 0 ? '+' : ''}${Math.round(c.trim * 100)}`];
  if (c.mixture < 0.97) bits.push(`Mix ${Math.round(c.mixture * 100)}`);
  if (c.park) bits.push('<i>Park brake</i>');
  if (ap.on) bits.push(`<i>AP ${String(Math.round(ap.heading / D2R) % 360).padStart(3, '0')}° ${Math.round(ap.alt / FT / 10) * 10} ft</i>`);
  if (o.stallWarn > 0.3) bits.push('<i>Stall</i>');
  if (ap.on && coupler.mode) bits.push(`<i>${[nav.out.ap.lat, nav.out.ap.vert].filter(Boolean).join(' ')}</i>`);
  if (S.def.prop && S.def.prop.governor) bits.push(`Prop ${Math.round(c.prop * 100)}`);
  if (!S.def.engine) bits.push(`Airbrake ${Math.round(c.spoiler * 100)}`);
  if (systems.sw.pitotHeat) bits.push('Pitot heat');
  if (systems.ice > 0.04) bits.push(`<i>Ice ${Math.round(systems.ice * 100)}</i>`);
  if (S.def.engine && !o.firing) bits.push('<i>Engine off</i>');
  $('hState').innerHTML = bits.join(' · ');
}

// ------------------------------------------------------------------ the loop
// ?record: frames are stepped by hand on a fixed clock (tools/record.mjs), so nothing depends on real time
const RECORD = new URLSearchParams(location.search).has('record');
if (RECORD) document.body.classList.add('record');
function tick(now) { requestAnimationFrame(tick); if (!RECORD) frame(now); }
function frame(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  frameAvg += (dt * 1000 - frameAvg) * 0.05;
  handleKeys();
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('on'); }
  if (!S.terrain || !S.weather) { renderer.setRenderTarget(null); renderer.clear(); return; }
  const o = fm.out, c = fm.ctl;
  const flying = S.mode === 'fly' && !S.paused;

  // the gear settles onto the real ground once it has streamed in
  if (!S.settled && (S.terrain.levelAt(fm.pos[1], fm.pos[0]) >= 14 || (air.hold === null && now - S.placedAt > 1500))) {
    S.settled = true;
    if (air.hold !== null) {
      const g = S.terrain.heightAt(fm.pos[1], fm.pos[0]);
      if (o.onGround) fm.pos[2] -= g - air.hold;      // keep the wheels where they were, on the real surface
      air.hold = null;
    }
  }

  if (flying) {
    S.elapsed += dt;
    air.update(dt, fm);
    input.apply(dt, fm, ap.on);
    {
      const k = input.keys;
      if (!S.def.engine) c.spoiler = c.throttle;            // a glider's throttle keys work the airbrakes
      c.prop = THREE.MathUtils.clamp(c.prop + ((k.has('Period') ? 1 : 0) - (k.has('Comma') ? 1 : 0)) * 0.4 * dt, 0, 1);
      const turn = (k.has('KeyO') ? 1 : 0) - (k.has('KeyL') ? 1 : 0);
      if (turn) nav.turnObs(turn * (k.has('ShiftLeft') ? 60 : 12) * dt);
    }
    nav.update(fm);
    coupler.update();
    if (ap.on) {
      const k = input.keys;
      ap.heading = (ap.heading + ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * 0.35 * dt + 2 * Math.PI) % (2 * Math.PI);
      ap.alt += ((k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)) * 6 * dt;
    }
    if (S.starting > 0) { S.starting -= dt; c.starter = !(o.firing && o.rpm > 520); if (!c.starter || S.starting <= 0) { c.starter = false; S.starting = 0; } }
    const wasCrashed = fm.crashed;
    acc += dt;
    while (acc >= H) { ap.update(H); fm.step(H); acc -= H; }
    if (!Number.isFinite(fm.pos[0] + fm.pos[1] + fm.pos[2] + fm.rpm + fm.w[0])) { place(); toast('Reset', '', 1.5); }
    // systems see the weather the aircraft is actually in: cloud water where it is, the real temperature and humidity
    systems.update(dt, {
      oat: o.oat, lwc: clouds.liquidAt(fm.pos[1], fm.pos[0], o.alt), precip: o.alt < S.weather.clouds.low.top ? S.weather.precip : 0,
      humidity: THREE.MathUtils.clamp(1 - (S.weather.tempC - S.weather.dewC) / 18, 0.2, 1), lat: S.airport.lat, variation: nav.out.variation || 0,
    });
    for (const ev of systems.events.splice(0)) if (ev === 'seized') toast('Engine seized', '', 3);   // never leave the pilot staring at a broken state
    if (fm.crashed && !wasCrashed) { ap.on = false; toast(fm.crashed, 'R to restart', 1e6); sound.touch(1); }
    if (fm.touchdowns !== S.lastTouch) {
      S.lastTouch = fm.touchdowns;
      const fpm = Math.round(o.touchdownVs / FT * 60);
      sound.touch(Math.min(1, 0.25 + o.touchdownVs / 2.5));
      if (o.touchdownAir > 4 && !fm.crashed) toast(fpm < 120 ? 'Greaser' : fpm < 300 ? 'Touchdown' : 'Firm', `${fpm} fpm`, 2.2);
    }
  }

  aircraftAttitude();
  updateCamera(dt);
  S.terrain.update(cam.e, cam.n, cam.u);
  S.scenery.update(cam, S.paused ? 0 : dt);

  // sun, sky, haze
  const date = new Date(S.date.getTime() + S.elapsed * 1000);
  const sun = sunPosition(date, S.airport.lat, S.airport.lon);
  const low = S.weather.clouds.low;
  const under = cam.u < low.base ? 1 : 0;
  const overcast = under * THREE.MathUtils.smoothstep(low.cover, 0.6, 1.0);
  const atm = updateAtmosphere({ sun, visibility: S.weather.vis, camAlt: Math.max(cam.u, 0), overcast });
  const shade = 1 - 0.78 * Math.pow(low.cover, 1.5) * under;
  sunLight.color.copy(atm.sunLight); sunLight.intensity = Math.PI * shade * 1.05;
  sunLight.position.copy(atm.lightDir).multiplyScalar(30);
  hemi.color.copy(atm.ambient); hemi.intensity = Math.PI * 1.25;
  hemi.groundColor.copy(atm.ambient).multiplyScalar(0.45).add(bounce.copy(atm.sunLight).multiplyScalar(0.07 * Math.max(0, atm.lightDir.y) * shade));
  // exposure follows the light actually falling on the ground, like an eye or a camera would
  const lum = (c) => 0.3 * c.r + 0.55 * c.g + 0.15 * c.b;
  const illum = lum(atm.sunLight) * Math.max(atm.lightDir.y, 0) * shade + lum(atm.ambient);
  const targetExp = THREE.MathUtils.clamp(0.95 * Math.pow(1.05 / Math.max(illum, 1e-4), 0.72), 0.7, 13);
  S.exposure = S.exposure ? S.exposure + (targetExp - S.exposure) * Math.min(1, dt * 1.5) : targetExp;
  const exposure = S.exposure;
  cabin.color.copy(atm.ambient).lerp(atm.sunLight, 0.35); cabin.intensity = 1.6 + 2.2 * illum;

  const wc = air.meanWind((low.base + low.top) / 2);
  clouds.update(S.paused ? 0 : dt, wc.e, wc.n, worldCam, cam.e, cam.n);

  // rain or snow past the windows
  const w = air.out;
  tmp.set(w.e - fm.vel[1], -(S.weather.snow ? 1.4 : 7.5) + fm.vel[2], -(w.n - fm.vel[0]));
  const wet = cam.u < low.top ? Math.min(1, S.weather.precip / 5) : 0;
  precip.update(S.paused ? 0 : dt, tmp, wet, S.weather.snow, atm.ambient, S.view === 'cockpit' ? 1.6 : 0);
  // and the water it leaves on the glass
  if (aircraft.rainGlass) {
    glassSky.copy(atm.ambient).multiplyScalar(1.3);
    glassGlint.copy(atm.sunLight).multiplyScalar(0.8 * shade).add(bounce.copy(atm.ambient).multiplyScalar(2));
    aircraft.rainGlass.update(S.paused ? 0 : dt, S.weather.snow ? 0 : wet, o.ias, glassSky, glassGlint);
  }

  // aircraft, panel, lights
  aircraft.update(o, c, flying ? dt : 0, now / 1000, atm.night, illum, fm.gearPos);
  cockpit.group.visible = S.view === 'cockpit' || S.view === 'orbit' || !!S.def && S.def.id === 'c172s';
  aircraft.glass.material.opacity = S.view === 'cockpit' ? 0.07 : 0.3;
  const dep = S.dep;
  const de = dep.runway.e0 * 0.5 + dep.runway.e1 * 0.5 - fm.pos[1], dn = dep.runway.n0 * 0.5 + dep.runway.n1 * 0.5 - fm.pos[0];
  cockpit.update(dt, fm, {
    heading: o.heading, e: fm.pos[1], n: fm.pos[0], runways: S.runways, range: Math.hypot(de, dn) * 1.15,
    ident: S.airport.id, brg: (Math.atan2(de, dn) / D2R + 360) % 360, dist: Math.hypot(de, dn) / 1852,
    gs: o.gs / KT, trk: o.gs > 2 ? o.track / D2R : o.heading / D2R, xpdr: '1200  ALT', oat: o.oat,
    nav: nav.out, ind: systems.ind,
    ap: ap.on, apHdg: (ap.heading - systems.variation) / D2R, apAlt: ap.alt / FT, qnh: fm.kollsman / 100, fuelGal: fm.fuel / 0.72 / 3.785,
  }, atm.night, exposure);
  S.lights.update(cam, 0.5 + 5 * atm.night + (S.weather.vis < 8000 ? 1.5 : 0), renderer.getDrawingBufferSize(new THREE.Vector2()).y / Math.tan(worldCam.fov * D2R / 2) * 0.6);

  // the aircraft's shadow on the ground
  const L = atm.lightDir;
  if (o.agl < 250 && L.y > 0.12) {
    const k = Math.max(o.agl, 0) / L.y;
    const se = fm.pos[1] - L.x * k, sn = fm.pos[0] + L.z * k;
    groundShadow.visible = true;
    groundShadow.position.set(se - cam.e, S.terrain.heightAt(se, sn) + 0.06 - cam.u, -(sn - cam.n));
    groundShadow.rotation.set(-Math.PI / 2, -o.heading, 0);
    groundShadow.material.opacity = 0.55 * (1 - o.agl / 250) * shade * Math.min(1, atm.twilight * 2);
  } else groundShadow.visible = false;

  // sound
  if (S.mode === 'fly') {
    let doppler = 1, distance = S.view === 'cockpit' ? 1 : 0.75;
    if (S.view === 'flyby') {
      const d = nearCam.position.length();
      const vr = S.lastDist != null && dt > 0 ? (d - S.lastDist) / dt : 0;
      S.lastDist = d;
      doppler = THREE.MathUtils.clamp(343 / (343 + vr), 0.7, 1.4);
      distance = THREE.MathUtils.clamp(45 / d, 0.04, 1);
    } else S.lastDist = null;
    sound.setLevel(S.paused ? 0 : 0.9);
    sound.update({
      rpm: o.rpm, load: c.throttle, firing: o.firing ? 1 : 0, speed: o.tas, interior: S.view === 'cockpit' ? 1 : 0,
      roll: o.onGround ? o.wheelSpeed : 0, stall: S.view === 'cockpit' ? o.stallWarn : 0, flap: o.flapMoving ? 1 : 0,
      rain: wet * (S.view === 'cockpit' ? 1 : 0.4), starter: c.starter ? 1 : 0, doppler, distance, turb: Math.min(1, air.sigma / 3), scrape: Math.min(1, o.scrape / 10),
    });
  }

  S.fade += ((S.settled || now - S.placedAt > 9000 ? 1 : 0.0) - S.fade) * Math.min(1, dt * 2.5);
  pipeline.render(world, worldCam, near, nearCam, exposure, S.fade, fm.crashed ? 0.7 : 0);
  if (S.mode === 'fly') updateHud(dt);

  // loading bar and a gentle quality governor
  const pend = S.terrain.pending;
  $('load').style.width = pend > 6 ? `${Math.max(8, 100 - pend * 2)}%` : '100%';
  $('load').style.opacity = pend > 6 ? 1 : 0;
  // a hidden or throttled tab ticks at a crawl; that is not a slow GPU, so only
  // steady 11-35 fps counts as struggling
  slowT += dt; frames++;
  if (dt > 0.028 && dt < 0.09) slowFrames++;
  if (slowT > 4) {
    if (!RECORD && frames > 40 && slowFrames > frames * 0.8 && pixelRatio > 0.8) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); resize(); }
    slowT = 0; frames = 0; slowFrames = 0;
  }
}

resize();
loadRunwayData();
loadNavaids().then((raw) => nav.setData(raw)).catch(() => {});
setAircraft(DEFAULT_AIRCRAFT);
setAirport('LSGS');
requestAnimationFrame(tick);
// run frames by hand with a synthetic clock (testing, and timing the GPU honestly)
function advance(seconds, fps = 30) {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) frame(last + 1000 / fps);
  last = performance.now();          // hand the clock back to real time
}
function bench(n = 20) {
  const gl = renderer.getContext(), px = new Uint8Array(4);
  const sync = () => { renderer.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  sync();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { frame(last + 16.7); sync(); }
  return (performance.now() - t0) / n;
}
// One finished frame as a JPEG, with an optional caption set in the page's own type.
const shot = document.createElement('canvas');
function grab(caption = '', sub = '', title = false) {
  const w = canvas.width, h = canvas.height, k = h / 1080;
  shot.width = w; shot.height = h;
  const x = shot.getContext('2d');
  x.drawImage(canvas, 0, 0);
  if (caption || title) {
    const g = x.createLinearGradient(0, h * (title ? 0 : 0.62), 0, h);
    g.addColorStop(0, 'rgba(8,10,13,0)'); g.addColorStop(1, 'rgba(8,10,13,0.62)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = '#f6f4ee'; x.textBaseline = 'alphabetic';
    if (title) {
      x.font = `800 ${300 * k}px "Helvetica Neue", Helvetica, Arial, sans-serif`; x.letterSpacing = `${-19 * k}px`;
      x.fillText(caption.toUpperCase(), 64 * k, 330 * k);
    } else {
      x.font = `800 ${76 * k}px "Helvetica Neue", Helvetica, Arial, sans-serif`; x.letterSpacing = `${-2.6 * k}px`;
      x.fillText(caption, 72 * k, h - (sub ? 128 : 84) * k);
    }
    if (sub) {
      x.font = `600 ${34 * k}px "Helvetica Neue", Helvetica, Arial, sans-serif`; x.letterSpacing = '0px';
      x.fillStyle = title ? '#f6f4ee' : 'rgba(246,244,238,0.78)';
      x.fillText(sub, 76 * k, h - 72 * k);
    }
  }
  return shot.toDataURL('image/jpeg', 0.94);
}
window.sim = { advance, bench, grab, applyTime, RECORD, toast, aircraft, cockpit, sound, fm, ap, systems, coupler, nav, setAircraft, AIRCRAFT, FAILURES, S, air, cam, input, clouds, pipeline, renderer, place, startFlight, setAirport, setWeather };
