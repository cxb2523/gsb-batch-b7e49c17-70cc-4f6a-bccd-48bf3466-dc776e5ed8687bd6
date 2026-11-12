// The garage, the scrapyard and the world objects, built without a renderer.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRng } from '../src/core/rng.js';
import { createAtlas } from '../src/level/atlas.js';
import { buildWorld } from '../src/level/world.js';
import * as W from '../src/level/worldLayout.js';
import { objectIds, objectRecords } from '../src/level/areas/garage.js';
import { CHANNELS, channelsUsed, sheetUv, WEAPON_IDS, CHALKED, BRANDS } from '../src/mats/yard.js';
import { BOX } from '../src/level/objects/box.js';
import { weapons } from '../src/game/tuning/weapons.js';
import { economy } from '../src/game/tuning/economy.js';

let world;
const mats = () => ({ object: null, gain: new Float32Array(CHANNELS), lift: { value: 0 } });
const G = (power = false) => ({ time: { t: 0 }, level: { power: { on: power } }, events: { on() {} } });
beforeAll(() => {
  const rng = createRng(7);
  world = buildWorld({ rng, atlas: createAtlas(rng.fork('atlas')) });
}, 120000);

describe('garage and world objects', () => {
  it('draws the garage itself and registers every object the economy uses', () => {
    expect(world.real.garage).toBe(true);
    const ids = objectIds();
    for (const s of [...W.machineSpots, ...W.boxSpots]) expect(ids, s.id).toContain(s.id);
    expect(ids).toContain('bench');
    expect(ids).toContain('power-switch');
    expect(channelsUsed()).toBeLessThanOrEqual(CHANNELS);
  });
  it('gives every machine and box spot a collider, and every stack its own', () => {
    for (const s of W.machineSpots) expect(world.colliders.some((c) => c.prop === `machine:${s.id}` || c.tag === `machine:${s.id}`), s.id).toBe(true);
    for (const s of W.boxSpots) expect(world.colliders.some((c) => c.prop === `box:${s.id}` || c.tag === `box:${s.id}`), s.id).toBe(true);
    for (const s of W.stacks) expect(world.colliders.some((c) => Math.abs(c.min[0] - s.x0) < 1e-6 && Math.abs(c.max[0] - s.x1) < 1e-6 && Math.abs(c.max[1] - s.h) < 1e-6 && (s.h < 2 || c.slip)), `stack at ${s.x0}`).toBeTruthy(); // 2 m and over: no footing
  });
  it('nothing a body could stand on tops out between a machine and head height', () => {
    for (const c of world.colliders) if (/^machine:/.test(c.prop || c.tag || '')) expect(c.noFooting, 'a machine is no step').toBeTruthy();
  });
  it('has a silhouette for every weapon the box can offer and a chalk outline for every wall weapon', () => {
    for (const id of Object.keys(weapons.table)) { expect(WEAPON_IDS, id).toContain(id); expect(sheetUv(`gun:${id}`).every(Number.isFinite)).toBe(true); }
    for (const id of Object.values(economy.wallBuys)) expect(CHALKED, id).toContain(id);
    for (const k of economy.machineKinds) expect(BRANDS[k], k).toBeTruthy();
  });
  it('the box jacks open while it rolls and offers, and is dark when gone', () => {
    const rec = objectRecords().find((d) => d.id === 'box-garage');
    const m = mats();
    const box = rec.make(G(), m);
    const lid = box.group.children[0];
    const run = (n, t0 = 0) => { for (let i = 0; i < n; i++) box.update(1 / 60, t0 + i / 60); };
    run(30);
    expect(lid.position.y).toBeCloseTo(BOX.h, 2);
    expect(Math.max(...m.gain)).toBe(0); // gone: no light at all
    box.setState('idle'); run(30);
    expect(Math.max(...m.gain)).toBeGreaterThan(0.5);
    box.setState('rolling'); run(90, 1);
    expect(lid.position.y).toBeGreaterThan(BOX.h + BOX.lift * 0.9);
    box.setState('offering'); box.setWeapon('lmg'); run(30, 3);
    expect(lid.position.y).toBeGreaterThan(BOX.h + BOX.lift * 0.9);
    box.setState('idle'); run(90, 4);
    expect(lid.position.y).toBeCloseTo(BOX.h, 2);
    box.setState('moving'); run(10, 6);
    box.reset(); run(5, 7);
    expect(box.state).toBe('gone');
  });
  it('machines are dead without the power, lit with it, dimmed with the lamp on once bought', () => {
    const rec = objectRecords().find((d) => d.id === 'longHaul');
    const m = mats();
    const mc = rec.make(G(false), m);
    mc.update(1 / 60, 0, true);
    expect(Math.max(...m.gain)).toBe(0);
    mc.setState('live'); mc.update(1 / 60, 0.1, true);
    const live = Math.max(...m.gain);
    expect(live).toBeGreaterThan(0.8);
    mc.setState('bought'); mc.update(1 / 60, 0.2, true);
    expect([...m.gain].filter((v) => v > 0).sort()).toEqual([expect.closeTo(0.22, 2), 1]);
    mc.reset(); mc.update(1 / 60, 0.3, true);
    expect(mc.state).toBe('dead');
    expect(rec.make(G(true), mats()).state).toBe('live');
  });
});
