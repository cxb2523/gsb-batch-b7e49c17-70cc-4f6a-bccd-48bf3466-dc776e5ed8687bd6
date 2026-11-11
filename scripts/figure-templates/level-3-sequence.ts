import { attribute, type FigureFiles, quoted, scope, type TemplateInput } from "./template-input.ts"

const STAGGER_MS = 60
const SEAT_MS = 420
const LIFT = 10

export function levelThreeSequence(input: TemplateInput): FigureFiles {
  const tsx = `import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, Plate, Press, playSound, Ripple, useDemoTap } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./${input.slug}.css"

export const meta = {
  slug: ${quoted(input.slug)},
  title: ${quoted(input.title)},
  industry: ${quoted(input.industry)},
  level: 3,
  blurb: ${quoted(input.blurb)},
  uses: ["Plate", "Box", "Press", "Ripple", "Cursor", "useDemoTap"],
  sounds: ["press", "release", "cascade", "whoosh"],
} satisfies FigureMeta

const BASE = { x: 0, y: 0, z: 0, w: 176, d: 134, h: 10 }
const RISER = { x: 0, y: 0, z: 10, w: 176, d: 34, h: 40 }
const SCREEN = { x: 10, y: 8, w: 92, h: 24 }
const CELL = { w: 26, d: 26, h: 12, gap: 6, y: 62, lift: ${LIFT} }
const CELLS = [0, 1, 2, 3, 4] as const
const KEY = { x: 60, y: 102, z: 10, w: 56, d: 22, h: 7 }
const STAGGER_MS = ${STAGGER_MS}
const SEAT_MS = ${SEAT_MS}
const SETTLED_MS = STAGGER_MS * (CELLS.length - 1) + SEAT_MS
const cellX = (index: number) => 10 + index * (CELL.w + CELL.gap)

export default function ${input.componentName}() {
  const [filled, setFilled] = useState(false)
  const [runs, setRuns] = useState(0)
  const [settled, setSettled] = useState(true)
  const settle = useRef(0)
  const stopSound = useRef(() => {})
  useEffect(
    () => () => {
      window.clearTimeout(settle.current)
      stopSound.current()
    },
    [],
  )
  const run = (audible: boolean) => {
    const next = !filled
    window.clearTimeout(settle.current)
    stopSound.current()
    if (audible) stopSound.current = next ? playSound("cascade", { count: CELLS.length, stagger: STAGGER_MS / 1000, delay: SEAT_MS / 1000 }) : playSound("whoosh")
    setFilled(next)
    setRuns((count) => count + 1)
    setSettled(false)
    settle.current = window.setTimeout(() => setSettled(true), SETTLED_MS)
  }
  const demo = useDemoTap(() => run(false))
  const press = () => {
    demo.dismiss()
    run(true)
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const progress = filled ? (settled ? \`\${CELLS.length} of \${CELLS.length} · seated\` : "seating") : runs ? (settled ? "cleared" : "clearing") : "empty"
  return (
    <Plate
      {...demo.plate}
      fig="${attribute(input.industryTitle)}"
      name="${attribute(input.title)}"
      hint={filled ? "Press to clear" : "Press run"}
      readout={progress}
      className="fig-${input.slug}"
      data-filled={filled}
      fit={[BASE, RISER, { x: 0, y: CELL.y, z: BASE.h + CELL.lift + CELL.h, w: 176, d: CELL.d, h: 0 }]}
      aspect={1.3}
      label="${attribute(input.label)}"
    >
      <g ref={demo.ref}>
        <Box {...BASE} r={10} />
        <Box
          {...RISER}
          r={8}
          front={
            <>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={3} />
              <g key={progress} className="ik-enter">
                <text className="ik-screen-text" x={SCREEN.x + 6} y={SCREEN.y + 15} fontSize={7}>
                  {progress}
                </text>
              </g>
            </>
          }
        />
        {CELLS.map((index) => (
          <g key={index} className="cell" style={{ "--i": filled ? index : CELLS.length - 1 - index } as CSSProperties}>
            <Box x={cellX(index)} y={CELL.y} z={BASE.h + CELL.lift} w={CELL.w} d={CELL.d} h={CELL.h} r={4} />
          </g>
        ))}
        {runs || aiming ? null : <Ripple {...KEY} r={5} />}
        <Press label={filled ? "Clear the row" : "Run the row"} material="plastic" onPress={press} data-hot={settled}>
          <g>
            <Box {...KEY} r={5} />
          </g>
        </Press>
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
`
  const css = `${scope(input)} .cell { transform: translateY(0); transition: transform ${SEAT_MS}ms var(--ik-spring) calc(var(--i) * ${STAGGER_MS}ms); }
${scope(input)} svg[data-filled="true"] .cell { transform: translateY(${LIFT}px); }
`
  return { tsx, css }
}
