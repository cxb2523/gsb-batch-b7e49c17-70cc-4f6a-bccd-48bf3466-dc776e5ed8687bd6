import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, playSound, Ripple, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./metrics-board.css"

export const meta = {
  slug: "metrics-board",
  title: "Metrics board",
  industry: "saas",
  level: 1,
  blurb: "Press a range key: the bar columns rebuild slab by slab and the headline signups number rolls over to the new total.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "Callout"],
  sounds: ["press", "release", "roll"],
} satisfies FigureMeta

type Range = "7d" | "30d" | "90d"
type View = { range: Range; previous: Range; step: number; refresh: number }

const BASE = { x: 0, y: 0, z: 0, w: 176, d: 132, h: 8 }
const FOOT = { x: 70, y: 7, z: BASE.h, w: 36, d: 15, h: 2.5 }
const NECK = { x: 82, y: 10, z: FOOT.z + FOOT.h, w: 12, d: 8, h: 34 }
const PANEL = { x: 8, y: 18, z: 40, w: 160, d: 8, h: 64 }
const SHELF = { x: 14, y: 44, z: BASE.h, w: 148, d: 26, h: 5 }
const COL = { y: SHELF.y + 7, w: 12, d: 12, h: 3.4, step: 4.2, gap: 20, inset: 7 }
const KEY = { y: 96, z: BASE.h, w: 34, d: 20, h: 5 }
const COLUMNS = [0, 1, 2, 3, 4, 5, 6] as const
const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const
const HEADLINE = { x: 14, y: 36, size: 16, chars: 5 }
const PITCH = HEADLINE.size * 0.6
const WINDOW = { x: HEADLINE.x - 1, y: 22, w: HEADLINE.chars * PITCH + 2, h: 18 }
const CHARS = Array.from({ length: HEADLINE.chars }, (_, k) => k)
const CARRY_MS = 50
const RANGES: ReadonlyArray<{ id: Range; label: string; x: number; days: number }> = [
  { id: "7d", label: "7D", x: 50, days: 7 },
  { id: "30d", label: "30D", x: 90, days: 30 },
  { id: "90d", label: "90D", x: 130, days: 90 },
]
const DAYS: ReadonlyMap<Range, number> = new Map(RANGES.map((r) => [r.id, r.days]))
const DATA: Readonly<Record<Range, { bars: readonly number[]; total: string; delta: string }>> = {
  "7d": { bars: [4, 6, 5, 7, 6, 8, 9], total: "312", delta: "+6%" },
  "30d": { bars: [3, 4, 4, 6, 7, 8, 10], total: "1,284", delta: "+18%" },
  "90d": { bars: [2, 3, 5, 4, 6, 8, 9], total: "3,910", delta: "+41%" },
}
const UP = "M0 6L4 0L8 6Z"
const VENTS = Array.from({ length: 14 }, (_, k) => k)
const PLATE_STYLE = { "--carry": `${CARRY_MS}ms` } as CSSProperties

const colX = (i: number) => SHELF.x + COL.inset + i * COL.gap
const heightOf = (range: Range, i: number) => DATA[range].bars[i] ?? 0
const charsOf = (range: Range) => DATA[range].total.padStart(HEADLINE.chars, " ").split("")

function slabOrder(level: number, from: number, to: number) {
  if (to > from && level >= from && level < to) return level - from
  if (to < from && level >= to && level < from) return from - 1 - level
  return 0
}

function carryOrder(now: readonly string[], was: readonly string[]) {
  const order = now.map(() => -1)
  let turning = 0
  for (let k = now.length - 1; k >= 0; k--) {
    if (now[k] !== was[k]) {
      order[k] = turning
      turning++
    }
  }
  return { order, turning }
}

export default function MetricsBoard() {
  const [view, setView] = useState<View>({ range: "7d", previous: "7d", step: 0, refresh: 0 })
  const [touched, setTouched] = useState(false)
  const stop = useRef(() => {})
  const clip = useId().replace(/[^\w-]/g, "")
  useEffect(() => () => stop.current(), [])

  const { range, previous, step, refresh } = view
  const data = DATA[range]
  const choose = (next: Range, audible: boolean) => {
    stop.current()
    const { turning } = carryOrder(charsOf(next), charsOf(range))
    if (audible && turning > 0) stop.current = playSound("roll", { count: turning, stagger: CARRY_MS / 1000 })
    setView({ range: next, previous: range, step: step + 1, refresh: next === range ? refresh + 1 : 0 })
  }
  const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(
    () => {
      if (step === 0) choose("30d", false)
    },
    { delay: 1800 },
  )
  const press = (next: Range) => {
    dismiss()
    setTouched(true)
    choose(next, true)
  }

  const days = DAYS.get(range) ?? 7
  const hot = step === 0
  const again = refresh ? ` · refreshed${refresh > 1 ? ` ×${refresh}` : ""}` : ""
  const hotKey = RANGES[1] ?? RANGES[0]
  const chars = charsOf(range)
  const before = charsOf(previous)
  const { order } = carryOrder(chars, before)

  return (
    <Plate
      {...plate}
      fig="SaaS"
      name="Metrics board"
      hint={hot ? "Press 30D" : "Pick a range"}
      readout={`${range} · signups ${data.delta}${again}`}
      className="fig-metrics-board"
      style={PLATE_STYLE}
      data-chosen={!hot}
      fit={[BASE, PANEL, { ...PANEL, z: 0, h: PANEL.z + PANEL.h }]}
      aspect={1.3}
      label="A dashboard monitor with a shelf of bar columns in front of it and three range keys. Press 7D, 30D or 90D to rebuild the chart for that range."
    >
      <g ref={demoAnchor}>
        <Box
          {...BASE}
          r={10}
          top={
            <>
              <text className="ik-label range-label" x={12} y={112}>
                RANGE
              </text>
              {[
                [6, BASE.d - 6],
                [BASE.w - 6, BASE.d - 6],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-detail" cx={cx} cy={cy} r={1.8} />
              ))}
            </>
          }
        />
        <Box {...FOOT} r={6} top={<rect className="ik-well" x={FOOT.w / 2 - 7} y={FOOT.d - 5} width={14} height={2.6} rx={1.3} />} />
        <Box {...NECK} r={3} front={<rect className="ik-well" x={NECK.w / 2 - 2.5} y={NECK.h - 12} width={5} height={7} rx={2.5} />} />
        <Box
          {...PANEL}
          r={3}
          top={VENTS.map((k) => (
            <path key={k} className="ik-detail" d={`M${PANEL.w / 2 - 33 + k * 5} 2.6v2.8`} />
          ))}
          front={
            <>
              <defs>
                <clipPath id={`${clip}-total`}>
                  <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} />
                </clipPath>
              </defs>
              <rect className="ik-screen" x={6} y={5} width={PANEL.w - 12} height={48} rx={4} />
              <g key={`${range}-${step}`} className="ik-enter">
                <text className="ik-screen-text ik-dim" x={14} y={16} fontSize={6}>
                  {`signups · last ${days} days`}
                </text>
                <path className="ik-screen-text" d={UP} transform="translate(107 25.6)" />
                <text className="ik-screen-text" x={146} y={32} fontSize={11} textAnchor="end">
                  {data.delta}
                </text>
                <text className="ik-screen-text ik-dim" x={14} y={47} fontSize={5.6}>
                  {`vs prior ${days} days`}
                </text>
              </g>
              <g clipPath={`url(#${clip}-total)`}>
                {CHARS.map((k) => {
                  const turn = order[k] ?? -1
                  const x = HEADLINE.x + k * PITCH
                  return (
                    <g key={`${k}-${step}`} style={{ "--i": turn } as CSSProperties}>
                      {turn >= 0 ? (
                        <text className="ik-screen-text mb-roll-out" x={x} y={HEADLINE.y} fontSize={HEADLINE.size}>
                          {before[k]}
                        </text>
                      ) : null}
                      <text className={turn >= 0 ? "ik-screen-text mb-roll-in" : "ik-screen-text"} x={x} y={HEADLINE.y} fontSize={HEADLINE.size}>
                        {chars[k]}
                      </text>
                    </g>
                  )
                })}
              </g>
              <path className="ik-detail" d={`M14 40.5h${PANEL.w - 28}`} />
              <circle className="ik-fill" cx={PANEL.w - 9} cy={58.5} r={1.4} />
              <path className="ik-detail" d={`M${PANEL.w / 2 - 8} 58.5h16`} />
            </>
          }
        />
        <Box
          {...SHELF}
          r={4}
          top={COLUMNS.map((i) => (
            <rect key={i} className="ik-well" x={colX(i) - SHELF.x - 2} y={COL.y - SHELF.y - 2} width={COL.w + 4} height={COL.d + 4} rx={2} />
          ))}
          front={COLUMNS.map((i) => (
            <path key={i} className="ik-detail" d={`M${colX(i) - SHELF.x + COL.w / 2} 1.2v2.6`} />
          ))}
        />
        {COLUMNS.map((i) =>
          LEVELS.map((level) => (
            <g
              key={`${i}-${level}`}
              className="slab"
              data-on={level < heightOf(range, i)}
              style={{ "--col": i, "--slab": slabOrder(level, heightOf(previous, i), heightOf(range, i)) } as CSSProperties}
            >
              <Box x={colX(i)} y={COL.y} z={SHELF.z + SHELF.h + level * COL.step} w={COL.w} d={COL.d} h={COL.h} r={1.5} />
            </g>
          )),
        )}
        {!touched && hot && phase !== "aim" && phase !== "press" && hotKey ? <Ripple x={hotKey.x} y={KEY.y} z={KEY.z} w={KEY.w} d={KEY.d} r={5} /> : null}
        {RANGES.map((r) => (
          <Press
            key={r.id}
            className="range"
            label={`Show the last ${r.days} days`}
            material="rubber"
            onPress={() => press(r.id)}
            data-on={range === r.id}
            data-hot={hot && r.id === "30d"}
          >
            <g>
              <Box
                x={r.x}
                y={KEY.y}
                z={KEY.z}
                w={KEY.w}
                d={KEY.d}
                h={KEY.h}
                r={5}
                top={
                  <>
                    <text className="ik-label key" x={7} y={13.2}>
                      {r.label}
                    </text>
                    <Glow on={range === r.id}>
                      <circle className="led" cx={KEY.w - 7} cy={KEY.d / 2} r={1.9} />
                    </Glow>
                  </>
                }
              />
            </g>
          </Press>
        ))}
        <Callout at={[colX(6) + COL.w, COL.y, SHELF.z + SHELF.h + heightOf(range, 6) * COL.step]} dx={22} dy={26} label="latest" />
        {hotKey ? <Cursor at={[hotKey.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={phase} /> : null}
      </g>
    </Plate>
  )
}
