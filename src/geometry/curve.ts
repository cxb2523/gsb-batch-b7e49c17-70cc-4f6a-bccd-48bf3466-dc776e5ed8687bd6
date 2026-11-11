import type { Vec3 } from "../schema"

export function curve(a: Vec3, b: Vec3, c: Vec3, d: Vec3, steps = 40): Vec3[] {
  const points: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    const wa = u * u * u
    const wb = 3 * u * u * t
    const wc = 3 * u * t * t
    const wd = t * t * t
    points.push([wa * a[0] + wb * b[0] + wc * c[0] + wd * d[0], wa * a[1] + wb * b[1] + wc * c[1] + wd * d[1], wa * a[2] + wb * b[2] + wc * c[2] + wd * d[2]])
  }
  return points
}
