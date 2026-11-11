import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, front, Glow, Plate, Press, playSound, Ripple, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./crossing-light.css"

export const meta = {
  slug: "crossing-light",
  title: "Crossing light",
  industry: "mobility",
  level: 1,
  blurb: "Press the call button: the controller's relay clicks, the red figure goes dark and the green walking figure lights with a beep for twelve seconds of crossing.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "front", "Callout"],
  sounds: ["press", "release", "relay", "beep"],
} satisfies FigureMeta

type Phase = "rest" | "walk" | "stop"

const BASE = { x: 0, y: 0, z: 0, w: 140, d: 104, h: 6 }
const PAVEMENT = { x: 4, y: 4, z: BASE.h, w: 132, d: 50, h: 4 }
const KERB_Z = PAVEMENT.z + PAVEMENT.h
const FOOT = { x: 63, y: 35, z: KERB_Z, w: 12, d: 12, h: 3 }
const POLE = { x: 66, y: 38, z: KERB_Z, w: 6, d: 6, h: 102 }
const CAP = { x: 67, y: 39, z: POLE.z + POLE.h, w: 4, d: 4, h: 3 }
const HEAD = { x: 56, y: POLE.y + POLE.d, z: 66, w: 26, d: 10, h: 46 }
const LAMP = { x: 3, w: 20, h: 18, rest: 3, walk: 25 }
const VISORS = [LAMP.rest, LAMP.walk].map((v) => ({ x: HEAD.x + 2, y: HEAD.y + HEAD.d, z: HEAD.z + HEAD.h - v, w: 22, d: 4, h: 1.6 }))
const BUTTON_BOX = { x: 60, y: HEAD.y, z: 32, w: 18, d: 8, h: 26 }
const PAD = { x: 63, y: BUTTON_BOX.y + BUTTON_BOX.d, z: 36, w: 12, d: 2.5, h: 12 }
const CABINET = { x: 100, y: 12, z: KERB_Z, w: 26, d: 14, h: 38 }
const PLINTH = { x: 98, y: 10, z: KERB_Z, w: 30, d: 18, h: 2 }
const WINDOW = { x: 5, y: 6, w: 16, h: 11 }
const ARMATURE = { x: 7.5, y: 14.5, length: 8 }
const CROSSING = { x: 84, w: 32 }
const BARS = [58, 67, 76, 85, 94] as const
const TACTILE = Array.from({ length: 32 }, (_, i) => ({ i, x: CROSSING.x - PAVEMENT.x + 2 + (i % 8) * 4, y: 38 + Math.floor(i / 8) * 3.6 }))
const RING = 3
const LAMP_MS = 160
const TIMING = { "--lamp": `${LAMP_MS}ms` } as CSSProperties
const RELAY_AT = [CABINET.x + ARMATURE.x + ARMATURE.length / 2, CABINET.y + CABINET.d, CABINET.z + CABINET.h - ARMATURE.y] as const
const READOUTS: Readonly<Record<Phase, string>> = {
  rest: "don't walk · press to cross",
  walk: "walk · 12 s",
  stop: "don't walk · cars go",
}

function StandingFigure() {
  return (
    <g className="cl-figure cl-stand" transform={`translate(${LAMP.x + LAMP.w / 2} ${LAMP.rest + LAMP.h / 2 + 2})`}>
      <circle className="cl-solid" cy={-4.7} r={1.5} />
      <rect className="cl-solid" x={-2.5} y={-2.7} width={5} height={5} rx={1.2} />
      <rect className="cl-solid" x={-1.7} y={1.8} width={1.4} height={4.8} rx={0.6} />
      <rect className="cl-solid" x={0.3} y={1.8} width={1.4} height={4.8} rx={0.6} />
    </g>
  )
}

function WalkingFigure() {
  return (
    <g className="cl-figure cl-walk" transform={`translate(${LAMP.x + LAMP.w / 2} ${LAMP.walk + LAMP.h / 2 + 2})`}>
      <circle className="cl-solid" cx={0.8} cy={-4.7} r={1.5} />
      <path className="cl-limb cl-torso" d="M0.5 -2.4L-0.3 1.4" />
      <path className="cl-limb" d="M-0.3 1.4L2.4 6.2M-0.3 1.4L-1.2 3.9L-2.9 6.2M0.3 -1.8L2 0.3L3 0.5M0.3 -1.8L-1.6 -0.1L-2.3 1.3" />
    </g>
  )
}

function Relay() {
  return (
    <>
      <rect className="ik-well" x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} rx={1.5} />
      <rect className="ik-detail" x={WINDOW.x + 2.5} y={WINDOW.y + 1.8} width={6} height={4.4} rx={0.8} />
      <path className="ik-detail" d={`M${WINDOW.x + 4} ${WINDOW.y + 1.8}v4.4M${WINDOW.x + 5.5} ${WINDOW.y + 1.8}v4.4M${WINDOW.x + 7} ${WINDOW.y + 1.8}v4.4`} />
      <path className="ik-detail" d={`M${ARMATURE.x + ARMATURE.length + 1.4} ${ARMATURE.y - 2.6}v3.2`} />
      <g transform={`translate(${ARMATURE.x} ${ARMATURE.y})`}>
        <g className="cl-armature">
          <path className="ik-line" d={`M0 0h${ARMATURE.length}`} />
        </g>
        <circle className="ik-fill" r={0.9} />
      </g>
    </>
  )
}

export default function CrossingLight() {
  const [phase, setPhase] = useState<Phase>("rest")
  const stop = useRef(() => {})
  const lamp = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(lamp.current)
      stop.current()
    },
    [],
  )

  const walk = phase === "walk"
  const demo = useDemoTap(
    () => {
      if (phase === "rest") setPhase("walk")
    },
    { delay: 500 },
  )
  const press = () => {
    demo.dismiss()
    window.clearTimeout(lamp.current)
    stop.current()
    stop.current = playSound("relay")
    if (!walk)
      lamp.current = window.setTimeout(() => {
        stop.current = playSound("beep")
      }, LAMP_MS)
    setPhase(walk ? "stop" : "walk")
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"

  return (
    <Plate
      {...demo.plate}
      fig="Mobility"
      name="Crossing light"
      hint={walk ? "Press to end the walk" : "Press the call button"}
      readout={READOUTS[phase]}
      className="fig-crossing-light"
      style={TIMING}
      data-walk={walk}
      fit={[BASE, HEAD, ...VISORS, { ...CAP, z: 0, h: CAP.z + CAP.h }]}
      aspect={1.2}
      label="A pedestrian crossing light on a pole at the kerb, with a call button box below the signal head, a controller cabinet on the pavement and a zebra crossing on the road. Press the button: the controller's relay clicks and the green walking figure lights; press again to give the road back to the cars."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={10}
          top={
            <>
              {BARS.map((y) => (
                <rect key={y} className="ik-fill" x={CROSSING.x} y={y} width={CROSSING.w} height={5} rx={0.6} />
              ))}
              <path className="ik-detail ik-thick" d={`M${CROSSING.x - 8} 58V${BASE.d - 6}M${CROSSING.x + CROSSING.w + 8} 58V${BASE.d - 6}`} />
              <path className="ik-dash" d={`M10 79H${CROSSING.x - 16}`} />
            </>
          }
        />
        <Box
          {...PAVEMENT}
          r={6}
          top={
            <>
              <path className="ik-detail" d={`M4 ${PAVEMENT.d - 4}H${PAVEMENT.w - 4}`} />
              {[26, 52, 118].map((x) => (
                <path key={x} className="ik-detail" d={`M${x} 6V${PAVEMENT.d - 8}`} />
              ))}
              {TACTILE.map((dot) => (
                <circle key={dot.i} className="ik-fill" cx={dot.x} cy={dot.y} r={0.9} />
              ))}
            </>
          }
        />
        <Box {...PLINTH} r={2} />
        <Box
          {...CABINET}
          r={2.5}
          top={<path className="ik-detail" d={`M4 ${CABINET.d / 2}H${CABINET.w - 4}`} />}
          front={
            <>
              <rect className="ik-detail" x={2.5} y={2.5} width={CABINET.w - 5} height={CABINET.h - 5} rx={1.5} />
              <Relay />
              <circle className="ik-well" cx={CABINET.w - 6} cy={22} r={1.4} />
              {[0, 1, 2, 3].map((k) => (
                <path key={k} className="ik-detail" d={`M6 ${26 + k * 2.4}H${CABINET.w - 6}`} />
              ))}
            </>
          }
          side={[0, 1, 2, 3, 4].map((k) => (
            <path key={k} className="ik-detail" d={`M3 ${8 + k * 3}H${CABINET.d - 3}`} />
          ))}
        />
        <Box {...FOOT} r={FOOT.w / 2} />
        <Box {...POLE} r={POLE.w / 2} />
        <Box {...CAP} r={CAP.w / 2} />

        <Box
          {...BUTTON_BOX}
          r={2}
          top={<path className="ik-detail" d={`M3 ${BUTTON_BOX.d / 2}H${BUTTON_BOX.w - 3}`} />}
          front={
            <>
              <rect className="ik-well" x={2.5} y={3} width={13} height={6.5} rx={1.2} />
              <text className="ik-label cl-wait" x={9} y={7.8} textAnchor="middle">
                WAIT
              </text>
            </>
          }
          side={[0, 1, 2, 3].map((k) => (
            <path key={k} className="ik-detail" d={`M2 ${12 + k * 3}H${BUTTON_BOX.d - 2}`} />
          ))}
        />
        {phase === "rest" && !aiming ? (
          <g transform={front(PAD.x - RING, PAD.y + PAD.d, PAD.z + PAD.h + RING)}>
            <Ripple inFace x={0} y={0} w={PAD.w + 2 * RING} d={PAD.h + 2 * RING} r={4} />
          </g>
        ) : null}
        <Press className="ik-lift cl-push" label={walk ? "End the walk phase" : "Call the green figure"} material="metal" onPress={press} data-hot={!walk}>
          <g>
            <Box
              {...PAD}
              r={1}
              front={
                <>
                  <circle className="ik-detail" cx={PAD.w / 2} cy={5} r={3.2} />
                  <path className="ik-detail ik-thick" d="M3.2 10H8.6M7 8.6L8.6 10L7 11.4" />
                </>
              }
            />
          </g>
        </Press>

        <Box
          {...HEAD}
          r={3}
          top={<path className="ik-detail" d={`M4 ${HEAD.d / 2}H${HEAD.w - 4}`} />}
          front={
            <>
              <rect className="ik-well cl-lens" x={LAMP.x} y={LAMP.rest} width={LAMP.w} height={LAMP.h} rx={3} />
              <rect className="ik-well cl-lens" x={LAMP.x} y={LAMP.walk} width={LAMP.w} height={LAMP.h} rx={3} />
              <Glow on={!walk} className="cl-glow">
                <StandingFigure />
              </Glow>
              <Glow on={walk} className="cl-glow">
                <WalkingFigure />
              </Glow>
            </>
          }
          side={<path className="ik-detail" d={`M3 6V${HEAD.h - 6}`} />}
        />
        {VISORS.map((visor) => (
          <Box key={visor.z} {...visor} r={1} />
        ))}

        <Callout at={RELAY_AT} dx={20} dy={-24} label="relay" />
        <Cursor at={[PAD.x + PAD.w / 2, PAD.y + PAD.d, PAD.z + PAD.h / 2]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
