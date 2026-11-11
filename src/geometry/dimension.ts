import type { Vec3 } from "../schema"
import { project, type Vec2 } from "./projection"
import { round3 } from "./round"

export type DimensionLayout = { origin: Vec2; angle: number; length: number; back: Vec2 }

const LEVEL = 1e-6

const lifted = ([x, y, z]: Vec3, [dx, dy, dz]: Vec3): Vec2 => project(x + dx, y + dy, z + dz)

export function dimension(from: Vec3, to: Vec3, offset: Vec3): DimensionLayout {
  const a = lifted(from, offset)
  const b = lifted(to, offset)
  const runsBack = b[0] < a[0] - LEVEL || (Math.abs(b[0] - a[0]) <= LEVEL && b[1] > a[1])
  const [start, end] = runsBack ? [b, a] : [a, b]
  const turn = Math.atan2(end[1] - start[1], end[0] - start[0])
  const [ex, ey] = project(...offset)
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  return {
    origin: [round3(start[0]), round3(start[1])],
    angle: round3((turn * 180) / Math.PI),
    length: round3(Math.hypot(end[0] - start[0], end[1] - start[1])),
    back: [round3(-(ex * cos + ey * sin)), round3(-(ey * cos - ex * sin))],
  }
}

export function witness([bx, by]: Vec2, gap: number, overshoot: number): string {
  const reach = Math.hypot(bx, by)
  if (reach <= gap) return ""
  const ux = bx / reach
  const uy = by / reach
  return `M${round3(bx - ux * gap)} ${round3(by - uy * gap)}L${round3(-ux * overshoot)} ${round3(-uy * overshoot)}`
}
