// The weapon box: a padlocked freight crate on a steel skid, stencilled for a haulage
// line, left at three places on the map. Only one of them holds the goods at a time.
//   gone      a dead crate: lid down, no light
//   idle      the slot in its front rail glows teal: this is the one
//   rolling   the lock lets go and the lid jacks up on a scissor lift; between lid and crate a strip
//             of amber light, and in it the outlines of weapons going by, slowing
//   offering  the strip holds the weapon on offer, bright and steady
//   moving    the lid drops, the slot burns red and stutters out
// The crate is static geometry in its zone's object mesh (its collider never changes); the lid, the
// scissor arms and the strip are two small meshes made when the level installs.
import { Group, Mesh } from 'three';
import { M, rgb } from '../build.js';
import { channel, createObj, setQuadUv, sheetUv, WEAPON_IDS } from '../../mats/yard.js';

export const BOX = { hx: 0.65, hz: 0.39, h: 0.74, lift: 0.52 };
const WOOD = [rgb(0x5a4630), rgb(0x66513a), rgb(0x4c3a28)], BAND = rgb(0x2a2d30), STEEL = rgb(0x8a8e92);
const STATES = ['gone', 'idle', 'rolling', 'offering', 'moving'];

function crate(O, ch) {
  const { hx, hz, h } = BOX;
  for (const s of [-1, 1]) O.box([-hx + 0.04, 0, s * 0.27 - 0.05], [hx - 0.04, 0.09, s * 0.27 + 0.05], BAND);
  O.box([-hx, 0.09, -hz], [hx, h, hz], WOOD[0]);
  // boards and battens on the long faces, steel angles on the corners
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) O.box([-hx + 0.01 + i * 0.257, 0.1, s * hz - 0.004], [-hx + 0.26 + i * 0.257, h - 0.14, s * hz + 0.006], WOOD[(i + (s > 0 ? 0 : 1)) % 3]);
    for (const x of [-hx + 0.05, 0, hx - 0.05]) O.box([x - 0.045, 0.09, s * hz], [x + 0.045, h - 0.13, s * hz + 0.022], WOOD[2]);
    O.box([-hx, h - 0.14, s * hz - 0.005], [hx, h, s * hz + 0.024], WOOD[1]); // the top rail the slot is cut in
    for (const x of [-hx, hx]) O.box([x - 0.02, 0.09, s * hz - 0.02], [x + 0.02, h, s * hz + 0.03], BAND);
    // the slot: teal when this crate holds the goods, red while it leaves
    const z = s * (hz + 0.0245), u = s > 0 ? 1 : -1;
    // a row of nine lamps in the slot, teal and red by turns
    for (let i = 0; i < 9; i++) {
      const x0 = (-0.45 + i * 0.1) * u, red = i % 2 === 1;
      O.quad([x0, h - 0.105, z], [0.09 * u, 0, 0], [0, 0.07, 0], { color: [0.02, 0.02, 0.02], glow: red ? [7, 0.5, 0.3] : [0.35, 3.8, 3.2], ch: red ? ch.move : ch.idle });
    }
    O.quad([-0.58 * u, 0.16, s * (hz + 0.007)], [1.16 * u, 0, 0], [0, 0.4, 0], { tex: 'freight', color: [0.07, 0.07, 0.07] });
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) O.box([s * hx - 0.006, 0.1, -hz + 0.01 + i * 0.257], [s * hx + 0.006, h - 0.02, -hz + 0.25 + i * 0.257], WOOD[(i + 1) % 3]);
    O.quad([s * (hx + 0.007), 0.26, s > 0 ? 0.17 : -0.17], [0, 0, s > 0 ? -0.34 : 0.34], [0, 0.34, 0], { tex: 'arrows', color: [0.07, 0.07, 0.07] });
  }
}
function lid(O, ch) {
  const { hx, hz } = BOX;
  O.box([-hx - 0.03, 0, -hz - 0.03], [hx + 0.03, 0.06, hz + 0.03], WOOD[1]);
  for (const x of [-hx + 0.08, 0, hx - 0.08]) O.box([x - 0.05, 0.06, -hz - 0.03], [x + 0.05, 0.085, hz + 0.03], WOOD[2]);
  for (const x of [-hx - 0.03, hx + 0.03]) O.box([x - 0.012, -0.02, -hz - 0.035], [x + 0.012, 0.07, hz + 0.035], BAND);
  // hasp and padlock, hanging from the front edge
  O.box([-0.03, -0.1, hz + 0.03], [0.03, 0.03, hz + 0.042], STEEL);
  O.box([-0.045, -0.2, hz + 0.028], [0.045, -0.11, hz + 0.06], rgb(0xa8842c), { bevel: 0.008 });
  // the strip of light under the lid, seen from both long sides: a backing and the weapon in it
  const first = [];
  for (const s of [-1, 1]) {
    const u = s > 0 ? 1 : -1, z = s * (hz - 0.06);
    O.quad([-0.6 * u, -0.5, z], [1.2 * u, 0, 0], [0, 0.48, 0], { color: [0.01, 0.01, 0.01], glow: [0.2, 0.12, 0.03], ch: ch.roll });
    first.push(O.quad([-0.56 * u, -0.47, z + s * 0.004], [1.12 * u, 0, 0], [0, 0.406, 0], { tex: 'gun:pistol', color: [0.2, 0.2, 0.2], glow: [9, 6, 1.8], ch: ch.roll }));
  }
  return first;
}
function arms(O) {
  // unit height: scaled by how far the lid has risen
  const { hz } = BOX;
  for (const z of [-hz + 0.1, hz - 0.1]) for (const s of [-1, 1]) {
    O.box([-0.56, 0.47, z - 0.012 + s * 0.014], [0.56, 0.53, z + 0.012 + s * 0.014], STEEL, { rz: s * Math.atan2(1, 1.04) });
  }
  for (const x of [-0.5, 0.5]) O.box([x - 0.02, 0, -hz + 0.08], [x + 0.02, 1, -hz + 0.11], BAND);
}

export function placeBox(ctx, spot, yaw) {
  const B = ctx.B;
  const ch = { idle: channel(), roll: channel(), move: channel() };
  const m = M(spot.pos[0], spot.pos[1], spot.pos[2], 0, yaw, 0);
  const O = ctx.stat(spot.zone);
  O.at(m, () => crate(O, ch));
  B.inZone(spot.zone, () => B.at(m, () => {
    B.tag(`box:${spot.id}`, () => B.collide([-BOX.hx, 0, -BOX.hz], [BOX.hx, BOX.h + 0.06, BOX.hz], 'cloth'));
    B.blob(BOX.hx * 2 + 0.6, BOX.hz * 2 + 0.6);
  }));
  ctx.reg({
    id: spot.id, zone: spot.zone,
    make(G, mats) {
      const group = new Group();
      group.matrixAutoUpdate = false; group.matrix.copy(m); group.name = `box:${spot.id}`;
      const lo = createObj();
      const quads = lid(lo, ch);
      const lidMesh = new Mesh(lo.geometry(), mats.object);
      const ao = createObj(); arms(ao);
      const armMesh = new Mesh(ao.geometry(), mats.object);
      armMesh.position.y = BOX.h; armMesh.visible = false;
      lidMesh.position.y = BOX.h;
      for (const q of [lidMesh, armMesh]) { q.castShadow = false; q.receiveShadow = true; q.userData.noReflect = true; q.frustumCulled = false; group.add(q); }
      const rects = WEAPON_IDS.map((id) => sheetUv(`gun:${id}`));
      const gain = mats.gain;
      let state = 'gone', open = 0, vel = 0, tState = 0, shown = -1, offer = 0, next = 0;
      const show = (i) => { if (i === shown) return; shown = i; for (const q of quads) setQuadUv(lidMesh.geometry, q, rects[i]); };
      show(0);
      const obj = {
        kind: 'box', group,
        get state() { return state; },
        setState(s) { if (!STATES.includes(s) || s === state) return; state = s; tState = 0; next = 0; },
        setWeapon(id) { const i = WEAPON_IDS.indexOf(id); offer = i < 0 ? 0 : i; },
        reset() { state = 'gone'; open = 0; vel = 0; },
        update(dt, t) {
          tState += dt;
          const want = state === 'rolling' || state === 'offering' ? 1 : 0;
          // a sprung jack: quick up with one bounce, a drop that lands
          const k = want ? 190 : 260, c = want ? 15 : 30;
          vel += ((want - open) * k - vel * c) * dt; open += vel * dt;
          if (open < 0) { open = 0; vel = 0; } else if (open > 1.08) { open = 1.08; vel = 0; }
          const y = BOX.h + open * BOX.lift;
          lidMesh.position.y = y;
          armMesh.visible = open > 0.02; armMesh.scale.y = Math.max(0.02, open * BOX.lift);
          if (state === 'rolling') {
            next -= dt;
            if (next <= 0) { show((shown + 1 + Math.floor(t * 7) % 3) % rects.length); next = 0.07 + 0.05 * Math.min(4, tState); }
          } else if (state === 'offering') show(offer);
          gain[ch.idle] = state === 'idle' ? 0.8 + 0.2 * Math.sin(t * 2.2) : state === 'rolling' || state === 'offering' ? 0.5 : 0;
          gain[ch.roll] = state === 'rolling' ? (0.7 + 0.3 * Math.sin(t * 40)) * Math.min(1, open * 1.4) : state === 'offering' ? (1.25 + 0.2 * Math.sin(t * 5)) * Math.min(1, open * 1.4) : 0;
          gain[ch.move] = state === 'moving' ? (Math.sin(t * 23) > -0.3 ? 1 : 0.1) * Math.max(0, 1 - tState / 3) : 0;
        },
      };
      return obj;
    },
  });
}

// The box on its own (the standard builder signature), for a stage or a test: { group, setState, update }.
export function buildBox(mats) {
  let made = null;
  const ctx = { B: { inZone: (z, fn) => fn(), at: (m, fn) => fn(), tag: (n, fn) => fn(), collide() {}, blob() {} }, stat: () => O, reg: (d) => { made = d; } };
  const O = createObj();
  placeBox(ctx, { id: 'box', zone: 'stage', pos: [0, 0, 0] }, 0);
  return { geometry: O.geometry(), make: (G) => made.make(G, mats) };
}
