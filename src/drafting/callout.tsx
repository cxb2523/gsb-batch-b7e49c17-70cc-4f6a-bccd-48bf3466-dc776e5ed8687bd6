import type { ReactNode } from "react"
import { classNames } from "../class-names"
import { project } from "../geometry/projection"
import { round3 } from "../geometry/round"
import type { Vec3 } from "../schema"

export type CalloutProps = {
  at: Vec3
  dx?: number | undefined
  dy?: number | undefined
  label: ReactNode
  className?: string | undefined
}

const SHELF = 6
const TEXT_GAP = 1.5

export function Callout({ at, dx = 18, dy = -14, label, className }: CalloutProps): ReactNode {
  const [x, y] = project(...at)
  const side = dx < 0 ? -1 : 1
  return (
    <g className={classNames("ik-drafting ik-callout", className)} transform={`translate(${round3(x)} ${round3(y)})`}>
      <circle className="ik-callout-dot" r={1.1} />
      <path className="ik-dimension-line" d={`M0 0L${dx} ${dy}h${side * SHELF}`} />
      <text className="ik-dimension-text" x={dx + side * (SHELF + TEXT_GAP)} y={dy} dominantBaseline="middle" textAnchor={side > 0 ? "start" : "end"}>
        {label}
      </text>
    </g>
  )
}
