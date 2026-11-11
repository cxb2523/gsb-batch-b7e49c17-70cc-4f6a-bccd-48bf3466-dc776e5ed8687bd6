import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, Flight, Glow, Plate, Press, playSound, project, Ripple, type SoundName, type SoundOptions, useDemoTap } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./pick-and-place.css"

export const meta = {
  slug: "pick-and-place",
  title: "Pick and place",
  industry: "deeptech",
  level: 4,
  blurb: "Press pick: the gantry motors run the head over the next chip, the vacuum valve clicks as it lifts the chip from the tray, and it seats on the board as the count rolls over.",
  uses: ["Plate", "Box", "Press", "Glow", "Flight", "Ripple", "Cursor", "useDemoTap", "project"],
  sounds: ["motor", "relay", "roll", "done", "complete", "whoosh"],
} satisfies FigureMeta

type Pos = readonly [number, number]

const BED = { x: 0, y: 0, z: 0, w: 170, d: 150, h: 10 }
const RAILS = [
  { x: 6, y: 6, z: 10, w: 8, d: 112, h: 6 },
  { x: 156, y: 6, z: 10, w: 8, d: 112, h: 6 },
] as const
const TRAY = { x: 36, y: 14, z: 10, w: 58, d: 40, h: 4 }
const BOARD = { x: 30, y: 62, z: 10, w: 100, d: 46, h: 4 }
const CHIP = { w: 10, d: 10, h: 4, z: 14 }
const HOME: Pos = [124, 22]
const LEGS = [
  { x: 4, y: HOME[1] - 16, z: 16, w: 12, d: 14, h: 30 },
  { x: 154, y: HOME[1] - 16, z: 16, w: 12, d: 14, h: 30 },
] as const
const BEAM = { x: 2, y: HOME[1] - 16, z: 46, w: 166, d: 12, h: 9 }
const HEAD = { x: HOME[0] - 9, y: HOME[1] - 5, z: 30, w: 18, d: 10, h: 28 }
const NOZZLE = { x: HOME[0] - 2.5, y: HOME[1] - 2.5, z: 23, w: 5, d: 5, h: 8 }
const CONSOLE = { x: 100, y: 120, z: 10, w: 62, d: 22, h: 26 }
const KEY = { x: 34, y: 122, z: 10, w: 50, d: 18, h: 5 }
const CELLS = [0, 1, 2, 3, 4, 5] as const
const TRAY_AT: readonly Pos[] = CELLS.map((k) => [47 + (k % 3) * 18, 25 + Math.floor(k / 3) * 18])
const SLOT_AT: readonly Pos[] = CELLS.map((k) => [48 + (k % 3) * 32, 76 + Math.floor(k / 3) * 20])
const MOVE_MS = 1600
const RETURN_MS = 700
const PICK_MS = 680
const LIFT_MS = 760
const CARRY_MS = 640
const LAND_MS = LIFT_MS + CARRY_MS
const STAGGER_MS = 50
const COUNT = { x: 9, y: 18.4, size: 7, pitch: 4.2 }
const COUNT_WINDOW = { x: COUNT.x - 0.6, y: 11.6, width: COUNT.pitch + 1.2, height: 8.4 }

const posOf = (placed: number): Pos => (placed === 0 ? HOME : (SLOT_AT[placed - 1] ?? HOME))
const chipBox = ([cx, cy]: Pos) => ({ x: cx - CHIP.w / 2, y: cy - CHIP.d / 2, z: CHIP.z, w: CHIP.w, d: CHIP.d, h: CHIP.h })
const px = (n: number) => `${Math.round(n * 1000) / 1000}px`

function moveVars(axis: "x" | "y", from: Pos, via: Pos, to: Pos): CSSProperties {
  const shift = (p: Pos) => (axis === "x" ? project(p[0] - HOME[0], 0, 0) : project(0, p[1] - HOME[1], 0))
  const [a, b, c] = [shift(from), shift(via), shift(to)]
  return { "--x0": px(a[0]), "--y0": px(a[1]), "--x1": px(b[0]), "--y1": px(b[1]), "--x2": px(c[0]), "--y2": px(c[1]) } as CSSProperties
}

function ChipFace() {
  return <circle className="ik-fill" cx={2.4} cy={2.4} r={1} />
}

function Chip({ at }: { at: Pos }) {
  return <Box {...chipBox(at)} r={1.5} top={<ChipFace />} front={<path className="ik-detail" d="M2.5 1.5v2.5M5 1.5v2.5M7.5 1.5v2.5" />} />
}

export default function PickAndPlace() {
  const [run, setRun] = useState({ placed: 0, step: 0 })
  const [touched, setTouched] = useState(false)
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

  const { placed, step } = run
  const full = placed === CELLS.length
  const reset = step > 0 && placed === 0
  const advance = (audible: boolean) => {
    for (const timer of timers.current) window.clearTimeout(timer)
    for (const stop of stops.current) stop()
    timers.current = []
    stops.current = []
    const later = (ms: number, name: SoundName, options?: SoundOptions) => timers.current.push(window.setTimeout(() => stops.current.push(playSound(name, options)), ms))
    if (full) {
      if (audible) {
        stops.current.push(playSound("whoosh"), playSound("motor", { duration: RETURN_MS / 1000 }), playSound("roll"))
      }
      setRun({ placed: 0, step: step + 1 })
      return
    }
    const next = placed + 1
    if (audible) {
      stops.current.push(playSound("motor", { duration: LAND_MS / 1000 }))
      later(PICK_MS, "relay")
      later(LAND_MS, "roll")
      later(LAND_MS, next === CELLS.length ? "complete" : "done")
    }
    setRun({ placed: next, step: step + 1 })
  }
  const demo = useDemoTap(() => {
    if (step === 0) advance(false)
  }, { delay: 1200 })
  const press = () => {
    demo.dismiss()
    setTouched(true)
    advance(true)
  }

  const from = reset ? (SLOT_AT[CELLS.length - 1] ?? HOME) : posOf(Math.max(0, placed - 1))
  const via = reset ? HOME : (TRAY_AT[placed - 1] ?? HOME)
  const to = posOf(placed)
  const motion = step === 0 ? undefined : reset ? "back" : "go"
  const picked = reset ? -1 : placed - 1
  const previous = reset ? CELLS.length : step > 0 ? placed - 1 : placed
  const turns = previous !== placed
  const readout = full ? "board full · 6 of 6" : placed ? `placed · ${placed} of 6` : reset ? "reset · 6 in tray" : "ready · 6 in tray"

  return (
    <Plate
      {...demo.plate}
      fig="Deep tech"
      name="Pick and place"
      hint={full ? "Press to reset" : "Press pick"}
      readout={readout}
      className="fig-pick-and-place"
      style={{ "--move": `${MOVE_MS}ms`, "--return": `${RETURN_MS}ms`, "--count-at": `${picked >= 0 ? LAND_MS : 0}ms` } as CSSProperties}
      fit={[BED, { x: BEAM.x, y: 6, z: 0, w: BEAM.w, d: 95, h: HEAD.z + HEAD.h }]}
      aspect={1.3}
      label="A pick-and-place gantry with a tray of six chips and a circuit board. Press pick to move the next chip from the tray to its slot on the board; after six, press again to reset."
    >
      <defs>
        <clipPath id={clip}>
          <rect {...COUNT_WINDOW} />
        </clipPath>
      </defs>
      <g ref={demo.ref}>
        <Box
          {...BED}
          r={10}
          top={
            <>
              <rect className="ik-detail" x={22} y={8} width={126} height={108} rx={5} />
              {[30, 60, 90].map((y) => (
                <path key={y} className="ik-detail" d={`M22 ${y}h4M144 ${y}h4`} />
              ))}
            </>
          }
        />
        <Rail {...RAILS[0]} />

        <Box
          {...TRAY}
          r={3}
          top={TRAY_AT.map(([cx, cy]) => (
                <rect key={`${cx}-${cy}`} className="ik-well" x={cx - TRAY.x - 6.5} y={cy - TRAY.y - 6.5} width={13} height={13} rx={2} />
              ))}
          front={<path className="ik-detail" d="M4 2h12" />}
        />
        {TRAY_AT.map((at, k) => (
          <g
            key={`tray-${at.join()}`}
            className="chip"
            data-on={k >= placed}
            style={{ "--t": `${k === picked ? LIFT_MS : reset ? 300 + k * STAGGER_MS : 0}ms` } as CSSProperties}
          >
            <Chip at={at} />
          </g>
        ))}

        <Box
          {...BOARD}
          r={3}
          top={
            <>
              <path className="ik-detail" d="M6 14h12M58 14h8M90 14h4M6 34h12M58 34h8M90 34h4M24 6v4M56 6v4M88 6v4M24 40v2M56 40v2" />
              {SLOT_AT.map(([cx, cy]) => (
                <rect key={`${cx}-${cy}`} className="ik-dash" x={cx - BOARD.x - 7} y={cy - BOARD.y - 7} width={14} height={14} rx={2} />
              ))}
              <circle className="ik-detail" cx={5} cy={5} r={2} />
              <circle className="ik-detail" cx={BOARD.w - 5} cy={BOARD.d - 5} r={2} />
            </>
          }
          side={<path className="ik-detail" d="M4 2h10" />}
        />
        {SLOT_AT.map((at, k) => (
          <g
            key={`slot-${at.join()}`}
            className="chip placed"
            data-on={k < placed}
            data-last={k === picked}
            style={{ "--t": `${k === picked ? LAND_MS : reset ? (CELLS.length - 1 - k) * STAGGER_MS : 0}ms` } as CSSProperties}
          >
            <Chip at={at} />
          </g>
        ))}
        <Rail {...RAILS[1]} />

        <g key={`flight-${step}`}>
          {picked >= 0 ? (
            <Flight from={[...(TRAY_AT[picked] ?? HOME), CHIP.z]} to={[...(SLOT_AT[picked] ?? HOME), CHIP.z]} delay={LIFT_MS} duration={CARRY_MS} lift={10}>
              <Chip at={TRAY_AT[picked] ?? HOME} />
            </Flight>
          ) : null}
        </g>

        <g key={`gantry-${step}`} className={motion ? `bridge ${motion}` : "bridge"} style={motion ? moveVars("y", from, via, to) : undefined}>
          {LEGS.map((leg) => (
            <Box key={leg.x} {...leg} r={2} side={<path className="ik-detail" d="M3 4h8M3 26h8" />} />
          ))}
          <Box
            {...BEAM}
            r={2}
            front={
              <>
                <path className="ik-detail" d={`M14 3.5h${BEAM.w - 28}`} />
                {[20, 50, 80, 110, 140].map((x) => (
                  <circle key={x} className="ik-fill" cx={x} cy={6.5} r={0.9} />
                ))}
              </>
            }
          />
          <g className={motion ? `head ${motion}` : "head"} style={motion ? moveVars("x", from, via, to) : undefined}>
            <g className={motion === "go" ? "nozzle go" : "nozzle"}>
              <Box {...NOZZLE} r={NOZZLE.w / 2} />
            </g>
            <Box
              {...HEAD}
              r={2}
              top={<circle className="ik-detail" cx={HEAD.w / 2} cy={HEAD.d / 2} r={3} />}
              front={
                <>
                  <rect className="ik-detail" x={3} y={4} width={12} height={9} rx={1.5} />
                  <circle className="ik-fill" cx={5} cy={23} r={0.9} />
                  <circle className="ik-fill" cx={13} cy={23} r={0.9} />
                </>
              }
            />
          </g>
        </g>

        <Box
          {...CONSOLE}
          r={4}
          top={<path className="ik-detail" d={`M5 5h${CONSOLE.w - 10}`} />}
          front={
            <>
              <rect className="ik-screen" x={5} y={4} width={40} height={17} rx={2.5} />
              {picked >= 0 ? (
                <g key={`was-${step}`} className="was" style={{ animationDelay: `${LAND_MS}ms` }}>
                  <CountLabel placed={placed - 1} />
                </g>
              ) : null}
              <g key={`count-${step}`} className="ik-enter" style={{ animationDelay: `${picked >= 0 ? LAND_MS : 0}ms` }}>
                <CountLabel placed={placed} />
              </g>
              <g clipPath={`url(#${clip})`}>
                <g key={`wheel-${step}`}>
                  {turns ? (
                    <text className="ik-screen-text roll-out" x={COUNT.x} y={COUNT.y} fontSize={COUNT.size}>
                      {previous}
                    </text>
                  ) : null}
                  <text className={turns ? "ik-screen-text roll-in" : "ik-screen-text"} x={COUNT.x} y={COUNT.y} fontSize={COUNT.size}>
                    {placed}
                  </text>
                </g>
              </g>
              <text className="ik-screen-text" x={COUNT.x + 2 * COUNT.pitch} y={COUNT.y} fontSize={COUNT.size}>
                {`of ${CELLS.length}`}
              </text>
              {CELLS.map((k) => (
                <g key={k} style={{ "--t": `${k === picked ? LAND_MS : 0}ms` } as CSSProperties}>
                  <Glow on={k < placed} className="pip-glow">
                    <rect className="pip" data-on={k < placed} x={49 + (k % 3) * 3.6} y={7 + Math.floor(k / 3) * 3.6} width={2.4} height={2.4} rx={0.5} />
                  </Glow>
                </g>
              ))}
              <path className="ik-detail" d="M49 17h10M49 20h10" />
            </>
          }
          side={Array.from({ length: 4 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M5 ${7 + k * 3.4}h12`} />
              ))}
        />

        {!touched && step === 0 && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...KEY} r={6} /> : null}
        <Press label={full ? "Reset the board" : "Pick the next part"} material="plastic" onPress={press} data-hot={placed === 0}>
          <g>
            <Box
              {...KEY}
              r={6}
              top={
                <>
                  <text className="ik-label key" x={8} y={12}>
                    {full ? "RESET" : "PICK"}
                  </text>
                  <path className="ik-detail ik-thick arrow" d="M0 0v7M-3 4l3 3 3-3" transform={`translate(${KEY.w - 10} 5.5)`} />
                </>
              }
            />
          </g>
        </Press>
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}

function CountLabel({ placed }: { placed: number }) {
  return (
    <text className="ik-screen-text ik-dim" x={COUNT.x} y={10.6} fontSize={5.6}>
      {placed === CELLS.length ? "full" : placed ? "placed" : "ready"}
    </text>
  )
}

function Rail(rail: { x: number; y: number; z: number; w: number; d: number; h: number }) {
  return <Box {...rail} r={2} top={<path className="ik-detail" d={`M${rail.w / 2} 3v${rail.d - 6}`} />} />
}
