import { type CSSProperties, useEffect, useReducer, useRef } from "react"
import { Box, Cursor, Glow, Plate, Press, playSound, project, Ripple, type SoundName, type SoundOptions, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./signal-box.css"

export const meta = {
  slug: "signal-box",
  title: "Signal box",
  industry: "mobility",
  level: 4,
  blurb: "Pull points, then signal: each lever's catch drops home, the points motor swings the blade to platform 3, train 2 runs over the points on the diagram and the block instrument's needle settles back to clear.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "project", "Callout"],
  sounds: ["press", "release", "latch", "motor", "toggle", "tick", "success", "whoosh"],
} satisfies FigureMeta

type Points = "normal" | "reverse"
type Stage = "held" | "setting" | "running" | "arrived"
type Note = "start" | "points" | "reset"
type State = { points: Points; stage: Stage; note: Note }
type Action = { type: "points" } | { type: "detect" } | { type: "signal" } | { type: "arrive" }
type Lever = { id: "points" | "signal"; x: number; badge: string; label: string }

const BASE = { x: 0, y: 0, z: 0, w: 190, d: 132, h: 8 }
const BOARD = { x: 10, y: 12, z: BASE.h, w: 170, d: 12, h: 82 }
const FRAME = { x: 46, y: 84, z: BASE.h, w: 96, d: 34, h: 10 }
const FRAME_TOP = FRAME.z + FRAME.h
const BAR = { y: 89, w: 4.5, d: 4.5, h: 42 }
const GRIP = { w: 5.5, d: 5.5, h: 9 }
const TRAVEL = 14
const PULL = project(0, TRAVEL, 0)
const LEVERS: readonly Lever[] = [
  { id: "points", x: 70, badge: "1", label: "POINTS" },
  { id: "signal", x: 112, badge: "2", label: "SIGNAL" },
]
const FIRST = LEVERS[0] ?? { id: "points", x: 70, badge: "1", label: "POINTS" }
const BLOCK = { x: 150, y: 86, z: BASE.h, w: 32, d: 22, h: 38 }
const BELL = { x: 160, y: 92, z: BLOCK.z + BLOCK.h, w: 12, d: 10, h: 4 }
const DIAL = { cx: 16, cy: 21, r: 9.5 }
const MAIN_Y = 37
const LOOP_Y = 55
const SIGNAL_U = 50
const POINTS_U = 72
const MERGE_U = POINTS_U + LOOP_Y - MAIN_Y
const START_U = 28
const PLATFORM_U = 126
const BLADE = 8
const BLADE_TIP = BLADE * Math.SQRT1_2
const PULL_MS = 420
const POINTS_MS = 640
const DETECT_MS = PULL_MS + POINTS_MS
const DEPART_MS = PULL_MS + 160
const RUN_MS = 1800
const ARRIVE_MS = DEPART_MS + RUN_MS
const POINTS_MOTOR = { duration: POINTS_MS / 1000 }
const TIMING = { "--pull": `${PULL_MS}ms`, "--points": `${POINTS_MS}ms`, "--depart": `${DEPART_MS}ms` } as CSSProperties
const LEGS = [
  { dx: POINTS_U - START_U, dy: 0, pace: 2, ease: "cubic-bezier(.5, 0, 1, 1)" },
  { dx: MERGE_U - POINTS_U, dy: LOOP_Y - MAIN_Y, pace: 1, ease: "linear" },
  { dx: PLATFORM_U - MERGE_U, dy: 0, pace: 2, ease: "cubic-bezier(0, 0, .5, 1)" },
] as const
const WEIGHTS = LEGS.map((leg) => Math.hypot(leg.dx, leg.dy) * leg.pace)
const TOTAL_WEIGHT = WEIGHTS.reduce((sum, weight) => sum + weight, 0)
const LEG_STYLES = LEGS.map((leg, i) => {
  const before = WEIGHTS.slice(0, i).reduce((sum, weight) => sum + weight, 0)
  return {
    "--dx": `${leg.dx}px`,
    "--dy": `${leg.dy}px`,
    animationDelay: `${Math.round(DEPART_MS + (RUN_MS * before) / TOTAL_WEIGHT)}ms`,
    animationDuration: `${Math.round((RUN_MS * (WEIGHTS[i] ?? 0)) / TOTAL_WEIGHT)}ms`,
    animationTimingFunction: leg.ease,
  } as CSSProperties
})
const NEEDLE_PIVOT = { x: DIAL.cx, y: DIAL.cy + 3 }
const DIAL_TICKS = [-42, 0, 42]
  .map((deg) => {
    const [sin, cos] = [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)]
    return `M${(NEEDLE_PIVOT.x + sin * 9.6).toFixed(3)} ${(NEEDLE_PIVOT.y - cos * 9.6).toFixed(3)}L${(NEEDLE_PIVOT.x + sin * 10.8).toFixed(3)} ${(NEEDLE_PIVOT.y - cos * 10.8).toFixed(3)}`
  })
  .join("")
const BLOCK_AT = [BLOCK.x + NEEDLE_PIVOT.x, BLOCK.y + BLOCK.d, BLOCK.z + BLOCK.h - NEEDLE_PIVOT.y] as const
const START: State = { points: "normal", stage: "held", note: "start" }

function signalBox(state: State, action: Action): State {
  switch (action.type) {
    case "points":
      if (state.stage === "held") return { ...state, points: state.points === "normal" ? "reverse" : "normal", stage: "setting", note: "points" }
      return state.stage === "arrived" ? { points: "normal", stage: "setting", note: "reset" } : state
    case "detect":
      return state.stage === "setting" ? { ...state, stage: "held" } : state
    case "signal":
      return state.stage === "held" && state.points === "reverse" ? { ...state, stage: "running" } : state
    case "arrive":
      return state.stage === "running" ? { ...state, stage: "arrived" } : state
  }
}

function readoutOf(state: State): string {
  if (state.stage === "running") return "signal off · train 2 running"
  if (state.stage === "arrived") return "train 2 · platform 3"
  if (state.stage === "setting") return state.note === "reset" ? "reset · points to normal" : `points moving · to platform ${state.points === "reverse" ? 3 : 2}`
  if (state.note === "reset") return "reset · train 2 held"
  if (state.note === "points") return state.points === "reverse" ? "points reversed · platform 3" : "points normal · platform 2 full"
  return "train 2 held · platform 2 full"
}

function hintOf(state: State): string {
  if (state.stage === "running") return "Train 2 on the move"
  if (state.stage === "arrived") return "Press points to reset"
  if (state.stage === "setting") return "Points moving"
  return state.points === "reverse" ? "Now press signal" : "Press points"
}

const routeOf = (state: State): Points | "none" => (state.stage === "setting" ? "none" : state.points)

function TrainTag({ n, u, v, className }: { n: string; u: number; v: number; className: string }) {
  return (
    <g className={className}>
      <rect className="sb-tag" x={u - 7.5} y={v - 4.5} width={15} height={9} rx={2} />
      <text className="ik-screen-text sb-tag-text" x={u} y={v + 2.1} fontSize={6} textAnchor="middle">
        {n}
      </text>
    </g>
  )
}

function Diagram({ state }: { state: State }) {
  const route = routeOf(state)
  const signalOff = state.stage === "running" || state.stage === "arrived"
  return (
    <>
      <rect className="ik-screen" x={6} y={6} width={BOARD.w - 12} height={BOARD.h - 12} rx={4} />
      <text className="ik-screen-text ik-dim" x={12} y={15} fontSize={5.6}>
        down main
      </text>
      <g key={route} className="ik-enter">
        <text className="ik-screen-text ik-dim" x={12} y={BOARD.h - 11} fontSize={5.6}>
          {route === "none" ? "points moving" : `route · platform ${route === "reverse" ? 3 : 2}`}
        </text>
      </g>
      <rect className="sb-platform" x={98} y={MAIN_Y - 18} width={54} height={8.5} rx={1.5} />
      <text className="ik-screen-text ik-dim" x={102} y={MAIN_Y - 11.8} fontSize={5.6}>
        platform 2
      </text>
      <rect className="sb-platform" x={98} y={LOOP_Y + 9.5} width={54} height={8.5} rx={1.5} />
      <text className="ik-screen-text ik-dim" x={102} y={LOOP_Y + 15.7} fontSize={5.6}>
        platform 3
      </text>
      <Glow on={route !== "none"}>
        <path className="ik-screen-line" d={`M12 ${MAIN_Y}H${POINTS_U}`} />
      </Glow>
      <Glow on={route === "normal"}>
        <path className="ik-screen-line sb-leg-normal" d={`M${POINTS_U + BLADE} ${MAIN_Y}H${BOARD.w - 12}`} />
      </Glow>
      <Glow on={route === "reverse"}>
        <path className="ik-screen-line sb-leg-reverse" d={`M${POINTS_U + BLADE_TIP} ${MAIN_Y + BLADE_TIP}L${MERGE_U} ${LOOP_Y}H${BOARD.w - 12}`} />
      </Glow>
      <g transform={`translate(${POINTS_U} ${MAIN_Y})`}>
        <g className="sb-blade">
          <path className="ik-screen-line" d={`M0 0H${BLADE}`} />
        </g>
      </g>
      <text className="ik-screen-text ik-dim" x={POINTS_U - 8} y={MAIN_Y + 9} fontSize={5.6}>
        1
      </text>
      <path className="ik-screen-line" d={`M${SIGNAL_U} ${MAIN_Y - 2.5}V${MAIN_Y - 8}`} />
      <text className="ik-screen-text ik-dim" x={SIGNAL_U + 5} y={MAIN_Y - 9} fontSize={5.6}>
        2
      </text>
      <circle className="sb-aspect-off" cx={SIGNAL_U} cy={MAIN_Y - 11} r={2.8} />
      <Glow on={signalOff} className="sb-aspect-glow">
        <circle className="sb-aspect" cx={SIGNAL_U} cy={MAIN_Y - 11} r={2.8} />
      </Glow>
      <TrainTag n="1" u={PLATFORM_U} v={MAIN_Y} className="sb-train-1" />
      <g key={state.stage === "running" || state.stage === "arrived" ? state.stage : "held"} className={state.stage === "running" || state.stage === "arrived" ? undefined : "ik-enter"}>
        {state.stage === "arrived" ? (
          <TrainTag n="2" u={PLATFORM_U} v={LOOP_Y} className="sb-train-2" />
        ) : (
          <g className="sb-leg" style={state.stage === "running" ? LEG_STYLES[0] : undefined}>
            <g className="sb-leg" style={state.stage === "running" ? LEG_STYLES[1] : undefined}>
              <g className="sb-leg" style={state.stage === "running" ? LEG_STYLES[2] : undefined}>
                <TrainTag n="2" u={START_U} v={MAIN_Y} className="sb-train-2" />
              </g>
            </g>
          </g>
        )}
      </g>
    </>
  )
}

function BlockInstrument() {
  return (
    <>
      <Box
        {...BLOCK}
        r={4}
        top={<path className="ik-detail" d={`M5 ${BLOCK.d - 5}H${BLOCK.w - 5}`} />}
        front={
          <>
            <text className="ik-label sb-dial" x={3} y={7}>
              CLEAR
            </text>
            <text className="ik-label sb-dial" x={BLOCK.w - 3} y={7} textAnchor="end">
              TRAIN
            </text>
            <circle className="ik-face ik-top" cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r} />
            <path className="ik-detail" d={`M${DIAL.cx - 6.4} ${DIAL.cy - 1.4}A7 7 0 0 1 ${DIAL.cx + 6.4} ${DIAL.cy - 1.4}`} />
            <path className="ik-detail" d={DIAL_TICKS} />
            <g transform={`translate(${NEEDLE_PIVOT.x} ${NEEDLE_PIVOT.y})`}>
              <g className="sb-needle">
                <path className="sb-hand" d="M0 0V-9" />
              </g>
              <circle className="ik-fill" r={1.4} />
            </g>
            <rect className="ik-well" x={7} y={33} width={18} height={3} rx={1} />
          </>
        }
        side={[0, 1, 2, 3].map((k) => (
          <path key={k} className="ik-detail" d={`M4 ${8 + k * 3.4}H${BLOCK.d - 4}`} />
        ))}
      />
      <Box {...BELL} r={BELL.d / 2} top={<circle className="ik-detail" cx={BELL.w / 2} cy={BELL.d / 2} r={2} />} />
    </>
  )
}

const notchesOf = (lever: Lever) => {
  const left = lever.x - FRAME.x - 3.5
  const right = lever.x - FRAME.x + BAR.w + 1.5
  return [0, TRAVEL]
    .map((at) => {
      const y = BAR.y - FRAME.y + BAR.d / 2 + at
      return `M${left} ${y}h2M${right} ${y}h2`
    })
    .join("")
}

type Timers = { current: number[] }
type Stops = { current: Array<() => void> }

function release(timers: Timers, stops: Stops) {
  for (const timer of timers.current) window.clearTimeout(timer)
  for (const stop of stops.current) stop()
  timers.current = []
  stops.current = []
}

export default function SignalBox() {
  const [state, dispatch] = useReducer(signalBox, START)
  const timers = useRef<number[]>([])
  const stops = useRef<Array<() => void>>([])
  useEffect(() => () => release(timers, stops), [])

  const held = state.stage === "held"
  const reverse = state.points === "reverse"
  const later = (wait: number, step: () => void) => timers.current.push(window.setTimeout(step, wait))
  const sound = (name: SoundName, options?: SoundOptions) => stops.current.push(playSound(name, options))

  const throwPoints = (audible: boolean) => {
    if (!held && state.stage !== "arrived") return
    release(timers, stops)
    if (audible) {
      if (state.stage === "arrived") sound("whoosh")
      later(PULL_MS, () => {
        sound("latch")
        sound("motor", POINTS_MOTOR)
      })
    }
    later(DETECT_MS, () => {
      if (audible) sound("toggle")
      dispatch({ type: "detect" })
    })
    dispatch({ type: "points" })
  }
  const clearSignal = () => {
    if (!(held && reverse)) return
    release(timers, stops)
    later(PULL_MS, () => sound("latch"))
    later(DEPART_MS, () => sound("tick"))
    later(ARRIVE_MS, () => {
      sound("tick")
      sound("success")
      dispatch({ type: "arrive" })
    })
    dispatch({ type: "signal" })
  }
  const demo = useDemoTap(
    () => {
      if (state.note === "start") throwPoints(false)
    },
    { delay: 1700 },
  )
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const signalOff = state.stage === "running" || state.stage === "arrived"
  const pulled = (lever: Lever) => (lever.id === "points" ? reverse : signalOff)
  const actOn = (lever: Lever) => {
    demo.dismiss()
    if (lever.id === "points") throwPoints(true)
    else clearSignal()
  }
  const labelOf = (lever: Lever) => {
    if (lever.id === "signal") return "Clear the signal"
    if (state.stage === "arrived") return "Reset for the next train"
    return reverse ? "Set the points normal" : "Reverse the points"
  }
  const disabledOf = (lever: Lever) => (lever.id === "points" ? state.stage === "running" || state.stage === "setting" : !(held && reverse))
  const hotOf = (lever: Lever) => held && (lever.id === "points" ? !reverse : reverse)

  return (
    <Plate
      {...demo.plate}
      fig="Mobility"
      name="Signal box"
      hint={hintOf(state)}
      readout={readoutOf(state)}
      className="fig-signal-box"
      style={TIMING}
      data-points={state.points}
      data-stage={state.stage}
      data-route={routeOf(state)}
      data-signal={signalOff ? "off" : "on"}
      fit={[BASE, BOARD, BLOCK, BELL, ...LEVERS.map((lever) => ({ x: lever.x - 0.5, y: BAR.y + TRAVEL, z: FRAME_TOP, w: GRIP.w, d: GRIP.d, h: BAR.h + GRIP.h }))]}
      aspect={1.25}
      label="A railway signal box: a track diagram board, a lever frame with a points lever and a signal lever held by an interlocking tappet, and a block instrument. Press points: the lever's catch drops home and the points motor swings the route to platform 3. Then press signal: train 2 runs over the points into platform 3 and the block needle settles back to clear."
    >
      <g ref={demo.ref}>
        <Box {...BASE} r={12} top={<path className="ik-detail" d={`M10 ${BASE.d - 8}H${BASE.w - 10}`} />} />
        <Box
          {...BOARD}
          r={3}
          top={<path className="ik-detail" d={`M6 ${BOARD.d / 2}H${BOARD.w - 6}`} />}
          front={<Diagram state={state} />}
          side={<path className="ik-detail" d={`M3 8V${BOARD.h - 8}`} />}
        />
        <Box
          {...FRAME}
          r={4}
          top={
            <>
              {LEVERS.map((lever) => (
                <g key={lever.id}>
                  <rect className="ik-well" x={lever.x - FRAME.x - 1} y={BAR.y - FRAME.y - 1.5} width={BAR.w + 2} height={TRAVEL + BAR.d + 3} rx={1.5} />
                  <path className="ik-detail" d={notchesOf(lever)} />
                  <text className="ik-label sb-name" x={lever.x - FRAME.x + BAR.w / 2} y={FRAME.d - 3.5} textAnchor="middle">
                    {lever.label}
                  </text>
                </g>
              ))}
              <g className="sb-tappet">
                <rect className="ik-face" x={(LEVERS[1]?.x ?? 0) - FRAME.x - 3} y={BAR.y - FRAME.y + BAR.d + 2.5} width={BAR.w + 6} height={2.4} rx={1} />
              </g>
            </>
          }
          front={<path className="ik-detail" d={`M6 3H${FRAME.w - 6}`} />}
        />

        {LEVERS.map((lever) => {
          const bar = { x: lever.x, y: BAR.y, z: FRAME_TOP, w: BAR.w, d: BAR.d, h: BAR.h }
          return (
            <g key={lever.id}>
              {lever.id === "points" && state.note === "start" && !aiming ? <Ripple x={lever.x - 4} y={BAR.y - 4} z={FRAME_TOP} w={BAR.w + 8} d={BAR.d + 8} r={4} /> : null}
              <g className="sb-slide" style={pulled(lever) ? { transform: `translate(${PULL[0].toFixed(3)}px, ${PULL[1].toFixed(3)}px)` } : undefined}>
                <Press label={labelOf(lever)} material="metal" onPress={() => actOn(lever)} disabled={disabledOf(lever)} data-hot={hotOf(lever)}>
                  <g>
                    <Box {...bar} r={1.5} />
                    <Box
                      x={lever.x - 1.5}
                      y={BAR.y + BAR.d}
                      z={FRAME_TOP + BAR.h - 14}
                      w={BAR.w + 3}
                      d={1}
                      h={8}
                      r={0.4}
                      front={
                        <text className="ik-label sb-plate" x={(BAR.w + 3) / 2} y={6} textAnchor="middle">
                          {lever.badge}
                        </text>
                      }
                    />
                    <Box x={lever.x - 0.5} y={BAR.y - 0.5} z={FRAME_TOP + BAR.h} w={GRIP.w} d={GRIP.d} h={GRIP.h} r={GRIP.w / 2} />
                  </g>
                </Press>
              </g>
            </g>
          )
        })}

        <BlockInstrument />

        <Callout at={BLOCK_AT} dx={30} dy={-16} label={`block · ${state.stage === "running" ? "train" : "clear"}`} />
        <Cursor at={[FIRST.x + GRIP.w / 2 - 0.5, BAR.y + GRIP.d / 2 - 0.5, FRAME_TOP + BAR.h + GRIP.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
