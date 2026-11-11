import type { ReactNode } from "react"
import "./parts.css"

export type SeatProps = {
  r: number
  hole?: number
  className?: string
}

export function Seat({ r, hole = 0, className }: SeatProps): ReactNode {
  return (
    <g className={className ? `lab-seat ${className}` : "lab-seat"}>
      <circle className="lab-seat-ring" r={r} />
      {hole > 0 && <circle className="lab-hole" r={hole} />}
    </g>
  )
}
