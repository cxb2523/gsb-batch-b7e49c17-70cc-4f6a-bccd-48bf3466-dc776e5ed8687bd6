import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, playSound, Ripple, top, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./turntable.css"

export const meta = {
  slug: "turntable",
  title: "Turntable",
  industry: "media",
  level: 2,
  blurb: "Press start: the power lamp lights, the motor hums the platter up to 33⅓ while the tonearm swings over and drops onto the next track.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "top", "Callout"],
  sounds: ["press", "release", "motor", "done", "whoosh"],
} satisfies FigureMeta

const PLINTH = { x: 0, y: 0, z: 4, w: 176, d: 136, h: 16 }
const DECK_Z = PLINTH.z + PLINTH.h
const FEET = [
  { x: 4, y: 4 },
  { x: 154, y: 4 },
  { x: 4, y: 114 },
  { x: 154, y: 114 },
].map((at) => ({ ...at, z: 0, w: 18, d: 18, h: PLINTH.z }))
const HINGES = [20, 98].map((x) => ({ x, y: 2, z: DECK_Z, w: 16, d: 6, h: 5 }))
const CENTER = { x: 66, y: 64 }
const PLATTER_R = 54
const RECORD_R = 50
const LABEL_R = 17
const PLATTER = { x: CENTER.x - PLATTER_R, y: CENTER.y - PLATTER_R, z: DECK_Z, w: 2 * PLATTER_R, d: 2 * PLATTER_R, h: 7 }
const RECORD = { x: CENTER.x - RECORD_R, y: CENTER.y - RECORD_R, z: PLATTER.z + PLATTER.h, w: 2 * RECORD_R, d: 2 * RECORD_R, h: 1.5 }
const SPINDLE = { x: CENTER.x - 1.5, y: CENTER.y - 1.5, z: RECORD.z + RECORD.h, w: 3, d: 3, h: 4 }
const PIVOT = { x: 150, y: 38 }
const PIVOT_BASE = { x: PIVOT.x - 10, y: PIVOT.y - 10, z: DECK_Z, w: 20, d: 20, h: 9 }
const GIMBAL = { x: PIVOT.x - 4, y: PIVOT.y - 4, z: PIVOT_BASE.z + PIVOT_BASE.h, w: 8, d: 8, h: 5 }
const ARM_Z = GIMBAL.z + GIMBAL.h
const ARM = 82
const REST = { x: PIVOT.x - 3, y: 98, z: DECK_Z, w: 6, d: 6, h: ARM_Z - DECK_Z - 1 }
const CUE = { x: 164, y: 46, z: DECK_Z, w: 6, d: 12, h: 4 }
const PITCH = { x: 160, y: 88, z: DECK_Z, w: 10, d: 7, h: 3 }
const KEY = { x: 12, y: 116, z: DECK_Z, w: 40, d: 14, h: 4 }
const GROOVES = [46, 44, 39, 37, 32, 30, 25, 23] as const
const STROBE = Array.from({ length: 60 }, (_, k) => (k * Math.PI) / 30)
const LAMP = { x: 102, y: 123.5 }
const SKATE_TICKS = Array.from({ length: 9 }, (_, k) => {
  const a = ((150 + k * 15) * Math.PI) / 180
  const inner = k % 4 === 0 ? 6.6 : 7.6
  return `M${(10 + inner * Math.cos(a)).toFixed(3)} ${(10 + inner * Math.sin(a)).toFixed(3)}L${(10 + 9 * Math.cos(a)).toFixed(3)} ${(10 + 9 * Math.sin(a)).toFixed(3)}`
}).join("")
const RIM_AT = [CENTER.x + (PLATTER_R - 2) * Math.cos((7 * Math.PI) / 6), CENTER.y + (PLATTER_R - 2) * Math.sin((7 * Math.PI) / 6), PLATTER.z + PLATTER.h] as const
const SWING_MS = 700
const DROP_MS = 300
const LAND_MS = SWING_MS + DROP_MS
const SPEED = 200
const TURN_MS = (360 / SPEED) * 1000
const SPIN_UP_MS = 1800
const SPIN_WAIT_MS = 150
const PLAYS = 8
const TIMING = {
  "--swing": `${SWING_MS}ms`,
  "--drop": `${DROP_MS}ms`,
  "--land": `${LAND_MS}ms`,
  "--spin-up": `${SPIN_UP_MS}ms`,
  "--turn": `${TURN_MS}ms`,
  "--wait": `${SPIN_WAIT_MS}ms`,
} as CSSProperties
const noop = () => {}

function swingTo(r: number): number {
  const dx = PIVOT.x - CENTER.x
  const dy = PIVOT.y - CENTER.y
  const a = 2 * ARM * dx
  const b = -2 * ARM * dy
  const k = dx * dx + dy * dy + ARM * ARM - r * r
  return ((Math.asin(k / Math.hypot(a, b)) - Math.atan2(b, a)) * 180) / Math.PI
}

const trackAt = (r: number) => ({ r, angle: swingTo(r) })
const FIRST_TRACK = trackAt(48)
const TRACKS = [FIRST_TRACK, ...[41, 34, 27].map(trackAt)]

type Deck = { presses: number; from: number; coast: number; coastMs: number }

const REST_DECK: Deck = { presses: 0, from: 0, coast: 0, coastMs: 0 }

function angleOf(element: SVGGElement | null): number {
  if (!element) return 0
  const transform = getComputedStyle(element).transform
  if (!transform || transform === "none") return 0
  const m = new DOMMatrixReadOnly(transform)
  return (Math.atan2(m.b, m.a) * 180) / Math.PI
}

function readoutOf(presses: number): string {
  if (presses === 0) return "ready · side A"
  const track = ((presses - 1) >> 1) + 1
  return presses % 2 ? `side A · track ${track}` : `stopped · track ${track}`
}

export default function Turntable() {
  const [deck, setDeck] = useState<Deck>(REST_DECK)
  const stop = useRef(noop)
  const stopMotor = useRef(noop)
  const timer = useRef(0)
  const playedAt = useRef(0)
  const spin = useRef<SVGGElement>(null)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
      stopMotor.current()
    },
    [],
  )

  const playing = deck.presses % 2 === 1
  const track = TRACKS[(Math.max(deck.presses, 1) - 1) >> 1] ?? FIRST_TRACK
  const toggle = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stop.current()
    stopMotor.current()
    stop.current = noop
    stopMotor.current = noop
    const presses = (deck.presses % PLAYS) + 1
    const from = angleOf(spin.current)
    if (playing) {
      const spun = performance.now() - playedAt.current - SPIN_WAIT_MS
      const speed = Math.max(0, Math.min(1, spun / SPIN_UP_MS)) * SPEED
      const coastMs = (SPIN_UP_MS * speed) / SPEED
      if (audible) stop.current = playSound("whoosh")
      setDeck({ presses, from, coast: (speed * coastMs) / 2000, coastMs })
      return
    }
    playedAt.current = performance.now()
    if (audible) {
      stopMotor.current = playSound("motor", { duration: (SPIN_WAIT_MS + SPIN_UP_MS) / 1000 })
      timer.current = window.setTimeout(() => {
        stop.current = playSound("done")
      }, LAND_MS)
    }
    setDeck({ presses, from, coast: 0, coastMs: 0 })
  }
  const demo = useDemoTap(() => {
    if (deck.presses === 0) toggle(false)
  }, { delay: 1100 })
  const press = () => {
    demo.dismiss()
    toggle(true)
  }

  const aiming = demo.phase === "aim" || demo.phase === "press"
  const spinVars = {
    "--from": `${deck.from}deg`,
    "--coast": `${deck.coast}deg`,
    "--coast-ms": `${deck.coastMs}ms`,
  } as CSSProperties

  return (
    <Plate
      {...demo.plate}
      fig="Media"
      name="Turntable"
      hint={playing ? "Press to stop" : "Press start"}
      readout={readoutOf(deck.presses)}
      className="fig-turntable"
      style={TIMING}
      data-playing={playing}
      fit={[{ ...PLINTH, z: 0, h: DECK_Z }, PLATTER, GIMBAL, [PIVOT.x, PIVOT.y - 24, ARM_Z]]}
      aspect={1.3}
      label="A turntable with a record on its platter, a tonearm at rest beside it, a power lamp and a start key. Press start: the motor spins the platter up while the arm swings onto the next track; press again to stop."
    >
      <g ref={demo.ref}>
        {FEET.map((foot) => (
          <Box key={`${foot.x}-${foot.y}`} {...foot} r={foot.w / 2} />
        ))}
        <Box
          {...PLINTH}
          r={8}
          top={
            <>
              <rect className="ik-well" x={PITCH.x + 3} y={64} width={4} height={52} rx={2} />
              {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                <path key={k} className="ik-detail" d={`M${PITCH.x + 10} ${66 + k * 8}h${k === 3 ? 4 : 2.5}`} />
              ))}
              {["33", "45"].map((speed, k) => (
                <g key={speed}>
                  <rect className="ik-detail" x={60 + k * 20} y={119} width={16} height={9} rx={1.5} />
                  <text className="ik-label tt-small" x={64.6 + k * 20} y={125.8}>
                    {speed}
                  </text>
                </g>
              ))}
              <Glow on={playing}>
                <circle className="tt-lamp" data-on={playing} cx={LAMP.x} cy={LAMP.y} r={1.6} />
              </Glow>
            </>
          }
          front={Array.from({ length: 3 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${118 + k * 4} 5v6`} />
          ))}
        />
        {HINGES.map((hinge) => (
          <Box key={hinge.x} {...hinge} r={1.5} top={<path className="ik-detail" d="M3 3h10" />} />
        ))}
        <Box
          {...PLATTER}
          r={PLATTER_R}
          top={
            <g transform={`translate(${PLATTER_R} ${PLATTER_R})`}>
              <g className="tt-spin ik-loop" style={spinVars}>
                {STROBE.map((a) => (
                  <circle key={a} className="ik-fill" cx={(PLATTER_R - 2) * Math.cos(a)} cy={(PLATTER_R - 2) * Math.sin(a)} r={0.75} />
                ))}
              </g>
            </g>
          }
        />
        <Box
          {...RECORD}
          r={RECORD_R}
          top={
            <g transform={`translate(${RECORD_R} ${RECORD_R})`}>
              <g ref={spin} className="tt-spin ik-loop" style={spinVars}>
                {TRACKS.map((t) => (
                  <circle key={t.r} className="ik-detail" r={t.r} />
                ))}
                {GROOVES.map((r) => (
                  <circle key={r} className="ik-detail tt-groove" r={r} />
                ))}
                <circle className="ik-face ik-top" r={LABEL_R} />
                <circle className="ik-detail" r={LABEL_R - 3} />
                <text className="ik-label tt-side" x={0} y={-6} textAnchor="middle">
                  A
                </text>
                <path className="ik-detail" d="M-8 6h16M-5 9.5h10" />
              </g>
              {playing ? <circle key={deck.presses} className="ik-live tt-track" r={track.r} /> : null}
            </g>
          }
        />
        <Box {...SPINDLE} r={1.5} />
        <Box
          {...PIVOT_BASE}
          r={PIVOT_BASE.w / 2}
          top={
            <>
              <circle className="ik-detail" cx={10} cy={10} r={6} />
              <path className="ik-detail" d={SKATE_TICKS} />
            </>
          }
        />
        <Box {...GIMBAL} r={GIMBAL.w / 2} />
        <Box {...CUE} r={2} top={<path className="ik-line ik-thick" d={`M${CUE.w / 2} 2.5v7`} />} />
        <Box {...REST} r={2} top={<path className="ik-detail" d="M1 3h4" />} />
        <Box {...PITCH} r={1.5} top={<path className="ik-detail" d={`M2 ${PITCH.d / 2}h${PITCH.w - 4}`} />} />

        {deck.presses || aiming ? null : <Ripple {...KEY} r={3} />}
        <Press label={playing ? "Stop the record" : "Start the record"} material="plastic" onPress={press} data-hot={!playing}>
          <g>
            <Box
              {...KEY}
              r={3}
              top={
                <>
                  <text className="ik-label tt-key" x={5} y={9.6}>
                    START
                  </text>
                  <path className="ik-detail tt-glyph" d="M29 4.6v5l4-2.5zM34.5 4.8h3.2v4.6h-3.2z" />
                </>
              }
            />
          </g>
        </Press>

        <g className="tt-cue">
          <g transform={top(PIVOT.x, PIVOT.y, ARM_Z)}>
            <g className="tt-swing" style={{ transform: `rotate(${playing ? track.angle : 0}deg)` }}>
              <rect className="ik-face ik-top" x={-6} y={-24} width={12} height={13} rx={3} />
              <path className="ik-detail" d="M-6 -20.5h12M-6 -17.5h12M-6 -14.5h12" />
              <rect className="ik-face ik-top" x={-1.6} y={-11} width={3.2} height={ARM - 4} rx={1.6} />
              <circle className="ik-face ik-top" r={4.6} />
              <circle className="ik-fill" r={1.4} />
              <g transform={`translate(0 ${ARM})`}>
                <path className="ik-line" d="M4.5 -11l6.5 -2.4" />
                <rect className="ik-face ik-top" x={-4.5} y={-16} width={9} height={17} rx={1.5} />
                <rect className="ik-well" x={-3} y={-9} width={6} height={8.5} rx={1} />
                <circle className="ik-fill" r={0.9} />
              </g>
            </g>
          </g>
        </g>

        <Callout at={RIM_AT} dx={-24} dy={-22} label="33⅓ rpm" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
