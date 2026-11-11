import type { ReactNode } from "react"
import { Box, Plate } from "react-isokit"

const DEVICE = { x: 0, y: 0, z: 0, w: 120, d: 70, h: 52 }
const VENTS = [0, 1, 2, 3, 4, 5] as const

export function BoxExample(): ReactNode {
  return (
    <Plate role="img" fit={[DEVICE]} aspect={1.6} hint="Three faces, three planes" readout="top · front · side" label="A rounded box with a label drawn on its lid, a screen on its front face and vents on its side.">
      <Box
        {...DEVICE}
        r={10}
        top={
          <text className="ik-label" x={12} y={24}>
            TOP
          </text>
        }
        front={
          <>
            <rect className="ik-screen" x={10} y={8} width={70} height={24} rx={4} />
            <text className="ik-screen-text" x={16} y={24} fontSize={8}>
              front
            </text>
          </>
        }
        side={
          <>
            {VENTS.map((vent) => (
              <path key={vent} className="ik-detail" d={`M${12 + vent * 4} 12v20`} />
            ))}
            <text className="ik-label" x={40} y={30}>
              SIDE
            </text>
          </>
        }
      />
    </Plate>
  )
}
