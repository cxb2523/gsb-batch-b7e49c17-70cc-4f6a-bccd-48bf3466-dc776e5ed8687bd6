import { type ReactNode, useMemo } from "react"
import { Box, type Vec3 } from "react-isokit"
import { around, NEAR, nearArc, verticals, wallEdge, within } from "./geometry"
import "./parts.css"

export type DrumProps = {
  at: Vec3
  r: number
  h: number
  ribs?: number | undefined
  grooves?: readonly number[] | undefined
  className?: string | undefined
  top?: ReactNode
  wall?: ReactNode
}

const RIB_MARGIN = 4
const RIB_INSET = 1.2

export function Drum({ at: [x, y, z], r, h, ribs = 0, grooves, className, top: lid, wall }: DrumProps): ReactNode {
  const { ribLines, edge } = useMemo(() => {
    const axis = { x, y }
    const angles = ribs > 0 ? around(ribs, 180 / ribs).filter((degrees) => within(degrees, NEAR, RIB_MARGIN)) : []
    return { ribLines: angles.length ? verticals(axis, r, z + RIB_INSET, h - RIB_INSET * 2, angles) : "", edge: wallEdge(axis, r, z, h) }
  }, [x, y, z, r, h, ribs])
  const grooveLines = grooves?.map((lift) => nearArc({ x, y }, r, z + lift)).join("") ?? ""
  const dressed = wall != null || ribLines !== "" || grooveLines !== ""
  return (
    <Box x={x - r} y={y - r} z={z} w={r * 2} d={r * 2} h={h} r={r} {...(className ? { className } : {})} top={lid == null ? undefined : <g transform={`translate(${r} ${r})`}>{lid}</g>}>
      {ribLines && <path className="ik-detail" d={ribLines} />}
      {grooveLines && <path className="ik-detail" d={grooveLines} />}
      {wall}
      {dressed && <path className="ik-edge" d={edge} />}
    </Box>
  )
}
