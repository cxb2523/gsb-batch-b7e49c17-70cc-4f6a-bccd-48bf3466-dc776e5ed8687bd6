import { type ReactNode, useMemo } from "react"
import { slots } from "./geometry"
import "./parts.css"

export type RadialSlotsProps = {
  count: number
  inner: number
  outer: number
  width: number
  lit?: boolean
  className?: string
}

export function RadialSlots({ count, inner, outer, width, lit = false, className }: RadialSlotsProps): ReactNode {
  const d = useMemo(() => slots(count, inner, outer, width), [count, inner, outer, width])
  return (
    <g className={className ? `lab-slots ${className}` : "lab-slots"} data-lit={lit}>
      <path className="lab-slot" d={d} />
      <path className="lab-light lab-slot-light" d={d} />
    </g>
  )
}
