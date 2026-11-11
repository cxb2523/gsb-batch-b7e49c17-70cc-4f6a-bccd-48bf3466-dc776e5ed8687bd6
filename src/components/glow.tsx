import type { ReactNode } from "react"
import { classNames } from "../class-names"

export type GlowProps = {
  on?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}

export function Glow({ on = true, className, children }: GlowProps): ReactNode {
  return (
    <g className={classNames("ik-glow", className)} data-on={on}>
      <g className="ik-halo" aria-hidden="true">
        {children}
      </g>
      <g className="ik-halo ik-halo-core" aria-hidden="true">
        {children}
      </g>
      {children}
    </g>
  )
}
