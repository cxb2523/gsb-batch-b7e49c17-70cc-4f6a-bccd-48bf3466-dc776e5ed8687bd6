// Frame-exact capture of the simulator for video. Headless Chrome is driven
// over the DevTools protocol; the page runs in ?record mode, where every
// frame is stepped by hand on a fixed 30 fps clock and read back as a JPEG,
// so nothing depends on real time. Needs the site served on :8906 (npm start).
//
//   node tools/record.mjs <outDir> [shot ...]      all shots, or only the named ones
//   node tools/record.mjs <outDir> --probe         one frame, to check the GPU path
//
// Writes <outDir>/<shot>/f0000.jpg ...; tools/cut.sh joins them.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [outDir, ...only] = process.argv.slice(2);
if (!outDir) { console.error('usage: node tools/record.mjs <outDir> [shot ...]'); process.exit(1); }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAP = !process.env.NOCAPTION;       // NOCAPTION=1 for clean stills, NOBLUR=1 for a quick look

// ---- helpers that live in the page
const PAGE = `
window.R = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  // let the scenery stream in: step a little, wait a little
  async settle(max = 40) {
    for (let k = 0; k < max * 4; k++) { sim.advance(0.1, 30); await R.sleep(220); if (sim.S.settled && sim.S.terrain.pending < 3) break; }
  },
  async pre(seconds) { for (let t = 0; t < seconds; t += 1.5) { sim.advance(Math.min(1.5, seconds - t), 30); await R.sleep(120); } },
  click: (seg, v) => document.querySelector('#' + seg + ' [data-v=' + v + ']').click(),
  async go({ plane = 'c172s', airport = null, time = 'noon', wx = 'fair', start = 'air' }) {
    if (airport && sim.S.airport.id !== airport) { await sim.setAirport(airport); }
    R.click('timeSeg', time); R.click('wxSeg', wx); await R.sleep(300);
    R.click('startSeg', start);
    if (sim.S.aircraftId !== plane) sim.setAircraft(plane);
    if (sim.S.mode !== 'fly') await sim.startFlight(); else sim.place();
    sim.input.apply = R.manual; R.fly = null; R.T = null;
    sim.input.look.yaw = 0; sim.input.look.pitch = 0; sim.input.zoom = 0;
    await R.settle();
    sim.place();
    await R.sleep(200);
  },
  cl: (x, a, b) => Math.max(a, Math.min(b, x)),
  // scripted hands: R.fly(dt) is called every frame in place of the keyboard
  hands(fn) { R.fly = fn; sim.input.apply = (dt) => { if (R.fly) R.fly(dt, sim.fm, sim.fm.out, sim.fm.ctl); }; },
  level(dt, fm, o, c, bank = 0, pitchT = null) {
    c.roll = R.cl(2.2 * (bank - o.roll) - 0.5 * fm.w[0], -1, 1);
    c.yaw = R.cl(2.2 * o.beta, -1, 1);
    if (pitchT !== null) c.pitch = R.cl(4 * (pitchT - o.pitch) - fm.w[1] + 0.1, -1, 1);
  },
};
R.manual = sim.input.apply.bind(sim.input);
'ok'`;

// ---- the shots. setup runs once; each runs before every frame with i (frame) and n (frames).
const SHOTS = [
  {
    // A low pass down the runway filmed from the grass beside it: pull up, one aileron roll, level off.
    // The camera stands still, pans a touch late like a hand would, and never zooms.
    name: '01-extra-roll', frames: 84, blur: 8, caption: 'Lifting-line wing. 40 strips.', sub: 'Every strip flies in the downwash of the others, 240 times a second',
    setup: `await R.go({ plane: 'extra300', airport: 'LSGS', time: 'noon', wx: 'fair', start: 'air' });
      const dep = sim.S.dep, ux = Math.sin(dep.heading), uy = Math.cos(dep.heading), fm = sim.fm;
      const T = R.T = { t: -0.2, phi: 0, go: false, done: false, log: [], alt: dep.elev + 13 };
      fm.reset({ n: dep.n - uy * 700, e: dep.e - ux * 700, alt: T.alt + 4, heading: dep.heading, speed: 84, pitch: 0.01, throttle: 1 });
      sim.ap.on = false; sim.input.bias = 0;
      const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
      const sm = (x) => { x = R.cl(x, 0, 1); return x * x * (3 - 2 * x); };
      R.hands((dt, fm, o, c) => {
        c.throttle = 1;
        const px = fm.pos[1] - dep.e, py = fm.pos[0] - dep.n, xt = px * uy - py * ux;
        const bank = R.cl(1.3 * (wrap(dep.heading - o.track) - R.cl(xt * 0.004, -0.12, 0.12)), -0.3, 0.3);
        const hold = R.cl(0.012 * (T.alt - o.alt) - 0.004 * o.vs + 0.012, -0.08, 0.14);
        if (T.go) T.t += dt;
        const t = T.t;
        if (t < 0.5 || T.done) {                                   // run in, then ease the nose up
          const up = T.done ? 0.03 + 0.05 * Math.exp(-(t - T.tEnd) * 2) * 0 : hold + (0.34 - hold) * sm(t / 0.4);
          R.level(dt, fm, o, c, T.done ? 0 : bank, T.done ? R.cl(0.012 * (T.alt + 12 - o.alt) - 0.004 * o.vs + 0.03, -0.06, 0.12) : up);
        } else {                                                     // unload, full stick, let the nose fall through
          T.phi += fm.w[0] * dt;
          c.roll = -sm((t - 0.5) / 0.14); c.yaw = 0; c.pitch = T.push;
          if (Math.abs(T.phi) > 2 * Math.PI - T.lead) { T.done = true; T.tEnd = t; }
        }
        if (T.cam) {                                                 // the operator: a still tripod, the pan trails the aircraft a little
          const k = 1 - Math.exp(-dt / 0.05), A = T.aim, u = -fm.pos[2];
          A[0] += (fm.pos[1] - A[0]) * k; A[1] += (u - A[1]) * k; A[2] += (fm.pos[0] - A[2]) * k;
          sim.S.view = 'flyby';
          sim.S.flyby = { e: T.cam[0], n: T.cam[1], u: T.cam[2], passed: false, d: 1e9, fov: T.fov, aim: [A[0] - fm.pos[1], A[1] - u, -(A[2] - fm.pos[0])] };
        }
      });
      T.push = 0.02; T.lead = 0.42; T.fov = 14.5;
      // the tripod: 700 m down the runway, 58 m to the left of the centreline, eye height
      const camS = 700, ce = dep.e + ux * camS - uy * 58, cn = dep.n + uy * camS + ux * 58;
      T.cam = [ce, cn, sim.S.terrain.heightAt(ce, cn) + 1.7]; T.aim = [fm.pos[1], -fm.pos[2], fm.pos[0]];
      let guard = 0;
      while ((fm.pos[1] - dep.e) * ux + (fm.pos[0] - dep.n) * uy < camS - 123 && guard++ < 4000) {
        sim.advance(1 / 30, 30); T.cam[2] = sim.S.terrain.heightAt(ce, cn) + 1.7; if (guard % 30 === 0) await R.sleep(150);
      }`,
    each: `R.T.go = true; if (i % 4 === 0) R.T.log.push([i, Math.round(sim.fm.out.roll * 57.3), Math.round(sim.fm.out.pitch * 57.3), Math.round(sim.fm.out.agl), Math.round(sim.fm.out.ias / 0.5144)]);`,
  },
  {
    name: '02-cub-takeoff', frames: 75, caption: 'Blade-element propeller', sub: 'Thrust, torque and P-factor come from the blades. The Cub swings like a Cub',
    setup: `await R.go({ plane: 'j3', airport: 'LSGS', time: 'noon', wx: 'fair', start: 'runway' });
      const dep = sim.S.dep; let yawI = 0; sim.fm.ctl.park = false;
      R.hands((dt, fm, o, c) => { c.throttle = 1; let h = dep.heading - o.heading; while (h > Math.PI) h -= 2 * Math.PI; while (h < -Math.PI) h += 2 * Math.PI; const k = o.ias / 0.5144; yawI += h * dt;
        if (o.onGround) { c.yaw = R.cl(7 * h - 1.5 * fm.w[2] + 3 * yawI, -1, 1); c.roll = 0; c.pitch = k < 38 ? R.cl(4 * (0.035 - o.pitch) - fm.w[1], -1, 0.3) * R.cl((k - 12) / 10, 0, 1) : R.cl(4 * (0.14 - o.pitch) - fm.w[1] + 0.1, -1, 1); }
        else { c.yaw = R.cl(2.2 * o.beta, -1, 1); c.roll = R.cl(2.2 * (R.cl(1.3 * h, -0.3, 0.3) - o.roll) - 0.5 * fm.w[0], -1, 1); c.pitch = R.cl(4 * (0.14 - o.pitch) - fm.w[1] + 0.1, -1, 1); } });
      sim.S.view = 'chase'; sim.input.look.yaw = 2.5; sim.input.look.pitch = 0.16; sim.input.zoom = -0.7; await R.pre(11.3);`,
    each: `sim.input.look.yaw = 2.5 - i * 0.011;`,
  },
  {
    name: '03-sr22-bay', frames: 75, caption: 'The whole planet, streamed', sub: 'Real elevation, satellite imagery, water, buildings. Any airport by ICAO code',
    setup: `await R.go({ plane: 'sr22', airport: 'KSFO', time: 'noon', wx: 'clear', start: 'air' });
      { const p = sim.S.geo.toLocal(37.7745, -122.3640), fm = sim.fm; fm.pos[0] = p.n; fm.pos[1] = p.e; fm.pos[2] = -430; }
      sim.ap.engage('alt'); sim.ap.alt = 430; sim.ap.heading = 306 * Math.PI / 180;
      sim.S.view = 'chase'; sim.input.look.yaw = 0.42; sim.input.look.pitch = -0.02; sim.input.zoom = -0.35;
      await R.pre(8); await R.settle(25); for (let k = 0; k < 14; k++) { sim.advance(0.1, 30); await R.sleep(700); } await R.pre(9);
      for (let k = 0; k < 8; k++) { sim.advance(0.1, 30); await R.sleep(600); }`,
    each: `sim.input.look.yaw = 0.42 - i * 0.004;`,
  },
  {
    name: '04-glider-ridge', frames: 75, caption: '9 aircraft, from published data', sub: 'Each one flown against its own handbook: 213 of 223 checks inside tolerance',
    setup: `await R.go({ plane: 'ask21', airport: 'LSGS', time: 'noon', wx: 'fair', start: 'air' });
      sim.ap.engage('ias'); sim.ap.ias = 30; sim.ap.lateral = 'hdg'; await R.pre(30);
      sim.S.view = 'chase'; sim.input.look.yaw = 0.75; sim.input.look.pitch = -0.2; sim.input.zoom = 0.1; await R.settle(6);`,
    each: `sim.ap.heading = sim.ap.heading + 0.004; sim.input.look.yaw = 0.75 - i * 0.004;`,
  },
  {
    name: '05-storm-cockpit', frames: 66, caption: 'Live weather. Real cloud.', sub: 'Winds aloft, turbulence, rain. Fly into freezing cloud and ice builds on the wing',
    setup: `await R.go({ plane: 'c172s', airport: 'LSGS', time: 'noon', wx: 'storm', start: 'air' });
      { const fm = sim.fm, dep = sim.S.dep, ux = Math.sin(dep.heading), uy = Math.cos(dep.heading), alt = sim.S.weather.clouds.low.base - 26; fm.pos[0] = dep.n - uy * 5200; fm.pos[1] = dep.e - ux * 5200; fm.pos[2] = -alt; sim.ap.engage('alt'); sim.ap.alt = alt; sim.ap.heading = dep.heading; }
      await R.pre(9); sim.S.view = 'cockpit'; sim.input.look.pitch = 0.05; sim.input.zoom = -0.1; await R.pre(1); await R.settle(6);`,
    each: `sim.input.look.yaw = Math.sin(i * 0.05) * 0.06;`,
  },
  {
    name: '06-night-ils', frames: 78, caption: 'Coupled ILS, at night', sub: 'Real VOR, DME and NDB stations. Gyros that drift, a compass with turning errors',
    setup: `await R.go({ plane: 'c172s', airport: 'LSGS', time: 'night', wx: 'clear', start: 'final' });
      { const fm = sim.fm, dep = sim.S.dep, ux = Math.sin(dep.heading), uy = Math.cos(dep.heading), d = 2300;
        fm.pos[0] = dep.n - uy * d; fm.pos[1] = dep.e - ux * d; fm.pos[2] = -(dep.elev + (d + 300) * Math.tan(3 * Math.PI / 180));
        sim.coupler.toggle('apr'); let thrI = fm.ctl.throttle; const vT = 66 * 0.5144;
        R.hands((dt, fm, o, c) => { const e = vT - o.ias; thrI = R.cl(thrI + 0.02 * e * dt, 0.03, 1); c.throttle = R.cl(thrI + 0.06 * e, 0.03, 1); }); }
      await R.pre(22); sim.S.view = 'cockpit'; sim.input.look.pitch = 0.02; sim.input.zoom = -0.12; await R.settle(5);`,
    each: ``,
  },
  {
    name: '07-touchdown', frames: 96, caption: 'Ground effect is a mirror vortex', sub: 'Not a fudge factor: the float before touchdown comes out of the solve',
    setup: `await R.go({ plane: 'c172s', airport: 'KSFO', time: 'dusk', wx: 'clear', start: 'final' });
      { const fm = sim.fm, dep = sim.S.dep, ux = Math.sin(dep.heading), uy = Math.cos(dep.heading), d = 560;
        fm.pos[0] = dep.n - uy * d; fm.pos[1] = dep.e - ux * d; fm.pos[2] = -(dep.elev + (d + 150) * Math.tan(3 * Math.PI / 180) + 1.2);
        let ei = 0, td = false;
        R.hands((dt, fm, o, c) => { const de = fm.pos[1] - dep.e, dn = fm.pos[0] - dep.n, along = de * ux + dn * uy, cross = de * uy - dn * ux;
          let h = dep.heading - R.cl(cross * 0.006, -0.4, 0.4) - o.heading; while (h > Math.PI) h -= 2 * Math.PI; while (h < -Math.PI) h += 2 * Math.PI;
          if (!o.onGround) { c.roll = R.cl(2.2 * (R.cl(1.3 * h, -0.4, 0.4) - o.roll) - 0.5 * fm.w[0], -1, 1); c.yaw = R.cl(2.2 * o.beta, -1, 1); } else { c.roll = 0; c.yaw = R.cl(5 * h - 1.5 * fm.w[2], -1, 1); td = true; }
          const path = dep.elev + Math.max(0, -along + 150) * Math.tan(3 * Math.PI / 180) + 1.2, flare = o.agl < 6;
          if (td) { c.throttle = 0; c.pitch = 0.15; c.brakeL = c.brakeR = o.gs < 30 ? 0.5 : 0.15; }
          else if (flare) { c.throttle = 0; const t = Math.min(8.5, 1.5 + (6 - o.agl) * 1.5) * Math.PI / 180; ei = R.cl(ei + 1.5 * (t - o.pitch) * dt, -0.4, 0.8); c.pitch = R.cl(5 * (t - o.pitch) - 1.2 * fm.w[1] + ei, -1, 1); }
          else { const vs = R.cl(-2 + 0.12 * (path - o.alt), -4.5, 1), t = (0.6 + 2.2 * (vs + 2)) * Math.PI / 180; c.pitch = R.cl(4 * (t - o.pitch) - fm.w[1], -1, 1); c.throttle = R.cl(0.15 + 0.05 * (33 - o.ias), 0, 0.6); } }); }
      sim.S.view = 'chase'; sim.input.look.yaw = 2.2; sim.input.look.pitch = 0.17; sim.input.zoom = -0.75; await R.pre(9); await R.settle(5);
      for (let k = 0; k < 60 && sim.fm.out.agl > 3.4; k++) sim.advance(0.25, 30);`,
    each: `sim.input.look.yaw = 2.2 - i * 0.006;`,
  },
  {
    // a takeoff roll in rain, from the left seat: beads on the windscreen until the air is fast enough to push them
    name: '10-wet-takeoff', frames: 96, caption: 'Live weather. Real cloud.', sub: 'Winds aloft, turbulence, rain on the glass. Fly into freezing cloud and ice builds on the wing',
    setup: `await R.go({ plane: 'c172s', airport: 'LSGS', time: 'noon', wx: 'storm', start: 'runway' });
      const dep = sim.S.dep; let yawI = 0, go = false;
      R.hands((dt, fm, o, c) => { let h = dep.heading - o.heading; while (h > Math.PI) h -= 2 * Math.PI; while (h < -Math.PI) h += 2 * Math.PI; yawI += h * dt;
        c.throttle = go ? 1 : 0; c.roll = 0; c.pitch = 0; c.yaw = R.cl(7 * h - 1.5 * fm.w[2] + 3 * yawI, -1, 1); fm.ctl.park = !go; });
      sim.S.view = 'cockpit'; sim.input.look.pitch = 0.04; sim.input.zoom = -0.1;
      await R.pre(24); go = true;
      for (let k = 0; k < 400 && sim.fm.out.ias < 10.5; k++) sim.advance(1 / 30, 30);
      await R.settle(3);`,
    each: ``,
  },
  {
    name: '08-title', frames: 54, caption: 'Cayley', sub: 'A flight simulator in a browser tab. Built overnight with Fable 5.2', title: true,
    setup: `await R.go({ plane: 'dr400', airport: 'LSGS', time: 'dusk', wx: 'fair', start: 'air' });
      sim.ap.engage('alt'); await R.pre(8); sim.S.view = 'chase'; sim.input.look.yaw = 2.6; sim.input.look.pitch = -0.02; sim.input.zoom = -0.2; await R.settle(5);`,
    each: `sim.input.look.yaw = 2.6 + i * 0.005;`,
  },
];

mkdirSync(outDir, { recursive: true });
const prof = mkdtempSync(join(tmpdir(), 'cayley-rec-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--mute-audio',
  `--user-data-dir=${prof}`, '--remote-debugging-port=0', '--window-size=1920,1080', '--force-device-scale-factor=1',
  '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
const hardStop = setTimeout(() => { console.error('timeout'); cleanup(); process.exit(2); }, 45 * 60 * 1000);

try {
  let port;
  for (let i = 0; i < 100 && !port; i++) { const f = join(prof, 'DevToolsActivePort'); if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0].trim(); else await sleep(100); }
  if (!port) throw new Error('chrome did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails).slice(0, 600));
    return r.result.result.value;
  };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8906/?record' });
  for (let i = 0; i < 100; i++) { await sleep(300); if (await ev('!!(window.sim && sim.S.airport && sim.S.weather && sim.S.terrain)').catch(() => false)) break; }
  await ev(PAGE);
  const info = await ev(`(() => { const gl = sim.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return { gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', size: [sim.renderer.domElement.width, sim.renderer.domElement.height] }; })()`);
  console.log('renderer', JSON.stringify(info));
  const save = (dir, i, dataUrl) => writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'));

  if (only[0] === '--probe') {
    await ev(`(async () => { R.click('timeSeg', 'noon'); await R.settle(30); })()`);
    save(outDir, 0, await ev(`(() => { sim.advance(1 / 30, 30); return sim.grab('Probe', 'Headless frame'); })()`));
    console.log('probe frame written');
  } else {
    for (const shot of SHOTS) {
      if (only.length && !only.some((o) => shot.name.includes(o))) continue;
      const dir = join(outDir, shot.name);
      mkdirSync(dir, { recursive: true });
      const t0 = Date.now();
      await ev(`(async () => { ${shot.setup} })()`);
      // blur: N renders N sub-frames for every frame and blends most of them, a 270 degree shutter
      const B = shot.blur && !process.env.NOBLUR ? shot.blur : 1, sub = dir + '.sub';
      if (B > 1) { rmSync(sub, { recursive: true, force: true }); mkdirSync(sub, { recursive: true }); }
      for (let i = 0; i < shot.frames; i++) {
        for (let k = 0; k < B; k++) {
          const url = await ev(`(async () => { const i = ${i}, n = ${shot.frames}; ${k === 0 ? shot.each || '' : ''}; sim.advance(1 / ${30 * B}, ${30 * B}); return sim.grab(${JSON.stringify(CAP ? shot.caption : '')}, ${JSON.stringify(CAP ? shot.sub || '' : '')}, ${!!shot.title}); })()`);
          if (B > 1) writeFileSync(join(sub, `s${String(i * B + k).padStart(5, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64')); else save(dir, i, url);
        }
        if (i % 6 === 5) await sleep(60);       // wall-clock time for tiles to arrive
      }
      if (B > 1) {
        const mix = Math.max(2, Math.round(B * 0.75));
        const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(30 * B), '-start_number', '0', '-i', join(sub, 's%05d.jpg'),
          '-vf', `tmix=frames=${mix},select='eq(mod(n\\,${B})\\,${B - 1})'`, '-fps_mode', 'passthrough', '-q:v', '2', '-start_number', '0', join(dir, 'f%04d.jpg')], { encoding: 'utf8' });
        if (r.status !== 0) throw new Error('blend failed: ' + r.stderr);
        rmSync(sub, { recursive: true, force: true });
      }
      const st = await ev(`JSON.stringify({ plane: sim.S.aircraftId, ias: Math.round(sim.fm.out.ias / 0.5144), agl: Math.round(sim.fm.out.agl), crashed: sim.fm.crashed, pending: sim.S.terrain.pending, log: window.R && R.T && R.T.log ? R.T.log.join(' | ') : undefined })`);
      console.log(`${shot.name}: ${shot.frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s  ${st}`);
    }
  }
} catch (err) { console.error('record failed:', err.message); process.exitCode = 1; } finally { clearTimeout(hardStop); cleanup(); }
