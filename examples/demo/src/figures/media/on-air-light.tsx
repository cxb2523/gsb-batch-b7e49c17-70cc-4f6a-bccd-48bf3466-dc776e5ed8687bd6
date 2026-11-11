import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, path, playSound, Ripple, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./on-air-light.css"

export const meta = {
  slug: "on-air-light",
  title: "On-air light",
  industry: "media",
  level: 1,
  blurb: "Flip the wall switch: the relay over it clicks, the ON AIR sign above the studio door lights and its clock starts from 00:00.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "path", "Callout"],
  sounds: ["press", "release", "relay"],
} satisfies FigureMeta

const BASE = { x: 0, y: 0, z: 0, w: 168, d: 50, h: 8 }
const WALL = { x: 0, y: 0, z: BASE.h, w: 168, d: 14, h: 80 }
const FACE_Y = WALL.y + WALL.d
const SIGN = { x: 12, y: FACE_Y, z: 62, w: 84, d: 10, h: 22 }
const CLIPS = [24, 74].map((x) => ({ x, y: FACE_Y, z: SIGN.z + SIGN.h, w: 6, d: 6, h: 2 }))
const PLATE = { x: 106, y: FACE_Y, z: 30, w: 22, d: 3, h: 32 }
const ROCKER = { x: PLATE.x + 4, y: PLATE.y + PLATE.d, z: PLATE.z + 5, w: 14, h: 11 }
const OUT = 6
const IN = 2
const RELAY = { x: 107, y: FACE_Y, z: 71, w: 20, d: 4, h: 14 }
const ARMATURE = { x: 10.5, y: 4.5, length: 6 }
const PANEL = { x: 136, y: FACE_Y, z: 18, w: 24, d: 4, h: 62 }
const DOOR = { x: 20, top: 30, w: 46, h: 50 }
const CONDUIT_Y = FACE_Y + 1
const CONDUITS = [
  path([
    [PLATE.x + PLATE.w / 2, CONDUIT_Y, PLATE.z + PLATE.h],
    [PLATE.x + PLATE.w / 2, CONDUIT_Y, RELAY.z],
  ]),
  path([
    [RELAY.x, CONDUIT_Y, RELAY.z + 5],
    [SIGN.x + SIGN.w, CONDUIT_Y, RELAY.z + 5],
  ]),
]
const RELAY_AT = [RELAY.x + RELAY.w / 2, RELAY.y + RELAY.d, RELAY.z + RELAY.h / 2] as const
const RELAY_MS = 120
const TIMING = { "--relay": `${RELAY_MS}ms` } as CSSProperties
const WINDOW = { x: 57, y: 5.5, w: 21.5, h: 11 }
const DIGIT = 3.36
const LINE = 10
const CLOCK_X = WINDOW.x + (WINDOW.w - DIGIT * 5) / 2
const CLOCK_Y = 13.2
const ROLLS = [
  { at: 0, count: 6, seconds: 3600 },
  { at: 1, count: 10, seconds: 600 },
  { at: 3, count: 6, seconds: 60 },
  { at: 4, count: 10, seconds: 10 },
] as const
const WINDINGS = Array.from({ length: 5 }, (_, k) => `M3 ${4.6 + k * 1.4}h6`).join("")

const half = (z: number, out: boolean) => ({ x: ROCKER.x, y: ROCKER.y, z, w: ROCKER.w, d: out ? OUT : IN, h: ROCKER.h })

function Clock({ running, clip }: { running: boolean; clip: string }) {
  if (!running)
    return (
      <text className="ik-screen-text ik-dim" x={CLOCK_X} y={CLOCK_Y} fontSize={5.6}>
        --:--
      </text>
    )
  return (
    <g clipPath={`url(#${clip})`}>
      {ROLLS.map((roll) => (
        <g
          key={roll.at}
          className="oal-roll ik-loop"
          style={{ "--shift": `${-roll.count * LINE}px`, animationDuration: `${roll.seconds}s`, animationTimingFunction: `steps(${roll.count})` } as CSSProperties}
        >
          {Array.from({ length: roll.count }, (_, k) => (
            <text key={k} className="ik-screen-text" x={CLOCK_X + roll.at * DIGIT} y={CLOCK_Y + k * LINE} fontSize={5.6}>
              {k}
            </text>
          ))}
        </g>
      ))}
      <text className="ik-screen-text" x={CLOCK_X + 2 * DIGIT} y={CLOCK_Y} fontSize={5.6}>
        :
      </text>
    </g>
  )
}

function RelayFace({ on }: { on: boolean }) {
  return (
    <>
      <rect className="ik-well" x={2} y={2} width={RELAY.w - 4} height={RELAY.h - 4} rx={1.5} />
      <rect className="ik-detail" x={3} y={3.4} width={6} height={7.4} rx={1} />
      <path className="ik-detail" d={WINDINGS} />
      <path className="ik-detail" d={`M${ARMATURE.x + ARMATURE.length + 1.2} ${ARMATURE.y - 2.2}v4.4`} />
      <g transform={`translate(${ARMATURE.x} ${ARMATURE.y})`}>
        <g className="oal-armature" data-on={on}>
          <path className="ik-line" d={`M0 0h${ARMATURE.length}`} />
        </g>
        <circle className="ik-fill" r={0.9} />
      </g>
      <circle className="ik-fill" cx={13.5} cy={9.8} r={0.8} />
      <circle className="ik-fill" cx={16.2} cy={9.8} r={0.8} />
    </>
  )
}

export default function OnAirLight() {
  const [presses, setPresses] = useState(0)
  const stop = useRef(() => {})
  const timer = useRef(0)
  const clip = useId().replace(/[^\w-]/g, "")
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const on = presses === 1
  const flip = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stop.current()
    if (audible)
      timer.current = window.setTimeout(() => {
        stop.current = playSound("relay")
      }, RELAY_MS)
    setPresses(on ? 2 : 1)
  }
  const demo = useDemoTap(() => {
    if (presses === 0) flip(false)
  }, { delay: 500 })
  const press = () => {
    demo.dismiss()
    flip(true)
  }

  const aiming = demo.phase === "aim" || demo.phase === "press"
  const upper = half(ROCKER.z + ROCKER.h, !on)
  const lower = half(ROCKER.z, on)

  return (
    <Plate
      {...demo.plate}
      fig="Media"
      name="On-air light"
      hint={on ? "Press to go off air" : "Press the switch"}
      readout={on ? "on air · 00:00" : "off air · standby"}
      className="fig-on-air-light"
      style={TIMING}
      data-on={on}
      fit={[BASE, WALL]}
      aspect={1.1}
      label="A studio wall with a door, an ON AIR sign above it, a rocker switch beside it and a relay between them. Press the switch: the relay clicks, the sign lights and its on-air clock starts; press again to go off air."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={10}
          top={
            <>
              <rect className="ik-detail" x={DOOR.x + 2} y={FACE_Y + 5} width={DOOR.w - 4} height={13} rx={2} />
              {[6, BASE.w - 6].map((x) => (
                <circle key={x} className="ik-detail" cx={x} cy={BASE.d - 6} r={1.8} />
              ))}
            </>
          }
        />
        <Box
          {...WALL}
          r={4}
          top={<path className="ik-detail" d={`M5 ${WALL.d / 2}h${WALL.w - 10}`} />}
          front={
            <>
              <path className="ik-detail" d={`M${DOOR.x} ${DOOR.top + DOOR.h}V${DOOR.top + 1.5}a1.5 1.5 0 0 1 1.5-1.5h${DOOR.w - 3}a1.5 1.5 0 0 1 1.5 1.5V${DOOR.top + DOOR.h}`} />
              <path className="ik-detail" d={`M${DOOR.x + 4} ${DOOR.top + DOOR.h}V${DOOR.top + 4}h${DOOR.w - 8}V${DOOR.top + DOOR.h}`} />
              <circle className="ik-well" cx={DOOR.x + DOOR.w / 2} cy={DOOR.top + 14} r={5.5} />
              <path className="ik-detail" d={`M${DOOR.x + DOOR.w / 2 - 2.5} ${DOOR.top + 12}l3-3`} />
              <path className="ik-line" d={`M${DOOR.x + DOOR.w - 11} ${DOOR.top + 27}h6`} />
              <circle className="ik-fill" cx={DOOR.x + DOOR.w - 11} cy={DOOR.top + 27} r={1.4} />
              <rect className="ik-detail" x={DOOR.x + 8} y={DOOR.top + DOOR.h - 8} width={DOOR.w - 16} height={5} rx={1} />
            </>
          }
          side={Array.from({ length: 4 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M3 ${14 + k * 16}h${WALL.d - 6}`} />
          ))}
        />
        {CONDUITS.map((d) => (
          <path key={d} className="ik-line" d={d} />
        ))}
        <Box
          {...SIGN}
          r={3}
          front={
            <>
              <defs>
                <clipPath id={clip}>
                  <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} rx={1.5} />
                </clipPath>
              </defs>
              <rect className="ik-detail" x={3} y={3} width={SIGN.w - 6} height={SIGN.h - 6} rx={2.5} />
              <Glow on={on} className="oal-glow">
                <g className="oal-lit">
                  <rect className="oal-panel" x={5.5} y={5.5} width={48} height={11} rx={1.5} />
                  <text className="ik-label oal-word" x={29.5} y={14.2} textAnchor="middle">
                    ON AIR
                  </text>
                </g>
              </Glow>
              <rect className="ik-screen" x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} rx={1.5} />
              <Glow on={on} className="oal-glow">
                <g key={presses} className={presses ? "oal-clock" : undefined}>
                  <Clock running={on} clip={clip} />
                </g>
              </Glow>
            </>
          }
          side={<circle className="ik-fill" cx={SIGN.d / 2} cy={SIGN.h / 2} r={1.2} />}
        />
        {CLIPS.map((c) => (
          <Box key={c.x} {...c} r={1} />
        ))}
        <Box
          {...RELAY}
          r={1.5}
          top={<path className="ik-detail" d={`M3 ${RELAY.d / 2}h${RELAY.w - 6}`} />}
          front={<RelayFace on={on} />}
          side={<path className="ik-detail" d="M1.2 4v6" />}
        />
        <Box
          {...PLATE}
          r={1.5}
          front={
            <>
              <rect className="ik-well" x={3} y={4} width={PLATE.w - 6} height={PLATE.h - 8} rx={1.5} />
              <circle className="ik-fill" cx={PLATE.w / 2} cy={2} r={0.9} />
              <circle className="ik-fill" cx={PLATE.w / 2} cy={PLATE.h - 2} r={0.9} />
            </>
          }
        />
        {presses || aiming ? null : <Ripple x={PLATE.x} y={PLATE.y} z={upper.z + upper.h} w={PLATE.w} d={PLATE.d + OUT} r={2} />}
        <Press label={on ? "Switch the on-air light off" : "Switch the on-air light on"} material="plastic" onPress={press} data-hot={!on}>
          <g>
            <Box {...lower} r={1.5} front={<circle className="ik-detail" cx={ROCKER.w / 2} cy={ROCKER.h / 2} r={2} />} />
            <Box {...upper} r={1.5} front={<path className="ik-detail" d={`M${ROCKER.w / 2} 3v4`} />} />
          </g>
        </Press>
        <Box
          {...PANEL}
          r={2}
          top={<path className="ik-detail" d={`M3 ${PANEL.d / 2}h${PANEL.w - 6}`} />}
          front={Array.from({ length: 7 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${3 + k * 3} 4v${PANEL.h - 8}`} />
          ))}
        />
        <Callout at={RELAY_AT} dx={24} dy={-30} label="relay" />
        <Cursor at={[ROCKER.x + ROCKER.w / 2, ROCKER.y + OUT, ROCKER.z + ROCKER.h * 1.5]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
