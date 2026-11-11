import type { ReactNode } from "react"
import { classNames } from "../class-names"
import { top } from "../geometry/projection"
import { round3 } from "../geometry/round"
import { cornerRadius } from "../geometry/rounded-outline"

export type RippleProps = {
  x: number
  y: number
  z?: number | undefined
  w: number
  d: number
  r?: number | undefined
  inFace?: boolean | undefined
  className?: string | undefined
}

export function Ripple({ x, y, z = 0, w, d, r = 0, inFace = false, className }: RippleProps): ReactNode {
  return (
    <g transform={inFace ? `translate(${round3(x)} ${round3(y)})` : top(x, y, z)}>
      <g className={classNames("ik-ripple ik-loop", className)}>
        <rect width={w} height={d} rx={cornerRadius(w, d, r)} />
      </g>
    </g>
  )
}
