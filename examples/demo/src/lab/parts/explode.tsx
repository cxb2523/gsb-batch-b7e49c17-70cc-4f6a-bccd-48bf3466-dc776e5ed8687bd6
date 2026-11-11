import type { CSSProperties, ReactNode } from "react"
import "./parts.css"

export type ExplodedProps = {
  assembled: boolean
  joints: number
  children: ReactNode
}

export type LiftProps = {
  joint: number
  span?: number
  children: ReactNode
}

export function Exploded({ assembled, joints, children }: ExplodedProps): ReactNode {
  return (
    <g className="lab-exploded" data-assembled={assembled} style={{ "--lab-joints": joints } as CSSProperties}>
      {children}
    </g>
  )
}

export function Lift({ joint, span = 1, children }: LiftProps): ReactNode {
  return (
    <g className="lab-lift" style={{ "--joint": joint, "--span": span } as CSSProperties}>
      {children}
    </g>
  )
}

export function Lifted({ spans, children }: { spans: readonly number[]; children: ReactNode }): ReactNode {
  return spans.reduceRight<ReactNode>(
    (inner, span, joint) => (
      <Lift key={joint} joint={joint} span={span}>
        {inner}
      </Lift>
    ),
    children,
  )
}
