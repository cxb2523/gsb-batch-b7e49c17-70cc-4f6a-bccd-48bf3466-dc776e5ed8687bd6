import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, front, Glow, Plate, Press, playSound, project, Ripple, Signal, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./scooter-dock.css"

export const meta = {
  slug: "scooter-dock",
  title: "Scooter dock",
  industry: "mobility",
  level: 2,
  blurb: "Press unlock on the phone: a signal arcs to the scooter's dash, the dock's lock pin draws back out of the front wheel with a clack and the deck light comes on at €0.25 a minute.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "front", "project", "Callout"],
  sounds: ["press", "release", "process", "latch", "success", "done"],
} satisfies FigureMeta

type Phase = "idle" | "unlocked" | "locked"

const BASE = { x: 0, y: 0, z: 0, w: 184, d: 114, h: 8 }
const G = BASE.h
const WHEEL = { r: 11, t: 5, y: 47.5, z: G + 11 }
const REAR_X = 56
const FRONT_X = 152
const DECK = { x: REAR_X + WHEEL.r, y: 42, z: G + 7, w: FRONT_X - REAR_X - 2 * WHEEL.r - 1, d: 16, h: 6 }
const NECK = { x: 134, y: WHEEL.y, z: G + 2 * WHEEL.r + 1, w: 16, d: WHEEL.t, h: 6 }
const STEM = { x: FRONT_X - 2.5, y: WHEEL.y, z: G + WHEEL.r, w: 5, d: WHEEL.t, h: 82 }
const LAMP = { x: STEM.x + STEM.w, y: WHEEL.y + 0.5, z: G + 76, w: 3, d: 4, h: 5 }
const QR = { x: STEM.x - 1.5, y: STEM.y + STEM.d, z: G + 48, w: 8, d: 1.2, h: 11 }
const BAR = { x: FRONT_X - 3, y: 30, z: STEM.z + STEM.h, w: 6, d: 40, h: 4 }
const GRIPS = [
  { x: BAR.x - 0.5, y: 27, z: BAR.z - 0.5, w: 7, d: 9, h: 5 },
  { x: BAR.x - 0.5, y: 64, z: BAR.z - 0.5, w: 7, d: 9, h: 5 },
] as const
const DASH = { x: FRONT_X - 4.5, y: 44, z: BAR.z + BAR.h, w: 9, d: 12, h: 3 }
const STAND_FOOT = { x: 10, y: 80, z: G, w: 40, d: 28, h: 4 }
const SUPPORT = { x: 20, y: 88, z: STAND_FOOT.z + STAND_FOOT.h, w: 20, d: 4, h: 34 }
const PHONE = { x: 13, y: SUPPORT.y + SUPPORT.d, z: G + 6, w: 34, d: 4, h: 58 }
const LIP = { x: 13, y: PHONE.y + PHONE.d, z: STAND_FOOT.z + STAND_FOOT.h, w: 34, d: 5, h: 5 }
const BAY = { x: 38, y: 24, w: 138, h: 48 }
const BUTTON = { x: 4, y: 39, w: 26, h: 10 }
const RING = 3
const BEAM = curve(
  [PHONE.x + PHONE.w / 2, PHONE.y + PHONE.d / 2, PHONE.z + PHONE.h + 2],
  [PHONE.x + PHONE.w / 2 + 18, PHONE.y - 10, PHONE.z + PHONE.h + 30],
  [DASH.x - 30, DASH.y + 8, DASH.z + 20],
  [DASH.x + DASH.w / 2, DASH.y + DASH.d / 2, DASH.z + DASH.h + 2],
  40,
)
const DOCK = { x: 167, y: 46, z: G, w: 11, d: 12, h: 24 }
const PIN = { x: 155, y: WHEEL.y + WHEEL.t, z: WHEEL.z - 1.5, w: 13, d: 3, h: 3 }
const PIN_TRAVEL = 10
const [PIN_DX, PIN_DY] = project(PIN_TRAVEL, 0, 0)
const SIGNAL_DELAY_MS = 120
const SIGNAL_MS = 640
const ARRIVE_MS = SIGNAL_DELAY_MS + SIGNAL_MS
const BOLT_MS = 220
const LIT_MS = ARRIVE_MS + BOLT_MS
const TIMING = {
  "--arrive": `${ARRIVE_MS}ms`,
  "--bolt": `${BOLT_MS}ms`,
  "--lit": `${LIT_MS}ms`,
  "--pin-x": `${PIN_DX.toFixed(3)}px`,
  "--pin-y": `${PIN_DY.toFixed(3)}px`,
} as CSSProperties
const LOCK_AT = [DOCK.x - 1, PIN.y + PIN.d, PIN.z + PIN.h / 2] as const
const K = Math.SQRT1_2

const READOUTS: Readonly<Record<Phase, string>> = {
  idle: "scooter 0412 · locked",
  unlocked: "unlocked · €0.25/min",
  locked: "locked · ride ended",
}

const polar = (deg: number, r: number) => `${(r * Math.cos((deg * Math.PI) / 180)).toFixed(3)} ${(r * Math.sin((deg * Math.PI) / 180)).toFixed(3)}`
const FENDER = `M${polar(196, WHEEL.r + 3)}A${WHEEL.r + 3} ${WHEEL.r + 3} 0 0 1 ${polar(338, WHEEL.r + 3)}L${polar(338, WHEEL.r + 1.2)}A${WHEEL.r + 1.2} ${WHEEL.r + 1.2} 0 0 0 ${polar(196, WHEEL.r + 1.2)}Z`

const wheelHull = (r: number, t: number) =>
  `M${r * K} ${r * K}L${r * K - t} ${r * K + t}A${r} ${r} 0 0 1 ${-r * K - t} ${t - r * K}L${-r * K} ${-r * K}A${r} ${r} 0 0 1 ${r * K} ${r * K}Z`

function Wheel({ cx, fender }: { cx: number; fender?: boolean }) {
  return (
    <g transform={front(cx, WHEEL.y, WHEEL.z)}>
      <path className="ik-face" d={wheelHull(WHEEL.r, WHEEL.t)} />
      <g transform={`translate(${-WHEEL.t} ${WHEEL.t})`}>
        <circle className="ik-face ik-top" r={WHEEL.r} />
        <circle className="ik-detail" r={WHEEL.r - 2.6} />
        <circle className="ik-face" r={3} />
        {[0, 72, 144, 216, 288].map((deg) => (
          <path key={deg} className="ik-detail" d="M0 -3.2V-7.6" transform={`rotate(${deg})`} />
        ))}
        {fender ? <path className="ik-face" d={FENDER} /> : null}
      </g>
    </g>
  )
}

function Padlock({ open }: { open: boolean }) {
  return (
    <g className={open ? "sd-lock sd-open" : "sd-lock sd-shut"}>
      <path className="sd-lock-line" d={open ? "M-1.6 -0.6V-3.4a1.6 1.6 0 0 1 3.2 0" : "M-1.6 -0.6V-2.4a1.6 1.6 0 0 1 3.2 0V-0.6"} />
      <rect className="sd-lock-body" x={-2.4} y={-0.6} width={4.8} height={3.6} rx={0.7} />
    </g>
  )
}

export default function ScooterDock() {
  const [phase, setPhase] = useState<Phase>("idle")
  const stop = useRef(() => {})
  const arrival = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(arrival.current)
      stop.current()
    },
    [],
  )

  const unlocked = phase === "unlocked"
  const send = (audible: boolean) => {
    window.clearTimeout(arrival.current)
    stop.current()
    stop.current = () => {}
    if (audible) {
      const travelling = playSound("process")
      const playing = [travelling]
      stop.current = () => {
        for (const cut of playing) cut()
      }
      arrival.current = window.setTimeout(() => {
        travelling()
        playing.push(playSound("latch"))
        arrival.current = window.setTimeout(() => playing.push(playSound(unlocked ? "done" : "success")), BOLT_MS)
      }, ARRIVE_MS)
    }
    setPhase(unlocked ? "locked" : "unlocked")
  }
  const demo = useDemoTap(
    () => {
      if (phase === "idle") send(false)
    },
    { delay: 1100 },
  )
  const press = () => {
    demo.dismiss()
    send(true)
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"

  return (
    <Plate
      {...demo.plate}
      fig="Mobility"
      name="Scooter dock"
      hint={unlocked ? "Press lock to end the ride" : "Press unlock"}
      readout={READOUTS[phase]}
      className="fig-scooter-dock"
      style={TIMING}
      data-phase={phase}
      fit={[BASE, { ...PHONE, z: 0, h: PHONE.z + PHONE.h }, GRIPS[0], GRIPS[1], DASH, ...BEAM]}
      aspect={1.3}
      label="A shared e-scooter parked in a painted bay with its front wheel pinned by a dock post, beside a phone on a desk stand running the rental app. Press unlock on the phone to send the unlock to the scooter: the dock's lock pin draws back and its deck light comes on. Press lock to end the ride and pin the wheel again."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={12}
          top={
            <>
              <rect className="ik-dash" x={BAY.x} y={BAY.y} width={BAY.w} height={BAY.h} rx={6} />
              <text className="ik-label sd-bay" x={BAY.x + 6} y={BAY.y + BAY.h - 6}>
                P
              </text>
              <path className="ik-detail" d={`M8 ${BASE.d - 8}H${BASE.w - 8}`} />
            </>
          }
        />

        <Wheel cx={REAR_X} fender />
        <Box
          {...DECK}
          r={4}
          top={Array.from({ length: 11 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${8 + k * 5.5} 4V${DECK.d - 4}`} />
          ))}
          front={
            <Glow on={unlocked} className="sd-deck-glow">
              <path className="sd-deck" d={`M4 2.5H${DECK.w - 4}`} />
            </Glow>
          }
        />
        <Wheel cx={FRONT_X} />
        <Box {...NECK} r={2} />
        <Box {...STEM} r={2.5} />
        <Box {...QR} r={0.5} front={<path className="ik-detail" d="M1.5 1.5h1.6v1.6h-1.6zM3.9 1.5h1.6v1.6h-1.6zM1.5 3.9h1.6v1.6h-1.6zM3.9 5.5h1.6v1.6h-1.6zM1.5 7.9h4" />} />
        <Box {...LAMP} r={1} side={<circle className="ik-detail" cx={2} cy={2.5} r={1.5} />} />
        <g className="sd-pin">
          <Box {...PIN} r={1.2} front={<path className="ik-detail" d={`M2 1.5H${PIN.w - 2}`} />} />
        </g>
        <Box
          {...DOCK}
          r={2.5}
          top={
            <>
              <rect className="ik-well" x={3} y={3} width={DOCK.w - 6} height={DOCK.d - 6} rx={1.5} />
              <path className="ik-detail" d={`M4.5 ${DOCK.d / 2}H${DOCK.w - 4.5}`} />
            </>
          }
          front={
            <>
              <text className="ik-label sd-dock" x={DOCK.w / 2} y={7} textAnchor="middle">
                04
              </text>
              <rect className="ik-detail" x={2} y={10} width={DOCK.w - 4} height={10} rx={1} />
              {[0, 1, 2].map((k) => (
                <path key={k} className="ik-detail" d={`M3.5 ${13 + k * 2.4}H${DOCK.w - 3.5}`} />
              ))}
            </>
          }
          side={[0, 1, 2, 3].map((k) => (
            <path key={k} className="ik-detail" d={`M3 ${6 + k * 3}H${DOCK.d - 3}`} />
          ))}
        />
        <Box {...BAR} r={2} />
        <Box {...GRIPS[0]} r={2.5} top={<path className="ik-detail" d="M3.5 2V7" />} />
        <Box
          {...DASH}
          r={2}
          top={
            <>
              <rect className="ik-screen" x={1.5} y={2} width={DASH.w - 3} height={DASH.d - 4} rx={1.2} />
              <Glow on={unlocked} className="sd-dash-glow">
                <g transform={`translate(${DASH.w / 2} ${DASH.d / 2})`}>
                  <g className="sd-dash-shut">
                    <Padlock open={false} />
                  </g>
                  <g className="sd-dash-open">
                    <Padlock open />
                  </g>
                </g>
              </Glow>
            </>
          }
        />
        <Box {...GRIPS[1]} r={2.5} top={<path className="ik-detail" d="M3.5 2V7" />} />

        <Box {...STAND_FOOT} r={6} top={<path className="ik-detail" d={`M6 ${STAND_FOOT.d - 5}H${STAND_FOOT.w - 6}`} />} />
        <Box {...SUPPORT} r={2} />
        <Box
          {...PHONE}
          r={2}
          front={
            <>
              <path className="ik-detail" d={`M${PHONE.w / 2 - 4} 1.6H${PHONE.w / 2 + 4}`} />
              <rect className="ik-screen" x={2.5} y={3.4} width={PHONE.w - 5} height={54} rx={3} />
              <text className="ik-screen-text ik-dim" x={6} y={12} fontSize={5.6}>
                #0412
              </text>
              <g transform="translate(27.6 10.2)">
                <Padlock open={unlocked} />
              </g>
              <Glow>
                <text className="ik-screen-text" x={6} y={24} fontSize={8}>
                  €0.25
                </text>
              </Glow>
              <text className="ik-screen-text ik-dim" x={6} y={31.5} fontSize={5.6}>
                per min
              </text>
              <path className="ik-detail" d={`M6 35.5H${PHONE.w - 6}`} />
              {phase === "idle" && !aiming ? (
                <Ripple inFace x={BUTTON.x - RING} y={BUTTON.y - RING} w={BUTTON.w + 2 * RING} d={BUTTON.h + 2 * RING} r={8} />
              ) : null}
              <Press className="ik-lift sd-unlock" label={unlocked ? "Lock the scooter" : "Unlock the scooter"} material="glass" onPress={press} data-hot={!unlocked}>
                <g>
                  <rect className="ik-face sd-button" x={BUTTON.x} y={BUTTON.y} width={BUTTON.w} height={BUTTON.h} rx={BUTTON.h / 2} />
                  <g key={phase} className="ik-enter">
                    <text className="ik-label sd-key" x={BUTTON.x + BUTTON.w / 2} y={BUTTON.y + 6.9} textAnchor="middle">
                      {unlocked ? "LOCK" : "UNLOCK"}
                    </text>
                  </g>
                </g>
              </Press>
            </>
          }
        />
        <Box {...LIP} r={2} />

        <g key={`beam-${phase}`}>{phase === "idle" ? null : <Signal points={BEAM} delay={SIGNAL_DELAY_MS} duration={SIGNAL_MS} />}</g>

        <Callout at={LOCK_AT} dx={-12} dy={26} label="dock lock" />
        <Cursor at={[PHONE.x + BUTTON.x + BUTTON.w / 2, PHONE.y + PHONE.d, PHONE.z + PHONE.h - BUTTON.y - BUTTON.h / 2]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
