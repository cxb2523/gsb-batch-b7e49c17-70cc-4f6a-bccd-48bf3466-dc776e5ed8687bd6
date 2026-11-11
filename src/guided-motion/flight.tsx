import type { CSSProperties, ReactNode } from "react"
import { classNames } from "../class-names"
import { project } from "../geometry/projection"
import { round3 } from "../geometry/round"
import type { Vec3 } from "../schema"

export type FlightProps = {
  from: Vec3
  to: Vec3
  delay?: number | undefined
  duration?: number | undefined
  lift?: number | undefined
  className?: string | undefined
  children: ReactNode
}

export function Flight({ from, to, delay = 0, duration = 520, lift = 26, className, children }: FlightProps): ReactNode {
  const [fromX, fromY] = project(...from)
  const [toX, toY] = project(...to)
  const style = {
    "--ik-dx": `${round3(toX - fromX)}px`,
    "--ik-dy": `${round3(toY - fromY)}px`,
    "--ik-lift": `${-lift}px`,
    animationDelay: `${delay}ms`,
    animationDuration: `${duration}ms`,
  } as CSSProperties
  return (
    <g className={classNames("ik-flight", className)} style={style}>
      <g className="ik-flight-arc">{children}</g>
    </g>
  )
}
