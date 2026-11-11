import type { ReactNode } from "react"
import { around, onPlane } from "./geometry"
import "./parts.css"

export type BoltCircleProps = {
  count: number
  r: number
  size?: number
  phase?: number
  className?: string
}

export function BoltCircle({ count, r, size = 1.2, phase = 0, className }: BoltCircleProps): ReactNode {
  return (
    <g className={className ? `lab-bolts ${className}` : "lab-bolts"}>
      {around(count, phase).map((degrees) => {
        const [cx, cy] = onPlane(r, degrees)
        return <circle key={degrees} className="lab-bolt" cx={cx} cy={cy} r={size} />
      })}
    </g>
  )
}
