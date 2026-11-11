import type { Box3 } from "../schema"
import { project, type Vec2 } from "./projection"
import { round3 } from "./round"

const ARC_STEPS = 6

export const cornerRadius = (width: number, depth: number, r: number): number => Math.max(0, Math.min(r, width / 2, depth / 2))

export const radius = (box: Box3, r: number): number => cornerRadius(box.w, box.d, r)

function footprint(x: number, y: number, w: number, d: number, r: number): Vec2[] {
  const points: Vec2[] = []
  const arcs: ReadonlyArray<readonly [number, number, number]> = [
    [x + w - r, y + d - r, 0],
    [x + r, y + d - r, 90],
    [x + r, y + r, 180],
    [x + w - r, y + r, 270],
  ]
  for (const [centerX, centerY, startDegrees] of arcs) {
    for (let step = 0; step <= ARC_STEPS; step++) {
      const angle = ((startDegrees + (90 * step) / ARC_STEPS) * Math.PI) / 180
      points.push([centerX + r * Math.cos(angle), centerY + r * Math.sin(angle)])
    }
  }
  return points
}

const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

function halfHull(sorted: readonly Vec2[]): Vec2[] {
  const chain: Vec2[] = []
  for (const point of sorted) {
    for (;;) {
      const a = chain[chain.length - 2]
      const b = chain[chain.length - 1]
      if (!a || !b || cross(a, b, point) > 0) break
      chain.pop()
    }
    chain.push(point)
  }
  chain.pop()
  return chain
}

export function hull(input: readonly Vec2[]): Vec2[] {
  const sorted = input.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return halfHull(sorted).concat(halfHull(sorted.slice().reverse()))
}

export function outline({ x, y, z, w, d, h }: Box3, r: number): string {
  const ring = footprint(x, y, w, d, r)
  const points = hull(ring.flatMap(([a, b]) => [project(a, b, z), project(a, b, z + h)]))
  return `M${points.map((point) => point.map(round3).join(" ")).join("L")}Z`
}
