import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Plate, Press, path, playSound } from "react-isokit"
import { Dimension } from "react-isokit/drafting"
import "./page-press.css"
import type { FigureMeta } from "../../catalog/figure-meta"

const BASE = { x: 0, y: 0, z: 0, w: 168, d: 150, h: 10 }
const KEY = { x: 98, y: 124, z: 10, w: 60, d: 19, h: 6 }
const Z = BASE.h
const T = 3
type Part = { x: number; y: number; w: number; d: number }
type Block = { name: "nav" | "hero" | "cards" | "footer"; lift: number; parts: readonly Part[] }
const BLOCKS: readonly Block[] = [
  { name: "nav", lift: 62, parts: [{ x: 17, y: 23, w: 134, d: 8 }] },
  { name: "hero", lift: 44, parts: [{ x: 17, y: 35, w: 134, d: 32 }] },
  { name: "cards", lift: 27, parts: [{ x: 17, y: 71, w: 65, d: 26 }, { x: 86, y: 71, w: 65, d: 26 }] },
  { name: "footer", lift: 12, parts: [{ x: 17, y: 101, w: 134, d: 9 }] },
]
const ARROW = "M0 8L8 0M2.5 0H8V5.5"
const DROP_MS = 320
const DROP_STAGGER_MS = 60
const LANDED_MS = DROP_MS + (BLOCKS.length - 1) * DROP_STAGGER_MS
const LOCK_MS = LANDED_MS + 240
const PRESS_TIMING = { "--drop-ms": `${DROP_MS}ms`, "--drop-stagger": `${DROP_STAGGER_MS}ms`, "--top-delay": `${LANDED_MS - DROP_MS}ms`, "--lock-ms": `${LOCK_MS}ms` } as CSSProperties
const TALLEST = BLOCKS[0]?.lift ?? 0
const STACK_EDGE = { x: 151, y: 23 }

function Marks({ block, part, i }: { block: Block["name"]; part: Part; i: number }) {
  switch (block) {
    case "nav":
      return (
        <>
          <rect className="ik-fill" x={4} y={2.5} width={3} height={3} rx={1} />
          {[0, 1, 2].map((k) => (
            <path key={k} className="ik-detail" d={`M${92 + k * 12} 4h8`} />
          ))}
        </>
      )
    case "hero":
      return (
        <>
          <rect className="ik-fill" x={8} y={7} width={78} height={4} rx={2} />
          <rect className="ik-fill" x={8} y={14} width={52} height={4} rx={2} />
          <path className="ik-detail" d="M8 22.5h40" />
          <rect className="ik-face ik-top" x={98} y={9} width={26} height={9} rx={4.5} />
        </>
      )
    case "cards":
      return (
        <>
          <rect className="ik-well" x={4} y={3} width={part.w - 8} height={12} rx={2} />
          <path className="ik-detail" d={`M4 19.5h${i ? 34 : 44}M4 22.5h${i ? 22 : 28}`} />
        </>
      )
    case "footer":
      return <path className="ik-detail" d="M4 4.5h22M110 4.5h20" />
  }
}

export function PagePress() {
  const [live, setLive] = useState(false)
  const stop = useRef(() => {})
  const lock = useRef(0)
  useEffect(
    () => () => {
      stop.current()
      window.clearTimeout(lock.current)
    },
    [],
  )
  const publish = () => {
    stop.current()
    window.clearTimeout(lock.current)
    if (live) stop.current = playSound("whoosh")
    else {
      stop.current = playSound("cascade", { count: BLOCKS.length, stagger: DROP_STAGGER_MS / 1000, delay: DROP_MS / 1000 })
      lock.current = window.setTimeout(() => playSound("latch"), LOCK_MS)
    }
    setLive(!live)
  }
  const stack = Z + T + (live ? 0 : TALLEST)

  return (
    <Plate
      fig="Fig 3"
      name="Page press"
      hint={live ? "Press again" : "Press publish"}
      readout={live ? "live · your-idea.site" : `draft · ${BLOCKS.length} blocks`}
      className="page-press"
      data-live={live}
      style={PRESS_TIMING}
      fit={[BASE, { x: 17, y: 23, z: Z + 62, w: 134, d: 8, h: T + 3 }]}
      aspect={1.18}
      label="A webpage taken apart into blocks that float above their page. Press publish and they drop into place."
    >
      <Box
        {...BASE}
        r={10}
        top={
          <>
            <rect className="ik-detail" x={9} y={8} width={150} height={110} rx={6} />
            <path className="ik-detail" d="M9 19h150" />
            {[0, 1, 2].map((k) => (
              <circle key={k} className="ik-fill" cx={16 + k * 5.5} cy={13.5} r={1.6} />
            ))}
            <rect className="url" x={43} y={10.5} width={82} height={6} rx={3} />
            <rect className="lock" x={45.2} y={13.3} width={3.6} height={2.6} rx={0.5} />
            <g className="shackle">
              <path className="ik-detail" d="M45.9 13.3v-1a1.1 1.1 0 0 1 2.2 0v1" />
            </g>
            {BLOCKS.flatMap((b) => b.parts.map((p, k) => <rect key={`${b.name}-${k}`} className="ik-dash" x={p.x} y={p.y} width={p.w} height={p.d} rx={2} />))}
          </>
        }
      />

      {BLOCKS.flatMap((b) =>
        b.parts.map((p, k) => (
          <path
            key={`${b.name}-${k}`}
            className="ik-dash guide"
            d={path([[p.x, p.y + p.d, Z], [p.x, p.y + p.d, Z + b.lift]]) + path([[p.x + p.w, p.y + p.d, Z], [p.x + p.w, p.y + p.d, Z + b.lift]])}
          />
        )),
      )}

      {BLOCKS.map((b, i) => (
        <g key={b.name} className="block" style={{ "--drop": `${b.lift}px`, "--i": BLOCKS.length - 1 - i, "--j": i } as CSSProperties}>
          <g className="ik-float" style={{ animationDelay: `${-i * 0.9}s` }}>
            {b.parts.map((p, k) => (
              <Box key={`${b.name}-${k}`} x={p.x} y={p.y} z={Z + b.lift} w={p.w} d={p.d} h={T} r={2} top={<Marks block={b.name} part={p} i={k} />} />
            ))}
          </g>
        </g>
      ))}

      <Press label={live ? "Unpublish the page" : "Publish the page"} material="plastic" onPress={publish} data-hot={!live}>
        <g>
          <Box
            {...KEY}
            r={6}
            top={
              <>
                <text className="ik-label" x={7} y={12.5}>
                  PUBLISH
                </text>
                <path className="ik-live ik-thick" d={ARROW} transform="translate(46 5.5) scale(.95)" />
              </>
            }
          />
        </g>
      </Press>
      <Dimension from={[STACK_EDGE.x, STACK_EDGE.y, 0]} to={[STACK_EDGE.x, STACK_EDGE.y, stack]} offset={[14, 0, 0]} label={`h ${stack}`} />
    </Plate>
  )
}

export const meta = {
  slug: "page-press",
  title: "Page press",
  industry: "agents",
  level: 3,
  blurb: "Press publish: the page blocks drop into place, lowest first, the lock latches and the address goes live.",
  uses: ["Plate", "Box", "Press", "path", "playSound", "Dimension"],
  sounds: ["press", "release", "cascade", "latch", "whoosh"],
} satisfies FigureMeta

export default PagePress
