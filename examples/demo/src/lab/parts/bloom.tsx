import type { CSSProperties, ReactNode } from "react"
import { top, type Vec3 } from "react-isokit"
import { usePartId } from "./part-id"
import "./parts.css"

export type LightSource = { x: number; y: number; r: number; step?: number; weight?: number }

export type BloomProps = {
  at: Vec3
  sources: readonly LightSource[]
  on?: boolean
  className?: string
}

const FALLOFF = [
  [0, 1],
  [0.12, 0.62],
  [0.3, 0.3],
  [0.55, 0.11],
  [1, 0],
] as const

export function Bloom({ at: [x, y, z], sources, on = false, className }: BloomProps): ReactNode {
  const id = usePartId("lab-bloom")
  return (
    <g className={className ? `lab-bloom ${className}` : "lab-bloom"} data-on={on} aria-hidden="true" transform={top(x, y, z)}>
      <defs>
        <radialGradient id={id}>
          {FALLOFF.map(([offset, opacity]) => (
            <stop key={offset} className={offset === 0 ? "lab-bloom-hot" : "lab-bloom-stop"} offset={offset} stopOpacity={opacity} />
          ))}
        </radialGradient>
      </defs>
      {sources.map((source) => (
        <circle
          key={`${source.x} ${source.y} ${source.r}`}
          className="lab-bloom-source"
          cx={source.x}
          cy={source.y}
          r={source.r}
          fill={`url(#${id})`}
          style={{ "--i": source.step ?? 0, "--w": source.weight ?? 1 } as CSSProperties}
        />
      ))}
    </g>
  )
}
