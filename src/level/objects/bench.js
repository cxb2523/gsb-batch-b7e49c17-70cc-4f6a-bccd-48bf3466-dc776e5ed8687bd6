// The upgrade bench: a mechanic's bench with a vice and a grinder, a rework lamp over it
// and the REWORK board behind. Static art in the garage's mesh; the lamp, the board and the grinder's
// pilot light come on with the power, and an upgrade throws a second of sparks off the wheel.
import { box, cyl, cylUp, M, rgb, torus } from '../build.js';
import { channel } from '../../mats/yard.js';

const STEEL = rgb(0x8a8e92), DARK = rgb(0x0e0e0f);

// A: the garage art, at the bench's transform (long axis x, the working side +z)
export function buildBenchArt(A, rng) {
  const B = A.B;
  A.box('wood', [-1.0, 0.84, -0.4], [1.0, 0.92, 0.4], rgb(0x5a4024), { par: 0, shadow: true, bevel: 0.01 });
  for (const sx of [-0.92, 0.92]) for (const sz of [-0.33, 0.33]) A.box('metal', [sx - 0.035, 0, sz - 0.035], [sx + 0.035, 0.84, sz + 0.035], rgb(0x2a3a34), { par: 0.6 });
  A.box('metal', [-0.95, 0.18, -0.36], [0.95, 0.21, 0.36], rgb(0x2a3a34), { par: 0.7 });
  A.box('metal', [-0.95, 0.76, -0.36], [0.95, 0.84, 0.36], rgb(0x2a3a34), { par: 0.5 });
  A.box('metal', [-0.5, 0.56, 0.3], [0.5, 0.76, 0.37], rgb(0x33443e), { par: 0.5 }); // a drawer
  A.box('metal', [-0.1, 0.65, 0.37], [0.1, 0.67, 0.39], STEEL);
  // the vice, on the left corner
  B.at(M(-0.7, 0.92, 0.22), () => {
    A.box('metal', [-0.11, 0, -0.14], [0.11, 0.05, 0.14], rgb(0x1f3f6a), { par: 0.5 });
    A.box('metal', [-0.07, 0.05, -0.12], [0.07, 0.2, 0.02], rgb(0x1f3f6a), { par: 0.5, bevel: 0.01 });
    A.box('metal', [-0.08, 0.14, 0.06], [0.08, 0.22, 0.1], rgb(0x1f3f6a), { par: 0.5 });
    A.box('metal', [-0.085, 0.16, 0.0], [0.085, 0.215, 0.02], STEEL); A.box('metal', [-0.085, 0.16, 0.04], [0.085, 0.215, 0.06], STEEL);
    A.add('metal', cyl(0.016, 0.016, 0.3, 6).rotateX(Math.PI / 2), { m: M(0, 0.1, 0.12), color: STEEL });
    A.add('metal', cyl(0.008, 0.008, 0.22, 5), { m: M(0, 0.1, 0.26, 0, 0, 0.5), color: STEEL });
  });
  // the grinder, on the right: motor, two wheels with guards, a rest
  B.at(M(0.62, 0.92, -0.05), () => {
    A.box('metal', [-0.1, 0, -0.09], [0.1, 0.03, 0.09], DARK);
    A.add('paint', cyl(0.085, 0.085, 0.2, 12).rotateZ(Math.PI / 2), { m: M(0, 0.13, 0), color: rgb(0x8a1c14), par: 1 });
    for (const s of [-1, 1]) {
      A.add('metal', cyl(0.09, 0.09, 0.03, 14).rotateZ(Math.PI / 2), { m: M(s * 0.14, 0.13, 0), color: rgb(0x6a6660), par: 1.2 });
      A.add('paint', torus(0.095, 0.02, 5, 12, Math.PI * 1.3).rotateY(Math.PI / 2), { m: M(s * 0.14, 0.13, 0, 0.9, 0, 0), color: rgb(0x8a1c14), par: 1 });
      A.box('metal', [s * 0.14 - 0.03, 0.09, 0.08], [s * 0.14 + 0.03, 0.1, 0.13], STEEL);
    }
    A.add('glow', cylUp(0.008, 0.008, 0.006, 6), { m: M(0.04, 0.215, 0.03), color: [0.1, 0.3, 0.1], glow: [1, 9, 2], power: true });
  });
  // what is on it: a stripped receiver in a rag, punches, a tin of oil, a parts tray
  A.detail(() => {
    A.box('curtain', [-0.3, 0.92, -0.12], [0.2, 0.935, 0.2], rgb(0x6a2a20), { ry: 0.2 });
    A.box('metal', [-0.22, 0.935, 0.0], [0.12, 0.975, 0.045], rgb(0x1c1e22), { par: 0.2, ry: 0.2 });
    A.add('metal', cyl(0.012, 0.012, 0.24, 6).rotateZ(Math.PI / 2), { m: M(-0.02, 0.96, 0.12, 0, 0.3, 0), color: rgb(0x1c1e22), par: 0.2 });
    for (let i = 0; i < 4; i++) A.add('metal', cyl(0.006, 0.006, 0.12, 5).rotateX(Math.PI / 2), { m: M(0.26 + i * 0.03, 0.927, 0.2 + rng.range(-0.02, 0.02), 0, rng.range(-0.3, 0.3), 0), color: STEEL });
    A.add('paint', cylUp(0.035, 0.035, 0.11, 10), { m: M(0.36, 0.92, -0.26), color: rgb(0xb8860f), par: 1 });
    A.box('metal', [-0.95, 0.92, -0.34], [-0.62, 0.95, -0.14], rgb(0x4a4e52), { par: 0.4 });
    for (let i = 0; i < 6; i++) A.add('metal', cylUp(0.012, 0.012, 0.02, 6), { m: M(-0.9 + rng.range(0, 0.24), 0.95, -0.3 + rng.range(0, 0.12)), color: rgb(0xb89a48) });
    for (let i = 0; i < 3; i++) A.box('wood', [-0.6 + i * 0.5, 0.21, -0.25], [-0.25 + i * 0.5, 0.42, 0.2], rgb([0x6b5236, 0x4a4e52, 0x54412c][i]), { par: 0 });
  });
  // the rework lamp: an arm off the back edge, a long hooded tube
  A.add('metal', cylUp(0.016, 0.016, 0.95, 6), { m: M(-0.8, 0.92, -0.36), color: STEEL });
  A.add('metal', cylUp(0.016, 0.016, 0.95, 6), { m: M(0.8, 0.92, -0.36), color: STEEL });
  A.box('paint', [-0.86, 1.86, -0.44], [0.86, 1.93, -0.2], rgb(0x23322c), { par: 1 });
  A.add('glow', cyl(0.018, 0.018, 1.5, 6).rotateZ(Math.PI / 2), { m: M(0, 1.845, -0.32), color: [0.4, 0.36, 0.3], glow: [26, 21, 13], power: true });
  B.tag('bench', () => B.collide([-1.0, 0, -0.4], [1.0, 0.92, 0.4], 'cloth'));
}

// the board and the grinder's sparks, in the object mesh; the live object
export function placeBench(ctx, spot, yaw, power) {
  const O = ctx.stat(spot.zone), spark = channel();
  O.at(M(spot.pos[0], 0, spot.pos[2], 0, yaw, 0), () => {
    O.box([-0.62, 1.98, -0.42], [0.62, 2.4, -0.39], rgb(0x101412));
    O.quad([-0.6, 2.0, -0.388], [1.2, 0, 0], [0, 0.375, 0], { tex: 'upgrade', color: [0.5, 0.5, 0.5], glow: [1.6, 1.6, 1.6], ch: power });
    for (const sx of [-0.55, 0.55]) O.box([sx - 0.012, 1.9, -0.41], [sx + 0.012, 2.0, -0.39], rgb(0x8a8e92));
    // sparks: a fan of thin bright slivers off the wheel
    for (let i = 0; i < 14; i++) {
      const a = -0.5 + (i / 13) * 1.3 + ((i * 37) % 7) * 0.03, l = 0.12 + ((i * 53) % 9) * 0.035;
      O.quad([0.76, 1.05, -0.05 + ((i * 29) % 5) * 0.012], [Math.cos(a) * l, -Math.sin(a) * l, 0.02], [0.004, 0.008, 0], { color: [0, 0, 0], glow: [60, 34, 8], ch: spark });
      O.quad([0.76, 1.05, -0.05 + ((i * 29) % 5) * 0.012], [0.004, 0.008, 0], [Math.cos(a) * l, -Math.sin(a) * l, 0.02], { color: [0, 0, 0], glow: [60, 34, 8], ch: spark });
    }
  });
  ctx.reg({
    id: spot.id || 'bench', zone: spot.zone,
    make(G, mats) {
      let until = -1;
      if (G.events) G.events.on('bench:upgrade', () => { until = G.time.t + 1.1; });
      return {
        kind: 'bench', state: 'idle', setState() {}, reset() { until = -1; },
        update(dt, t) { mats.gain[spark] = t < until ? (Math.sin(t * 91) * Math.sin(t * 57) > -0.2 ? 1 : 0.15) : 0; },
      };
    },
  });
}
void box;
