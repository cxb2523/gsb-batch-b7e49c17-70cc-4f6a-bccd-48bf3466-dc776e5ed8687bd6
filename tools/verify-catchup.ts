/**
 * Headless verification of the OBSERVABLE catch-up behaviour.
 *
 *   npm run verify:catchup
 *
 * Drives the real RaceDirector with the real Terrain, Track, CarSim and
 * AIController - no rendering, no DOM, no browser, and no second copy of the
 * catch-up rules. The only test scaffolding is pinning cars at chosen arc
 * distances so each rule can be exercised deterministically; every multiplier
 * and gap under assertion comes straight back out of the read-only
 * RaceDirector.catchUpStatus() query.
 *
 * Covers:
 *   - rivals ahead ease off (multiplier < 1), rivals behind press on (> 1)
 *   - the easing is deliberately stronger than the pushing
 *   - finished cars are neither eased nor pushed
 *   - catchUp off returns every rival to neutral
 *   - a car actually ahead but whose raw arc difference is negative is still
 *     classified ahead, via the shortest-way-round fold across the line
 *   - multipliers move through the AIController smoothing, never jump
 *   - the query is read-only and never includes the player
 */

import * as THREE from 'three';
import { Track } from '../src/sim/track';
import { Terrain } from '../src/sim/terrain';
import { RaceDirector } from '../src/sim/race';
import type { CatchUpRow } from '../src/sim/race';
import { AIController } from '../src/sim/ai';
import { RaceAudio } from '../src/audio/raceAudio';
import { Dust } from '../src/render/dust';
import type { SimEnv } from '../src/sim/types';

const f = (v: number, d = 4): string => v.toFixed(d);

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label.padEnd(44)} ${detail}`);
}

console.log('\n=== NOCTIS GP - catch-up observability verification ===\n');

// ---- world: exactly the construction race-sim.ts uses --------------------
const track = new Track().build(2).buildHash().markLaunchRamp();
const terrain = new Terrain();
terrain.buildNatural(track);
track.setHeightsFromTerrain(terrain);
terrain.carve(track);
const L = track.length;
console.log(`  lap length ${f(L, 0)} m, catch-up folds at +/- ${f(L / 2, 0)} m\n`);

const DT = 1 / 60;

function makeDirector(catchUp: boolean): RaceDirector {
  const env: SimEnv = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(60, 1.6, 0.5, 90000),
    terrain,
    track,
    audio: new RaceAudio(),
    dust: new Dust(new THREE.Scene()),
    autopilot: true,
    menu: null,
  };
  const d = new RaceDirector(env);
  d.catchUp = catchUp;
  d.classifyOnPlayerFinish = false;
  d.startRace();
  // Skip the countdown: put the director straight into the racing state and
  // release the grid the same way updateCountdown() does at "GO".
  d.state = 'race';
  for (const c of d.cars) {
    c.disabled = false;
    c.idling = false;
  }
  return d;
}

/**
 * Test scaffolding only: seat a car at an unwrapped arc distance so the
 * director's own gap rule sees exactly the scenario under test. The pin is
 * reapplied every frame, so ordinary physics cannot blur the arrangement.
 */
function pinAt(car: { s: number; lastS: number; totalDist: number; pos: THREE.Vector3; vel: THREE.Vector3; yaw: number }, totalDist: number): void {
  const s = ((totalDist % L) + L) % L;
  const frame = track.frameAt(s);
  car.s = s;
  car.lastS = s;
  car.totalDist = totalDist;
  car.pos.set(frame.x, terrain.sampleHeight(frame.x, frame.z) + 0.6, frame.z);
  car.yaw = Math.atan2(frame.tx, frame.tz);
  car.vel.set(frame.tx * 40, 0, frame.tz * 40);
}

/**
 * Run pinned scenarios long enough for the AIController's exponential
 * smoothing (2% per 1/120 s substep) to effectively reach its target.
 */
function settle(d: RaceDirector, layout: (dir: RaceDirector) => void, frames = 360): void {
  for (let i = 0; i < frames; i++) {
    layout(d);
    // Neutralise power-ups, exactly like the catch-up trial in race-sim.ts:
    // random stuns would move cars off their pinned positions.
    for (const c of d.cars) c.item = null;
    d.update(DT);
  }
}

const row = (d: RaceDirector, name: string): CatchUpRow => {
  const r = d.catchUpStatus().find((x) => x.name === name);
  if (!r) throw new Error(`rival ${name} missing from catchUpStatus()`);
  return r;
};

// ===========================================================================
// Scenario 1: player lagging AND leading in the same field
// ===========================================================================
{
  console.log('-- 1. rivals ahead ease, rivals behind push --');
  const d = makeDirector(true);
  const rivals = d.cars.filter((c) => c !== d.player);
  const aheadCar = rivals[0];
  const behindCar = rivals[1];

  const layout = (dir: RaceDirector): void => {
    pinAt(dir.player, 1000);
    pinAt(aheadCar, 2000); // +1000 m, well outside the 700 m full-strength range
    pinAt(behindCar, 300); // -700 m, exactly at full push strength
    // Spread the rest far enough away that contact cannot disturb the pins.
    rivals.slice(2).forEach((c, i) => pinAt(c, 1400 + i * 160));
  };
  settle(d, layout);

  const rows = d.catchUpStatus();
  const ahead = row(d, aheadCar.name);
  const behind = row(d, behindCar.name);

  console.log(`    ${aheadCar.name}: gap=${f(ahead.gap, 1)} m raw=${f(ahead.rawGap, 1)} m mult=${f(ahead.multiplier)}`);
  console.log(`    ${behindCar.name}: gap=${f(behind.gap, 1)} m raw=${f(behind.rawGap, 1)} m mult=${f(behind.multiplier)}`);

  check('query reports one row per rival, player excluded',
    rows.length === d.cars.length - 1 && !rows.some((r) => r.name === d.player.name),
    `${rows.length}/${d.cars.length - 1} rivals, no player row`);
  check('ahead car is classified ahead', ahead.ahead && ahead.gap > 0, `gap ${f(ahead.gap, 1)} m`);
  check('ahead car eases off (multiplier < 1)', ahead.multiplier < 0.99, `multiplier ${f(ahead.multiplier)}`);
  check('behind car is classified behind', !behind.ahead && behind.gap < 0, `gap ${f(behind.gap, 1)} m`);
  check('behind car presses on (multiplier > 1)', behind.multiplier > 1.001, `multiplier ${f(behind.multiplier)}`);
  check('easing amplitude is stronger than pushing',
    1 - ahead.multiplier > behind.multiplier - 1,
    `ease ${f(1 - ahead.multiplier)} vs push ${f(behind.multiplier - 1)}`);
  // At full strength the converged values must reflect the shipped constants:
  // 16% easing versus 5% pushing, clamped by the AIController's allowed band.
  check('full-strength easing approaches 16%', Math.abs((1 - ahead.multiplier) - 0.16) < 0.002,
    `easing ${f((1 - ahead.multiplier) * 100, 2)}% of pace`);
  check('full-strength pushing approaches 5%', Math.abs((behind.multiplier - 1) - 0.05) < 0.002,
    `pushing ${f((behind.multiplier - 1) * 100, 2)}% of pace`);
  console.log();
}

// ===========================================================================
// Scenario 2: a dominant player - the whole field behind gets pushed
// ===========================================================================
{
  console.log('-- 2. player leading: every rival presses on, nobody eases --');
  const d = makeDirector(true);
  const layout = (dir: RaceDirector): void => {
    pinAt(dir.player, 3000);
    dir.cars.filter((c) => c !== dir.player).forEach((c, i) => pinAt(c, 1200 + i * 150));
  };
  settle(d, layout);

  const rows = d.catchUpStatus();
  for (const r of rows) {
    console.log(`    ${r.name}: gap=${f(r.gap, 1)} m mult=${f(r.multiplier)}`);
  }
  check('all rivals classified behind', rows.every((r) => !r.ahead && r.gap < 0),
    `${rows.filter((r) => r.ahead).length} misclassified ahead`);
  check('all rivals pushed (multipliers > 1)', rows.every((r) => r.multiplier > 1.001),
    `min multiplier ${f(Math.min(...rows.map((r) => r.multiplier)))}`);
  check('no rival is eased', rows.every((r) => r.multiplier >= 1),
    `min multiplier ${f(Math.min(...rows.map((r) => r.multiplier)))}`);
  console.log();
}

// ===========================================================================
// Scenario 3: a finished car is left alone
// ===========================================================================
{
  console.log('-- 3. finished cars participate in neither easing nor pushing --');
  const d = makeDirector(true);
  const rivals = d.cars.filter((c) => c !== d.player);
  const finishedAhead = rivals[0];
  const activeBehind = rivals[1];

  const layout = (dir: RaceDirector): void => {
    pinAt(dir.player, 1000);
    pinAt(finishedAhead, 2000); // would be eased hard if it were still racing
    pinAt(activeBehind, 400); // actively racing, must still be pushed
    rivals.slice(2).forEach((c, i) => pinAt(c, 1500 + i * 160));
    finishedAhead.finished = true;
  };
  settle(d, layout);

  const fin = row(d, finishedAhead.name);
  const act = row(d, activeBehind.name);
  console.log(`    finished ${finishedAhead.name}: gap=${f(fin.gap, 1)} m mult=${f(fin.multiplier)} finished=${fin.finished}`);
  console.log(`    racing   ${activeBehind.name}: gap=${f(act.gap, 1)} m mult=${f(act.multiplier)} finished=${act.finished}`);

  check('finished car is flagged in the query', fin.finished, `finished=${fin.finished}`);
  check('finished ahead car is not eased', Math.abs(fin.multiplier - 1) < 0.002,
    `multiplier ${f(fin.multiplier)}`);
  check('racing cars around it are still adjusted', act.multiplier > 1.001,
    `active behind-car multiplier ${f(act.multiplier)}`);

  // A car that finishes WHILE eased must glide back to neutral through the
  // same smoothing rather than snapping - and rather than keeping the bias.
  const later = rivals[2];
  const ai = later.ai as AIController;
  const pinField = (dir: RaceDirector): void => {
    pinAt(dir.player, 1000);
    pinAt(later, 2000);
    rivals.filter((c) => c !== later).forEach((c, i) => pinAt(c, 600 + i * 160));
  };
  settle(d, () => {
    pinField(d);
    later.finished = false;
  }, 240);
  const easedBias = ai.catchUpBias;
  later.finished = true;
  settle(d, () => {
    pinField(d);
    later.finished = true;
  }, 120);
  console.log(`    ${later.name} eased to ${f(easedBias)}, then flagged finished -> ${f(ai.catchUpBias)}`);
  check('finishing releases a previously eased car back to 1', ai.catchUpBias > easedBias && Math.abs(ai.catchUpBias - 1) < 0.02,
    `${f(easedBias)} -> ${f(ai.catchUpBias)}`);
  console.log();
}

// ===========================================================================
// Scenario 4: catchUp switched off - everyone is neutral
// ===========================================================================
{
  console.log('-- 4. catchUp off returns every rival to multiplier 1 --');
  const d = makeDirector(false);
  const layout = (dir: RaceDirector): void => {
    pinAt(dir.player, 1000);
    dir.cars.filter((c) => c !== dir.player).forEach((c, i) =>
      pinAt(c, i % 2 === 0 ? 2200 + i * 120 : 200 + i * 120));
  };
  settle(d, layout);

  const rows = d.catchUpStatus();
  for (const r of rows) console.log(`    ${r.name}: gap=${f(r.gap, 1)} m mult=${f(r.multiplier)}`);
  check('all multipliers are 1 with catchUp off', rows.every((r) => Math.abs(r.multiplier - 1) < 0.002),
    `max deviation ${f(Math.max(...rows.map((r) => Math.abs(r.multiplier - 1))))}`);
  check('gaps are still reported when the system is off',
    rows.every((r) => Number.isFinite(r.gap) && r.gap !== 0), 'gap telemetry unaffected');
  console.log();
}

// ===========================================================================
// Scenario 5: folding across the start/finish line
// ===========================================================================
{
  console.log('-- 5. shortest-way-round gap across the line --');

  // 5a. A rival genuinely 140 m AHEAD, but its unwrapped arc distance is
  //     nearly a full lap smaller than the player's, so the raw difference is
  //     negative. Naive subtraction would call this car "behind".
  const d = makeDirector(true);
  const rivals = d.cars.filter((c) => c !== d.player);
  const wrapAhead = rivals[0];
  const layout = (dir: RaceDirector): void => {
    pinAt(dir.player, L + 100);
    pinAt(wrapAhead, 240); // raw = 240 - (L+100) = -(L-140); folded = +140
    rivals.slice(1).forEach((c, i) => pinAt(c, L * 0.5 + i * 160));
  };
  settle(d, layout);
  const wa = row(d, wrapAhead.name);
  console.log(`    ${wrapAhead.name}: rawGap=${f(wa.rawGap, 1)} m -> folded gap=${f(wa.gap, 1)} m mult=${f(wa.multiplier)}`);
  check('negative raw gap across the line still reads as ahead',
    wa.rawGap < 0 && wa.ahead && wa.gap > 0,
    `raw ${f(wa.rawGap, 1)} -> gap ${f(wa.gap, 1)}`);
  check('folded gap is the true 140 m lead', Math.abs(wa.gap - 140) < 1, `gap ${f(wa.gap, 1)} m`);
  check('the cross-line leader is eased, not pushed', wa.multiplier < 1,
    `multiplier ${f(wa.multiplier)}`);

  // 5b. Mirror case: positive raw difference of almost a lap must fold to a
  //     small negative gap - the car is actually just behind.
  const d2 = makeDirector(true);
  const rivals2 = d2.cars.filter((c) => c !== d2.player);
  const wrapBehind = rivals2[0];
  const layout2 = (dir: RaceDirector): void => {
    pinAt(dir.player, 200);
    pinAt(wrapBehind, L + 60); // raw = L - 140; folded = -140
    rivals2.slice(1).forEach((c, i) => pinAt(c, L * 0.5 + i * 160));
  };
  settle(d2, layout2);
  const wb = row(d2, wrapBehind.name);
  console.log(`    ${wrapBehind.name}: rawGap=${f(wb.rawGap, 1)} m -> folded gap=${f(wb.gap, 1)} m mult=${f(wb.multiplier)}`);
  check('positive raw gap across the line still reads as behind',
    wb.rawGap > 0 && !wb.ahead && wb.gap < 0,
    `raw ${f(wb.rawGap, 1)} -> gap ${f(wb.gap, 1)}`);
  check('folded gap is the true 140 m deficit', Math.abs(wb.gap + 140) < 1, `gap ${f(wb.gap, 1)} m`);
  check('the cross-line trailer is pushed, not eased', wb.multiplier > 1,
    `multiplier ${f(wb.multiplier)}`);
  console.log();
}

// ===========================================================================
// Scenario 6: smoothing - multipliers ramp, they never jump
// ===========================================================================
{
  console.log('-- 6. AIController smoothing prevents instant jumps --');
  const d = makeDirector(true);
  const rivals = d.cars.filter((c) => c !== d.player);
  const target = rivals[0];
  const ai = target.ai as AIController;
  const layout = (dir: RaceDirector): void => {
    pinAt(dir.player, 1000);
    pinAt(target, 2000); // full-strength ease target: 0.84
    rivals.slice(1).forEach((c, i) => pinAt(c, 1500 + i * 160));
  };

  // Fresh director: no substep has run yet, so the multiplier must still be
  // its constructed neutral value even though the target is already easing.
  layout(d);
  check('multiplier is constructed at neutral', Math.abs(ai.catchUpBias - 1) < 1e-12,
    `before first update ${f(ai.catchUpBias)}`);

  const samples: number[] = [ai.catchUpBias];
  for (let i = 0; i < 120; i++) {
    layout(d);
    for (const c of d.cars) c.item = null;
    d.update(DT);
    samples.push(ai.catchUpBias);
  }
  const firstStep = Math.abs(samples[1] - samples[0]);
  const maxStep = Math.max(...samples.slice(1).map((v, i) => Math.abs(v - samples[i])));
  const monotone = samples.every((v, i) => i === 0 || v <= samples[i - 1] + 1e-12);
  console.log(`    first step ${f(firstStep, 6)}, max per-frame step ${f(maxStep, 6)}, end ${f(samples.at(-1)!)}`);
  check('no instant jump to the target', firstStep < 0.01, `first step ${f(firstStep, 6)}`);
  check('every frame moves smoothly', maxStep < 0.01, `max step ${f(maxStep, 6)}`);
  check('ramp is monotonic towards the eased target', monotone, 'non-monotonic ramp');
  check('ramp approaches the eased target', samples.at(-1)! < 0.9, `after 2 s ${f(samples.at(-1)!)}`);
  console.log();
}

// ===========================================================================
// Scenario 7: the query is strictly read-only
// ===========================================================================
{
  console.log('-- 7. catchUpStatus() changes no race state --');
  const d = makeDirector(true);
  const layout = (dir: RaceDirector): void => {
    pinAt(dir.player, 1000);
    dir.cars.filter((c) => c !== dir.player).forEach((c, i) => pinAt(c, 1800 + i * 150));
  };
  settle(d, layout);

  const snapshot = d.cars.map((c) => ({
    s: c.s, totalDist: c.totalDist, speed: c.speed, finished: c.finished,
    pos: c.pos.clone(), vel: c.vel.clone(),
  }));
  const before = { clock: d.clock, state: d.state };
  for (let i = 0; i < 50; i++) d.catchUpStatus();
  const unchanged = d.cars.every((c, i) => {
    const s = snapshot[i];
    return c.s === s.s && c.totalDist === s.totalDist && c.speed === s.speed &&
      c.finished === s.finished && c.pos.equals(s.pos) && c.vel.equals(s.vel);
  });
  check('50 queries leave every car untouched', unchanged, unchanged ? 'identical state' : 'state mutated');
  check('clock and race state untouched', d.clock === before.clock && d.state === before.state,
    `clock ${f(d.clock, 3)}, state ${d.state}`);
  const twice = d.catchUpStatus();
  const again = d.catchUpStatus();
  check('repeated queries return identical data',
    twice.every((r, i) => r.multiplier === again[i].multiplier && r.gap === again[i].gap &&
      r.rawGap === again[i].rawGap && r.finished === again[i].finished && r.ahead === again[i].ahead),
    'deterministic view');
  console.log();
}

console.log(failures === 0 ? 'ALL CATCH-UP CHECKS PASSED\n' : `${failures} CATCH-UP CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
