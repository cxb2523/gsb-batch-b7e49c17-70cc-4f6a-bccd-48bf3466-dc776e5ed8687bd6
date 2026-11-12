// Prints the trim that holds a condition at fixed power, for the start presets.
import { FlightModel, Autopilot, KT, FT, D2R } from '../js/fdm.js';
import { AIRCRAFT } from '../js/aircraft/index.js';
const def = AIRCRAFT[process.argv[2] || 'c172s'];
const DT = 1 / 240;
function hold({ ias, flaps = 0, throttle, alt = 800, mode = 'ias' }) {
  const fm = new FlightModel(def);
  fm.reset({ alt, speed: ias * KT, pitch: 0.02, throttle });
  fm.ctl.flaps = flaps; fm.flapPos = flaps;
  const ap = new Autopilot(fm); ap.engage(mode); ap.ias = ias * KT;
  for (let i = 0; i < 240 * 150; i++) { ap.update(DT); fm.step(DT); }
  const p = fm.ctl.pitch;
  return { ias: +(fm.out.ias / KT).toFixed(1), vs: Math.round(fm.out.vs / FT * 60), throttle, trim: +(p * (p > 0 ? 28 : 23) / 11).toFixed(3), pitch: +(fm.out.pitch / D2R).toFixed(1), rpm: Math.round(fm.out.rpm) };
}
for (const t of [0.1, 0.15, 0.2]) console.log('final, 70 kt, flaps 10 ', hold({ ias: 70, flaps: 1 / 3, throttle: t }));
for (const t of [0.55, 0.65, 0.75]) console.log('level, alt hold        ', hold({ ias: 100, throttle: t, alt: 1500, mode: 'alt' }));
console.log('climb, 76 kt, full power', hold({ ias: 76, throttle: 1 }));
