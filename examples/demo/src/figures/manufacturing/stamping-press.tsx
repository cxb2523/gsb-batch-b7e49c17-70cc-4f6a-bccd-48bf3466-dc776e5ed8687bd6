import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, useDemoTap } from "react-isokit"
import { Dimension } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./stamping-press.css"

export const meta = {
  slug: "stamping-press",
  title: "Stamping press",
  industry: "manufacturing",
  level: 1,
  blurb: "Press the palm button: the ram drops on the die with a thud, the flat blank comes out a bracket and the stroke counter rolls on a part.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "curve", "path", "Dimension"],
  sounds: ["press", "release", "latch", "roll"],
} satisfies FigureMeta

type Shown = { count: number; from: number }
type Wheel = { digit: string; before: string; rank: number }

const BASE = { x: 0, y: 0, z: 0, w: 160, d: 132, h: 8 }
const BED = { x: 12, y: 12, z: 8, w: 96, d: 84, h: 26 }
const SPINE = { x: 22, y: 14, z: 34, w: 76, d: 22, h: 72 }
const BOLSTER = { x: 24, y: 40, z: 34, w: 72, d: 50, h: 6 }
const POSTS = [
  { x: 32, y: 42, z: 40, w: 6, d: 6, h: 36 },
  { x: 82, y: 42, z: 40, w: 6, d: 6, h: 36 },
] as const
const DIE = { x: 36, y: 52, z: 40, w: 48, d: 30, h: 10 }
const SEAT = DIE.z + DIE.h
const BLANK = { x: 33, y: 59, z: SEAT, w: 54, d: 16, h: 2 }
const WEB = { x: 42, y: 59, z: SEAT, w: 36, d: 16, h: 2 }
const FLANGE = { y: 59, z: SEAT + 2, w: 2.5, d: 16, h: 9 }
const NEAR_FLANGE = { ...FLANGE, x: WEB.x }
const FAR_FLANGE = { ...FLANGE, x: WEB.x + WEB.w - FLANGE.w }
const STROKE = 24
const PUNCH = { x: 45, y: 55, z: SEAT + 2 + STROKE, w: 30, d: 24, h: 12 }
const RAM = { x: 28, y: 40, z: PUNCH.z + PUNCH.h, w: 64, d: 44, h: 14 }
const CROWN = { x: 16, y: 12, z: SPINE.z + SPINE.h, w: 88, d: 76, h: 26 }
const ROD = { x: 52, y: 54, z: RAM.z + RAM.h, w: 16, d: 16, h: CROWN.z - RAM.z - RAM.h + STROKE + 6 }
const CYLINDER = { x: 44, y: 34, z: CROWN.z + CROWN.h, w: 32, d: 32, h: 16 }
const CYLINDER_CAP = { x: 50, y: 40, z: CYLINDER.z + CYLINDER.h, w: 20, d: 20, h: 3 }
const PORT = { x: CROWN.x + CROWN.w, y: 28, z: 114, w: 3, d: 8, h: 8 }
const POWER = { x: 116, y: 14, z: 8, w: 34, d: 40, h: 30 }
const MOTOR = { x: 121, y: 20, z: POWER.z + POWER.h, w: 18, d: 18, h: 14 }
const FITTING = { x: 140, y: 42, z: POWER.z + POWER.h, w: 6, d: 6, h: 4 }
const HOSE = path(curve([143, 45, 42], [143, 45, 96], [124, 32, 120], [PORT.x + PORT.w, 32, 118], 28))
const PEDESTAL = { x: 118, y: 92, z: 8, w: 30, d: 28, h: 30 }
const COLLAR = { x: 122, y: 95, z: PEDESTAL.z + PEDESTAL.h, w: 22, d: 22, h: 3 }
const STEM = { x: 128, y: 101, z: COLLAR.z + COLLAR.h, w: 10, d: 10, h: 5 }
const PALM = { x: 121, y: 94, z: STEM.z + STEM.h, w: 24, d: 24, h: 6 }
const SCREEN = { x: 8, y: 5, w: 50, h: 16 }
const COUNTER = { x: SCREEN.x + 4, y: SCREEN.y + 13.6, size: 6.6, char: 3.96, places: 3 }
const WHEELS_X = COUNTER.x + "part ".length * COUNTER.char
const STRIPES = Array.from({ length: 9 }, (_, k) => `M${14 + k * 4} 12.5l3.6 -6`).join("")
const NUTS = [
  [7, 7],
  [CROWN.w - 7, 7],
  [7, CROWN.d - 7],
  [CROWN.w - 7, CROWN.d - 7],
] as const
const START = 17
const LAST = 999
const STROKE_MS = 1100
const STRIKE_MS = 440
const ROLL_STAGGER_MS = 50
const TIMING = { "--stroke-ms": `${STROKE_MS}ms`, "--strike-ms": `${STRIKE_MS}ms` } as CSSProperties

const partNumber = (count: number) => String(count).padStart(COUNTER.places, "0")

function wheelsOf(from: number, to: number): { wheels: Wheel[]; turning: number } {
  const before = partNumber(from).split("")
  const after = partNumber(to).split("")
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

function Counter({ count, from, clip }: Shown & { clip: string }) {
  return (
    <g clipPath={`url(#${clip})`}>
      {wheelsOf(from, count).wheels.map(({ digit, before, rank }, index) => {
        const x = WHEELS_X + index * COUNTER.char
        return (
          <g key={`${index}-${count}`} style={{ "--roll-at": `${Math.max(0, rank) * ROLL_STAGGER_MS}ms` } as CSSProperties}>
            {rank >= 0 ? (
              <text className="ik-screen-text sp-roll-out" x={x} y={COUNTER.y} fontSize={COUNTER.size}>
                {before}
              </text>
            ) : null}
            <text className={rank >= 0 ? "ik-screen-text sp-roll-in" : "ik-screen-text"} x={x} y={COUNTER.y} fontSize={COUNTER.size}>
              {digit}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function FrontFlange() {
  return <Box {...FAR_FLANGE} r={0.6} side={<circle className="ik-well" cx={FLANGE.d / 2} cy={4.5} r={1.6} />} />
}

function WebAndBackFlange() {
  return (
    <>
      <Box
        {...WEB}
        r={0.8}
        top={
          <>
            <circle className="ik-well" cx={12} cy={WEB.d / 2} r={2.2} />
            <circle className="ik-well" cx={WEB.w - 12} cy={WEB.d / 2} r={2.2} />
          </>
        }
      />
      <Box {...NEAR_FLANGE} r={0.6} side={<circle className="ik-well" cx={FLANGE.d / 2} cy={4.5} r={1.6} />} />
    </>
  )
}

export default function StampingPress() {
  const [shown, setShown] = useState<Shown>({ count: START, from: START })
  const strike = useRef(0)
  const clip = useId().replace(/[^\w-]/g, "")
  useEffect(() => () => window.clearTimeout(strike.current), [])

  const { count } = shown
  const stamp = (audible: boolean) => {
    const next = count >= LAST ? 1 : count + 1
    window.clearTimeout(strike.current)
    if (audible) {
      const { turning } = wheelsOf(count, next)
      strike.current = window.setTimeout(() => {
        playSound("latch", { size: 1 })
        playSound("roll", { count: turning, stagger: ROLL_STAGGER_MS / 1000 })
      }, STRIKE_MS)
    }
    setShown({ count: next, from: count })
  }
  const demo = useDemoTap(
    () => {
      if (count === START) stamp(false)
    },
    { delay: 500 },
  )
  const press = () => {
    demo.dismiss()
    stamp(true)
  }

  const fresh = count === START
  const fed = count > START + 1 || count < START
  const aiming = demo.phase === "aim" || demo.phase === "press"

  return (
    <Plate
      {...demo.plate}
      fig="Manufacturing"
      name="Stamping press"
      hint="Press the palm button"
      readout={fresh ? `ready · ${START} parts` : `part ${count} · ok`}
      className="fig-stamping-press"
      style={TIMING}
      fit={[BASE, { x: CROWN.x, y: CROWN.y, z: 0, w: CROWN.w, d: CROWN.d, h: CYLINDER_CAP.z + CYLINDER_CAP.h }]}
      aspect={1.15}
      label="A hydraulic stamping press: a C-frame with a cylinder on its crown, a ram over a die set with a flat blank on it, a stroke counter on the crown, a hydraulic power unit, and a palm button on a pedestal. Press the palm button to bring the ram down, stamp the blank into a bracket and roll the counter on by one part."
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
          {...BED}
          r={6}
          front={
            <>
              <rect className="ik-well" x={8} y={7} width={26} height={12} rx={2} />
              <text className="ik-label sp-plate" x={12} y={15.4}>
                40 T
              </text>
              {Array.from({ length: 9 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${58 + k * 3.4} 7v12`} />
              ))}
            </>
          }
          side={Array.from({ length: 6 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${10 + k * 3.4} 7v12`} />
          ))}
        />
        <Box
          {...SPINE}
          r={3}
          front={<path className="ik-detail" d={`M8 6h${SPINE.w - 16}M8 10h${SPINE.w - 16}`} />}
          side={[18, 36, 54].map((y) => (
            <path key={y} className="ik-detail" d={`M4 ${y}h${SPINE.d - 8}`} />
          ))}
        />
        <Box
          {...BOLSTER}
          r={2}
          top={<path className="ik-detail" d={`M4 ${BOLSTER.d - 4}h${BOLSTER.w - 8}M6 6v${BOLSTER.d - 14}M${BOLSTER.w - 6} 6v${BOLSTER.d - 14}`} />}
        />
        {POSTS.map((post) => (
          <Box key={post.x} {...post} r={post.w / 2} />
        ))}
        <Box
          {...DIE}
          r={2}
          top={<rect className="ik-well" x={4} y={5} width={DIE.w - 8} height={DIE.d - 10} rx={1.5} />}
          front={
            <>
              <path className="ik-detail" d={`M4 3.5h${DIE.w - 8}`} />
              <circle className="ik-fill" cx={6} cy={6.8} r={1.1} />
              <circle className="ik-fill" cx={DIE.w - 6} cy={6.8} r={1.1} />
            </>
          }
          side={<path className="ik-detail" d={`M4 3.5h${DIE.d - 8}`} />}
        />

        {fed ? (
          <g key={`out-${count}`} className="sp-eject">
            <WebAndBackFlange />
            <FrontFlange />
          </g>
        ) : null}
        <g key={`blank-${count}`} className={fresh ? "sp-blank" : fed ? "sp-blank sp-fed sp-struck" : "sp-blank sp-struck"}>
          <Box {...BLANK} r={0.8} />
        </g>
        {fresh ? null : (
          <g key={`web-${count}`} className="sp-made">
            <WebAndBackFlange />
          </g>
        )}

        <g key={`punch-${count}`} className={fresh ? "sp-ram" : "sp-ram sp-stroke"}>
          <Box
            {...PUNCH}
            r={2}
            front={<path className="ik-detail" d={`M4 3h${PUNCH.w - 8}`} />}
            side={<path className="ik-detail" d={`M4 3h${PUNCH.d - 8}`} />}
          />
        </g>
        {fresh ? null : (
          <g key={`flange-${count}`} className="sp-made">
            <FrontFlange />
          </g>
        )}
        <g key={`ram-${count}`} className={fresh ? "sp-ram" : "sp-ram sp-stroke"}>
          <Box
            {...RAM}
            r={3}
            front={
              <>
                <path className="ik-detail" d={`M6 4h${RAM.w - 12}`} />
                <path className="ik-detail" d={STRIPES} />
                {[8, RAM.w - 8].map((cx) => (
                  <circle key={cx} className="ik-detail" cx={cx} cy={9} r={2} />
                ))}
              </>
            }
            side={<path className="ik-detail" d={`M5 4h${RAM.d - 10}`} />}
          />
          <Box {...ROD} r={ROD.w / 2} />
        </g>

        <Box
          {...CROWN}
          r={5}
          top={NUTS.map(([cx, cy]) => (
            <g key={`${cx}-${cy}`}>
              <circle className="ik-detail" cx={cx} cy={cy} r={3} />
              <circle className="ik-fill" cx={cx} cy={cy} r={1.2} />
            </g>
          ))}
          front={
            <>
              <defs>
                <clipPath id={`${clip}-screen`}>
                  <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
                </clipPath>
                <clipPath id={`${clip}-counter`}>
                  <rect x={WHEELS_X - 0.6} y={COUNTER.y - 5.6} width={COUNTER.places * COUNTER.char + 1.2} height={7} />
                </clipPath>
              </defs>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
              <g clipPath={`url(#${clip}-screen)`}>
                <Glow>
                  <g key={count} className="ik-enter" style={{ animationDelay: fresh ? "0ms" : "var(--strike-ms)" }}>
                    <text className="ik-screen-text ik-dim" x={SCREEN.x + 4} y={SCREEN.y + 6.4} fontSize={4.8}>
                      {fresh ? "blank in" : "40 t · ok"}
                    </text>
                  </g>
                  <text className="ik-screen-text" x={COUNTER.x} y={COUNTER.y} fontSize={COUNTER.size}>
                    part
                  </text>
                  <Counter count={count} from={shown.from} clip={`${clip}-counter`} />
                </Glow>
              </g>
              <circle className="ik-well" cx={73} cy={13} r={7.5} />
              <path className="ik-detail" d="M67.5 15.5a6 6 0 0 1 11 0" />
              <path className="ik-detail ik-thick" d="M73 13l3.6-3" />
            </>
          }
          side={Array.from({ length: 7 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${40 + k * 3.4} 6v14`} />
          ))}
        />
        <Box {...PORT} r={1} />
        <Box {...CYLINDER} r={CYLINDER.w / 2} />
        <Box {...CYLINDER_CAP} r={CYLINDER_CAP.w / 2} top={<circle className="ik-detail" cx={10} cy={10} r={4} />} />

        <Box
          {...POWER}
          r={4}
          front={
            <>
              <rect className="ik-well" x={6} y={7} width={6} height={15} rx={2} />
              <path className="ik-detail" d="M7.5 15h3" />
              {Array.from({ length: 5 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${18 + k * 3} 8v14`} />
              ))}
            </>
          }
          side={<path className="ik-detail" d={`M5 5h${POWER.d - 10}M5 25h${POWER.d - 10}`} />}
        />
        <Box {...MOTOR} r={MOTOR.w / 2} top={<circle className="ik-detail" cx={9} cy={9} r={4.5} />} />
        <Box {...FITTING} r={2} />
        <path className="ik-line" d={HOSE} />

        <Box
          {...PEDESTAL}
          r={5}
          front={
            <>
              <text className="ik-label sp-tag" x={5} y={10}>
                CYCLE
              </text>
              <path className="ik-detail" d={`M5 15h${PEDESTAL.w - 10}`} />
            </>
          }
          side={<path className="ik-detail" d={`M5 6h${PEDESTAL.d - 10}`} />}
        />
        <Box {...COLLAR} r={COLLAR.w / 2} />
        {fresh && !aiming ? <Ripple x={PALM.x} y={PALM.y} z={COLLAR.z + COLLAR.h} w={PALM.w} d={PALM.d} r={PALM.w / 2} /> : null}
        <Press label="Press the palm button to stamp a part" material="plastic" onPress={press} data-hot={fresh}>
          <g>
            <Box {...STEM} r={STEM.w / 2} />
            <Box {...PALM} r={PALM.w / 2} top={<circle className="ik-detail" cx={PALM.w / 2} cy={PALM.d / 2} r={7} />} />
          </g>
        </Press>
        <Dimension from={[PUNCH.x + PUNCH.w, PUNCH.y + PUNCH.d, SEAT + 2]} to={[PUNCH.x + PUNCH.w, PUNCH.y + PUNCH.d, PUNCH.z]} offset={[16, 0, 0]} label={`stroke ${STROKE}`} />
        <Cursor at={[PALM.x + PALM.w / 2, PALM.y + PALM.d / 2, PALM.z + PALM.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
