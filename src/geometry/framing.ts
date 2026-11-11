import { check, DEV } from "../development-checks"
import type { Box3, Vec3 } from "../schema"
import { project } from "./projection"
import { round3 } from "./round"

const DEFAULT_ASPECT = 1.25
const DEFAULT_PAD = 0.07

export const corners = ({ x, y, z, w, d, h }: Box3): Vec3[] =>
  [0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k): Vec3 => [x + i * w, y + j * d, z + k * h])))

const isBox = (item: Box3 | Vec3): item is Box3 => !Array.isArray(item)

const isFinitePoint = (point: Vec3): boolean => Number.isFinite(point[0]) && Number.isFinite(point[1]) && Number.isFinite(point[2])

export function frame(fit: ReadonlyArray<Box3 | Vec3>, aspect = DEFAULT_ASPECT, pad = DEFAULT_PAD): string {
  if (DEV) check("fit", fit, "frame() was given something that is not a box or an [x, y, z] point")
  if (DEV) check("plate", { aspect, pad }, "frame() needs a positive aspect and a small, non-negative pad")
  let left = Infinity
  let right = -Infinity
  let upper = Infinity
  let lower = -Infinity
  for (const item of fit) {
    for (const point of isBox(item) ? corners(item) : [item]) {
      if (!isFinitePoint(point)) continue
      const [screenX, screenY] = project(...point)
      left = Math.min(left, screenX)
      right = Math.max(right, screenX)
      upper = Math.min(upper, screenY)
      lower = Math.max(lower, screenY)
    }
  }
  if (left > right) return "0 0 100 100"
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT
  const margin = Number.isFinite(pad) && pad >= 0 ? pad : DEFAULT_PAD
  let width = Math.max(right - left, 1) * (1 + 2 * margin)
  let height = Math.max(lower - upper, 1) * (1 + 2 * margin)
  if (width / height < ratio) width = height * ratio
  else height = width / ratio
  return [(left + right - width) / 2, (upper + lower - height) / 2, width, height].map(round3).join(" ")
}
