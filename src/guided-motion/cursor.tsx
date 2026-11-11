import type { ReactNode } from "react"
import { classNames } from "../class-names"
import { project } from "../geometry/projection"
import { round3 } from "../geometry/round"
import type { Vec3 } from "../schema"
import type { DemoPhase } from "./use-demo-tap"

export type CursorProps = {
  at: Vec3
  phase: DemoPhase
  size?: number | undefined
  className?: string | undefined
}

const ARROW_PATH = "M0 0V15.6l3.9-3.7 2.7 5.9 2.7-1.2-2.6-5.7H12.2Z"

export function Cursor({ at, phase, size = 1, className }: CursorProps): ReactNode {
  if (phase === "waiting" || phase === "done") return null
  const [x, y] = project(...at)
  return (
    <g className={classNames("ik-cursor", className)} data-phase={phase} transform={`translate(${round3(x)} ${round3(y)}) scale(${round3(size)})`}>
      <circle className="ik-cursor-ring" r={4} />
      <g className="ik-cursor-arrow">
        <path d={ARROW_PATH} />
      </g>
    </g>
  )
}
