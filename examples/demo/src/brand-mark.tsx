import type { ReactNode } from "react"

type BrandMarkProps = { x?: number; y?: number; size?: number; className?: string }

export function BrandMark({ x = 0, y = 0, size = 10, className }: BrandMarkProps): ReactNode {
  const halfWidth = Math.cos(Math.PI / 6) * size
  const half = size / 2
  const topFace = `M0 ${-size}L${halfWidth} ${-half}L0 0L${-halfWidth} ${-half}Z`
  const leftFace = `M${-halfWidth} ${-half}L0 0L0 ${size}L${-halfWidth} ${half}Z`
  const rightFace = `M${halfWidth} ${-half}L0 0L0 ${size}L${halfWidth} ${half}Z`
  return (
    <g className={className} transform={`translate(${x} ${y})`}>
      <path d={topFace} />
      <path d={leftFace} opacity={0.72} />
      <path d={rightFace} opacity={0.45} />
    </g>
  )
}
