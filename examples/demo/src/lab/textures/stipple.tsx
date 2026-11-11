import type { CSSProperties, ReactNode } from "react"
import type { Speck } from "./scatter"

export type StippleProps = { specks: readonly Speck[]; on: boolean; loop?: boolean }

export function Stipple({ specks, on, loop = false }: StippleProps): ReactNode {
  const speckClass = loop ? "tx-speck ik-loop" : "tx-speck"
  return (
    <g className="tx-stipple" data-on={on} aria-hidden="true">
      {specks.map(({ x, y, r, order }) => (
        <circle key={`${x} ${y}`} className={speckClass} cx={x} cy={y} r={r} style={{ "--i": order } as CSSProperties} />
      ))}
    </g>
  )
}
