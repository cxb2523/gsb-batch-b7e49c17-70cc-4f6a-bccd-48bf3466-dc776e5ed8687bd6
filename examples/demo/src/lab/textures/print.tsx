import { type CSSProperties, type ReactNode, useId } from "react"
import type { TextureId } from "../../catalog/lab-meta"
import { scatter } from "./scatter"
import "./print.css"

type Face = "top" | "front" | "side"
type Tones<Value> = Readonly<Record<Face, Value>>
type Surface = { name: string; face: Face; skewed: boolean }
type Draw = (id: string) => ReactNode

const FRONT_PLANE = "matrix(0.866 0.5 0 1 0 0)"
const PAPER: Tones<string> = { top: "tx-paper-top", front: "tx-paper-front", side: "tx-paper-side" }
const FACES: readonly Face[] = ["top", "front", "side"]
const SURFACES: readonly Surface[] = [
  { name: "top", face: "top", skewed: false },
  { name: "front", face: "front", skewed: true },
  { name: "side", face: "side", skewed: false },
  { name: "plane", face: "front", skewed: false },
]

function Tile({ id, surface, width, height, children }: { id: string; surface: Surface; width: number; height: number; children?: ReactNode }): ReactNode {
  return (
    <pattern id={`${id}-${surface.name}`} width={width} height={height} patternUnits="userSpaceOnUse" patternTransform={surface.skewed ? FRONT_PLANE : undefined}>
      <rect className={PAPER[surface.face]} width={width} height={height} />
      {surface.face === "top" ? null : children}
    </pattern>
  )
}

const RULE_PITCH: Tones<number> = { top: 0, front: 2.6, side: 1.5 }

const engrave: Draw = (id) =>
  SURFACES.map((surface) => {
    const pitch = RULE_PITCH[surface.face]
    return pitch ? (
      <Tile key={surface.name} id={id} surface={surface} width={pitch} height={4}>
        <path className="tx-rule" d={`M${pitch / 2} 0V4`} />
      </Tile>
    ) : (
      <Tile key={surface.name} id={id} surface={surface} width={4} height={4} />
    )
  })

const DOT_PITCH = 2.4
const DOT_RADIUS: Tones<number> = { top: 0.2, front: 0.55, side: 0.9 }
const SCREEN = [
  [0, 0],
  [DOT_PITCH, 0],
  [0, DOT_PITCH],
  [DOT_PITCH, DOT_PITCH],
  [DOT_PITCH / 2, DOT_PITCH / 2],
] as const

const halftone: Draw = (id) =>
  SURFACES.map((surface) => (
    <Tile key={surface.name} id={id} surface={surface} width={DOT_PITCH} height={DOT_PITCH}>
      {SCREEN.map(([cx, cy]) => (
        <circle key={`${cx} ${cy}`} className="tx-dot" cx={cx} cy={cy} r={DOT_RADIUS[surface.face]} />
      ))}
    </Tile>
  ))

const STIPPLE_TILE = 26
const STIPPLE_DOTS = new Map(
  FACES.map((face, index) => [face, scatter({ count: [6, 24, 58][index] ?? 0, w: STIPPLE_TILE, d: STIPPLE_TILE, seed: 11 + index * 7, size: [0.32, 0.46] })]),
)

const stipple: Draw = (id) =>
  SURFACES.map((surface) => (
    <Tile key={surface.name} id={id} surface={surface} width={STIPPLE_TILE} height={STIPPLE_TILE}>
      {STIPPLE_DOTS.get(surface.face)?.map(({ x, y, r }) => (
        <circle key={`${x} ${y}`} className="tx-dot" cx={x} cy={y} r={r} />
      ))}
    </Tile>
  ))

const CELL = 1.6
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const
const DITHER_LEVEL: Tones<number> = { top: 0, front: 2, side: 4 }
const ditherCells = (level: number): string =>
  BAYER.flatMap((rank, index) => (rank < level ? [`M${(index % 4) * CELL} ${Math.floor(index / 4) * CELL}h${CELL}v${CELL}h${-CELL}Z`] : [])).join("")
const DITHER_CELLS = new Map(FACES.map((face) => [face, ditherCells(DITHER_LEVEL[face])]))

const dither: Draw = (id) =>
  SURFACES.map((surface) => (
    <Tile key={surface.name} id={id} surface={surface} width={CELL * 4} height={CELL * 4}>
      <path className="tx-dot" d={DITHER_CELLS.get(surface.face)} />
    </Tile>
  ))

const GLYPH_CELL = { width: 3, height: 4 }
const GLYPHS: Tones<string> = { top: ".", front: ":", side: "=" }

const ascii: Draw = (id) =>
  SURFACES.map((surface) => (
    <Tile key={surface.name} id={id} surface={surface} {...GLYPH_CELL}>
      <text className="tx-glyph" x={GLYPH_CELL.width / 2} y={GLYPH_CELL.height - 1} textAnchor="middle">
        {GLYPHS[surface.face]}
      </text>
    </Tile>
  ))

const TREATMENTS: ReadonlyMap<TextureId, Draw> = new Map([
  ["engrave", engrave],
  ["halftone", halftone],
  ["stipple", stipple],
  ["dither", dither],
  ["ascii", ascii],
])

export type Print = { id: string; style: CSSProperties }

export const PLAIN = { "--tx-top": "var(--ik-top)", "--tx-front": "var(--ik-front)", "--tx-side": "var(--ik-side)", "--tx-plane": "var(--ik-front)" } as CSSProperties

export function usePrint(): Print {
  const id = `tx-print${useId().replace(/[^\w-]/g, "")}`
  return { id, style: { "--tx-top": `url(#${id}-top)`, "--tx-front": `url(#${id}-front)`, "--tx-side": `url(#${id}-side)`, "--tx-plane": `url(#${id}-plane)` } as CSSProperties }
}

export function PrintDefs({ id, treatment }: { id: string; treatment: TextureId }): ReactNode {
  return <defs>{TREATMENTS.get(treatment)?.(id)}</defs>
}
