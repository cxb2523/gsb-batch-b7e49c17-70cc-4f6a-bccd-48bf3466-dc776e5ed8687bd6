// Picking rules shared by the city scene and the verification page.
//
// A selection only happens when ALL of these hold:
//   1. the press started on a tower (id >= 0)
//   2. the release lands on the SAME instance (id matches)
//   3. net displacement between press and release is <= 8 px (the historical rule)
//   4. total pointer travel during the press is <= 8 px, so a drag that
//      wanders off and comes back to its start pixel still is not a click
//   5. no wheel zoom happened while the press was held
//
// The same distance/travel/wheel rules decide whether a release that hit
// nothing counts as "clicked empty space" (collapse the card).

export const MAX_CLICK_MOVE_PX = 8;

/** mutable, shared between the canvas, the buildings and the camera rig */
export interface CameraInteraction {
  /** a pointer is currently held down on the canvas */
  pressing: boolean;
  /** total pointer travel (px) since the current press started */
  travel: number;
  /** performance.now() of the last wheel zoom over the canvas */
  wheelAt: number;
}

export function createCameraInteraction(): CameraInteraction {
  return { pressing: false, travel: 0, wheelAt: 0 };
}

export interface Press {
  x: number;
  y: number;
  /** instance id under the press, -1 when the press started off the towers */
  id: number;
  /** performance.now() of the press */
  at: number;
}

export function beginPress(x: number, y: number, id: number, at: number): Press {
  return { x, y, id, at };
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Decide whether a release is a genuine tap on a tower.
 * Returns the instance id to select, or null when the gesture was a drag,
 * a zoom, or ended on a different tower than it started on.
 */
export function resolveClick(
  press: Press | null,
  up: { x: number; y: number; id: number },
  ix: CameraInteraction,
): number | null {
  if (!press || press.id < 0) return null;
  if (up.id !== press.id) return null;
  if (distance(press, up) > MAX_CLICK_MOVE_PX) return null;
  if (ix.travel > MAX_CLICK_MOVE_PX) return null;
  if (ix.wheelAt > press.at) return null;
  return press.id;
}

/**
 * Decide whether a release that hit nothing means "clicked empty space".
 * A press that turned into an orbit drag or a wheel zoom must not collapse
 * the open card.
 */
export function resolveMiss(
  press: { x: number; y: number; at: number } | null,
  up: { x: number; y: number },
  ix: CameraInteraction,
): boolean {
  if (!press) return false;
  if (distance(press, up) > MAX_CLICK_MOVE_PX) return false;
  if (ix.travel > MAX_CLICK_MOVE_PX) return false;
  if (ix.wheelAt > press.at) return false;
  return true;
}
