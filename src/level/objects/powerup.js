// Power-ups: four floating shapes, each its own outline and colour, lit from within, so a
// drop is known at a glance across the lot.
//   resupply    a green ammunition tin with a pale band
//   oneTap      a red, long, faceted spike standing on its point
//   doubleTime  two gold rings crossed
//   flashover   an orange burst: a core with eight points
import { BoxGeometry, ConeGeometry, OctahedronGeometry, TorusGeometry } from 'three';
import { M } from '../build.js';
import { createObj } from '../../mats/yard.js';

export const POWERUP_KINDS = ['resupply', 'oneTap', 'doubleTime', 'flashover'];

export function powerupGeometry(kind) {
  const O = createObj();
  if (kind === 'resupply') {
    O.add(new BoxGeometry(0.42, 0.26, 0.24), { color: [0.04, 0.2, 0.06], glow: [0.25, 2.2, 0.5] });
    O.add(new BoxGeometry(0.43, 0.06, 0.25), { m: M(0, 0.04, 0), color: [0.5, 0.5, 0.4], glow: [1.4, 2.6, 1.2] });
    O.add(new TorusGeometry(0.07, 0.014, 5, 10, Math.PI), { m: M(0, 0.13, 0), color: [0.3, 0.3, 0.3], glow: [1, 1.6, 1] });
  } else if (kind === 'oneTap') {
    O.add(new OctahedronGeometry(0.2), { m: M(0, 0, 0, 0, 0, 0, 0.8, 1.9, 0.8), color: [0.3, 0.02, 0.02], glow: [7, 0.5, 0.35] });
    O.add(new OctahedronGeometry(0.08), { m: M(0, 0, 0, 0, 0.6, 0, 2.6, 0.5, 2.6), color: [0.5, 0.1, 0.1], glow: [9, 2.2, 1.6] });
  } else if (kind === 'doubleTime') {
    O.add(new TorusGeometry(0.2, 0.045, 6, 18), { m: M(-0.07, 0, 0, 0, 0.5, 0), color: [0.4, 0.28, 0.04], glow: [6.5, 4.2, 0.6] });
    O.add(new TorusGeometry(0.2, 0.045, 6, 18), { m: M(0.07, 0, 0, 0, -0.5, 0), color: [0.4, 0.28, 0.04], glow: [6.5, 4.2, 0.6] });
  } else {
    O.add(new OctahedronGeometry(0.13, 1), { color: [0.5, 0.3, 0.1], glow: [10, 6, 1.6] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, up = i % 2 ? 0.5 : -0.5;
      O.add(new ConeGeometry(0.05, 0.3, 5).translate(0, 0.24, 0), { m: M(0, 0, 0, up, a, Math.PI / 2), color: [0.4, 0.12, 0.02], glow: [8, 2.4, 0.3] });
    }
  }
  return O.geometry();
}
