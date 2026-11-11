import { type ReactNode, useMemo } from "react"
import { top, type Vec3 } from "react-isokit"
import { Drum } from "./drum"
import { ellipse, seenThrough } from "./geometry"
import { usePartId } from "./part-id"
import "./parts.css"

export type RingProps = {
  at: Vec3
  r: number
  bore: number
  h: number
  depth?: number
  ribs?: number
  grooves?: readonly number[]
  className?: string
  top?: ReactNode
  wall?: ReactNode
  boreWall?: ReactNode
  floor?: ReactNode
  children?: ReactNode
}

export function Ring({ at, r, bore, h, depth = h, ribs, grooves, className, top: lid, wall, boreWall, floor, children }: RingProps): ReactNode {
  const id = usePartId("lab-ring")
  const [x, y, z] = at
  const rimZ = z + h
  const floorZ = rimZ - depth
  const paths = useMemo(() => {
    const axis = { x, y }
    return { opening: ellipse(axis, bore, rimZ), base: ellipse(axis, bore, floorZ), inside: seenThrough(axis, bore, rimZ) }
  }, [x, y, bore, rimZ, floorZ])
  return (
    <g className={className}>
      <Drum at={at} r={r} h={h} ribs={ribs} grooves={grooves} top={lid} wall={wall} />
      <defs>
        <clipPath id={`${id}-bore`}>
          <path d={paths.opening} />
        </clipPath>
        <clipPath id={`${id}-inside`}>
          <path d={paths.inside} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-bore)`}>
        <path className="lab-bore" d={paths.opening} />
        {boreWall}
        <path className="lab-floor" d={paths.base} />
        {floor != null && <g transform={top(x, y, floorZ)}>{floor}</g>}
      </g>
      <path className="ik-line" d={paths.opening} />
      {children != null && <g clipPath={`url(#${id}-inside)`}>{children}</g>}
    </g>
  )
}
