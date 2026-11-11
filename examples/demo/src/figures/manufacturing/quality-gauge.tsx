import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, playSound, project, Ripple, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./quality-gauge.css"

export const meta = {
  slug: "quality-gauge",
  title: "Quality gauge",
  industry: "manufacturing",
  level: 2,
  blurb: "Press check: the next part slides under the dial indicator, its needle swings to the reading and settles, and the part drops through the go slot into pass or rides off the end into reject.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "project", "Callout"],
  sounds: ["press", "release", "process", "tick", "success", "error"],
} satisfies FigureMeta

type Run = { lot: number; n: number; passed: number; step: number }
type Part = { w: number; h: number }

const BASE = { x: 0, y: 0, z: 0, w: 164, d: 118, h: 8 }
const TRACK_Y = 55
const DECK = 54
const BIN = { y: 36, z: 8, w: 34, d: 40, h: 18 }
const PASS_BIN = { ...BIN, x: 71 }
const REJECT_BIN = { ...BIN, x: 118 }
const BIN_TOP = BIN.z + BIN.h
const POST = { x: 16, y: 36, z: 8, w: 10, d: 6, h: 96 }
const LEGS = [
  { x: 30, y: 50, z: 8, w: 8, d: 10, h: 42 },
  { x: 107, y: 50, z: 8, w: 8, d: 10, h: 38 },
] as const
const CHUTE = { x: 2, y: 44, z: 50, w: 70, d: 22, h: 4 }
const PUSHER = { x: 2, y: 50, z: DECK, w: 10, d: 10, h: 7 }
const PUSH_HEAD = { x: 12, y: 51.5, z: DECK + 1, w: 2.5, d: 7, h: 5 }
const GAUGE = { z: 46, h: 8 }
const SLOT = { x: 80, y: 49, w: 16, d: 12 }
const GAUGE_IN = { ...GAUGE, x: 72, y: 44, w: SLOT.x - 72, d: 22 }
const GAUGE_BACK = { ...GAUGE, x: SLOT.x, y: 44, w: SLOT.w, d: SLOT.y - 44 }
const GAUGE_FRONT = { ...GAUGE, x: SLOT.x, y: SLOT.y + SLOT.d, w: SLOT.w, d: 66 - SLOT.y - SLOT.d }
const GAUGE_OUT = { ...GAUGE, x: SLOT.x + SLOT.w, y: 44, w: 24, d: 22 }
const GAUGE_END = GAUGE_OUT.x + GAUGE_OUT.w
const CLAMP = { x: 17, y: 40, z: 90, w: 8, d: 10, h: 6 }
const TUBE = { x: 13, y: 47, z: 66, w: 18, d: 16, h: 38 }
const CONSOLE = { x: 8, y: 80, z: 8, w: 60, d: 28, h: 24 }
const KEY = { x: 98, y: 90, z: BASE.h, w: 46, d: 20, h: 5 }
const SCREEN = { x: 4, y: 4, w: 52, h: 16 }
const GOOD: Part = { w: 10, h: 8 }
const OVERSIZE: Part = { w: 15, h: 9 }
const START_X = TUBE.x + TUBE.w / 2
const SLOT_X = SLOT.x + SLOT.w / 2
const REJECT_X = REJECT_BIN.x + REJECT_BIN.w / 2
const RISE = TUBE.z - DECK
const DROP = DECK - BIN_TOP
const DIAL_POST = { x: 86, y: 44, z: DECK, w: 4, d: 3, h: 24 }
const HEAD = { x: 78, y: 47, z: 68, w: 20, d: 11, h: 22 }
const PLUNGER = { x: 87, y: TRACK_Y - 1, z: 64, w: 2, d: 2, h: HEAD.z - 64 }
const STEM_CAP = { ...PLUNGER, z: HEAD.z + HEAD.h, h: 3 }
const DIAL = { cx: HEAD.w / 2, cy: 11, r: 8.5 }
const NEEDLE_STOP = -66
const TOLERANCE = 20
const OVER = 56
const LAND_MS = 1000
const SWING_MS = 360
const LOT_SIZE = 40
const START: Run = { lot: 3, n: 33, passed: 32, step: 0 }

const goes = (n: number) => n % 7 !== 0
const reading = (n: number) => (goes(n) ? (((n * 5) % 7) - 3) * 4 : OVER)
const pct = (run: Run) => Math.round((run.passed / run.n) * 100)
const px = (n: number) => `${Math.round(n * 1000) / 1000}px`
const shift = (dx: number) => project(dx, 0, 0)
const GO_MID = shift(SLOT_X - START_X)
const REJECT_MID = shift(GAUGE_END - START_X)
const REJECT_END = shift(REJECT_X - START_X)
const RIDE_GO = { "--mx": px(GO_MID[0]), "--my": px(GO_MID[1]), "--rise": px(-RISE), "--drop": px(DROP) } as CSSProperties
const RIDE_REJECT = {
  "--mx": px(REJECT_MID[0]),
  "--my": px(REJECT_MID[1]),
  "--ex": px(REJECT_END[0]),
  "--ey": px(REJECT_END[1]),
  "--rise": px(-RISE),
  "--drop": px(DROP),
} as CSSProperties
const TIMING = { "--land": `${LAND_MS}ms`, "--swing": `${SWING_MS}ms` } as CSSProperties
const SLOTS = [0, 1] as const

const radial = (deg: number, inner: number, outer: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return `M${(Math.cos(a) * inner).toFixed(3)} ${(Math.sin(a) * inner).toFixed(3)}L${(Math.cos(a) * outer).toFixed(3)} ${(Math.sin(a) * outer).toFixed(3)}`
}
const SCALE_MARKS = [-60, -45, -30, -15, 0, 15, 30, 45, 60].map((deg) => radial(deg, 6.2, 7.5)).join("")
const BAND_MARKS = [-TOLERANCE, TOLERANCE].map((deg) => radial(deg, 4.6, 7.5)).join("")

function advance(run: Run): Run {
  const rolled = run.n >= LOT_SIZE
  const n = rolled ? 1 : run.n + 1
  return { lot: rolled ? (run.lot % 9) + 1 : run.lot, n, passed: (rolled ? 0 : run.passed) + (goes(n) ? 1 : 0), step: run.step + 1 }
}

function Bushing({ part, cx, z }: { part: Part; cx: number; z: number }) {
  return (
    <Box
      x={cx - part.w / 2}
      y={TRACK_Y - part.w / 2}
      z={z}
      w={part.w}
      d={part.w}
      h={part.h}
      r={part.w / 2}
      top={<circle className="ik-well" cx={part.w / 2} cy={part.w / 2} r={part.w * 0.24} />}
    />
  )
}

function Riding({ go }: { go: boolean }) {
  return (
    <g className={go ? "qg-go" : "qg-reject"} style={go ? RIDE_GO : RIDE_REJECT}>
      <g className="qg-fall">
        <Bushing part={go ? GOOD : OVERSIZE} cx={START_X} z={DECK} />
      </g>
    </g>
  )
}

function Resting({ go }: { go: boolean }) {
  return (
    <g className="qg-old">
      <Bushing part={go ? GOOD : OVERSIZE} cx={go ? SLOT_X : REJECT_X} z={BIN_TOP} />
    </g>
  )
}

function Dial({ turn, from, step }: { turn: number; from: number; step: number }) {
  return (
    <g transform={`translate(${DIAL.cx} ${DIAL.cy})`}>
      <circle className="ik-well" r={DIAL.r} />
      <path className="ik-detail" d={SCALE_MARKS} />
      <path className="ik-detail ik-thick" d={BAND_MARKS} />
      <g
        key={step}
        className={step === 0 ? "qg-needle" : "qg-needle qg-measure"}
        style={{ "--turn": `${turn}deg`, "--from": `${from}deg`, "--stop": `${NEEDLE_STOP}deg` } as CSSProperties}
      >
        <path className="ik-line ik-thick" d="M0 2V-6.8" />
      </g>
      <circle className="ik-fill" r={0.9} />
    </g>
  )
}

function Tote({ bin, name, lit, step, pile }: { bin: typeof PASS_BIN; name: string; lit: boolean; step: number; pile: readonly (readonly [number, number])[] }) {
  return (
    <Box
      {...bin}
      r={4}
      top={
        <>
          <rect className="ik-well" x={3} y={3} width={bin.w - 6} height={bin.d - 6} rx={2.5} />
          {pile.map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={2.6} />
          ))}
        </>
      }
      front={
        <>
          <text className="ik-label qg-bin-name" x={4} y={13.4}>
            {name}
          </text>
          <circle className="ik-well" cx={bin.w - 4.5} cy={4.4} r={1.8} />
          {SLOTS.map((slot) => {
            const on = lit && step % 2 === slot
            return (
              <Glow key={slot} on={on} className="qg-lamp-glow">
                <circle className="ik-dot qg-lamp" data-on={on} cx={bin.w - 4.5} cy={4.4} r={1.8} />
              </Glow>
            )
          })}
        </>
      }
      side={<path className="ik-detail" d={`M5 4h${bin.d - 10}`} />}
    />
  )
}

const PASS_PILE = [
  [8, 9],
  [26, 8],
  [9, 30],
  [25, 31],
] as const
const REJECT_PILE = [[9, 30]] as const

export default function QualityGauge() {
  const [run, setRun] = useState<Run>(START)
  const stop = useRef(() => {})
  const timer = useRef(0)
  const clip = useId().replace(/:/g, "")
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const check = (audible: boolean) => {
    const next = advance(run)
    const go = goes(next.n)
    window.clearTimeout(timer.current)
    stop.current()
    if (audible) {
      stop.current = playSound("process")
      timer.current = window.setTimeout(() => {
        playSound("tick")
        timer.current = window.setTimeout(() => {
          stop.current()
          stop.current = playSound(go ? "success" : "error")
        }, SWING_MS)
      }, LAND_MS - SWING_MS)
    }
    setRun(next)
  }
  const demo = useDemoTap(
    () => {
      if (run.step === 0) check(false)
    },
    { delay: 1100 },
  )
  const press = () => {
    demo.dismiss()
    check(true)
  }

  const { step } = run
  const fresh = step === 0
  const go = goes(run.n)
  const previous = run.n === 1 ? LOT_SIZE : run.n - 1
  const previousGo = goes(previous)
  const settled = step > 1
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const readout = fresh ? `lot ${run.lot} · ${run.n} checked` : `${pct(run)}% pass · lot ${run.lot} · #${run.n} ${go ? "go" : "no-go"}`

  return (
    <Plate
      {...demo.plate}
      fig="Manufacturing"
      name="Quality gauge"
      hint="Press check"
      readout={readout}
      className="fig-quality-gauge"
      style={TIMING}
      fit={[BASE, { ...TUBE, z: 0, h: TUBE.z + TUBE.h }, { ...POST, z: 0, h: POST.z + POST.h }]}
      aspect={1.3}
      label="A go/no-go gauge over two bins, with a dial indicator over the go slot, fed by a magazine of bushings and run from a console. Press check to push the next bushing along the gauge: the dial needle swings to its reading and settles, then a good one drops through the go slot into the pass bin and an oversize one rides off the end into reject."
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
        <Box {...POST} r={2} front={<path className="ik-detail" d={`M${POST.w / 2} 6v${POST.h - 50}`} />} />
        <Box {...LEGS[0]} r={2} />
        <Tote bin={PASS_BIN} name="PASS" lit={!fresh && go} step={step} pile={PASS_PILE} />
        <Box {...LEGS[1]} r={2} />
        <Tote bin={REJECT_BIN} name="REJECT" lit={!fresh && !go} step={step} pile={REJECT_PILE} />
        <Box {...CLAMP} r={1.5} />
        <Box
          {...CHUTE}
          r={2}
          top={<path className="ik-detail" d={`M14 ${TRACK_Y - 44 - 7}h${CHUTE.w - 14}M14 ${TRACK_Y - 44 + 7}h${CHUTE.w - 14}`} />}
        />
        <Box {...PUSHER} r={2} top={<path className="ik-detail" d="M3 5h4" />} />
        <g key={`jab-${step}`} className={fresh ? undefined : "qg-jab"}>
          <Box {...PUSH_HEAD} r={1} />
        </g>
        <Box {...GAUGE_IN} r={1.5} />
        <Box {...GAUGE_BACK} r={0.8} />
        <Box {...DIAL_POST} r={1} />

        {settled && previousGo ? <Resting key={`old-${step}`} go /> : null}
        {!fresh && go ? <Riding key={`new-${step}`} go /> : null}

        <Box
          {...GAUGE_FRONT}
          r={0.8}
          front={
            <text className="ik-label qg-mark" x={SLOT.w / 2} y={5.6} textAnchor="middle">
              GO
            </text>
          }
        />
        <Box
          {...GAUGE_OUT}
          r={1.5}
          top={<path className="ik-detail" d={`M${GAUGE_OUT.w - 5} 4v${GAUGE_OUT.d - 8}`} />}
          front={
            <text className="ik-label qg-mark" x={GAUGE_OUT.w / 2} y={5.6} textAnchor="middle">
              NO GO
            </text>
          }
          side={<path className="ik-detail" d="M4 4h14" />}
        />

        {settled && !previousGo ? <Resting key={`old-${step}`} go={false} /> : null}
        {!fresh && !go ? <Riding key={`new-${step}`} go={false} /> : null}

        <Box {...PLUNGER} r={1} />
        <Box
          {...HEAD}
          r={3}
          top={<path className="ik-detail" d={`M3 3h${HEAD.w - 6}`} />}
          front={<Dial turn={reading(run.n)} from={reading(previous)} step={step} />}
          side={<path className="ik-detail" d={`M2.5 4v${HEAD.h - 8}`} />}
        />
        <Box {...STEM_CAP} r={1} />

        <Box
          {...TUBE}
          r={TUBE.w / 2}
          front={
            <>
              <rect className="ik-well" x={TUBE.w / 2 - 3} y={5} width={6} height={TUBE.h - 10} rx={2} />
              {Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${TUBE.w / 2 - 3} ${9 + k * 4.4}h6`} />
              ))}
            </>
          }
        />

        <Box
          {...CONSOLE}
          r={5}
          front={
            <>
              <defs>
                <clipPath id={`${clip}-screen`}>
                  <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
                </clipPath>
              </defs>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
              <g clipPath={`url(#${clip}-screen)`}>
                <Glow>
                  <g key={step} className="ik-enter" style={{ animationDelay: fresh ? "0ms" : "var(--land)" }}>
                    <text className="ik-screen-text ik-dim" x={SCREEN.x + 4} y={SCREEN.y + 6} fontSize={5}>
                      {`lot ${run.lot} · #${run.n}`}
                    </text>
                    <text className="ik-screen-text" x={SCREEN.x + 4} y={SCREEN.y + 13.6} fontSize={7}>
                      {fresh ? "ready" : go ? "GO" : "NO-GO"}
                    </text>
                    <text className="ik-screen-text ik-dim" x={SCREEN.x + SCREEN.w - 4} y={SCREEN.y + 13.6} fontSize={6} textAnchor="end">
                      {`${pct(run)}%`}
                    </text>
                  </g>
                </Glow>
              </g>
            </>
          }
          side={Array.from({ length: 5 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${8 + k * 3.4} 7v12`} />
          ))}
        />
        {fresh && !aiming ? <Ripple {...KEY} r={5} /> : null}
        <Press label="Check the next part" material="rubber" onPress={press} data-hot={fresh}>
          <g>
            <Box
              {...KEY}
              r={5}
              top={
                <>
                  <text className="ik-label qg-key" x={7} y={12.4}>
                    CHECK
                  </text>
                  <path className="ik-detail ik-thick qg-tick" d="M0 3l2.6 2.6L8 0" transform={`translate(${KEY.w - 14} 7)`} />
                </>
              }
            />
          </g>
        </Press>
        <Callout at={[HEAD.x + HEAD.w, HEAD.y + HEAD.d / 2, HEAD.z + HEAD.h - 6]} dx={14} dy={-10} label="dial indicator" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
