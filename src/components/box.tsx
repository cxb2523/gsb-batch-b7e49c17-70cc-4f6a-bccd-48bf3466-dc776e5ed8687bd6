import { type ReactNode, useMemo } from "react"
import { check, DEV } from "../development-checks"
import { front, side, top } from "../geometry/projection"
import { outline, radius } from "../geometry/rounded-outline"
import type { Box3 } from "../schema"

export type BoxProps = Box3 & {
  r?: number
  className?: string
  top?: ReactNode
  front?: ReactNode
  side?: ReactNode
  children?: ReactNode
}

const isDrawable = (x: number, y: number, z: number, w: number, d: number, h: number): boolean => [x, y, z, w, d, h].every(Number.isFinite) && w >= 0 && d >= 0 && h >= 0

export function Box({ x, y, z, w, d, h, r = 0, className, top: lid, front: frontFace, side: sideFace, children }: BoxProps): ReactNode {
  if (DEV) check("box", { x, y, z, w, d, h }, `<Box x={${x}} y={${y}} z={${z}} w={${w}} d={${d}} h={${h}}> cannot be drawn`)
  const drawable = isDrawable(x, y, z, w, d, h)
  const corner = drawable ? radius({ x, y, z, w, d, h }, Number.isFinite(r) ? r : 0) : 0
  const hullPath = useMemo(() => (drawable ? outline({ x, y, z, w, d, h }, corner) : ""), [drawable, x, y, z, w, d, h, corner])
  if (!drawable) return null
  return (
    <g className={className}>
      <path className="ik-face" d={hullPath} />
      {d > 2 * corner && (
        <g transform={side(x + w, y + d - corner, z + h)}>
          <rect className="ik-tint" width={d - 2 * corner} height={h} />
        </g>
      )}
      <path className="ik-edge" d={hullPath} />
      <g transform={top(x, y, z + h)}>
        <rect className="ik-face ik-top" width={w} height={d} rx={corner} />
      </g>
      {sideFace != null && <g transform={side(x + w, y + d, z + h)}>{sideFace}</g>}
      {frontFace != null && <g transform={front(x, y + d, z + h)}>{frontFace}</g>}
      {lid != null && <g transform={top(x, y, z + h)}>{lid}</g>}
      {children}
    </g>
  )
}
