import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, useDemoTap, type Vec3 } from "react-isokit"
import { Dimension } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./cryo-stack.css"

export const meta = {
  slug: "cryo-stack",
  title: "Cryo stack",
  industry: "deeptech",
  level: 3,
  blurb: "Press cool: the pump spins up, the fridge's plates settle together lowest first, the screen counts down to 10 mK and the needle settles on cold.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "curve", "path", "Dimension"],
  sounds: ["motor", "cascade", "complete", "whoosh"],
} satisfies FigureMeta

type Disc = { w: number; h: number; z: number; lift: number }
type State = "warm" | "cold" | "warming"

const BASE = { x: 0, y: 0, z: 0, w: 180, d: 140, h: 8 }
const CX = 62
const CY = 58
const STAGES: readonly Disc[] = [
  { w: 34, h: 3, z: 26, lift: 6 },
  { w: 42, h: 3, z: 41, lift: 13 },
  { w: 52, h: 3, z: 56, lift: 20 },
  { w: 62, h: 3, z: 71, lift: 27 },
  { w: 74, h: 3, z: 86, lift: 34 },
]
const TOP: Disc = { w: 96, h: 5, z: 101, lift: 41 }
const DISCS: readonly Disc[] = [...STAGES, TOP]
const PORT = { x: CX - 6, y: CY - 6, z: TOP.z + TOP.h, w: 12, d: 12, h: 7 }
const SAMPLE = { x: CX - 7, y: CY - 7, z: 18, w: 14, d: 14, h: 8 }
const POSTS = [
  { x: CX - 47, y: CY - 4, z: 8, w: 8, d: 8, h: TOP.z - 8 },
  { x: CX - 4, y: CY - 47, z: 8, w: 8, d: 8, h: TOP.z - 8 },
] as const
const CABINET = { x: 122, y: 74, z: 8, w: 50, d: 48, h: 54 }
const KEY = { x: 126, y: 92, z: CABINET.z + CABINET.h, w: 42, d: 20, h: 5 }
const PUMP = { x: 14, y: 106, z: 8, w: 40, d: 22, h: 16 }
const FLANGE = { x: 28, y: 113, z: 24, w: 8, d: 8, h: 4 }
const HOSE = path(curve([36, 117, 28], [40, 136, 9.5], [100, 136, 9.5], [128, 122, 14]))
const ROD_ANGLES = [75, 195, 315] as const
const ROTOR = { x: 31, y: 11, r: 6.5 }
const BLADES = [0, 120, 240].map((deg) => {
  const a = (deg * Math.PI) / 180
  return `M${Math.cos(a) * 1.6} ${Math.sin(a) * 1.6}L${Math.cos(a + 0.5) * 5.4} ${Math.sin(a + 0.5) * 5.4}`
}).join("")
const DIAL = { x: 34, y: 18, r: 8.5, warm: 52, cold: -52 }
const DIAL_TICKS = [-52, -26, 0, 26, 52].map((deg) => {
  const a = ((deg - 90) * Math.PI) / 180
  return `M${Math.cos(a) * 6} ${Math.sin(a) * 6}L${Math.cos(a) * 7.6} ${Math.sin(a) * 7.6}`
}).join("")
const STEP_MS = 60
const SETTLE_MS = 700
const LAND_MS = 360
const COUNTDOWN = [
  { temp: "300 K", at: 0 },
  { temp: "4 K", at: 480 },
  { temp: "1 K", at: 800 },
  { temp: "100 mK", at: 1120 },
  { temp: "10 mK", at: 1440 },
] as const
const STABLE_MS = 1440

const RIM = TOP.w / 2 / Math.SQRT2
const STACK_FOOT: Vec3 = [CX + RIM, CY - RIM, BASE.h]
const STACK_OFFSET: Vec3 = [8, -8, 0]
const stackTop = (cold: boolean): Vec3 => [CX + RIM, CY - RIM, TOP.z + TOP.h + (cold ? 0 : TOP.lift)]

const box = (disc: Disc) => ({ x: CX - disc.w / 2, y: CY - disc.w / 2, z: disc.z, w: disc.w, d: disc.w, h: disc.h })
const rods = (upper: Disc, lower: Disc) =>
  ROD_ANGLES.map((deg) => {
    const a = (deg * Math.PI) / 180
    const r = lower.w / 2 - 5
    return { x: CX + r * Math.cos(a) - 1.2, y: CY + r * Math.sin(a) - 1.2, z: lower.z + lower.h, w: 2.4, d: 2.4, h: upper.z - lower.z - lower.h }
  }).sort((p, q) => p.x + p.y - (q.x + q.y))

function Ring({ disc }: { disc: Disc }) {
  const c = disc.w / 2
  return <circle className="ik-detail ring" cx={c} cy={c} r={c - 3} />
}

export default function CryoStack() {
  const [state, setState] = useState<State>("warm")
  const [step, setStep] = useState(0)
  const [touched, setTouched] = useState(false)
  const stops = useRef<Array<() => void>>([])
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      for (const stop of stops.current) stop()
    },
    [],
  )

  const cold = state === "cold"
  const toggle = (audible: boolean) => {
    window.clearTimeout(timer.current)
    for (const stop of stops.current) stop()
    stops.current = []
    if (audible && !cold) {
      stops.current.push(playSound("motor", { duration: STABLE_MS / 1000 }))
      stops.current.push(playSound("cascade", { count: STAGES.length, stagger: STEP_MS / 1000, delay: LAND_MS / 1000 }))
      timer.current = window.setTimeout(() => {
        stops.current.push(playSound("complete"))
      }, STABLE_MS)
    }
    if (audible && cold) stops.current.push(playSound("whoosh"))
    setState(cold ? "warming" : "cold")
    setStep(step + 1)
  }
  const demo = useDemoTap(() => {
    if (state === "warm") toggle(false)
  }, { delay: 1800 })
  const press = () => {
    demo.dismiss()
    setTouched(true)
    toggle(true)
  }

  const readout = cold ? "10 mK · stable" : state === "warming" ? "warming · 300 K" : "warm · 300 K"

  return (
    <Plate
      {...demo.plate}
      fig="Deep tech"
      name="Cryo stack"
      hint={cold ? "Press to warm up" : "Press cool"}
      readout={readout}
      className="fig-cryo-stack"
      style={{ "--step": `${STEP_MS}ms`, "--settle": `${SETTLE_MS}ms`, "--land": `${LAND_MS}ms`, "--stable": `${STABLE_MS}ms` } as CSSProperties}
      data-cold={cold}
      fit={[BASE, { x: CX - TOP.w / 2, y: CY - TOP.w / 2, z: 0, w: TOP.w, d: TOP.w, h: PORT.z + PORT.h + TOP.lift }]}
      aspect={1.3}
      label="A dilution refrigerator: five round plates hanging from a top plate, a pump, and a cabinet with a screen and a temperature dial. Press cool to run the pump, settle the plates together and count the temperature down to 10 millikelvin; press again to warm it up."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={12}
          top={
            <>
              <rect className="ik-detail" x={8} y={8} width={BASE.w - 16} height={BASE.d - 16} rx={7} />
              <circle className="ik-dash" cx={CX} cy={CY} r={22} />
            </>
          }
        />
        {POSTS.map((post) => (
          <g key={post.x}>
            <Box {...post} r={post.w / 2} />
            <Box x={post.x - 2} y={post.y - 2} z={TOP.z - 4} w={post.w + 4} d={post.d + 4} h={4} r={2} />
          </g>
        ))}

        {DISCS.map((disc, i) => {
          const lower = DISCS[i - 1]
          return (
            <g key={disc.z} className="stage" style={{ "--lift": `${-disc.lift}px`, "--i": i, "--j": DISCS.length - 1 - i } as CSSProperties}>
              <g className="ik-float" style={{ animationDelay: `${-i * 0.7}s` }}>
                {i === 0 ? <Box {...SAMPLE} r={SAMPLE.w / 2} top={<rect className="ik-fill" x={4.5} y={4.5} width={5} height={5} rx={1} />} /> : null}
                {lower ? rods(disc, lower).map((rod) => <Box key={`${rod.x}-${rod.y}`} {...rod} r={1.2} />) : null}
                <Box
                  {...box(disc)}
                  r={disc.w / 2}
                  top={
                    disc === TOP ? (
                      <>
                        <Ring disc={disc} />
                        {Array.from({ length: 12 }, (_, k) => {
                          const a = (k * Math.PI) / 6
                          return <circle key={k} className="ik-fill" cx={disc.w / 2 + 40 * Math.cos(a)} cy={disc.w / 2 + 40 * Math.sin(a)} r={1.1} />
                        })}
                        <circle className="ik-detail" cx={disc.w / 2 - 22} cy={disc.w / 2 + 8} r={3} />
                        <circle className="ik-detail" cx={disc.w / 2 + 18} cy={disc.w / 2 - 20} r={3} />
                      </>
                    ) : (
                      <Ring disc={disc} />
                    )
                  }
                />
                {disc === TOP ? <Box {...PORT} r={PORT.w / 2} top={<circle className="ik-detail" cx={6} cy={6} r={3} />} /> : null}
              </g>
            </g>
          )
        })}

        <Box
          {...PUMP}
          r={4}
          top={
            <g transform={`translate(${ROTOR.x} ${ROTOR.y})`}>
              <circle className="ik-well" r={ROTOR.r} />
              <g className="rotor">
                <path className="ik-detail" d={BLADES} />
              </g>
              <circle className="ik-fill" r={1.2} />
            </g>
          }
          front={<PumpFins />}
          side={<path className="ik-detail" d="M5 5h12M5 8.5h12" />}
        />
        <Box {...FLANGE} r={FLANGE.w / 2} />
        <Box
          {...CABINET}
          r={4}
          front={
            <>
              <rect className="ik-screen" x={5} y={6} width={40} height={22} rx={3} />
              <g key={`small-${step}`} className="ik-enter">
                {cold ? (
                  <>
                    <text className="ik-screen-text ik-dim shown passing" x={9} y={13.5} fontSize={5.6} style={{ "--on": "0ms", "--off": `${STABLE_MS}ms` } as CSSProperties}>
                      cooling
                    </text>
                    <text className="ik-screen-text ik-dim shown" x={9} y={13.5} fontSize={5.6} style={{ "--on": `${STABLE_MS}ms` } as CSSProperties}>
                      stable
                    </text>
                  </>
                ) : (
                  <text className="ik-screen-text ik-dim" x={9} y={13.5} fontSize={5.6}>
                    {state === "warming" ? "warming" : "warm"}
                  </text>
                )}
              </g>
              <g key={`temp-${step}`}>
                {cold ? (
                  COUNTDOWN.map(({ temp, at }, k) => (
                    <text
                      key={temp}
                      className={k === COUNTDOWN.length - 1 ? "ik-screen-text shown" : "ik-screen-text shown passing"}
                      x={9}
                      y={24}
                      fontSize={8}
                      style={{ "--on": `${at}ms`, "--off": `${COUNTDOWN[k + 1]?.at ?? STABLE_MS}ms` } as CSSProperties}
                    >
                      {temp}
                    </text>
                  ))
                ) : (
                  <g className="ik-enter">
                    <text className="ik-screen-text" x={9} y={24} fontSize={8}>
                      300 K
                    </text>
                  </g>
                )}
              </g>
              <Glow on={cold} className="light-glow">
                <circle className="light" cx={9} cy={35} r={1.9} />
              </Glow>
              <path className="ik-detail" d="M15 35h14" />
              {Array.from({ length: 4 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M5 ${41 + k * 3}h40`} />
              ))}
            </>
          }
          side={
            <>
              {Array.from({ length: 5 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${8 + k * 3.4} 8v16`} />
              ))}
              <g transform={`translate(${DIAL.x} ${DIAL.y})`}>
                <circle className="ik-well" r={DIAL.r} />
                <path className="ik-detail" d={DIAL_TICKS} />
                <g className="needle" style={{ "--turn": `${cold ? DIAL.cold : DIAL.warm}deg` } as CSSProperties}>
                  <path className="ik-line" d="M0 1.4V-6.4" />
                </g>
                <circle className="ik-fill" r={1.1} />
              </g>
              <circle className="ik-well" cx={36} cy={40} r={2.6} />
            </>
          }
        />
        <path className="ik-line" d={HOSE} />

        {!touched && state === "warm" && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...KEY} r={6} /> : null}
        <Press label={cold ? "Warm the fridge" : "Cool the fridge"} material="metal" onPress={press} data-hot={!cold}>
          <g>
            <Box
              {...KEY}
              r={6}
              top={
                <>
                  <text className="ik-label key" x={6} y={12.5}>
                    {cold ? "WARM" : "COOL"}
                  </text>
                  <path className="ik-detail ik-thick flake" d="M0-4v8M-3.5-2l7 4M-3.5 2l7-4" transform={`translate(${KEY.w - 7.5} ${KEY.d / 2})`} />
                </>
              }
            />
          </g>
        </Press>
        <Dimension className="stack-dim" from={STACK_FOOT} to={stackTop(cold)} offset={STACK_OFFSET} label={`h ${TOP.z + TOP.h + (cold ? 0 : TOP.lift)}`} />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}

function PumpFins() {
  return (
    <>
      {Array.from({ length: 7 }, (_, k) => (
        <path key={k} className="ik-detail" d={`M${5 + k * 4} 4v9`} />
      ))}
    </>
  )
}
