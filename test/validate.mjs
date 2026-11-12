// Flies an aircraft headless and compares it with its published handbook
// figures (the `handbook` block of its definition), at maximum weight, sea
// level, standard day, plus handling and wind-tunnel checks that apply to any
// aeroplane.
//   node test/validate.mjs            the default aircraft
//   node test/validate.mjs pa28       one aircraft by id
//   node test/validate.mjs all        every aircraft, summary lines only
//   node test/validate.mjs all --json machine-readable results (for the validation page)
import { FlightModel, Autopilot, KT, FT, D2R, stillAir } from '../js/fdm.js';
import { AIRCRAFT } from '../js/aircraft/index.js';

const DT = 1 / 240;
const clampN = (x, a, b) => Math.max(a, Math.min(b, x));

export function validate(def) {
  const hb = def.handbook || {}, rows = [];
  const row = (name, got, spec, unit) => { if (spec) rows.push({ name, got, want: spec[0], tol: spec[1], unit, ok: Math.abs(got - spec[0]) <= spec[1] }); };
  const check = (name, pass) => rows.push({ name, got: pass ? 1 : 0, want: 1, tol: 0, unit: '', ok: !!pass });
  const powered = !!def.engine, tail = !!def.gear.tailwheel;
  const vs1 = (hb.vs1Kcas ? hb.vs1Kcas[0] : def.limits.vs1), cruiseK = hb.handlingKias || Math.round(vs1 * 1.9);

  const load = (fm) => { fm.fuel = def.mass.fuelMax; fm.payload = def.mass.max - def.mass.empty - def.mass.fuelMax; };
  const make = ({ alt = 300, ias, throttle = 0.7, flaps = 0 } = {}) => {
    const fm = new FlightModel(def, stillAir);
    load(fm);
    fm.reset({ alt, heading: 0, speed: ias * KT, pitch: 0.03, throttle });
    fm.ctl.flaps = flaps; fm.flapPos = flaps;
    const ap = new Autopilot(fm);
    ap.engage('alt');
    return { fm, ap };
  };
  const run = (fm, ap, seconds, each) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) { ap && ap.update(DT); fm.step(DT); if (each && each(i * DT) === false) return false; }
    return true;
  };
  const cas = (fm) => fm.out.tas * Math.sqrt(fm.out.rho / 1.225) / KT;

  // ---- engine on the ground
  if (powered) {
    const fm = new FlightModel(def);
    fm.reset({});
    run(fm, null, 12);
    row('Idle RPM', fm.out.rpm, hb.idleRpm, 'rpm');
    if (tail) fm.ctl.pitch = 1;                                    // a tailwheel pilot runs up with the stick held back
    fm.ctl.throttle = 1;
    run(fm, null, 10);
    row('Static RPM, full throttle, brakes on', fm.out.rpm, hb.staticRpm, 'rpm');
    row('Static thrust', fm.out.thrust, hb.staticThrust, 'N');
    row('Parking brake holds at full power', fm.out.gs, [0, 0.4], 'm/s');
  }

  // ---- stall speeds: low power, bleed speed until the wing lets go
  const stallSpeed = (flaps) => {
    const { fm, ap } = make({ alt: 1000, ias: vs1 * 1.3, throttle: powered ? 0.12 : 0, flaps });
    let v = 0, tgt = vs1 * 1.3;
    if (!powered) ap.engage('ias');
    run(fm, ap, 200, (t) => {
      if (!powered) { tgt -= 0.5 * DT; ap.ias = tgt * KT; }      // a glider bleeds speed with pitch, 1 kt every 2 s
      if (t > 6 && fm.out.stalled > 0.3) { v = cas(fm); return false; }
    });
    return v;
  };
  row('Stall speed, flaps up', stallSpeed(0), hb.vs1Kcas, 'KCAS');
  if (hb.vs0Kcas) row('Stall speed, full flap', stallSpeed(1), hb.vs0Kcas, 'KCAS');

  if (powered) {
    // ---- top speed at sea level
    { const { fm, ap } = make({ alt: 150, ias: cruiseK, throttle: 1 });
      run(fm, ap, 170);
      row('Max level speed, sea level', fm.out.tas / KT, hb.vmaxKtas, 'KTAS');
      row('RPM at max level speed', fm.out.rpm, hb.vmaxRpm, 'rpm');
      row('Brake power at full throttle', fm.out.bhp, hb.bhp, 'hp'); }
    // ---- climb
    if (hb.climb) {
      const { fm, ap } = make({ alt: 150, ias: hb.climb.kias, throttle: 1 });
      ap.engage('ias'); ap.ias = hb.climb.kias * KT;
      run(fm, ap, 45);
      const a0 = fm.out.alt;
      run(fm, ap, 60);
      row(`Rate of climb at ${hb.climb.kias} KIAS`, (fm.out.alt - a0) / FT, hb.climb.fpm, 'ft/min');
      row('Rudder needed in the climb', Math.abs(fm.ctl.yaw) * 100, hb.climb.rudder || [20, 20], '% travel');
    }
    // ---- cruise
    if (hb.cruise) {
      const c = hb.cruise;
      const { fm, ap } = make({ alt: c.altFt * FT, ias: cruiseK, throttle: c.throttle ?? 1 });
      fm.ctl.mixture = c.mixture ?? 1; if (c.prop != null) fm.ctl.prop = c.prop;
      run(fm, ap, 170);
      row(`Cruise at ${c.altFt} ft`, fm.out.tas / KT, c.ktas, 'KTAS');
      row('Fuel flow in that cruise', fm.out.fuelFlow * 3600 / 0.72 / 3.785, c.gph, 'gal/h');
      if (c.rpm) row('RPM in that cruise', fm.out.rpm, c.rpm, 'rpm');
    }
  }
  // ---- glide
  if (hb.glide) {
    const { fm, ap } = make({ alt: 1500, ias: hb.glide.kias, throttle: 0 });
    ap.engage('ias'); ap.ias = hb.glide.kias * KT;
    fm.ctl.mixture = 0;
    run(fm, ap, 40);
    const a0 = fm.out.alt, n0 = fm.pos[0];
    run(fm, ap, 40);
    row(`Glide ratio at ${hb.glide.kias} KIAS${powered ? ', engine out' : ''}`, (fm.pos[0] - n0) / (a0 - fm.out.alt), hb.glide.ratio, ': 1');
    if (hb.glide.sink) row('Sink rate in that glide', (a0 - fm.out.alt) / 40, hb.glide.sink, 'm/s');
  }
  // ---- takeoff
  if (powered && hb.takeoff) {
    const t = hb.takeoff;
    const fm = new FlightModel(def);
    load(fm);
    fm.reset({});
    fm.ctl.park = false; fm.ctl.throttle = 1; fm.ctl.flaps = t.flaps || 0; fm.flapPos = t.flaps || 0;
    let roll = null, maxDev = 0, yawI = 0;
    const climbPitch = (t.pitch ?? 11.5);
    run(fm, null, 70, () => {
      const o = fm.out, h = o.heading > Math.PI ? o.heading - 2 * Math.PI : o.heading;
      yawI += (-h - 0.01 * fm.pos[1]) * DT;
      fm.ctl.yaw = clampN(-7 * h - 1.5 * fm.w[2] - 0.08 * fm.pos[1] + 3 * yawI, -1, 1);
      const k = o.ias / KT;
      if (tail && k < t.rotateKias) fm.ctl.pitch = clampN(4 * (2 * D2R - o.pitch) - 1.0 * fm.w[1], -1, 0.3) * clampN((k - 12) / 10, 0, 1);  // tail up
      else if (k > t.rotateKias) fm.ctl.pitch = clampN(4 * ((climbPitch - 0.5 * Math.max(0, t.rotateKias + 7 - k)) * D2R - o.pitch) - 1.0 * fm.w[1] + 0.1, -1, 1);
      fm.ctl.roll = clampN(-2 * o.roll - 0.5 * fm.w[0], -1, 1);
      if (o.onGround) maxDev = Math.max(maxDev, Math.abs(fm.pos[1]));
      if (roll === null && !o.onGround && o.agl - def.gear.rest > 0.3) roll = fm.pos[0];
      if (o.agl > 15.24 + def.gear.rest) return false;
    });
    row('Takeoff ground roll', (roll ?? 9999) / FT, t.rollFt, 'ft');
    row('Distance to clear 50 ft', fm.pos[0] / FT, t.over50Ft, 'ft');
    row('Stays on the centreline during the roll', maxDev, [0, 6], 'm');
    check('Takeoff without damage', !fm.crashed);
  }

  // ---- wind tunnel: hold the aircraft still in a steady airflow and read the forces
  const tunnel = ({ alphaDeg, agl = 2000 }) => {
    const V = cruiseK * KT * 0.9, fm = new FlightModel(def, { ...stillAir, ground: () => 0 }), a = alphaDeg * D2R;
    const pin = () => { fm.pos[0] = 0; fm.pos[1] = 0; fm.pos[2] = -agl; fm.vel[0] = V; fm.vel[1] = 0; fm.vel[2] = 0; fm.q[0] = Math.cos(a / 2); fm.q[1] = 0; fm.q[2] = Math.sin(a / 2); fm.q[3] = 0; fm.w[0] = fm.w[1] = fm.w[2] = 0; };
    fm.reset({ alt: agl, speed: V, pitch: a, throttle: 0 });
    fm.ctl.mixture = 0;
    for (let i = 0; i < 480; i++) { pin(); fm.step(DT); }
    const o = fm.out, m = o.mass, qS = 0.5 * o.rho * V * V * def.wing.area;
    const X = m * o.ax - o.thrust, Z = m * o.az;
    return { CL: (-Z * Math.cos(a) + X * Math.sin(a)) / qS, CD: (-X * Math.cos(a) - Z * Math.sin(a)) / qS, wing: fm.wing };
  };
  {
    const AR = def.wing.span ** 2 / def.wing.area;
    const p2 = tunnel({ alphaDeg: 1 }), p7 = tunnel({ alphaDeg: 6 });
    const k = (p7.CD - p2.CD) / (p7.CL * p7.CL - p2.CL * p2.CL);
    row('Lift-curve slope, whole aircraft', (p7.CL - p2.CL) / (5 * D2R), hb.clAlpha, '/rad');
    row('Span efficiency (Oswald e)', 1 / (Math.PI * AR * k), hb.oswald, '');
    const hg = def.gear.rest + 0.4, g2 = tunnel({ alphaDeg: 1, agl: hg }), g7 = tunnel({ alphaDeg: 6, agl: hg });
    const kg = (g7.CD - g2.CD) / (g7.CL * g7.CL - g2.CL * g2.CL);
    // height of the lifting line itself, averaged along the span: dihedral lifts most of a low wing well clear of its root
    const zMean = p7.wing.z.reduce((a, z) => a + z, 0) / p7.wing.z.length;
    const hOverB = Math.max(0.05, (hg - zMean) / def.wing.span);
    const sigma = (1 - 1.32 * hOverB) / (1.05 + 7.4 * hOverB);          // Wieselsberger's ground-effect factor
    row('Drag due to lift near the runway, vs free air', kg / k, [1 - sigma, 0.15], 'x');
    check('More lift at the same attitude in ground effect', g7.CL > p7.CL * 1.01);
    const G = p7.wing.gamma, N = G.length;
    row('Circulation at 70 % span, vs the root', G[Math.round(N * 0.85)] / G[N / 2], hb.loading || [0.71, 0.14], 'x');
  }

  // ---- handling: let go and watch
  {
    const { fm, ap } = make({ alt: 1000, ias: cruiseK, throttle: powered ? 0.62 : 0 });
    if (!powered) { ap.engage('ias'); ap.ias = cruiseK * KT; }
    run(fm, ap, 60);
    ap.on = false;
    const trimPitch = fm.ctl.pitch, V = fm.out.tas;
    fm.ctl.roll = 0; fm.ctl.yaw = 0;
    fm.ctl.pitch = trimPitch + 0.2; run(fm, null, 1.5); fm.ctl.pitch = trimPitch;
    const peaks = []; let prev = fm.out.vs, prevD = 0, sum = 0, cnt = 0;
    run(fm, null, 160, (t) => {
      fm.ctl.roll = clampN(-2 * fm.out.roll - 0.5 * fm.w[0], -1, 1);
      const d = fm.out.vs - prev;
      if (prevD > 0 && d <= 0) peaks.push({ t, v: fm.out.vs });
      prevD = d; prev = fm.out.vs; sum += fm.out.vs; cnt++;
    });
    const mean = sum / cnt;                                               // a glider's oscillation rides on its sink rate
    const big = peaks.filter((p) => p.v > mean + 0.05).map((p) => ({ t: p.t, v: p.v - mean }));
    const period = big.length > 2 ? (big[big.length - 1].t - big[0].t) / (big.length - 1) : 0;
    const theory = Math.PI * Math.SQRT2 * V / 9.80665;                   // Lanchester
    row('Phugoid period, hands off', period, [theory * 1.15, theory * 0.35], 's');
    check('Phugoid does not grow', big.length < 3 || big[big.length - 1].v <= big[0].v * 1.05);
  }
  {
    const { fm, ap } = make({ alt: 1000, ias: cruiseK, throttle: powered ? 0.62 : 0 });
    if (!powered) { ap.engage('ias'); ap.ias = cruiseK * KT; }
    run(fm, ap, 50);
    ap.on = false;
    const hold = fm.ctl.yaw;
    fm.ctl.yaw = hold + 0.5; run(fm, null, 1.0); fm.ctl.yaw = hold;
    const amp = []; let prev = fm.w[2], localMax = 0;
    run(fm, null, 12, () => { const r = fm.w[2]; if (prev < 0 && r >= 0) { amp.push(localMax); localMax = 0; } localMax = Math.max(localMax, Math.abs(r)); prev = r; });
    check('Dutch roll dies out', amp.length < 3 || amp[2] < amp[1] * 0.85);
  }
  {
    const { fm, ap } = make({ alt: 1000, ias: cruiseK, throttle: powered ? 0.62 : 0 });
    if (!powered) { ap.engage('ias'); ap.ias = cruiseK * KT; }
    run(fm, ap, 40);
    ap.on = false;
    fm.ctl.roll = 1;
    run(fm, null, 1.2);
    row(`Roll rate, full aileron, ${cruiseK} KIAS`, fm.w[0] / D2R, hb.rollRate, 'deg/s');
  }
  // ---- a stall should break, and letting go should recover it
  {
    const { fm, ap } = make({ alt: 1500, ias: vs1 * 1.2, throttle: powered ? 0.1 : 0 });
    ap.on = false;
    let stick0 = 0.05;
    // a glider has no power setting to hold it near the stall: start it from a trimmed glide, or the entry is a dive and a zoom
    if (!powered) { ap.engage('ias'); ap.ias = vs1 * 1.2 * KT; run(fm, ap, 20); ap.on = false; stick0 = fm.ctl.pitch; fm.ctl.roll = 0; }
    let alphaBreak = 0, broke = false, tBreak = 0, recovered = 0;
    run(fm, null, 45, (t) => {
      const o = fm.out;
      if (!broke) {
        fm.ctl.pitch = Math.min(1, stick0 + t / 14);
        fm.ctl.yaw = clampN(3 * o.beta, -1, 1);
        if (t > 5 && o.stalled > 0.3 && o.vs < -2) { broke = true; tBreak = t; alphaBreak = o.alpha; }
      } else {
        fm.ctl.pitch = 0; fm.ctl.yaw = 0;
        if (!recovered && o.alpha < 8 * D2R && o.stalled < 0.05 && t > tBreak + 0.3) { recovered = t - tBreak; return false; }
      }
    });
    row('Stall angle of attack', alphaBreak / D2R, hb.stallAlpha || [16.5, 5], 'deg');
    row('Recovers after releasing the stick', recovered || 99, [1.5, 2.5], 's');
  }
  // ---- landing: fly the approach speed, flare, stop
  if (hb.landing) {
    const L = hb.landing, fm = new FlightModel(def);
    // optional, for aircraft the standard approach does not suit: L.throttle (approach power, default 0.2), L.approachPitch
    // (the attitude that holds L.kias, default -3.5 deg; the flare then starts from it), L.holdAttitude (keep flying the attitude
    // after touchdown, not full back stick)
    fm.reset({ alt: 30 + def.gear.rest, speed: L.kias * KT, pitch: -0.03, throttle: powered ? (L.throttle ?? 0.2) : 0 });
    const fl = L.flaps ?? 1; fm.ctl.flaps = fl; fm.flapPos = fl;
    if (!powered) fm.ctl.spoiler = 0.5;
    const flareTo = tail ? def.gear.restPitch / D2R - 1 : (L.flarePitch ?? 9);
    let td = null, tdVs = 0, elevI = 0;
    run(fm, null, 110, () => {
      const o = fm.out, h = o.agl - def.gear.rest, flare = h < 5.5;
      const target = flare ? Math.min(flareTo, Math.max(1.5, (L.approachPitch ?? -3.5) + 1) + (5.5 - h) * 1.6) * D2R : ((L.approachPitch ?? -3.5) + 0.6 * (o.ias / KT - L.kias)) * D2R;
      if (flare) fm.ctl.throttle = 0;
      elevI = clampN(elevI + 1.5 * (target - o.pitch) * DT, -0.5, 0.8);
      if (td === null || L.holdAttitude) fm.ctl.pitch = clampN(5 * (target - o.pitch) - 1.2 * fm.w[1] + elevI, -1, 1);
      fm.ctl.roll = clampN(-2 * o.roll - 0.5 * fm.w[0], -1, 1);
      const hd = o.heading > Math.PI ? o.heading - 2 * Math.PI : o.heading;
      fm.ctl.yaw = clampN(-5 * hd - 1.5 * fm.w[2], -1, 1);
      if (td === null && o.onGround) { td = fm.pos[0]; tdVs = o.touchdownVs; }
      if (td !== null) { fm.ctl.brakeL = fm.ctl.brakeR = 0.8; if (!L.holdAttitude) fm.ctl.pitch = tail ? 0.8 : 0.1; if (!powered) fm.ctl.spoiler = 1; if (o.gs < 0.5) return false; }
    });
    row('Touchdown sink rate (scripted flare)', tdVs / FT * 60, [150, 250], 'ft/min');
    row('Landing ground roll', (fm.pos[0] - (td ?? 0)) / FT, L.rollFt, 'ft');
    check('Survives the landing', !fm.crashed && td !== null);
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('validate.mjs')) {
  const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'c172s', json = process.argv.includes('--json');
  // a path to a definition file works too, for one that is not registered yet
  const list = arg === 'all' ? Object.values(AIRCRAFT) : arg.endsWith('.js') ? [(await import(new URL(arg, `file://${process.cwd()}/`))).default] : [AIRCRAFT[arg]];
  if (!list[0]) { console.error(`Unknown aircraft "${arg}". Known: ${Object.keys(AIRCRAFT).join(', ')}`); process.exit(1); }
  const pad = (s, n) => String(s).padEnd(n);
  const out = {};
  for (const def of list) {
    const rows = validate(def), bad = rows.filter((r) => !r.ok).length;
    out[def.id] = { name: def.name, source: def.handbook && def.handbook.source, rows };
    if (json) continue;
    if (arg === 'all') { console.log(`${bad ? ' MISS ' : '  ok  '}${pad(def.name, 26)}${rows.length - bad}/${rows.length}${bad ? '   ' + rows.filter((r) => !r.ok).map((r) => `${r.name}: ${r.got.toFixed(1)} vs ${r.want}`).join('; ') : ''}`); continue; }
    console.log(`\n${def.name}  (${def.handbook ? def.handbook.source : 'no handbook data'})\n` + pad('', 50) + pad('model', 10) + 'published');
    for (const r of rows) console.log(`${r.ok ? '  ok  ' : ' MISS '}${pad(r.name, 44)}${pad(r.got.toFixed(Math.abs(r.got) > 20 ? 0 : 2), 10)}${pad(typeof r.want === 'number' ? +r.want.toFixed(2) : r.want, 8)}${r.unit}`);
    console.log(`\n${rows.length - bad}/${rows.length} within tolerance\n`);
  }
  if (json) console.log(JSON.stringify(out));
}
