import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, playSound, Ripple, side, useDemoTap } from "react-isokit"
import { Dimension } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./assembly-line.css"

export const meta = {
  slug: "assembly-line",
  title: "Assembly line",
  industry: "manufacturing",
  level: 3,
  blurb: "Press run: the conveyor motor indexes a truck chassis down the line, three stations lower in its battery, its body and its cab, and the built counter rolls on a unit.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "side", "Dimension"],
  sounds: ["press", "release", "motor", "cascade", "roll", "complete"],
} satisfies FigureMeta

type PartId = "battery" | "body" | "cab"
type Part = { id: PartId; x: number; y: number; z: number; w: number; d: number; h: number }
type Run = { unit: number; from: number; step: number }
type Wheel = { digit: string; before: string; rank: number }

const BASE = { x: 0, y: 0, z: 0, w: 204, d: 104, h: 8 }
const CONSOLE = { x: 8, y: 74, z: 8, w: 66, d: 22, h: 18 }
const SCREEN = { x: 4, y: 2.5, w: 58, h: 13 }
const BELT = { x: 6, y: 26, z: 8, w: 192, d: 36, h: 12 }
const CY = BELT.y + BELT.d / 2
const IN = 26
const DOCKS = [64, 102, 140] as const
const OUT = 178
const CHASSIS = { x: -9, y: -17, z: 25, w: 18, d: 34, h: 4 }
const WHEEL = { at: [7, 27] as const, cy: 4, r: 5 }
const PARTS: readonly Part[] = [
  { id: "battery", x: -7, y: -14, z: 29, w: 14, d: 28, h: 4 },
  { id: "body", x: -8, y: -16, z: 33, w: 16, d: 18, h: 16 },
  { id: "cab", x: -7, y: 4, z: 33, w: 14, d: 11, h: 12 },
]
const LIFT = 22
const COLUMN = { y: 12, z: 8, w: 10, d: 10, h: 86 }
const ARM = { y: 12, z: COLUMN.z + COLUMN.h, w: 12, d: 50, h: 8 }
const GRIP = { w: 12, d: 8, h: 5 }
const ROD = 4
const KEY = { x: 15, y: 76, z: CONSOLE.z + CONSOLE.h, w: 50, d: 14, h: 5 }
const MOTOR = { x: 155, y: BELT.y + BELT.d + 1, z: BASE.h, w: 15, d: 15, h: 13 }
const GEARBOX = { x: MOTOR.x + MOTOR.w, y: BELT.y + BELT.d, z: BASE.h, w: 20, d: 10, h: 10 }
const FAN = { cx: MOTOR.w / 2, cy: MOTOR.d / 2, r: 5.4 }
const VANES = Array.from({ length: 6 }, (_, k) => {
  const a = (k * Math.PI) / 3
  return `M${(Math.cos(a) * 1.4).toFixed(3)} ${(Math.sin(a) * 1.4).toFixed(3)}L${(Math.cos(a + 0.45) * 4.4).toFixed(3)} ${(Math.sin(a + 0.45) * 4.4).toFixed(3)}`
}).join("")
const ROLLERS = Array.from({ length: 16 }, (_, k) => 8 + k * 11.8)
const COUNTER = { x: SCREEN.x + 4, y: SCREEN.y + 11.9, size: 6.4, char: 3.84, places: 2 }
const WHEELS_X = COUNTER.x + "built ".length * COUNTER.char
const ROLL_STAGGER_MS = 50
const FEED_MS = 200
const HOP_MS = 320
const DOWN_MS = 140
const WORK_MS = 380
const PITCH_MS = HOP_MS + WORK_MS
const arriveAt = (k: number) => FEED_MS + HOP_MS + k * PITCH_MS
const landAt = (k: number) => arriveAt(k) + DOWN_MS
const DONE_MS = arriveAt(DOCKS.length - 1) + WORK_MS + HOP_MS
const HOPS = Array.from({ length: DOCKS.length + 1 }, (_, k) => FEED_MS + k * PITCH_MS)
const START: Run = { unit: 11, from: 11, step: 0 }
const LAST = 99
const TIMING = { "--feed": `${FEED_MS}ms`, "--work": `${WORK_MS}ms`, "--run": `${DONE_MS}ms` } as CSSProperties
const PROGRESS = [
  { text: "loading", on: 0, off: landAt(0) },
  { text: "station 1", on: landAt(0), off: landAt(1) },
  { text: "station 2", on: landAt(1), off: landAt(2) },
  { text: "station 3", on: landAt(2), off: DONE_MS },
] as const

const unitNumber = (unit: number) => String(unit).padStart(COUNTER.places, "0")

function wheelsOf(from: number, to: number): { wheels: Wheel[]; turning: number } {
  const before = unitNumber(from).split("")
  const after = unitNumber(to).split("")
  const wheels: Wheel[] = []
  let turning = 0
  for (let index = after.length - 1; index >= 0; index--) {
    const digit = after[index] ?? "0"
    const was = before[index] ?? "0"
    wheels[index] = { digit, before: was, rank: digit === was ? -1 : turning }
    if (digit !== was) turning++
  }
  return { wheels, turning }
}

const place = (part: Omit<Part, "id">, cx: number) => ({ x: cx + part.x, y: CY + part.y, z: part.z, w: part.w, d: part.d, h: part.h })
const ms = (n: number) => `${n}ms`

function Counter({ unit, from, clip }: { unit: number; from: number; clip: string }) {
  return (
    <g clipPath={`url(#${clip})`}>
      {wheelsOf(from, unit).wheels.map(({ digit, before, rank }, index) => {
        const x = WHEELS_X + index * COUNTER.char
        return (
          <g key={`${index}-${unit}`} style={{ "--roll-at": `${Math.max(0, rank) * ROLL_STAGGER_MS}ms` } as CSSProperties}>
            {rank >= 0 ? (
              <text className="ik-screen-text al-roll-out" x={x} y={COUNTER.y} fontSize={COUNTER.size}>
                {before}
              </text>
            ) : null}
            <text className={rank >= 0 ? "ik-screen-text al-roll-in" : "ik-screen-text"} x={x} y={COUNTER.y} fontSize={COUNTER.size}>
              {digit}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Rollers({ running }: { running: boolean }) {
  return (
    <g className={running ? "al-indexing" : undefined}>
      {ROLLERS.map((cx) => (
        <g key={cx} transform={`translate(${cx} 6)`}>
          <g className="al-spin al-roller">
            <circle className="ik-detail" r={2.4} />
            <path className="ik-detail" d="M-1.6 0H1.6" />
          </g>
        </g>
      ))}
    </g>
  )
}

function Drive({ running }: { running: boolean }) {
  return (
    <>
      <Box
        {...MOTOR}
        r={4}
        top={
          <g className={running ? "al-indexing" : undefined}>
            <circle className="ik-well" cx={FAN.cx} cy={FAN.cy} r={FAN.r} />
            <g transform={`translate(${FAN.cx} ${FAN.cy})`}>
              <g className="al-spin al-fan">
                <path className="ik-detail" d={VANES} />
              </g>
              <circle className="ik-fill" r={1} />
            </g>
          </g>
        }
        front={Array.from({ length: 4 }, (_, k) => (
          <path key={k} className="ik-detail" d={`M${4 + k * 2.4} 3v${MOTOR.h - 5}`} />
        ))}
        side={Array.from({ length: 4 }, (_, k) => (
          <path key={k} className="ik-detail" d={`M${4 + k * 2.4} 3v${MOTOR.h - 5}`} />
        ))}
      />
      <Box
        {...GEARBOX}
        r={2.5}
        top={<path className="ik-detail" d={`M3 3h${GEARBOX.w - 6}`} />}
        front={
          <>
            <circle className="ik-detail" cx={GEARBOX.w - 6} cy={5} r={3} />
            <circle className="ik-fill" cx={GEARBOX.w - 6} cy={5} r={1} />
            <circle className="ik-fill" cx={3.5} cy={3} r={0.8} />
            <circle className="ik-fill" cx={3.5} cy={7.4} r={0.8} />
          </>
        }
        side={<path className="ik-detail" d={`M3 3h${GEARBOX.d - 6}`} />}
      />
    </>
  )
}

function Wheels() {
  return (
    <>
      {WHEEL.at.map((x) => (
        <g key={x}>
          <circle className="ik-face" cx={x} cy={WHEEL.cy} r={WHEEL.r} />
          <circle className="ik-detail" cx={x} cy={WHEEL.cy} r={1.8} />
        </g>
      ))}
    </>
  )
}

function Chassis({ cx }: { cx: number }) {
  const box = place(CHASSIS, cx)
  return (
    <>
      <g transform={side(box.x, box.y + box.d, box.z + box.h)}>
        <Wheels />
      </g>
      <Box {...box} r={1.5} front={<path className="ik-detail" d={`M3 2h${box.w - 6}`} />} side={<Wheels />} />
    </>
  )
}

function PartBox({ part, cx, z = part.z, built }: { part: Part; cx: number; z?: number; built?: string | undefined }) {
  const box = { ...place(part, cx), z }
  if (part.id === "battery") {
    return (
      <Box
        {...box}
        r={1.5}
        side={Array.from({ length: 6 }, (_, k) => (
          <path key={k} className="ik-detail" d={`M${3 + k * 4.4} 1v2`} />
        ))}
      />
    )
  }
  if (part.id === "body") {
    return (
      <Box
        {...box}
        r={1.5}
        top={<rect className="ik-detail" x={3} y={3} width={part.w - 6} height={part.d - 6} rx={1} />}
        side={Array.from({ length: 4 }, (_, k) => (
          <path key={k} className="ik-detail" d={`M${3.5 + k * 3.6} 3v${part.h - 6}`} />
        ))}
      />
    )
  }
  return (
    <Box
      {...box}
      r={2}
      top={
        <g style={built === undefined ? undefined : ({ "--t": built } as CSSProperties)}>
          <Glow on={built !== undefined} className="al-beacon-glow">
            <circle className="al-beacon" data-on={built !== undefined} cx={part.w / 2} cy={part.d / 2} r={1.8} />
          </Glow>
        </g>
      }
      front={
        <>
          <rect className="ik-well" x={2} y={2} width={part.w - 4} height={4.6} rx={1} />
          <circle className="ik-fill" cx={3.4} cy={9} r={1.1} />
          <circle className="ik-fill" cx={part.w - 3.4} cy={9} r={1.1} />
        </>
      }
      side={<rect className="ik-well" x={2} y={2} width={5} height={4.6} rx={1} />}
    />
  )
}

function Truck({ cx }: { cx: number }) {
  return (
    <>
      <Chassis cx={cx} />
      {PARTS.map((part) => (
        <PartBox key={part.id} part={part} cx={cx} />
      ))}
    </>
  )
}

function Station({ k, part, running }: { k: number; part: Part; running: boolean }) {
  const x = DOCKS[k] ?? 0
  const at = place(part, x)
  const gripY = at.y + at.d / 2 - GRIP.d / 2
  const top = at.z + LIFT + at.h
  const timing = { "--t": ms(running ? arriveAt(k) : 0) } as CSSProperties
  return (
    <>
      <g className={running ? "al-dip" : undefined} style={timing}>
        <g className={running ? "al-held" : undefined} style={{ "--t": ms(landAt(k)) } as CSSProperties}>
          <PartBox part={part} cx={x} z={part.z + LIFT} />
        </g>
        <Box x={x - GRIP.w / 2} y={gripY} z={top} w={GRIP.w} d={GRIP.d} h={GRIP.h} r={1.5} front={<path className="ik-detail" d={`M3 2.5h${GRIP.w - 6}`} />} />
        <Box x={x - ROD / 2} y={gripY + GRIP.d / 2 - ROD / 2} z={top + GRIP.h} w={ROD} d={ROD} h={ARM.z - top - GRIP.h + LIFT + 2} r={ROD / 2} />
      </g>
      <Box
        x={x - ARM.w / 2}
        y={ARM.y}
        z={ARM.z}
        w={ARM.w}
        d={ARM.d}
        h={ARM.h}
        r={2}
        top={<path className="ik-detail" d={`M${ARM.w / 2} 14v${ARM.d - 20}`} />}
        side={<path className="ik-detail" d={`M4 3h${ARM.d - 8}`} />}
      />
    </>
  )
}

function Column({ k, running }: { k: number; running: boolean }) {
  const x = DOCKS[k] ?? 0
  return (
    <Box
      x={x - COLUMN.w / 2}
      y={COLUMN.y}
      z={COLUMN.z}
      w={COLUMN.w}
      d={COLUMN.d}
      h={COLUMN.h}
      r={2}
      front={
        <>
          <circle className="al-lamp" data-run={running} style={{ "--t": ms(arriveAt(k)) } as CSSProperties} cx={COLUMN.w / 2} cy={12} r={2} />
          <text className="ik-label al-tag" x={COLUMN.w / 2} y={22} textAnchor="middle">
            {k + 1}
          </text>
        </>
      }
    />
  )
}

export default function AssemblyLine() {
  const [run, setRun] = useState<Run>(START)
  const [built, setBuilt] = useState(true)
  const stops = useRef<Array<() => void>>([])
  const timers = useRef<number[]>([])
  const clip = useId().replace(/[^\w-]/g, "")
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      for (const stop of stops.current) stop()
    },
    [],
  )

  const start = (audible: boolean) => {
    const next = run.unit >= LAST ? 1 : run.unit + 1
    for (const timer of timers.current) window.clearTimeout(timer)
    for (const stop of stops.current) stop()
    stops.current = []
    timers.current = []
    if (audible) {
      const { turning } = wheelsOf(run.unit, next)
      stops.current.push(playSound("cascade", { count: DOCKS.length, stagger: PITCH_MS / 1000, delay: landAt(0) / 1000 }))
      timers.current = HOPS.map((at) => window.setTimeout(() => stops.current.push(playSound("motor", { duration: HOP_MS / 1000 })), at))
      timers.current.push(
        window.setTimeout(() => {
          stops.current.push(playSound("roll", { count: turning, stagger: ROLL_STAGGER_MS / 1000 }), playSound("complete"))
        }, DONE_MS),
      )
    }
    timers.current.push(window.setTimeout(() => setBuilt(true), DONE_MS))
    setRun({ unit: next, from: run.unit, step: run.step + 1 })
    setBuilt(false)
  }
  const demo = useDemoTap(
    () => {
      if (run.step === 0) start(false)
    },
    { delay: 1700 },
  )
  const press = () => {
    demo.dismiss()
    start(true)
  }

  const { unit, step } = run
  const running = step > 0
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const readout = !running ? `ready · unit ${unit} built` : built ? `3 of 3 stations · unit ${unit} built` : `running · unit ${unit}`

  return (
    <Plate
      {...demo.plate}
      fig="Manufacturing"
      name="Assembly line"
      hint="Press run"
      readout={readout}
      className="fig-assembly-line"
      style={TIMING}
      fit={[BASE, { x: DOCKS[0] - ARM.w / 2, y: ARM.y, z: 0, w: DOCKS[2] - DOCKS[0] + ARM.w, d: ARM.d, h: ARM.z + ARM.h }, { ...CONSOLE, z: 0, h: KEY.z + KEY.h }]}
      aspect={1.35}
      label="A short assembly line: a conveyor with a drive motor, three stations and a console with a line screen and a run key. Press run to index a truck chassis down the line; the first station lowers in the battery, the second the body and the third the cab, and the built counter rolls on by one."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={10}
          top={[
            [6, 6],
            [BASE.w - 6, BASE.d - 6],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.6} />
          ))}
        />
        <Box
          {...CONSOLE}
          r={4}
          front={
            <>
              <defs>
                <clipPath id={`${clip}-screen`}>
                  <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
                </clipPath>
                <clipPath id={`${clip}-counter`}>
                  <rect x={WHEELS_X - 0.6} y={COUNTER.y - 5.4} width={COUNTER.places * COUNTER.char + 1.2} height={6.8} />
                </clipPath>
              </defs>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
              <g clipPath={`url(#${clip}-screen)`}>
                <Glow>
                  <g key={`line-${step}`}>
                    {running ? (
                      <>
                        {PROGRESS.map((row) => (
                          <text key={row.text} className="ik-screen-text ik-dim al-window" x={SCREEN.x + 4} y={SCREEN.y + 5.2} fontSize={4.6} style={{ "--on": ms(row.on), "--span": ms(row.off - row.on) } as CSSProperties}>
                            {row.text}
                          </text>
                        ))}
                        <text className="ik-screen-text ik-dim al-shown" x={SCREEN.x + 4} y={SCREEN.y + 5.2} fontSize={4.6} style={{ "--on": ms(DONE_MS) } as CSSProperties}>
                          done
                        </text>
                      </>
                    ) : (
                      <text className="ik-screen-text ik-dim" x={SCREEN.x + 4} y={SCREEN.y + 5.2} fontSize={4.6}>
                        ready
                      </text>
                    )}
                    {DOCKS.map((dock, k) => (
                      <rect
                        key={dock}
                        className="al-pip"
                        data-on={running}
                        style={{ "--t": ms(landAt(k)) } as CSSProperties}
                        x={SCREEN.x + 44.5 + k * 4}
                        y={SCREEN.y + 2.6}
                        width={2.6}
                        height={2.6}
                        rx={0.6}
                      />
                    ))}
                  </g>
                  <text className="ik-screen-text" x={COUNTER.x} y={COUNTER.y} fontSize={COUNTER.size}>
                    built
                  </text>
                  <Counter unit={unit} from={run.from} clip={`${clip}-counter`} />
                </Glow>
              </g>
            </>
          }
          side={Array.from({ length: 5 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M4 ${4 + k * 2.6}h${CONSOLE.d - 8}`} />
          ))}
        />
        {DOCKS.map((dock, k) => (
          <Column key={`${dock}-${step}`} k={k} running={running} />
        ))}
        <Box
          {...BELT}
          r={4}
          top={
            <>
              <path className="ik-detail" d={`M4 4h${BELT.w - 8}M4 ${BELT.d - 4}h${BELT.w - 8}`} />
              {Array.from({ length: 23 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${8 + k * 8} 6v${BELT.d - 12}`} />
              ))}
            </>
          }
          front={<Rollers key={step} running={running} />}
          side={<path className="ik-detail" d={`M4 6h${BELT.d - 8}`} />}
        />
        <Drive key={`drive-${step}`} running={running} />

        <g key={`out-${step}`} className={running ? "al-exit" : undefined}>
          <Truck cx={OUT} />
        </g>
        <g key={`ride-${step}`} className={running ? "al-ride" : undefined}>
          <Chassis cx={IN} />
          {running
            ? PARTS.map((part, k) => (
                <g key={part.id} className="al-mounted" style={{ "--t": ms(landAt(k)) } as CSSProperties}>
                  <PartBox part={part} cx={IN} built={part.id === "cab" ? ms(DONE_MS) : undefined} />
                </g>
              ))
            : null}
        </g>

        {PARTS.map((part, k) => (
          <Station key={`${part.id}-${step}`} k={k} part={part} running={running} />
        ))}

        {!running && !aiming ? <Ripple {...KEY} r={6} /> : null}
        <Press label="Run the line" material="plastic" onPress={press} data-hot={!running}>
          <g>
            <Box
              {...KEY}
              r={6}
              top={
                <>
                  <text className="ik-label al-key" x={9} y={10}>
                    RUN
                  </text>
                  <path className="ik-detail ik-thick al-play" d="M0 0l5.2 3.4L0 6.8z" transform={`translate(${KEY.w - 15} 3.6)`} />
                </>
              }
            />
          </g>
        </Press>
        <Dimension from={[DOCKS[1], ARM.y, ARM.z + ARM.h]} to={[DOCKS[2], ARM.y, ARM.z + ARM.h]} offset={[0, 0, 8]} label={`pitch ${DOCKS[2] - DOCKS[1]}`} />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
