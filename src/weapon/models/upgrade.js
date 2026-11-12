// The upgraded finish (the bench's one tier) and the upgraded tracer's colour.
//
// Every model calls upgradeFinish(model, upgraded, G, patch) from its finish(upgraded). Upgraded,
// the weapon's steel (whatever its stock finish: phosphate, bluing, bare) is heat-blued, a deep
// oiled blue that goes violet at the glancing angles, and long guns get a roadside stripe painted
// by hand round the barrel: a yellow band with a white one ahead of it, in road-marking paint.
// Back to stock, the original materials return and the stripe is hidden. Nothing is rebuilt per
// call: the upgraded materials and the stripe are made once per model, the first time they are
// asked for.
import { Mesh } from 'three';
import { lathe, MM } from '../geo.js';

// scene-linear tint of a tracer by its Def's `tracer` name (fx/combat.js draws it)
export const TRACER_COLOR = { warm: [1, 0.62, 0.28], violet: [0.62, 0.34, 1] };

// the materials that are steel on the models (models/*.js material names)
const STEEL = { slide: 'body', ctrl: 'body', blued: 'body', mag: 'body', steel: 'bright' };
// where the stripe goes, by weapon id: [z of its rear edge, z of its front edge, the barrel's radius there] in mm
const STRIPE = {
  pump: [-618, -650, 11.6], autoShotgun: [-584, -616, 11.6], rifle: [-418, -446, 9.4],
  battleRifle: [-598, -630, 8.6], lmg: [-524, -548, 9.6], flare: [-236, -262, 21],
};

function make(model, G, patch) {
  const mats = G.mats, rest = { space: 'rest', shelter: 0.3 };
  const U = {
    body: patch(mats.chrome({ color: 0x0f1a3e, roughness: 0.3, age: 0.08, dust: 0, ...rest }), { occ: true }),
    bright: patch(mats.chrome({ color: 0x2c2660, roughness: 0.24, age: 0.05, dust: 0, ...rest }), { occ: true }),
    stripe: null,
  };
  const s = STRIPE[model.id];
  if (s && model.parts && (model.parts.barrel || model.parts.recv)) {
    const [z0, z1, r] = s; const mid = z0 + (z1 - z0) * 0.62;
    const yellow = patch(mats.gunmetal({ finish: 'polymer', color: 0xc9a416, wear: 0.6, oil: 0, seed: 301, space: 'rest', shelter: 0.6 }), { rough: [1.1, 0.7] });
    const white = patch(mats.gunmetal({ finish: 'polymer', color: 0xc8c6ba, wear: 0.6, oil: 0, seed: 303, space: 'rest', shelter: 0.6 }), { rough: [1.1, 0.7] });
    const band = (a, b, mat) => {
      // a brushed band is not a clean ring: its edges wander a little
      const soup = lathe([[r + 0.05, b], [r + 0.3, b - 0.4], [r + 0.34, (a + b) / 2], [r + 0.3, a + 0.5], [r + 0.05, a]], { segs: 28 });
      const geo = soup.toGeometry();
      mats.bakeRest(geo, {});
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.renderOrder = -10; mesh.visible = false;
      mesh.userData.mat = 'stripe';
      return mesh;
    };
    const parent = model.parts.barrel || model.parts.recv;
    U.stripe = [band(z0, mid + 2, yellow), band(mid - 1.5, z1, white)];
    for (const m of U.stripe) {
      // a part with its own pivot holds its geometry relative to that pivot
      m.position.set(-parent.position.x, -parent.position.y, -parent.position.z);
      parent.add(m);
      model.meshes.push(m);
    }
  }
  void MM;
  return U;
}

export function upgradeFinish(model, upgraded, G, patch = (m) => m) {
  if (!model || !model.meshes) return;
  if (!upgraded && !model.upgradeMats) return; // never upgraded: nothing to undo
  const U = model.upgradeMats || (model.upgradeMats = make(model, G, patch));
  for (const mesh of model.meshes) {
    const kind = STEEL[mesh.userData.mat];
    if (!kind) continue;
    if (upgraded) { if (!mesh.userData.stock) mesh.userData.stock = mesh.material; mesh.material = U[kind]; }
    else if (mesh.userData.stock) mesh.material = mesh.userData.stock;
  }
  if (U.stripe) for (const m of U.stripe) m.visible = !!upgraded;
}
