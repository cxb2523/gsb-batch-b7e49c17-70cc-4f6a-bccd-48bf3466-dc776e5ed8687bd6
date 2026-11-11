import type { ReactNode } from "react"
import { Glow } from "react-isokit"
import "./parts.css"

export type LensProps = {
  r: number
  bezel?: number
  lit?: boolean
  className?: string
}

const BEZEL = 0.26
const INNER_RING = 0.5

export function Lens({ r, bezel = r * BEZEL, lit = false, className }: LensProps): ReactNode {
  const glass = r - bezel
  return (
    <g className={className ? `lab-lens ${className}` : "lab-lens"} data-lit={lit}>
      <circle className="lab-bezel" r={glass + 0.8} />
      <circle className="lab-glass" r={glass} />
      <Glow on={lit} className="lab-light-glow">
        <circle className="lab-light lab-glass-light" r={glass} />
      </Glow>
      <circle className="lab-glass-ring" r={glass * INNER_RING} />
    </g>
  )
}
