// What lies in the world to be taken: a weapon left by a search, and the power-ups a kill
// drops. Both follow the game's own live lists (G.game.loot.pickups, G.game.powerups.drops), so
// nothing here keeps state the game could disagree with.
//   pickup    the weapon's outline as a lit card turning slowly over the searched object, a warm
//             pool under it: bright enough to read at 15 m and on a phone
//   power-up  a floating shape with a glow, one per kind (powerup.js)
// A small pool of meshes in the object material; no allocation after install.
import { CylinderGeometry, Group, Mesh } from 'three';
import { createObj, setQuadUv, sheetUv, WEAPON_IDS } from '../../mats/yard.js';
import { powerupGeometry, POWERUP_KINDS } from './powerup.js';

const PICKUPS = 4, DROPS = 4;

export function buildPickup(mats) {
  const O = createObj();
  const quads = [];
  for (const s of [1, -1]) quads.push(O.quad([-0.34 * s, 0.0, 0.004 * s], [0.68 * s, 0, 0], [0, 0.2465, 0], { tex: 'gun:pistol', color: [0.3, 0.26, 0.2], glow: [7, 5.2, 2.6] }));
  // the warm pool: a disc of light on what it rests on
  const disc = createObj();
  disc.add(new CylinderGeometry(0.26, 0.3, 0.012, 16), { color: [0.25, 0.18, 0.1], glow: [0.55, 0.38, 0.15] });
  const card = new Mesh(O.geometry(), mats.object), pool = new Mesh(disc.geometry(), mats.object);
  const group = new Group();
  card.position.y = 0.16; pool.position.y = 0.012;
  for (const m of [card, pool]) { m.castShadow = false; m.userData.noReflect = true; m.frustumCulled = false; group.add(m); }
  group.visible = false;
  let shown = '';
  return {
    group,
    setItem(id) { if (id === shown) return; shown = id; const r = sheetUv(`gun:${WEAPON_IDS.includes(id) ? id : 'pump'}`); for (const q of quads) setQuadUv(card.geometry, q, r); },
    update(dt, t) { card.rotation.y = t * 1.1; card.position.y = 0.2 + 0.03 * Math.sin(t * 2.3); },
  };
}

export function buildPowerup(mats) {
  const group = new Group();
  const meshes = {};
  for (const k of POWERUP_KINDS) { const m = new Mesh(powerupGeometry(k), mats.object); m.castShadow = false; m.userData.noReflect = true; m.frustumCulled = false; m.visible = false; group.add(m); meshes[k] = m; }
  group.visible = false;
  let kind = '';
  return {
    group,
    setKind(k) { if (k === kind) return; kind = k; for (const q of POWERUP_KINDS) meshes[q].visible = q === k; },
    update(dt, t, ttl) {
      group.rotation.y = t * 1.6;
      const m = meshes[kind];
      if (m) { m.position.y = 0.95 + 0.08 * Math.sin(t * 2.6); m.visible = !(ttl < 5 && Math.sin(t * 18) < 0); } // it blinks before it lapses
    },
  };
}

const px = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? p[0] : p.x), py = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? p[1] : p.y), pz = (p) => (Array.isArray(p) || ArrayBuffer.isView(p) ? p[2] : p.z);

export function installLoot(G, mats, level) {
  if (!level.root) return null;
  const root = new Group();
  root.name = 'loot';
  level.root.add(root);
  const pickups = [], drops = [];
  for (let i = 0; i < PICKUPS; i++) { const p = buildPickup(mats); root.add(p.group); pickups.push(p); }
  for (let i = 0; i < DROPS; i++) { const p = buildPowerup(mats); root.add(p.group); drops.push(p); }
  // harness: ?loot=1 puts one of each on the forecourt, for a look
  const demo = typeof window !== 'undefined' && window.location && /[?&]loot=1/.test(window.location.search);
  const DEMO_P = [{ item: 'rifle', pos: [36.2, 0.62, 22.4] }, { item: 'lmg', pos: [60.4, 0.97, 14.25] }];
  const DEMO_D = POWERUP_KINDS.map((kind, i) => ({ kind, pos: [38.5 + i * 1.3, 0, 10.2 + (i % 2) * 0.9], ttl: 20 }));
  return {
    pickups, drops,
    update(dt, t) {
      const game = G.game;
      const pl = demo ? DEMO_P : game && game.loot && game.loot.pickups;
      const dl = demo ? DEMO_D : game && game.powerups && game.powerups.drops;
      for (let i = 0; i < PICKUPS; i++) {
        const p = pickups[i], rec = pl && i < pl.length ? pl[i] : null;
        p.group.visible = !!rec;
        if (!rec) continue;
        p.setItem(rec.item); p.group.position.set(px(rec.pos), py(rec.pos), pz(rec.pos)); p.update(dt, t);
      }
      for (let i = 0; i < DROPS; i++) {
        const p = drops[i], rec = dl && i < dl.length ? dl[i] : null;
        p.group.visible = !!rec;
        if (!rec) continue;
        p.setKind(rec.kind); p.group.position.set(px(rec.pos), py(rec.pos), pz(rec.pos)); p.update(dt, t, rec.ttl ?? 99);
      }
    },
  };
}
