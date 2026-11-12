// Checks the aircraft systems against what a pilot is taught to expect.
//   node test/systems.mjs
import { FlightModel, Autopilot, KT, D2R, stillAir } from '../js/fdm.js';
import { Systems } from '../js/systems.js';

const DT = 1 / 240, rows = [];
const row = (name, got, want, unit, tol) => rows.push({ name, got, want, unit, ok: Math.abs(got - want) <= tol });
const check = (name, pass, note = '') => rows.push({ name, got: pass ? 1 : 0, want: 1, unit: note, ok: !!pass });
const clear = { oat: 15, lwc: 0, precip: 0, humidity: 0.5, lat: 46, variation: 0 };
const deg = (a) => ((a / D2R) % 360 + 360) % 360;
const dAng = (a, b) => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };

function flying({ ias = 95, alt = 1500, heading = 0, throttle = 0.65 } = {}) {
  const fm = new FlightModel(stillAir);
  fm.reset({ alt, heading: heading * D2R, speed: ias * KT, pitch: 0.03, throttle });
  const sys = new Systems(fm), ap = new Autopilot(fm);
  ap.engage('alt');
  const run = (sec, wx = clear, each) => { for (let i = 0; i < sec / DT; i++) { ap.update(DT); fm.step(DT); sys.update(DT, wx); if (each && each(i * DT) === false) break; } };
  return { fm, sys, ap, run };
}

// Ice builds in cloud and melts in warm air, and the airframe pays for it.
{
  const { fm, sys, run } = flying({ ias: 100 });
  run(40);
  fm.ctl.throttle = 0.8; run(60);
  const v0 = fm.out.ias / KT;
  run(480, { ...clear, oat: -7, lwc: 1 });
  check('Ice builds in freezing cloud', sys.ice > 0.8, `ice ${sys.ice.toFixed(2)} after 8 min`);
  row('Speed lost to severe ice at the same power', v0 - fm.out.ias / KT, 24, 'kt', 14);
  check('Still holding altitude at 80 % power with a full load of ice', fm.out.alt > 1450);
  run(900, { ...clear, oat: 12, lwc: 0 });
  check('Ice melts in warm air', sys.ice < 0.05, `ice ${sys.ice.toFixed(2)} after 15 min at +12 C`);
}
{
  // stall speed with a full load of ice, measured the same way as the handbook check
  const stall = (ice) => { const { fm, sys, run } = flying({ ias: 70, alt: 1000, throttle: 0.12 }); let v = 0; fm.fx.ice = ice;
    run(200, clear, (t) => { fm.fx.ice = ice; if (t > 6 && fm.out.stalled > 0.3) { v = fm.out.tas / KT; return false; } }); return v; };
  const clean = stall(0), iced = stall(1);
  row('Stall speed rise with severe ice', iced - clean, 9, 'kt', 5);
}
// ---- icing and pitot: the causal chain a pilot can see, fly and act on
// Clean air, no ice, no blockage: the panel agrees with the truth and the horn is silent.
{
  const { fm, sys, run } = flying();
  run(60);
  check('No ice: the airspeed indicator reads the true airspeed', Math.abs(sys.ind.ias - fm.out.ias) < 1, `${(sys.ind.ias / KT).toFixed(1)} kt indicated, ${(fm.out.ias / KT).toFixed(1)} true`);
  check('No ice: the stall horn is silent', fm.out.stallWarn === 0);
  check('No ice: the horn speed is the handbook stall-warning speed', fm.out.stallWarnIas / KT > 45 && fm.out.stallWarnIas / KT < 60, `${(fm.out.stallWarnIas / KT).toFixed(1)} kt`);
  check('No ice: the pitot is clear and unheated', sys.ind.pitotBlock === 0 && !sys.ind.pitotHeated);
}
// Ice monotonically lowers maximum lift, adds drag and weight, and the horn warns earlier.
{
  const warnOf = (ice) => {
    const { fm, sys, run } = flying({ ias: 80, alt: 1000, throttle: 0.6 });
    fm.setIcing(ice); sys.setIce(ice);
    run(30);
    return fm.out.stallWarnIas / KT;
  };
  const levels = [0, 0.25, 0.5, 0.75, 1], v = levels.map(warnOf);
  const rising = v.every((x, i) => i === 0 || x > v[i - 1] + 0.3);
  check('Stall-warning speed rises monotonically as ice builds', rising, levels.map((l, i) => `${l}: ${v[i].toFixed(1)}`).join(', '));
  row('Warning speed rise from clean to full ice', v[4] - v[0], 8, 'kt', 4);
  const massOf = (ice) => { const { fm, sys, run } = flying({ alt: 1000 }); fm.setIcing(ice); sys.setIce(ice); run(2); return fm.out.mass; };
  const m = levels.map(massOf);
  check('Ice adds weight monotonically', m.every((x, i) => i === 0 || x > m[i - 1]), levels.map((l, i) => `${m[i].toFixed(0)} kg`).join(', '));
  // in a glide at a held airspeed, the sink rate grows with ice: more drag and more weight
  const sinkOf = (ice) => {
    const fm = new FlightModel(stillAir); fm.fuel = 0.5;
    fm.reset({ alt: 1500, heading: 0, speed: 80 * KT, pitch: 0.02, throttle: 0 });
    fm.fx.ice = ice;
    const ap = new Autopilot(fm); ap.engage('ias'); ap.ias = 80 * KT;
    const run = (s) => { for (let i = 0; i < s / DT; i++) { fm.fx.ice = ice; ap.update(DT); fm.step(DT); } };
    run(30); const a0 = fm.out.alt; run(60); return (a0 - fm.out.alt) / 60;
  };
  const sk = levels.map(sinkOf);
  check('Ice adds drag monotonically (sink rate in a glide)', sk.every((x, i) => i === 0 || x > sk[i - 1] + 0.1), levels.map((l, i) => `${sk[i].toFixed(1)} m/s`).join(', '));
  row('Sink rate rise from clean to full ice at 80 KIAS', sk[4] - sk[0], 1.8, 'm/s', 0.8);
  // the horn is heard in level flight at a higher airspeed the more ice is aboard
  const hornAt = (ice) => {
    const { fm, sys, run } = flying({ ias: 65, alt: 1000, throttle: 0.25 });
    fm.setIcing(ice); sys.setIce(ice);
    let onset = null;
    run(150, clear, () => {
      fm.setIcing(ice); sys.setIce(ice);
      if (onset === null && fm.out.stallWarn > 0.3) onset = fm.out.ias / KT;
    });
    return onset;
  };
  const h0 = hornAt(0), h1 = hornAt(1);
  check('With full ice the horn comes on at a higher airspeed', h1 !== null && h0 !== null && h1 > h0 + 3, `clean ${h0 && h0.toFixed(1)}, iced ${h1 && h1.toFixed(1)} kt`);
}
// Pitot ice: unheated, the gauge falls away from the truth; sealed, it behaves like an altimeter.
{
  // hold the speed with pitch (the autopilot's 'ias' mode), so the aircraft neither
  // climbs away nor stalls while the pitot freezes
  const fm = new FlightModel(stillAir);
  fm.reset({ alt: 1500, heading: 0, speed: 95 * KT, pitch: 0.04, throttle: 0.7 });
  const sys = new Systems(fm), ap = new Autopilot(fm);
  ap.engage('ias'); ap.ias = 95 * KT;
  const run = (sec, each) => { for (let i = 0; i < sec / DT; i++) { ap.update(DT); fm.step(DT); sys.update(DT, clear); if (each && each(i * DT) === false) break; } };
  run(60);
  check('Clean pitot: gauge and truth agree', Math.abs(sys.ind.ias - fm.out.ias) < 1, `${(sys.ind.ias / KT).toFixed(1)} kt`);
  sys.setPitotBlock(0.6); run(1);
  row('Pitot ice: gauge reads low while the ice builds', (fm.out.ias - sys.ind.ias) / KT, 12, 'kt', 6);
  sys.setPitotBlock(1); run(1);
  const blocked0 = sys.ind.ias / KT, true0 = fm.out.ias / KT, alt0 = fm.out.alt, p0 = fm.out.staticP;
  // now climb steadily at 2.5 m/s with the power fixed: the aircraft really slows as it climbs
  ap.on = false; const vp = new Autopilot(fm); vp.engage('vs'); vp.vs = 2.5; fm.ctl.throttle = 0.7;
  for (let i = 0; i < 80 / DT; i++) { vp.update(DT); fm.step(DT); sys.update(DT, clear); }
  check('Sealed pitot: indicated airspeed climbs with the altimeter', sys.ind.ias / KT > blocked0 + 25, `${blocked0.toFixed(1)} -> ${(sys.ind.ias / KT).toFixed(1)} kt`);
  check('Sealed pitot: true airspeed falls in the same climb', fm.out.ias / KT < true0 - 15, `${true0.toFixed(1)} -> ${(fm.out.ias / KT).toFixed(1)} kt`);
  check('Sealed pitot: the gauge no longer follows the truth', sys.ind.ias / KT - fm.out.ias / KT > 40, `${(sys.ind.ias / KT).toFixed(1)} indicated, ${(fm.out.ias / KT).toFixed(1)} true`);
  // ...and it reads exactly what a trapped total pressure against a falling static pressure gives
  const v0 = blocked0 * KT, dp = p0 - fm.out.staticP;
  row('Sealed pitot: gauge follows the pressure altitude', sys.ind.ias / KT, Math.sqrt(v0 * v0 + 2 * dp / 1.225) / KT, 'kt', 4);
}
// Pitot heat: it stops the blockage, and melts it away once there.
{
  const { fm, sys, run } = flying({ ias: 100, alt: 1500 });
  sys.setPitotHeat(true);
  run(300, { ...clear, oat: -7, lwc: 1 });
  check('With heat on the pitot never blocks', fm.out.pitotBlock === 0 && sys.ind.pitotBlock === 0, `block ${fm.out.pitotBlock.toFixed(2)}`);
  check('With heat on the gauge keeps reading the truth', Math.abs(sys.ind.ias - fm.out.ias) < 1);
  // now freeze it over with the heat off, then turn heat on and watch the blockage melt
  sys.setPitotHeat(false); sys.setPitotBlock(1); run(1);
  check('Heat off: the head is sealed', fm.out.pitotBlock > 0.99);
  sys.setPitotHeat(true); run(10);
  check('Heat melts the blockage', fm.out.pitotBlock < 0.6, `block ${fm.out.pitotBlock.toFixed(2)} after 10 s`);
  run(20);
  check('...and clears it entirely', fm.out.pitotBlock === 0, `block ${fm.out.pitotBlock.toFixed(2)} after 30 s`);
  check('...and the gauge reads the truth again', Math.abs(sys.ind.ias - fm.out.ias) < 1);
}

// ---- vacuum failure: the attitude indicator leans over slowly, and no flag drops
{
  const { fm, sys, run } = flying();
  run(20);
  check('Gyros agree with the horizon when healthy', Math.abs(sys.ind.roll - fm.out.roll) < 0.01);
  sys.fail('vacuum');
  run(60);
  const e1 = Math.abs(sys.ind.roll - fm.out.roll) / D2R;
  run(240);
  const e2 = Math.abs(sys.ind.roll - fm.out.roll) / D2R;
  check('After a vacuum failure the attitude indicator is still nearly right a minute later', e1 < 4, `${e1.toFixed(1)} deg`);
  check('...and badly wrong five minutes later', e2 > 15, `${e2.toFixed(0)} deg`);
  check('Low-vacuum warning shows', sys.ind.lowVac);
}
// ---- heading gyro drift: about a degree every few minutes, needs resetting
{
  const { fm, sys, run } = flying({ heading: 90 });
  sys.syncHeading(); run(900);
  const drift = Math.abs(dAng(deg(sys.ind.heading), deg(fm.out.heading)));
  row('Heading gyro drift in 15 minutes', drift, 3.5, 'deg', 2.5);
}

// ---- compass errors (northern hemisphere)
{
  // accelerate on an east heading: the compass swings toward north ("accelerate north, decelerate south")
  const { fm, sys, run } = flying({ heading: 90, ias: 80, throttle: 0.5 });
  run(40);
  const c0 = deg(sys.ind.compass);
  fm.ctl.throttle = 1; let minC = c0;
  run(8, clear, () => { minC = Math.min(minC, deg(sys.ind.compass)); });
  check('Accelerating eastbound, the compass swings toward north', c0 - minC > 3, `${c0.toFixed(0)} -> ${minC.toFixed(0)}`);
}
{
  // roll into a turn from north: the compass first shows a turn the other way ("undershoot north")
  const { fm, sys, ap, run } = flying({ heading: 0 });
  run(40);
  ap.heading = 60 * D2R; let worst = 0;
  run(6, clear, () => { worst = Math.min(worst, dAng(deg(sys.ind.compass), deg(fm.out.heading))); });
  check('Turning east from north, the compass lags behind the turn', worst < -8, `${worst.toFixed(0)} deg behind`);
}
{
  const { fm, sys, ap, run } = flying({ heading: 180 });
  run(40);
  ap.heading = 240 * D2R; let lead = 0;
  run(6, clear, () => { lead = Math.max(lead, dAng(deg(sys.ind.compass), deg(fm.out.heading))); });
  check('Turning west from south, the compass leads the turn', lead > 8, `${lead.toFixed(0)} deg ahead`);
}
{
  const { fm, sys, run } = flying({ heading: 270 });
  run(60);
  row('In steady level flight the compass reads the heading', dAng(deg(sys.ind.compass), 270), 0, 'deg', 2);
}

// ---- electrics
{
  const { fm, sys, run } = flying();
  run(10); const v0 = sys.volts;
  sys.fail('alternator'); run(60);
  check('Alternator failure: bus drops to battery voltage and the warning lights', v0 > 27.5 && sys.volts < 25.5 && sys.ind.lowVolts, `${v0.toFixed(1)} -> ${sys.volts.toFixed(1)} V`);
  let t = 60; while (sys.powered && t < 4 * 3600) { sys.update(1, clear); t += 1; }   // the aircraft need not move for the battery to run down
  row('Battery life with everything left on', t / 60, 95, 'min', 40);
  check('With the battery flat the turn coordinator flags and the flaps are dead', sys.ind.tcFlag && !fm.fx.flapPower);
  sys.repair();
}
// ---- magneto check on the ground at 1800 rpm
{
  const fm = new FlightModel(stillAir); fm.reset({});
  const sys = new Systems(fm);
  const run = (sec) => { for (let i = 0; i < sec / DT; i++) { fm.step(DT); sys.update(DT, clear); } };
  for (let k = 0; k < 40; k++) { run(1); fm.ctl.throttle += 0.004 * (1800 - fm.out.rpm) / 100; }
  const both = fm.out.rpm; sys.sw.magnetos = 1; run(6);
  row('Magneto check: RPM drop on one magneto', both - fm.out.rpm, 90, 'rpm', 60);
  sys.sw.magnetos = 0; run(4);
  check('Magnetos off stops the engine', !fm.out.firing);
}
// ---- fuel selector
{
  const { fm, sys, run } = flying();
  sys.sw.tank = 'left'; fm.fuel = 6; sys.tanks = [0.15, 5.85]; sys.lastFuel = 6;
  run(120);
  check('Running a tank dry stops the engine with fuel still aboard', !fm.out.firing && fm.fuel > 5, `${fm.fuel.toFixed(1)} kg left in the other tank`);
  sys.sw.tank = 'both'; run(8);
  check('Switching tanks brings it back (the propeller is still windmilling)', fm.out.firing);
}
// ---- oil loss ends in a seized engine
{
  const { fm, sys, run } = flying();
  sys.fail('oil'); run(60);
  check('Oil pressure falls first', sys.ind.oilP < 5 && fm.out.firing);
  run(400);
  check('...then the engine seizes', sys.seized && !fm.out.firing);
}

const pad = (s, n) => String(s).padEnd(n);
let bad = 0;
for (const r of rows) { if (!r.ok) bad++; console.log(`${r.ok ? '  ok  ' : ' MISS '}${pad(r.name, 76)}${typeof r.want === 'number' && r.unit !== '' && !isNaN(r.got) && r.want !== 1 ? pad(r.got.toFixed(1), 8) + pad(r.want, 6) : ''}${r.unit}`); }
console.log(`\n${rows.length - bad}/${rows.length}\n`);
