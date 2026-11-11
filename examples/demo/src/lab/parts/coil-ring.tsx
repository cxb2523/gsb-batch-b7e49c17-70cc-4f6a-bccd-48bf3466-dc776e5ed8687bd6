import { type CSSProperties, type ReactNode, useMemo } from "react"
import { Glow, type Vec3 } from "react-isokit"
import { coilRing } from "./geometry"
import { Ring } from "./ring"
import "./parts.css"

export type CoilRingProps = {
  at: Vec3
  r: number
  bore: number
  h: number
  depth?: number
  coils?: number
  fill?: number
  turns?: number
  lit?: boolean
  className?: string
  children?: ReactNode
}

export const COIL_FILL = 0.7

export function CoilRing({ at, r, bore, h, depth = h, coils = 10, fill = COIL_FILL, turns = 9, lit = false, className, children }: CoilRingProps): ReactNode {
  const [x, y, z] = at
  const shape = useMemo(() => coilRing({ x, y }, z, r, bore, h, depth, coils, fill, turns), [x, y, z, r, bore, h, depth, coils, fill, turns])
  return (
    <g className={className ? `lab-coil-ring ${className}` : "lab-coil-ring"} data-lit={lit}>
      <Ring
        at={at}
        r={r}
        bore={bore}
        h={h}
        depth={depth}
        top={
          <>
            {shape.windows.map((window) => (
              <g key={window.key} style={{ "--i": window.step } as CSSProperties}>
                <path className="lab-window" d={window.d} />
                <Glow on={lit} className="lab-light-glow">
                  <path className="lab-light lab-window-light" d={window.d} />
                </Glow>
              </g>
            ))}
            <path className="lab-copper" d={shape.tops} />
            <path className="lab-winding" d={shape.topTurns} />
          </>
        }
        wall={
          <>
            <path className="lab-copper lab-copper-wall" d={shape.walls} />
            <path className="lab-winding" d={shape.wallTurns} />
          </>
        }
        boreWall={
          <>
            <path className="lab-copper lab-copper-bore" d={shape.boreWalls} />
            <path className="lab-winding" d={shape.boreTurns} />
          </>
        }
        floor={
          <>
            <circle className="lab-reflector" r={bore} />
            <Glow on={lit} className="lab-light-glow">
              <circle className="lab-light lab-reflector-light" r={bore} />
            </Glow>
          </>
        }
      >
        {children}
      </Ring>
    </g>
  )
}
