import type { ReactNode } from "react"
import { Box, curve, front, Plate, path, side, top } from "react-isokit"

const CUBE = { x: 0, y: 0, z: 0, w: 60, d: 60, h: 40 }
const CORD = curve([60, 30, 1], [100, 30, 1], [100, 90, 1], [140, 90, 1])

export function GeometryExample(): ReactNode {
  return (
    <Plate role="img" hint="x down-right · y down-left · z up" readout="true isometric" fit={[CUBE, [140, 90, 0], [0, 0, 60]]} aspect={1.6} label="A box with a word drawn on each of its three planes and a cable leaving its side.">
      <path className="ik-line" d={path(CORD)} />
      <Box {...CUBE} r={6} />
      <g transform={top(CUBE.x, CUBE.y, CUBE.h)}>
        <text className="ik-label" x={10} y={34}>
          top()
        </text>
      </g>
      <g transform={front(CUBE.x, CUBE.y + CUBE.d, CUBE.h)}>
        <text className="ik-label" x={8} y={24}>
          front()
        </text>
      </g>
      <g transform={side(CUBE.x + CUBE.w, CUBE.y + CUBE.d, CUBE.h)}>
        <text className="ik-label" x={8} y={24}>
          side()
        </text>
      </g>
    </Plate>
  )
}
