import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, front, Glow, Plate, Press, path, playSound, project, Ripple, Signal, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./ev-charger.css"

export const meta = {
  slug: "ev-charger",
  title: "EV charger",
  industry: "energy",
  level: 2,
  blurb: "Press the plug: the connector seats in the car's inlet and its latch catches, a signal runs down the cable and the car's charge bar fills toward 80%.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path", "project", "front", "playSound", "Callout"],
  sounds: ["press", "release", "latch", "process", "success", "whoosh"],
} satisfies FigureMeta

type Phase = "idle" | "charging" | "unplugged"

const BASE = { x: 0, y: 0, z: 0, w: 214, d: 140, h: 8 }
const BODY = { x: 8, y: 34, z: 11, w: 132, d: 56, h: 26 }
const CABIN = { x: 30, y: 39, z: BODY.z + BODY.h, w: 84, d: 46, h: 15 }
const FLANK = BODY.y + BODY.d
const WHEELS = [34, 96] as const
const WHEEL = { r: 11, arch: 13, z: BASE.h + 11 }
const INLET = { x: 124, z: 26 }
const GAP = 7
const HEAD = { x: INLET.x - 5.5, y: FLANK + GAP, z: INLET.z - 5, w: 11, d: 6, h: 10 }
const GRIP = { x: INLET.x - 4, y: HEAD.y + HEAD.d, z: INLET.z - 4.5, w: 8, d: 12, h: 9 }
const CATCH = { x: INLET.x - 1.5, y: HEAD.y + 0.6, z: HEAD.z + HEAD.h, w: 3, d: 10, h: 1.6 }
const CATCH_LIFT = { y: 2, z: 1.4 }
const PLUG = { x: HEAD.x, y: HEAD.y, z: HEAD.z, w: HEAD.w, d: HEAD.d + GRIP.d, h: HEAD.h + CATCH.h + CATCH_LIFT.z }
const EXIT: Vec3 = [INLET.x, GRIP.y + GRIP.d, INLET.z]
const TAIL = path([EXIT, [INLET.x, EXIT[1] + GAP + 4, INLET.z]])
const PLINTH = { x: 154, y: 16, z: BASE.h, w: 52, d: 30, h: 4 }
const ANCHORS = [
  [3.4, 3.4],
  [PLINTH.w - 3.4, 3.4],
  [3.4, PLINTH.d - 3.4],
  [PLINTH.w - 3.4, PLINTH.d - 3.4],
] as const
const POST = { x: 158, y: 20, z: PLINTH.z + PLINTH.h, w: 44, d: 22, h: 72 }
const CAP = { x: 155, y: 17, z: POST.z + POST.h, w: 50, d: 28, h: 5 }
const GLAND: Vec3 = [180, POST.y + POST.d, POST.z + 3]
const GROUND = BASE.h + 0.6
const LEAD_POINTS: readonly Vec3[] = [
  [INLET.x, EXIT[1] + 4, INLET.z],
  ...curve([INLET.x, EXIT[1] + GAP + 4, INLET.z], [INLET.x, 134, INLET.z - 2], [128, 132, GROUND], [148, 128, GROUND], 20),
  ...curve([148, 128, GROUND], [174, 122, GROUND], [GLAND[0], 86, GROUND], [GLAND[0], 54, GROUND], 18),
  [GLAND[0], PLINTH.y + PLINTH.d + 1, PLINTH.z + PLINTH.h + 0.6],
  [GLAND[0], GLAND[1] + 1.5, GLAND[2] - 1],
  GLAND,
]
const LEAD = path(LEAD_POINTS)
const SIGNAL_PATH: readonly Vec3[] = [...LEAD_POINTS].reverse().concat([[INLET.x, EXIT[1] - GAP, INLET.z]])
const [SEAT_X, SEAT_Y] = project(0, -GAP, 0)
const [LIFT_X, LIFT_Y] = project(0, CATCH_LIFT.y, CATCH_LIFT.z)
const SEAT_STYLE = { "--seat-x": `${SEAT_X}px`, "--seat-y": `${SEAT_Y}px`, "--lift-x": `${LIFT_X}px`, "--lift-y": `${LIFT_Y}px` } as CSSProperties
const SEAT_MS = 380
const SIGNAL_AT = SEAT_MS
const SIGNAL_MS = 520
const ARRIVE_MS = SIGNAL_AT + SIGNAL_MS
const TIMING = { "--seat": `${SEAT_MS}ms`, "--arrive": `${ARRIVE_MS}ms` } as CSSProperties
const CELLS = [0, 1, 2, 3, 4] as const
const CHARGED = 4
const CHARGING_CELL = CHARGED - 1
const BAR = { x: 42, y: 16, w: 5.4, h: 3, gap: 1.2 }
const SCREEN = { x: 4, y: 6, w: 36, h: 27 }
const PINS = [
  [0, -1.6],
  [-1.5, -0.4],
  [1.5, -0.4],
  [-0.9, 1.4],
  [0.9, 1.4],
] as const
const BOLT = "M6 0L1 9h4.4L3 16l7-10H5.6L8 0z"
const READOUTS: Readonly<Record<Phase, string>> = { idle: "ready · plug in", charging: "11 kW · 34% → 80%", unplugged: "unplugged · 0 kW" }
const NEXT: Readonly<Record<Phase, Phase>> = { idle: "charging", charging: "unplugged", unplugged: "charging" }

const INLET_POINT: Vec3 = [INLET.x, FLANK, INLET.z]

const local = (x: number, z: number) => ({ x: x - BODY.x, y: BODY.z + BODY.h - z })
const INLET_AT = local(INLET.x, INLET.z)
const archOf = (cx: number) => {
  const { x, y } = local(cx, WHEEL.z)
  const half = Math.sqrt(WHEEL.arch ** 2 - (BODY.h - y) ** 2)
  return `M${x - half} ${BODY.h}A${WHEEL.arch} ${WHEEL.arch} 0 1 1 ${x + half} ${BODY.h}Z`
}

function Wheel({ cx }: { cx: number }) {
  return (
    <g transform={front(cx, FLANK + 0.6, WHEEL.z)}>
      <circle className="ik-face" r={WHEEL.r} />
      <circle className="ik-detail" r={6.4} />
      {[0, 72, 144, 216, 288].map((deg) => (
        <path key={deg} className="ik-detail" d="M0 -2V-6.4" transform={`rotate(${deg})`} />
      ))}
      <circle className="ik-fill" r={1.4} />
    </g>
  )
}

export default function EvCharger() {
  const [run, setRun] = useState<{ phase: Phase; step: number }>({ phase: "idle", step: 0 })
  const stop = useRef(() => {})
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const { phase, step } = run
  const charging = phase === "charging"
  const toggle = (audible: boolean) => {
    const next = NEXT[phase]
    window.clearTimeout(timer.current)
    stop.current()
    if (audible && next === "charging") {
      timer.current = window.setTimeout(() => {
        playSound("latch")
        stop.current = playSound("process")
        timer.current = window.setTimeout(() => {
          stop.current()
          stop.current = playSound("success")
        }, ARRIVE_MS - SEAT_MS)
      }, SEAT_MS)
    }
    if (audible && next === "unplugged") stop.current = playSound("whoosh")
    setRun({ phase: next, step: step === 1 ? 2 : 1 })
  }
  const demo = useDemoTap(
    () => {
      if (phase === "idle") toggle(false)
    },
    { delay: 1100 },
  )
  const press = () => {
    demo.dismiss()
    toggle(true)
  }

  return (
    <Plate
      {...demo.plate}
      fig="Energy"
      name="EV charger"
      hint={charging ? "Press to unplug" : "Press the plug"}
      readout={READOUTS[phase]}
      className="fig-ev-charger"
      style={TIMING}
      data-charging={charging}
      fit={[BASE, { ...BODY, z: 0, h: CABIN.z + CABIN.h }, { ...CAP, z: 0, h: CAP.z + CAP.h }, PLUG]}
      aspect={1.5}
      label="A charging post on a parking bay, cabled to a parked electric car whose connector waits outside the charge inlet. Press the plug to seat it; its latch catches, a signal runs down the cable and the car's charge bar fills from 34 to 80 percent. Press again to unplug."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={12}
          top={
            <>
              <path className="ik-detail" d="M2 26H148V102H2" />
              <path className="ik-detail" d="M2 28.5H145.5V99.5H2" />
              <path className="ik-detail" d={BOLT} transform="translate(190 94)" />
              {[
                [BASE.w - 10, 10],
                [BASE.w - 10, BASE.d - 10],
                [10, BASE.d - 10],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.6} />
              ))}
            </>
          }
        />

        <Box
          {...BODY}
          r={10}
          top={
            <>
              <path className="ik-detail" d={`M6 14H${CABIN.x - BODY.x - 4}M6 ${BODY.d - 14}H${CABIN.x - BODY.x - 4}`} />
              <path className="ik-detail" d={`M${BODY.w - 12} 8V${BODY.d - 8}`} />
            </>
          }
          front={
            <>
              {WHEELS.map((cx) => (
                <path key={cx} className="ik-well" d={archOf(cx)} />
              ))}
              <path className="ik-detail" d={`M${local(50, 0).x} 2V13M${local(80, 0).x} 2V13`} />
              <path className="ik-detail" d={`M${BAR.x} ${BODY.h - 3}H${BAR.x + 32}`} />
              <rect className="ik-detail" x={local(60, 0).x} y={3} width={7} height={1.8} rx={0.9} />
              <rect className="ik-detail" x={11} y={3} width={9} height={2.4} rx={1.2} />
              {CELLS.map((k) => (
                <g key={k} style={{ "--k": Math.max(0, k - 1) } as CSSProperties}>
                  <Glow on={charging && k < CHARGED} className="ev-lit">
                    <rect
                      className="ev-cell ik-loop"
                      data-on={k < CHARGED}
                      data-head={k === CHARGING_CELL}
                      x={BAR.x + k * (BAR.w + BAR.gap)}
                      y={BAR.y}
                      width={BAR.w}
                      height={BAR.h}
                      rx={0.8}
                    />
                  </Glow>
                </g>
              ))}
              <rect className="ik-detail" x={INLET_AT.x - 6} y={INLET_AT.y - 6} width={12} height={12} rx={3} />
              <circle className="ik-well" cx={INLET_AT.x} cy={INLET_AT.y} r={3.8} />
              {PINS.map(([px, py]) => (
                <circle key={`${px}-${py}`} className="ik-fill" cx={INLET_AT.x + px} cy={INLET_AT.y + py} r={0.6} />
              ))}
            </>
          }
          side={
            <>
              <rect className="ik-detail" x={8} y={3} width={BODY.d - 16} height={3} rx={1.5} />
              <rect className="ik-detail" x={BODY.d / 2 - 9} y={10} width={18} height={6} rx={1} />
              <path className="ik-detail" d={`M6 ${BODY.h - 4}H${BODY.d - 6}`} />
            </>
          }
        />
        {WHEELS.map((cx) => (
          <Wheel key={cx} cx={cx} />
        ))}
        <Box
          {...CABIN}
          r={9}
          top={<rect className="ik-detail" x={14} y={9} width={CABIN.w - 28} height={CABIN.d - 18} rx={5} />}
          front={
            <>
              <rect className="ik-well" x={7} y={3} width={33} height={9} rx={3} />
              <rect className="ik-well" x={43} y={3} width={33} height={9} rx={3} />
            </>
          }
          side={<rect className="ik-well" x={6} y={3} width={CABIN.d - 12} height={9} rx={3} />}
        />

        <Box
          {...PLINTH}
          r={4}
          top={ANCHORS.map(([cx, cy]) => (
            <g key={`${cx}-${cy}`}>
              <circle className="ik-detail" cx={cx} cy={cy} r={1.5} />
              <circle className="ik-fill" cx={cx} cy={cy} r={0.6} />
            </g>
          ))}
        />
        <Box
          {...POST}
          r={5}
          front={
            <>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={3} />
              <g key={`small-${step}`} className="ik-enter" style={{ animationDelay: `${charging ? ARRIVE_MS : 0}ms` }}>
                <text className="ik-screen-text ik-dim" x={SCREEN.x + 4} y={SCREEN.y + 8} fontSize={5.6}>
                  {charging ? "34% → 80%" : phase === "unplugged" ? "unplugged" : "plug in"}
                </text>
              </g>
              <Glow>
                <g key={`big-${step}`}>
                  {charging ? (
                    <>
                      <text className="ik-screen-text ev-linking" x={SCREEN.x + 4} y={SCREEN.y + 20} fontSize={7}>
                        linking
                      </text>
                      <g className="ik-enter" style={{ animationDelay: `${ARRIVE_MS}ms` }}>
                        <text className="ik-screen-text" x={SCREEN.x + 4} y={SCREEN.y + 20} fontSize={8}>
                          11 kW
                        </text>
                      </g>
                    </>
                  ) : (
                    <g className="ik-enter">
                      <text className="ik-screen-text" x={SCREEN.x + 4} y={SCREEN.y + 20} fontSize={8}>
                        {phase === "unplugged" ? "0 kW" : "ready"}
                      </text>
                    </g>
                  )}
                </g>
              </Glow>
              <Glow on={charging} className="ev-lit">
                <rect className="ev-strip" x={8} y={37} width={28} height={3} rx={1.5} />
              </Glow>
              <rect className="ik-detail" x={10} y={45} width={24} height={13} rx={3} />
              <g className="ik-detail" transform="translate(22 52)">
                <path d="M-1.5 1.5a2.2 2.2 0 0 1 3 0" />
                <path d="M-3.6 -0.6a5 5 0 0 1 7.2 0" />
                <path d="M-5.6 -2.7a7.8 7.8 0 0 1 11.2 0" />
              </g>
              <text className="ik-label ev-tag" x={8} y={63}>
                11 kW AC
              </text>
              <circle className="ik-well" cx={GLAND[0] - POST.x} cy={POST.h - 3} r={2.2} />
            </>
          }
          side={
            <>
              <rect className="ik-well" x={6} y={22} width={11} height={18} rx={3} />
              <path className="ik-detail" d="M8 44h7" />
              {Array.from({ length: 4 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M6 ${54 + k * 3}h11`} />
              ))}
            </>
          }
        />
        <Box {...CAP} r={6} top={<circle className="ik-detail" cx={CAP.w / 2} cy={CAP.d / 2} r={5} />} />

        <path className="ik-line" d={LEAD} />
        <g className="ev-plug" style={SEAT_STYLE}>
          <Press label={charging ? "Unplug the car" : "Plug in the car"} material="plastic" onPress={press} data-hot={!charging}>
            <g>
              <Box {...HEAD} r={4} side={<path className="ik-detail" d={`M1.6 2v${HEAD.h - 4}`} />} />
              <Box
                {...GRIP}
                r={2.5}
                top={<rect className="ik-detail" x={2.2} y={2.5} width={GRIP.w - 4.4} height={5} rx={1.5} />}
                front={<circle className="ik-detail" cx={GRIP.w / 2} cy={GRIP.h / 2} r={2.2} />}
                side={Array.from({ length: 4 }, (_, k) => <path key={k} className="ik-detail" d={`M${2.5 + k * 2.4} 2.2v4.6`} />)}
              />
              <g className="ev-catch">
                <Box {...CATCH} r={1.2} top={<path className="ik-detail" d={`M${CATCH.w / 2} 1.6v${CATCH.d - 5}`} />} />
              </g>
            </g>
          </Press>
          {phase === "idle" && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...PLUG} z={HEAD.z + HEAD.h} r={3} /> : null}
          <path className="ik-line" d={TAIL} />
        </g>
        {charging ? <Signal key={step} points={SIGNAL_PATH} delay={SIGNAL_AT} duration={SIGNAL_MS} /> : null}
        <Callout at={INLET_POINT} dx={16} dy={26} label={charging ? "inlet · locked" : "inlet · open"} />
        <Cursor at={[GRIP.x + GRIP.w / 2, GRIP.y + GRIP.d / 2, GRIP.z + GRIP.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
