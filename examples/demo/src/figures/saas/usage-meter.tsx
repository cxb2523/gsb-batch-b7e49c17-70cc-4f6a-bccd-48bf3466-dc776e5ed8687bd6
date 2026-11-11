import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./usage-meter.css"

export const meta = {
  slug: "usage-meter",
  title: "Usage meter",
  industry: "saas",
  level: 1,
  blurb: "Press +1K: the needle sweeps, the odometer rolls over with a carry and the bill climbs until the plan-limit light starts to pulse.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "curve", "path", "Callout"],
  sounds: ["press", "release", "roll", "notify"],
} satisfies FigureMeta

const BASE = { x: 0, y: 0, z: 0, w: 150, d: 120, h: 8 }
const BODY = { x: 14, y: 10, z: BASE.h, w: 112, d: 50, h: 96 }
const KEY = { x: 40, y: 78, z: BASE.h, w: 60, d: 30, h: 8 }
const JUNCTION = { x: 132, y: 12, z: BASE.h, w: 12, d: 10, h: 7 }
const PIVOT = { x: 56, y: 48 }
const ARC = 34
const SWEEP = 75
const START = 11
const NEAR = 15
const LIMIT = 16
const MAX = 20
const PRICE = 2
const CELL = { x: 14.2, y: 62, w: 10, h: 13, step: 11.4 }
const WHEELS = [0, 1, 2, 3, 4] as const
const CARRY_MS = 50
const WARN = { x: 100, y: 69 }
const SIDE_PORT = { y: BODY.y + BODY.d - 12, z: BODY.z + BODY.h - 70 }
const CABLE = path(
  curve(
    [BODY.x + BODY.w + 3, SIDE_PORT.y, SIDE_PORT.z],
    [BODY.x + BODY.w + 14, SIDE_PORT.y, SIDE_PORT.z - 6],
    [JUNCTION.x + 6, JUNCTION.y + 26, BASE.h + 3],
    [JUNCTION.x + 6, JUNCTION.y + JUNCTION.d, BASE.h + 3.5],
  ),
)
const PLATE_STYLE = { "--carry": `${CARRY_MS}ms` } as CSSProperties

const angle = (k: number) => -SWEEP + (2 * SWEEP * k) / MAX
const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180
  return [PIVOT.x + r * Math.sin(a), PIVOT.y - r * Math.cos(a)] as const
}
const tick = (k: number, r0: number, r1: number) => {
  const [x0, y0] = polar(angle(k), r0)
  const [x1, y1] = polar(angle(k), r1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`
}
const arc = (from: number, to: number, r: number) => {
  const [x0, y0] = polar(angle(from), r)
  const [x1, y1] = polar(angle(to), r)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}
const KS = Array.from({ length: MAX + 1 }, (_, k) => k)
const money = (k: number) => `$${(k * PRICE).toFixed(2)}`
const wheelsOf = (k: number) => String(k * 1000).padStart(WHEELS.length, "0").split("")

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

function readoutOf(k: number, reset: boolean): string {
  const base = `${k}k calls · ${money(k)}`
  if (reset) return `new cycle · ${base}`
  if (k >= LIMIT) return `${base} · over limit`
  if (k >= NEAR) return `${base} · near limit`
  return base
}

export default function UsageMeter() {
  const [meter, setMeter] = useState({ calls: START, previous: START, presses: 0 })
  const [touched, setTouched] = useState(false)
  const stop = useRef(() => {})
  const clip = useId().replace(/[^\w-]/g, "")
  useEffect(() => () => stop.current(), [])

  const { calls, previous, presses } = meter
  const add = (audible: boolean) => {
    const next = calls >= MAX ? 0 : calls + 1
    stop.current()
    if (audible) {
      const { turning } = carryOrder(wheelsOf(next), wheelsOf(calls))
      const stopRoll = playSound("roll", { count: turning, stagger: CARRY_MS / 1000 })
      const stopNotify = next === NEAR ? playSound("notify") : () => {}
      stop.current = () => {
        stopRoll()
        stopNotify()
      }
    }
    setMeter({ calls: next, previous: calls, presses: presses + 1 })
  }
  const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(
    () => {
      if (presses === 0) add(false)
    },
    { delay: 1700 },
  )
  const press = () => {
    dismiss()
    setTouched(true)
    add(true)
  }

  const warn = calls >= NEAR
  const digits = wheelsOf(calls)
  const before = wheelsOf(previous)
  const { order } = carryOrder(digits, before)
  const fresh = presses === 0

  return (
    <Plate
      {...plate}
      fig="SaaS"
      name="Usage meter"
      hint="Press +1K"
      readout={readoutOf(calls, presses > 0 && calls === 0)}
      className="fig-usage-meter"
      style={PLATE_STYLE}
      data-warn={warn}
      data-used={!fresh}
      fit={[BASE, { ...BODY, z: 0, h: BODY.z + BODY.h }]}
      aspect={1.3}
      label="A metered-billing meter with a needle gauge, a plan-limit mark, an odometer of API calls and a bill line. Press +1K to add a thousand calls and watch the needle, the count and the bill climb toward the limit."
    >
      <g ref={demoAnchor}>
        <Box {...BASE} r={10} top={[6, BASE.w - 6].map((x) => <circle key={x} className="ik-detail" cx={x} cy={BASE.d - 6} r={1.8} />)} />
        <Box
          {...BODY}
          r={8}
          top={
            <>
              {Array.from({ length: 7 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${30 + k * 8} 14v20`} />
              ))}
              <circle className="ik-detail" cx={10} cy={10} r={2} />
              <circle className="ik-detail" cx={BODY.w - 10} cy={BODY.d - 10} r={2} />
            </>
          }
          side={
            <>
              {Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${26 + k * 3.4} 10v40`} />
              ))}
              <rect className="ik-well" x={8} y={66} width={8} height={8} rx={1.5} />
            </>
          }
          front={
            <>
              <defs>
                <clipPath id={`${clip}-odo`}>
                  {WHEELS.map((k) => (
                    <rect key={k} x={CELL.x + k * CELL.step} y={CELL.y} width={CELL.w} height={CELL.h} rx={1.2} />
                  ))}
                </clipPath>
              </defs>
              <rect className="ik-screen" x={8} y={8} width={96} height={46} rx={5} />
              <path className="um-scale" d={arc(0, MAX, ARC)} />
              {KS.map((k) => (
                <path key={k} className="um-scale" d={k % 2 ? tick(k, ARC - 2.5, ARC) : tick(k, ARC - 5, ARC)} />
              ))}
              <path className="um-zone" d={arc(LIMIT, MAX, ARC + 2.5)} />
              <path className="um-limit" d={tick(LIMIT, ARC - 7, ARC + 5)} />
              <text className="ik-screen-text ik-dim" x={86} y={21} fontSize={5.6}>
                16k
              </text>
              <text className="ik-screen-text ik-dim" x={17} y={50} fontSize={5.6}>
                0
              </text>
              <text className="ik-screen-text ik-dim" x={95} y={50} fontSize={5.6} textAnchor="end">
                20k
              </text>
              <g className="um-needle" style={{ transform: `rotate(${angle(calls)}deg)`, transformOrigin: `${PIVOT.x}px ${PIVOT.y}px` } as CSSProperties}>
                <path className="um-hand" d={`M${PIVOT.x} ${PIVOT.y + 4}V${PIVOT.y - ARC + 4}`} />
              </g>
              <circle className="ik-face ik-top" cx={PIVOT.x} cy={PIVOT.y} r={3} />

              <rect className="ik-well" x={12} y={60} width={60} height={17} rx={2.5} />
              {WHEELS.map((k) => (
                <rect key={k} className="ik-screen" x={CELL.x + k * CELL.step} y={CELL.y} width={CELL.w} height={CELL.h} rx={1.2} />
              ))}
              <g clipPath={`url(#${clip}-odo)`}>
                {WHEELS.map((k) => {
                  const turn = order[k] ?? -1
                  const ink = k > 1 ? "ik-screen-text ik-dim" : "ik-screen-text"
                  const x = CELL.x + k * CELL.step + CELL.w / 2
                  return (
                    <g key={`${k}-${presses}`} style={{ "--i": turn } as CSSProperties}>
                      {turn >= 0 ? (
                        <text className={`${ink} um-roll-out`} x={x} y={CELL.y + 10} fontSize={9.5} textAnchor="middle">
                          {before[k]}
                        </text>
                      ) : null}
                      <text className={turn >= 0 ? `${ink} um-roll-in` : ink} x={x} y={CELL.y + 10} fontSize={9.5} textAnchor="middle">
                        {digits[k]}
                      </text>
                    </g>
                  )
                })}
              </g>
              <path className="ik-detail" d={`M12 ${CELL.y + CELL.h / 2}h1.6M70.4 ${CELL.y + CELL.h / 2}h1.6`} />
              <text className="ik-label um-small" x={76} y={71}>
                CALLS
              </text>
              <Glow on={warn}>
                <circle className="um-warn ik-loop" cx={WARN.x} cy={WARN.y} r={2.6} />
              </Glow>

              <rect className="ik-screen" x={12} y={82} width={88} height={10} rx={2} />
              <g key={calls} className="ik-enter">
                <text className="ik-screen-text ik-dim" x={15.5} y={89.2} fontSize={5.6}>
                  bill
                </text>
                <text className="ik-screen-text" x={96.5} y={89.6} fontSize={6.6} textAnchor="end">
                  {money(calls)}
                </text>
              </g>
            </>
          }
        />
        <Box x={BODY.x + BODY.w} y={SIDE_PORT.y - 3} z={SIDE_PORT.z - 3} w={3} d={6} h={6} r={1} />
        <Box
          {...JUNCTION}
          r={2}
          top={
            <>
              <path className="ik-detail" d="M3 5h6" />
              <circle className="ik-fill" cx={2} cy={2} r={0.8} />
              <circle className="ik-fill" cx={JUNCTION.w - 2} cy={JUNCTION.d - 2} r={0.8} />
            </>
          }
        />
        <path className="ik-line" d={CABLE} />

        {fresh && !touched && phase !== "aim" && phase !== "press" ? <Ripple {...KEY} r={6} /> : null}
        <Press label="Add a thousand calls" material="plastic" onPress={press} data-hot={fresh}>
          <g>
            <Box
              {...KEY}
              r={6}
              top={
                <>
                  <text className="ik-label um-key" x={9} y={19.5}>
                    +1K
                  </text>
                  <path className="ik-detail" d={`M${KEY.w - 22} 11v8M${KEY.w - 26} 15h8`} />
                  <path className="ik-detail" d={`M9 24h${KEY.w - 18}`} />
                </>
              }
            />
          </g>
        </Press>

        <Callout at={[BODY.x + WARN.x, BODY.y + BODY.d, BODY.z + BODY.h - WARN.y]} dx={18} dy={28} label={`warn ${NEAR}k`} />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={phase} />
      </g>
    </Plate>
  )
}
