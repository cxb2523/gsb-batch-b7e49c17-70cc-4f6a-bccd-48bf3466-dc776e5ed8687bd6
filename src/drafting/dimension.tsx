import type { ReactNode } from "react"
import { classNames } from "../class-names"
import { dimension, witness } from "../geometry/dimension"
import type { Vec3 } from "../schema"

export type DimensionProps = {
  from: Vec3
  to: Vec3
  offset: Vec3
  label?: ReactNode
  className?: string | undefined
}

const WITNESS_GAP = 1.5
const WITNESS_OVERSHOOT = 2
const ARROW_START = "M2.6 -1.1L0 0L2.6 1.1"
const ARROW_END = "M-2.6 -1.1L0 0L-2.6 1.1"

export function Dimension({ from, to, offset, label, className }: DimensionProps): ReactNode {
  const { origin, angle, length, back } = dimension(from, to, offset)
  const leg = witness(back, WITNESS_GAP, WITNESS_OVERSHOOT)
  return (
    <g className={classNames("ik-drafting ik-dimension", className)}>
      <g transform={`translate(${origin[0]} ${origin[1]}) rotate(${angle})`}>
        <path className="ik-dimension-witness" d={leg} />
        <g className="ik-dimension-run" style={{ transform: `scaleX(${length})` }}>
          <path className="ik-dimension-line" d="M0 0H1" />
        </g>
        <path className="ik-dimension-line" d={ARROW_START} />
        <g className="ik-dimension-end" style={{ transform: `translateX(${length}px)` }}>
          <path className="ik-dimension-witness" d={leg} />
          <path className="ik-dimension-line" d={ARROW_END} />
        </g>
        {label != null && (
          <g className="ik-dimension-label" style={{ transform: `translateX(${length / 2}px)` }}>
            <text className="ik-dimension-text" y={-2.2} textAnchor="middle">
              {label}
            </text>
          </g>
        )}
      </g>
    </g>
  )
}
