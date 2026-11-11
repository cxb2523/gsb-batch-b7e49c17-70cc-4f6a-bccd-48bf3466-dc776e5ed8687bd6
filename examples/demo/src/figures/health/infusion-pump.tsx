import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, Signal, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./infusion-pump.css"

export const meta = {
  slug: "infusion-pump",
  title: "Infusion pump",
  industry: "health",
  level: 2,
  blurb: "Press start: the roller pump turns, drops run down the line from the bag, the pump's lamp comes on and the rate lands on its screen.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path", "playSound", "Callout"],
  sounds: ["motor", "done", "toggle"],
} satisfies FigureMeta

type Flow = "idle" | "running" | "paused"

const BASE = { x: 0, y: 0, z: 0, w: 128, d: 112, h: 8 }
const PX = 44
const PY = 40
const CASTERS_BACK = [
  [23, PY],
  [PX, 19],
] as const
const CASTERS_FRONT = [
  [65, PY],
  [PX, 61],
] as const
const LEGS_BACK = [
  { x: 20, y: PY - 2.5, z: 12, w: 24, d: 5, h: 3 },
  { x: PX - 2.5, y: 16, z: 12, w: 5, d: 24, h: 3 },
] as const
const LEGS_FRONT = [
  { x: PX, y: PY - 2.5, z: 12, w: 24, d: 5, h: 3 },
  { x: PX - 2.5, y: PY, z: 12, w: 5, d: 24, h: 3 },
] as const
const HUB = { x: PX - 8, y: PY - 8, z: 10, w: 16, d: 16, h: 7 }
const POLE = { x: PX - 3, y: PY - 3, z: 17, w: 6, d: 6, h: 119 }
const COLLAR = { x: PX - 4.5, y: PY - 4.5, z: 88, w: 9, d: 9, h: 6 }
const KNOB = { x: PX + 4.5, y: PY - 1.5, z: 89.5, w: 4, d: 3, h: 3 }
const CAP = { x: PX - 4, y: PY - 4, z: 136, w: 8, d: 8, h: 3 }
const ARM_LEFT = { x: 24, y: PY - 1.5, z: 129, w: 17, d: 3, h: 3 }
const ARM_RIGHT = { x: PX + 3, y: PY - 1.5, z: 129, w: 39, d: 3, h: 3 }
const HOOKS = [24, 84] as const
const BAG = { x: 68, y: 37, z: 92, w: 24, d: 6, h: 30 }
const SPIKE = { x: 78.5, y: 38.5, z: 87, w: 3, d: 3, h: 5 }
const PORT = { x: 71, y: 38.5, z: 88.5, w: 3, d: 3, h: 3.5 }
const CHAMBER = { x: 76.5, y: 36.5, z: 71, w: 7, d: 7, h: 16 }
const PUMP = { x: 2, y: 46, z: 36, w: 72, d: 26, h: 44 }
const HANDLE = { x: 14, y: 50, z: 80, w: 44, d: 5, h: 3 }
const LEDGE = { x: 2, y: 72, z: 36, w: 72, d: 18, h: 8 }
const KEY = { x: 34, y: 75, z: 44, w: 36, d: 12, h: 3 }
const CONNECTOR = { x: 100, y: 91, z: 8, w: 10, d: 6, h: 4 }
const INLET: Vec3 = [PUMP.x + PUMP.w, 56, 70]
const OUTLET: Vec3 = [PUMP.x + PUMP.w, 56, 46]
const LINE_IN = curve([80, 40, 71], [80, 43, 54], [80, 56, 66], INLET, 32)
const LINE_OUT = path(curve(OUTLET, [90, 56, 44], [94, 74, 9.5], [CONNECTOR.x + 2, CONNECTOR.y + 3, 9.5], 32))
const STRAP = path([
  [HOOKS[1], PY, 129],
  [HOOKS[1], PY, 124],
  [80, PY, 122],
])
const DROPS = [0, 150, 300] as const
const DROP_MS = 520
const ARRIVE_MS = 300 + DROP_MS
const SCREEN = { x: 5, y: 5, w: 54, h: 26 }
const TIMING = { "--arrive": `${ARRIVE_MS}ms` } as CSSProperties
const onSide = ([, y, z]: Vec3) => ({ cx: PUMP.y + PUMP.d - y, cy: PUMP.z + PUMP.h - z })
const PORT_IN = onSide(INLET)
const PORT_OUT = onSide(OUTLET)
const PORT_R = 2.2
const DOOR_TUBE = `M${PORT_IN.cx} ${PORT_IN.cy + PORT_R}C${PORT_IN.cx + 4.2} ${PORT_IN.cy + 4} 20.7 17 20.7 22S${PORT_OUT.cx + 4.2} ${PORT_OUT.cy - 4} ${PORT_OUT.cx} ${PORT_OUT.cy - PORT_R}`
const ROTOR = { cx: 12, cy: 22, r: 6.8, reach: 4.6 }
const ROLLERS = [0, 120, 240].map((turn) => {
  const angle = (turn * Math.PI) / 180
  return { turn, x: Math.cos(angle) * ROTOR.reach, y: Math.sin(angle) * ROTOR.reach }
})
const ROTOR_AT: Vec3 = [PUMP.x + PUMP.w, PUMP.y + PUMP.d - ROTOR.cx, PUMP.z + PUMP.h - ROTOR.cy]

function Hook({ x }: { x: number }) {
  return (
    <path
      className="ik-line"
      d={path([
        [x, PY, 132],
        [x, PY, 135],
        [x + 2, PY, 137],
        [x + 4, PY, 135.5],
      ])}
    />
  )
}

function Rotor() {
  return (
    <g transform={`translate(${ROTOR.cx} ${ROTOR.cy})`}>
      <g className="rotor">
        <circle className="ik-detail" r={ROTOR.r} />
        {ROLLERS.map(({ turn, x, y }) => (
          <path key={turn} className="ik-detail" d={`M0 0L${x} ${y}`} />
        ))}
        {ROLLERS.map(({ turn, x, y }) => (
          <circle key={turn} className="ik-face" cx={x} cy={y} r={1.9} />
        ))}
      </g>
      <circle className="ik-fill" r={1.1} />
    </g>
  )
}

function Caster({ at: [cx, cy] }: { at: readonly [number, number] }) {
  return <Box x={cx - 3} y={cy - 3} z={8} w={6} d={6} h={4} r={3} />
}

export default function InfusionPump() {
  const [run, setRun] = useState<{ flow: Flow; step: number }>({ flow: "idle", step: 0 })
  const [touched, setTouched] = useState(false)
  const stop = useRef(() => {})
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const { flow, step } = run
  const running = flow === "running"
  const toggle = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stop.current()
    if (audible && !running) {
      stop.current = playSound("motor", { duration: ARRIVE_MS / 1000 })
      timer.current = window.setTimeout(() => {
        stop.current()
        stop.current = playSound("done")
      }, ARRIVE_MS)
    }
    if (audible && running) stop.current = playSound("toggle")
    setRun({ flow: running ? "paused" : "running", step: 1 - step })
  }
  const demo = useDemoTap(() => {
    if (flow === "idle") toggle(false)
  }, { delay: 500 })
  const press = () => {
    demo.dismiss()
    setTouched(true)
    toggle(true)
  }

  const readout = running ? "50 ml/h · running" : flow === "paused" ? "paused · 0 ml/h" : "idle · 0 ml/h"

  return (
    <Plate
      {...demo.plate}
      fig="Health"
      name="Infusion pump"
      hint={running ? "Press to pause" : "Press start"}
      readout={readout}
      className="fig-infusion-pump"
      style={TIMING}
      data-run={running}
      fit={[BASE, CAP, ARM_LEFT, ARM_RIGHT, BAG, PUMP]}
      aspect={1.15}
      label="An infusion pump clamped to an IV pole, with a line running down from a saline bag. Press start to run drops down the line and show the rate on the pump's screen; press again to pause."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={12}
          top={<rect className="ik-detail" x={8} y={8} width={BASE.w - 16} height={BASE.d - 16} rx={7} />}
        />
        {CASTERS_BACK.map((at) => (
          <Caster key={at.join()} at={at} />
        ))}
        {LEGS_BACK.map((leg) => (
          <Box key={leg.x} {...leg} r={1.5} />
        ))}
        <Box {...HUB} r={8} top={<circle className="ik-detail" cx={8} cy={8} r={4.5} />} />
        {CASTERS_FRONT.map((at) => (
          <Caster key={at.join()} at={at} />
        ))}
        {LEGS_FRONT.map((leg) => (
          <Box key={leg.x} {...leg} r={1.5} />
        ))}

        <Box {...ARM_LEFT} r={1.5} />
        <Hook x={HOOKS[0]} />
        <Box {...POLE} r={3} />
        <Box {...COLLAR} r={4.5} front={<path className="ik-detail" d="M2 2.5h5" />} />
        <Box {...KNOB} r={1.5} />
        <Box {...CAP} r={4} />
        <Box {...ARM_RIGHT} r={1.5} />
        <Hook x={HOOKS[1]} />
        <path className="ik-line" d={STRAP} />

        <Box
          {...BAG}
          r={3}
          top={<path className="ik-detail" d={`M4 3h${BAG.w - 8}`} />}
          front={
            <>
              <circle className="ik-well" cx={12} cy={3.4} r={1.6} />
              <path className="ik-detail" d={`M2.5 8.5h${BAG.w - 5}`} />
              {[11, 15, 19, 23, 27].map((y, k) => (
                <path key={y} className="ik-detail" d={`M3 ${y}h${k % 2 ? 2.5 : 4.5}`} />
              ))}
              <rect className="ik-detail" x={10} y={12} width={11} height={12} rx={1.5} />
              <path className="ik-detail" d="M12.5 16h6M12.5 19.5h4" />
            </>
          }
          side={<path className="ik-detail" d="M3 6v20" />}
        />
        <Box {...PORT} r={1.5} />
        <Box {...SPIKE} r={1.5} />
        <Box
          {...CHAMBER}
          r={3.5}
          front={
            <>
              <g className="drip ik-loop">
                <circle className="drop-dot" cx={3.5} cy={3.6} r={1.1} />
              </g>
              <path className="ik-detail" d="M1 11.5h5" />
            </>
          }
        />

        <Box
          {...PUMP}
          r={4}
          front={
            <>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={3} />
              <g key={`small-${step}`} className="ik-enter">
                <text className="ik-screen-text ik-dim" x={10} y={13.6} fontSize={6}>
                  {running ? "infusing" : flow === "paused" ? "paused" : "ready"}
                </text>
              </g>
              <g key={`big-${step}`}>
                {running ? (
                  <Glow on>
                    <text className="ik-screen-text priming" x={10} y={26} fontSize={10}>
                      priming
                    </text>
                    <g className="ik-enter arrive">
                      <text className="ik-screen-text" x={10} y={26} fontSize={10}>
                        50 ml/h
                      </text>
                    </g>
                  </Glow>
                ) : (
                  <g className="ik-enter">
                    <text className="ik-screen-text" x={10} y={26} fontSize={10}>
                      0 ml/h
                    </text>
                  </g>
                )}
              </g>
              <Glow on={running} className="lamp-glow">
                <circle className="lamp" cx={65.5} cy={10} r={2.6} />
              </Glow>
              <path className="ik-detail" d="M65.5 16.5c-1.8 2.4-2.7 3.8-2.7 4.9a2.7 2.7 0 0 0 5.4 0c0-1.1-.9-2.5-2.7-4.9z" />
              {[0, 1, 2, 3, 4, 5].map((k) => (
                <path key={k} className="ik-detail" d={`M${7 + k * 3.2} 34v-0.5`} />
              ))}
              <path className="ik-detail" d="M30 33.8h29" />
            </>
          }
          side={
            <>
              <rect className="ik-well" x={4} y={4} width={18} height={36} rx={3} />
              <path className="ik-detail" d="M23.4 8v5M23.4 31v5" />
              <rect className="ik-detail" x={1.6} y={19} width={2.4} height={6} rx={1} />
              <circle className="ik-well" cx={PORT_IN.cx} cy={PORT_IN.cy} r={PORT_R} />
              <circle className="ik-well" cx={PORT_OUT.cx} cy={PORT_OUT.cy} r={PORT_R} />
              <path className="ik-line" d={DOOR_TUBE} />
              <Rotor />
            </>
          }
        />
        <Box {...HANDLE} r={2.5} />
        <Box
          {...LEDGE}
          r={3}
          top={
            <>
              {[7, 15, 23].map((cx) => (
                <circle key={cx} className="ik-detail" cx={cx} cy={9} r={2.6} />
              ))}
              <path className="ik-detail" d="M5.6 9h2.8M13.6 9h2.8M15 7.6v2.8" />
            </>
          }
          front={<path className="ik-detail" d={`M5 3.5h${LEDGE.w - 10}`} />}
        />

        {!touched && flow === "idle" && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...KEY} r={3} /> : null}
        <Press label={running ? "Pause the infusion" : "Start the infusion"} onPress={press} material="rubber" data-hot={!running}>
          <g>
            <Box
              {...KEY}
              r={3}
              top={
                <>
                  <text className="ik-label key" x={5} y={8.4}>
                    {running ? "PAUSE" : "START"}
                  </text>
                  {running ? (
                    <path className="ik-detail ik-thick" d="M29 3.4v5.2M31.6 3.4v5.2" />
                  ) : (
                    <path className="ik-detail ik-thick play" d="M28.6 3.2l3.8 2.8-3.8 2.8z" />
                  )}
                </>
              }
            />
          </g>
        </Press>

        <path className="ik-line" d={path(LINE_IN)} />
        <g key={`drops-${step}`}>{running ? DROPS.map((delay) => <Signal key={delay} className="drop" points={LINE_IN} delay={delay} duration={DROP_MS} />) : null}</g>
        <path className="ik-line" d={LINE_OUT} />
        <Box {...CONNECTOR} r={2} top={<path className="ik-detail" d="M3 3h4" />} />
        <Callout at={ROTOR_AT} dx={26} dy={6} label="roller pump" />

        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
