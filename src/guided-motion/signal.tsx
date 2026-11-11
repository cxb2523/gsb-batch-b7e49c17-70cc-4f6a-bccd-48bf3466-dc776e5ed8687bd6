import type { ReactNode } from "react"
import { classNames } from "../class-names"
import { path } from "../geometry/projection"
import type { Vec3 } from "../schema"

export type SignalProps = {
  points: readonly Vec3[]
  delay?: number | undefined
  duration?: number | undefined
  className?: string | undefined
}

export function Signal({ points, delay = 0, duration = 320, className }: SignalProps): ReactNode {
  return <path className={classNames("ik-signal", className)} d={path(points)} pathLength={100} style={{ animationDelay: `${delay}ms`, animationDuration: `${duration}ms` }} />
}
