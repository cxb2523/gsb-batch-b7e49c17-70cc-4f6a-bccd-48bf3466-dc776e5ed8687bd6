import { type CSSProperties, useEffect, useId, useReducer, useRef } from "react"
import { Box, Cursor, Flight, Glow, Plate, Press, path, playSound, project, Ripple, type SoundName, type SoundOptions, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./container-crane.css"

export const meta = {
  slug: "container-crane",
  title: "Container crane",
  industry: "logistics",
  level: 4,
  blurb: "Press hoist, then trolley: the hoist motor lowers the spreader, its twistlocks latch onto the next box, and the trolley motor carries it along the boom onto the truck, six boxes to a cycle.",
  uses: ["Plate", "Box", "Press", "Glow", "Flight", "Ripple", "Cursor", "useDemoTap", "path", "project", "Callout"],
  sounds: ["press", "release", "motor", "latch", "done", "complete", "whoosh"],
} satisfies FigureMeta

type Stage = "ready" | "hoisting" | "hoisted" | "moving" | "landed"
type State = { stage: Stage; moved: number; trip: number; swaps: number; reset: boolean }
type Action = { type: "hoist" } | { type: "lifted" } | { type: "trolley" } | { type: "land" }
type Spot = { y: number; z: number }
type Lock = "open" | "turn" | "locked" | "release"

const QUAY = { x: 0, y: 0, z: 0, w: 196, d: 70, h: 10 }
const WATER = { x: 0, y: QUAY.d, z: 0, w: 196, d: 66, h: 3 }
const GROUND = QUAY.z + QUAY.h
const HULL = { x: 14, y: 76, z: 1, w: 176, d: 48, h: 19 }
const DECK = HULL.z + HULL.h
const HOUSE = { x: 22, y: 80, z: DECK, w: 24, d: 16, h: 22 }
const FUNNEL = { x: 30, y: 82, z: HOUSE.z + HOUSE.h, w: 8, d: 8, h: 8 }
const LANE_X = 96
const CONT = { x: LANE_X - 14, w: 28, d: 12, h: 12 }
const ROW_YS = [80, 93, 106] as const
const TIERS = [DECK, DECK + CONT.h] as const
const LEG_XS = [60, 126] as const
const LAND_Y = 6
const SEA_Y = 60
const LEG = { w: 6, d: 6, z: GROUND + 5, h: 69 }
const SILLS = [
  { x: 54, y: LAND_Y - 2, z: GROUND, w: 84, d: 10, h: 5 },
  { x: 54, y: SEA_Y - 2, z: GROUND, w: 84, d: 10, h: 5 },
] as const
const PORTAL = { y: LAND_Y, z: LEG.z + LEG.h, w: 6, d: SEA_Y + LEG.d - LAND_Y, h: 8 }
const BOOM = { x: LANE_X - 6, y: 0, z: PORTAL.z + PORTAL.h, w: 12, d: 134, h: 7 }
const BOOM_TOP = BOOM.z + BOOM.h
const MACHINERY = { x: LANE_X - 10, y: 2, z: BOOM_TOP, w: 20, d: 20, h: 13 }
const APEX = { x: LANE_X - 6, y: SEA_Y - 1, z: 130, w: 12, d: 8, h: 4 }
const APEX_TIP: Vec3 = [LANE_X, SEA_Y + 3, APEX.z + 2]
const TRUCK_Y = 34
const TRUCK = {
  chassis: { x: 79, y: TRUCK_Y - 6, z: GROUND, w: 35, d: 12, h: 6 },
  cab: { x: 114, y: TRUCK_Y - 7, z: GROUND, w: 11, d: 14, h: 17 },
}
const BED_Z = GROUND + TRUCK.chassis.h
const SPREAD_Z = 60
const HELD_Z = SPREAD_Z - CONT.h
const CONSOLE = { x: 142, y: 44, z: GROUND, w: 50, d: 20, h: 20 }
const HOIST_KEY = { x: 144, y: 48, z: CONSOLE.z + CONSOLE.h, w: 22, d: 12, h: 3 }
const TROLLEY_KEY = { x: 168, y: 48, z: CONSOLE.z + CONSOLE.h, w: 22, d: 12, h: 3 }
const SCREEN = { x: 4, y: 3, w: 42, h: 14 }
const TOTAL = 6
const CYCLE = 12
const SWAP_SHIFT = 30
const RETURN_MS = 760
const LOWER_MS = 560
const GRAB_MS = 200
const LIFT_MS = 620
const FLY_MS = 1000
const RISE_DELAY_MS = 160
const RISE_MS = 560
const TIMING = {
  "--return-ms": `${RETURN_MS}ms`,
  "--lower-ms": `${LOWER_MS}ms`,
  "--lift-ms": `${LIFT_MS}ms`,
  "--fly-ms": `${FLY_MS}ms`,
  "--rise-ms": `${RISE_MS}ms`,
} as CSSProperties
const RETURN_MOTOR = { duration: RETURN_MS / 1000 }
const LOWER_MOTOR = { duration: LOWER_MS / 1000 }
const LIFT_MOTOR = { duration: LIFT_MS / 1000 }
const FLY_MOTOR = { duration: FLY_MS / 1000 }
const RISE_MOTOR = { duration: RISE_MS / 1000 }
const CASTINGS = [1.6, CONT.w - 1.6].flatMap((cx) => [1.6, CONT.d - 1.6].map((cy) => [cx, cy] as const))
const TWIST = { x: CONT.x - 1, y: -7, w: CONT.w + 2, d: 14, h: 3 }
const TROLLEY_WHEELS = [3.5, 12.5] as const
const PIPS = Array.from({ length: TOTAL }, (_, k) => ({ x: SCREEN.x + SCREEN.w - 8.6 + (k % 2) * 2.6, y: SCREEN.y + 1.6 + Math.floor(k / 2) * 2.6 }))

const SPOTS: readonly Spot[] = Array.from({ length: TOTAL }, (_, k) => ({ y: (ROW_YS[k % 3] ?? 0) + CONT.d / 2, z: TIERS[k < 3 ? 1 : 0] ?? DECK }))
const PAINTED_SPOTS = SPOTS.map((spot, k) => ({ spot, k })).sort((a, b) => a.spot.z - b.spot.z || a.spot.y - b.spot.y)
const RESET_ORDER: ReadonlyMap<number, number> = new Map(PAINTED_SPOTS.map(({ k }, order) => [k, order]))
const START: State = { stage: "ready", moved: 0, trip: 0, swaps: 0, reset: false }
const cycle = (count: number) => (count % CYCLE) + 1

function advance(state: State, action: Action): State {
  switch (action.type) {
    case "hoist":
      if (state.stage === "ready") return { ...state, stage: "hoisting", trip: cycle(state.trip), reset: false }
      if (state.stage !== "landed") return state
      if (state.moved === TOTAL) return { ...state, stage: "ready", moved: 0, trip: cycle(state.trip), swaps: cycle(state.swaps), reset: true }
      return { ...state, stage: "hoisting", trip: cycle(state.trip), swaps: cycle(state.swaps) }
    case "lifted":
      return state.stage === "hoisting" ? { ...state, stage: "hoisted" } : state
    case "trolley":
      return state.stage === "hoisted" ? { ...state, stage: "moving", trip: cycle(state.trip) } : state
    case "land":
      return state.stage === "moving" ? { ...state, stage: "landed", moved: state.moved + 1 } : state
  }
}

const BIG: Readonly<Record<Stage, string>> = { ready: "ready", hoisting: "hoist", hoisted: "lifted", moving: "trolley", landed: "on truck" }

function readoutOf(state: State, box: number): string {
  switch (state.stage) {
    case "ready":
      return state.reset ? "reset · 6 boxes on ship" : "ready · 6 boxes on ship"
    case "hoisting":
      return `box ${box} of 6 · hoisting`
    case "hoisted":
      return `box ${box} of 6 · hoisted`
    case "moving":
      return `box ${box} of 6 · trolley out`
    case "landed":
      return `box ${box} of 6 · on truck`
  }
}

const px = (value: number) => `${Math.round(value * 1000) / 1000}px`
const ms = (value: number) => `${Math.round(value)}ms`
const spotOf = (box: number) => SPOTS[box - 1] ?? SPOTS[0] ?? { y: TRUCK_Y, z: DECK }
const shift = (y: number) => project(0, y - TRUCK_Y, 0)
const travelVars = (from: number, to: number) => {
  const [x0, y0] = shift(from)
  const [x1, y1] = shift(to)
  return { "--x0": px(x0), "--y0": px(y0), "--x1": px(x1), "--y1": px(y1) }
}
const ROPES = [
  [-2, -2],
  [2, -2],
  [-2, 2],
  [2, 2],
] as const
const ropeLine = (y: number, dx: number, dy: number) =>
  path([
    [LANE_X + dx, y + dy, SPREAD_Z + 6],
    [LANE_X + dx, y + dy, 150],
  ])
const [CLIP_A_X, CLIP_A_Y] = project(BOOM.x + BOOM.w, -120, BOOM.z)
const [CLIP_B_X, CLIP_B_Y] = project(BOOM.x + BOOM.w, 320, BOOM.z)
const BELOW_BOOM = `M${CLIP_A_X} ${CLIP_A_Y}L${CLIP_B_X} ${CLIP_B_Y}L${CLIP_B_X} ${CLIP_B_Y + 600}L${CLIP_A_X} ${CLIP_A_Y + 600}Z`
const FORESTAY = path([APEX_TIP, [LANE_X, BOOM.y + BOOM.d - 1, BOOM_TOP]])
const BACKSTAY = path([APEX_TIP, [LANE_X, MACHINERY.y + 10, MACHINERY.z + MACHINERY.h]])
const frameLeg = (x: number, toward: number) =>
  path([
    [x + LEG.w / 2, SEA_Y + 3, BOOM_TOP],
    [toward, SEA_Y + 3, APEX.z],
  ])
const LEFT_FRAME = frameLeg(LEG_XS[0], LANE_X - 3)
const RIGHT_FRAME = frameLeg(LEG_XS[1], LANE_X + 3)

function Crate({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <Box
      x={x}
      y={y}
      z={z}
      w={CONT.w}
      d={CONT.d}
      h={CONT.h}
      r={0.8}
      top={CASTINGS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={0.7} />
      ))}
      front={<path className="ik-detail" d={Array.from({ length: 10 }, (_, k) => `M${2.6 + k * 2.5} 1.4v9.2`).join("")} />}
      side={<path className="ik-detail" d="M6 1.2v9.6M2.6 1.6v8.8M4.4 1.6v8.8M7.6 1.6v8.8M9.4 1.6v8.8" />}
    />
  )
}

function Spreader({ y, carrying, lock }: { y: number; carrying: "always" | "grab" | "never"; lock: Lock }) {
  return (
    <>
      {ROPES.map(([dx, dy]) => (
        <path key={`${dx}-${dy}`} className="ik-line" d={ropeLine(y, dx, dy)} />
      ))}
      {carrying === "never" ? null : (
        <g className={carrying === "grab" ? "cc-held" : undefined}>
          <Crate x={CONT.x} y={y - CONT.d / 2} z={HELD_Z} />
        </g>
      )}
      <g className="cc-spreader-frame">
        <Box
          x={TWIST.x}
          y={y + TWIST.y}
          z={SPREAD_Z}
          w={TWIST.w}
          d={TWIST.d}
          h={TWIST.h}
          r={1}
          top={
            <>
              <path className="ik-detail" d={`M8 2v${TWIST.d - 4}M${TWIST.w - 8} 2v${TWIST.d - 4}`} />
              {CASTINGS.map(([cx, cy]) => (
                <g key={`${cx}-${cy}`} transform={`translate(${cx + 1} ${cy + 1})`}>
                  <g className="cc-twist" data-lock={lock}>
                    <path className="ik-line" d="M-2.2 0h4.4" />
                  </g>
                </g>
              ))}
            </>
          }
          front={<path className="ik-detail" d="M3 1.5h24" />}
        />
      </g>
      <Box x={LANE_X - 4} y={y - 4} z={SPREAD_Z + 3} w={8} d={8} h={3} r={1.5} />
    </>
  )
}

function Truck({ loaded, delay }: { loaded: boolean; delay: number }) {
  const { chassis, cab } = TRUCK
  return (
    <>
      <Box
        {...chassis}
        r={1}
        front={[5, 12, 29].map((cx) => (
          <circle key={cx} className="ik-face cc-wheel" cx={cx} cy={5} r={2.6} />
        ))}
      />
      <g className="cc-delivered" data-on={loaded} style={{ "--t": ms(delay) } as CSSProperties}>
        <Crate x={CONT.x} y={TRUCK_Y - CONT.d / 2} z={BED_Z} />
      </g>
      <Box
        {...cab}
        r={2}
        top={<path className="ik-detail" d="M3 3v8" />}
        side={
          <>
            <rect className="ik-well" x={2} y={2} width={cab.d - 4} height={6} rx={1} />
            <path className="ik-detail" d={`M3 11.5h${cab.d - 6}M3 13.5h${cab.d - 6}`} />
          </>
        }
        front={
          <>
            <rect className="ik-well" x={2} y={2.5} width={5} height={5} rx={0.8} />
            <circle className="ik-face cc-wheel" cx={6} cy={16} r={2.6} />
          </>
        }
      />
    </>
  )
}

function Leg({ x, y }: { x: number; y: number }) {
  return <Box x={x} y={y} z={LEG.z} w={LEG.w} d={LEG.d} h={LEG.h} r={1} front={<path className="ik-detail" d={`M3 4v${LEG.h - 8}`} />} />
}

function Portal({ x }: { x: number }) {
  return (
    <Box
      x={x}
      y={PORTAL.y}
      z={PORTAL.z}
      w={PORTAL.w}
      d={PORTAL.d}
      h={PORTAL.h}
      r={1}
      side={<path className="ik-detail" d={Array.from({ length: 7 }, (_, k) => `M${5 + k * 8} 7L${9 + k * 8} 1L${13 + k * 8} 7`).join("")} />}
    />
  )
}

function Tie({ x, w, y }: { x: number; w: number; y: number }) {
  return <Box x={x} y={y} z={BOOM.z} w={w} d={LEG.d} h={BOOM.h} r={1} front={<path className="ik-detail" d={`M3 3.5h${w - 6}`} />} />
}

type Pending = { timers: { current: number[] }; stops: { current: Array<() => void> } }

function release(timers: Pending["timers"], stops: Pending["stops"]) {
  for (const timer of timers.current) window.clearTimeout(timer)
  for (const stop of stops.current) stop()
  timers.current = []
  stops.current = []
}

export default function ContainerCrane() {
  const [state, dispatch] = useReducer(advance, START)
  const timers = useRef<number[]>([])
  const stops = useRef<Array<() => void>>([])
  const clip = useId().replace(/:/g, "")
  useEffect(() => () => release(timers, stops), [])

  const { stage, moved, trip, swaps } = state
  const holding = stage === "hoisting" || stage === "hoisted" || stage === "moving"
  const box = holding ? moved + 1 : Math.max(moved, 1)
  const full = stage === "landed" && moved === TOTAL
  const hoistHot = stage === "ready" || stage === "landed"
  const trolleyHot = stage === "hoisted"
  const later = (wait: number, step: () => void) => timers.current.push(window.setTimeout(step, wait))
  const sound = (name: SoundName, options?: SoundOptions) => stops.current.push(playSound(name, options))
  const cue = (wait: number, name: SoundName, options?: SoundOptions) => (wait > 0 ? later(wait, () => sound(name, options)) : sound(name, options))

  const hoist = (audible: boolean) => {
    if (!hoistHot) return
    release(timers, stops)
    if (full) {
      if (audible) {
        sound("whoosh")
        sound("motor", RETURN_MOTOR)
      }
      dispatch({ type: "hoist" })
      return
    }
    const lead = stage === "ready" ? 0 : RETURN_MS
    if (audible) {
      if (lead > 0) sound("motor", RETURN_MOTOR)
      cue(lead, "motor", LOWER_MOTOR)
      cue(lead + LOWER_MS, "latch")
      cue(lead + LOWER_MS + GRAB_MS, "motor", LIFT_MOTOR)
    }
    later(lead + LOWER_MS + GRAB_MS + LIFT_MS, () => dispatch({ type: "lifted" }))
    dispatch({ type: "hoist" })
  }
  const trolley = () => {
    if (!trolleyHot) return
    release(timers, stops)
    sound("motor", FLY_MOTOR)
    cue(FLY_MS, moved + 1 === TOTAL ? "complete" : "done")
    cue(FLY_MS + RISE_DELAY_MS, "motor", RISE_MOTOR)
    later(FLY_MS, () => dispatch({ type: "land" }))
    dispatch({ type: "trolley" })
  }
  const demo = useDemoTap(() => {
    if (trip === 0) hoist(false)
  }, { delay: 1700 })
  const pressHoist = () => {
    demo.dismiss()
    hoist(true)
  }
  const pressTrolley = () => {
    demo.dismiss()
    trolley()
  }

  const phase = stage === "hoisting" || stage === "hoisted" ? "hoist" : stage === "moving" || stage === "landed" ? "carry" : state.reset ? "reset" : "park"
  const spot = spotOf(box)
  const lead = box === 1 ? 0 : RETURN_MS
  const grabAt = lead + LOWER_MS
  const firstSpot = spotOf(1)
  const trolleyFrom = phase === "hoist" ? (box === 1 ? firstSpot.y : TRUCK_Y) : phase === "carry" ? spot.y : TRUCK_Y
  const trolleyTo = phase === "hoist" ? spot.y : phase === "carry" ? TRUCK_Y : firstSpot.y
  const moves = phase === "carry" || phase === "reset" || (phase === "hoist" && box > 1)
  const trolleyClass = !moves ? "cc-trolley" : phase === "carry" ? "cc-trolley cc-carry" : "cc-trolley cc-move"
  const trolleyStyle = travelVars(trolleyFrom, trolleyTo) as CSSProperties
  const spreaderStyle = {
    "--drop": px(phase === "carry" ? SPREAD_Z - BED_Z - CONT.h : SPREAD_Z - spot.z - CONT.h),
    "--lower-at": ms(lead),
    "--grab-at": ms(grabAt),
    "--lift-at": ms(grabAt + GRAB_MS),
    "--land-at": ms(FLY_MS),
    "--rise-at": ms(FLY_MS + RISE_DELAY_MS),
  } as CSSProperties
  const shipVisible = (k: number) => (stage === "ready" ? true : k + 1 > (holding ? moved + 1 : moved))
  const shipDelay = (k: number) =>
    phase === "hoist" && k + 1 === box ? ms(grabAt) : phase === "reset" ? `calc(var(--ik-t-state) + ${RESET_ORDER.get(k) ?? 0} * var(--ik-stagger))` : "0ms"
  const swapped = swaps > 0 && (phase === "hoist" || phase === "reset")
  const [enterX, enterY] = project(-SWAP_SHIFT, 0, 0)
  const [leaveX, leaveY] = project(SWAP_SHIFT, 0, 0)
  const swapStyle = { "--enter-x": px(enterX), "--enter-y": px(enterY), "--leave-x": px(leaveX), "--leave-y": px(leaveY) } as CSSProperties
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const screenSmall = stage === "ready" ? "6 on ship" : `box ${box} of 6`

  return (
    <Plate
      {...demo.plate}
      fig="Logistics"
      name="Container crane"
      hint={full ? "Press to reset" : trolleyHot ? "Press trolley" : stage === "hoisting" ? "Then press trolley" : "Press hoist"}
      readout={readoutOf(state, box)}
      className="fig-container-crane"
      style={TIMING}
      fit={[QUAY, WATER, BOOM, MACHINERY, APEX]}
      aspect={1.25}
      label="A quay crane straddling a truck lane, its boom reaching out over a container ship stacked with six boxes. Press hoist to lower the spreader onto the next box and lift it, then trolley to carry it along the boom onto the truck; after six boxes, hoist resets the ship."
    >
      <g ref={demo.ref}>
        <defs>
          <clipPath id={`${clip}-below-boom`}>
            <path d={BELOW_BOOM} />
          </clipPath>
        </defs>
        <Box
          {...QUAY}
          r={8}
          top={
            <>
              {SILLS.flatMap((sill) => [sill.y + 2, sill.y + 8]).map((y) => (
                <path key={y} className="ik-detail" d={`M4 ${y}H${QUAY.w - 4}`} />
              ))}
              <path className="ik-dash" d={`M4 ${TRUCK_Y - 10}H${QUAY.w - 4}M4 ${TRUCK_Y + 10}H${QUAY.w - 4}`} />
              {[40, 150].map((x) => (
                <circle key={x} className="ik-fill" cx={x} cy={QUAY.d - 3.5} r={1.6} />
              ))}
            </>
          }
          front={[20, 60, 140, 180].map((x) => (
                <rect key={x} className="ik-well" x={x} y={2} width={6} height={6} rx={1.5} />
              ))}
        />
        <Box
          {...WATER}
          r={8}
          top={[0, 1, 2, 3, 4].map((k) => (
            <path key={k} className="ik-dash" d={`M${10 + k * 38} ${WATER.d - 6 - (k % 2) * 4}h20`} />
          ))}
        />
        <Box {...SILLS[0]} r={1.5} front={[9, 75].map((cx) => <circle key={cx} className="ik-face cc-wheel" cx={cx} cy={4.4} r={2.4} />)} />
        {LEG_XS.map((x) => (
          <Leg key={x} x={x} y={LAND_Y} />
        ))}
        <Portal x={LEG_XS[0]} />
        {[LAND_Y, SEA_Y].map((y) => (
          <Tie key={y} x={LEG_XS[0]} w={BOOM.x - LEG_XS[0]} y={y} />
        ))}
        <path className="ik-line ik-thick" d={LEFT_FRAME} />

        {swaps > 0 ? (
          <g key={`gone-${swaps}`} className="cc-truck-leave" style={swapStyle}>
            <Truck loaded delay={0} />
          </g>
        ) : null}
        <g key={`truck-${swaps}`} className={swapped ? "cc-truck-arrive" : undefined} style={swapStyle}>
          <Truck loaded={stage === "moving" || stage === "landed"} delay={stage === "moving" ? FLY_MS : 0} />
        </g>
        <Leg x={LEG_XS[0]} y={SEA_Y} />
        <Box {...SILLS[1]} r={1.5} front={[9, 75].map((cx) => <circle key={cx} className="ik-face cc-wheel" cx={cx} cy={4.4} r={2.4} />)} />

        <Box
          {...HULL}
          r={16}
          top={
            <>
              <rect className="ik-detail" x={5} y={4} width={HULL.w - 10} height={HULL.d - 8} rx={12} />
              {[28, 48, 116, 136].map((x) => (
                <path key={x} className="ik-detail" d={`M${x} 10v${HULL.d - 20}`} />
              ))}
            </>
          }
          front={
            <>
              <path className="ik-detail" d={`M10 12h${HULL.w - 20}`} />
              {[24, 34, 44].map((x) => (
                <path key={x} className="ik-detail" d={`M${x} 13.5v3`} />
              ))}
            </>
          }
        />
        {PAINTED_SPOTS.map(({ spot: at, k }) => (
          <g key={k} className="cc-stowed" data-on={shipVisible(k)} style={{ "--t": shipDelay(k) } as CSSProperties}>
            <Crate x={CONT.x} y={at.y - CONT.d / 2} z={at.z} />
          </g>
        ))}
        <Box
          {...HOUSE}
          r={2}
          front={
            <>
              {[0, 1, 2].map((k) => (
                <rect key={k} className="ik-well" x={3 + k * 6.6} y={3} width={4.6} height={3.4} rx={0.6} />
              ))}
              {[0, 1, 2].map((k) => (
                <rect key={k} className="ik-detail" x={3 + k * 6.6} y={10} width={4.6} height={3} rx={0.6} />
              ))}
            </>
          }
        />
        <Box {...FUNNEL} r={3} top={<path className="ik-detail" d="M2 4h4" />} />

        <g clipPath={`url(#${clip}-below-boom)`}>
          <g key={`rig-${trip}`} className={trolleyClass} style={trolleyStyle}>
            <g className={`cc-spreader cc-${phase}`} style={spreaderStyle}>
              <Spreader y={TRUCK_Y} carrying={phase === "hoist" ? "grab" : "never"} lock={phase === "hoist" ? "turn" : phase === "carry" ? "release" : "open"} />
            </g>
          </g>
          {phase === "carry" ? (
            <Flight key={`fly-${trip}`} from={[CONT.x, spot.y - CONT.d / 2, HELD_Z]} to={[CONT.x, TRUCK_Y - CONT.d / 2, BED_Z]} duration={FLY_MS} lift={8}>
              <Spreader y={spot.y} carrying="always" lock="locked" />
            </Flight>
          ) : null}
        </g>

        <Leg x={LEG_XS[1]} y={SEA_Y} />
        <Portal x={LEG_XS[1]} />
        <Box
          {...BOOM}
          r={1.5}
          side={<path className="ik-detail" d={Array.from({ length: 16 }, (_, k) => `M${4 + k * 8} 6L${8 + k * 8} 1L${12 + k * 8} 6`).join("")} />}
        />
        {[LAND_Y, SEA_Y].map((y) => (
          <Tie key={y} x={BOOM.x + BOOM.w} w={LEG_XS[1] + LEG.w - BOOM.x - BOOM.w} y={y} />
        ))}
        <Box
          {...MACHINERY}
          r={2}
          front={
            <>
              {Array.from({ length: 4 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${4 + k * 2.6} 3v7`} />
              ))}
              <rect className="ik-well" x={13} y={3} width={4.4} height={8} rx={0.8} />
            </>
          }
          side={<path className="ik-detail" d="M4 4h12M4 7h12" />}
        />
        <g key={`body-${trip}`} className={trolleyClass} style={trolleyStyle}>
          <Box
            x={BOOM.x - 2}
            y={TRUCK_Y - 8}
            z={BOOM_TOP}
            w={BOOM.w + 4}
            d={16}
            h={5}
            r={1.5}
            top={<path className="ik-detail" d="M4 3v10M12 3v10" />}
            front={<path className="ik-detail" d="M3 2.5h10" />}
            side={TROLLEY_WHEELS.map((cx) => (
              <circle key={cx} className="ik-face cc-wheel" cx={cx} cy={3.2} r={1.5} />
            ))}
          />
        </g>
        <path className="ik-line ik-thick" d={RIGHT_FRAME} />
        <Box {...APEX} r={1.5} />
        <path className="ik-line" d={FORESTAY} />
        <path className="ik-line" d={BACKSTAY} />
        <Box
          {...CONSOLE}
          r={3}
          front={
            <>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
              <Glow>
                <g key={`screen-${stage}-${box}`} className="ik-enter">
                  <text className="ik-screen-text ik-dim" x={SCREEN.x + 3} y={SCREEN.y + 5.6} fontSize={4.4}>
                    {screenSmall}
                  </text>
                  <text className="ik-screen-text" x={SCREEN.x + 3} y={SCREEN.y + 12} fontSize={6}>
                    {BIG[stage]}
                  </text>
                </g>
              </Glow>
              {PIPS.map((pip, k) => (
                <Glow key={k} on={k < moved}>
                  <rect className="cc-pip" data-on={k < moved} x={pip.x} y={pip.y} width={1.8} height={1.8} rx={0.4} />
                </Glow>
              ))}
            </>
          }
          side={<path className="ik-detail" d="M4 5h12M4 8h12M4 11h12" />}
        />
        {trip || aiming ? null : <Ripple {...HOIST_KEY} r={3} />}
        <Press label={full ? "Reset the ship" : "Hoist the next box"} material="metal" onPress={pressHoist} disabled={!hoistHot} data-hot={hoistHot}>
          <g>
            <Box
              {...HOIST_KEY}
              r={3}
              top={
                <>
                  <text className="ik-label cc-key" x={3} y={5.6}>
                    {full ? "RESET" : "HOIST"}
                  </text>
                  <path className="ik-detail cc-icon" d="M16 9.8V6.4M14.4 8l1.6-1.6L17.6 8" />
                </>
              }
            />
          </g>
        </Press>
        <Press label="Trolley the box to the truck" material="metal" onPress={pressTrolley} disabled={!trolleyHot} data-hot={trolleyHot}>
          <g>
            <Box
              {...TROLLEY_KEY}
              r={3}
              top={
                <>
                  <text className="ik-label cc-key" x={1.6} y={5.6}>
                    TROLLEY
                  </text>
                  <path className="ik-detail cc-icon" d="M4 9h14M18 9l-1.8-1.4M18 9l-1.8 1.4" />
                </>
              }
            />
          </g>
        </Press>

        <Callout at={[MACHINERY.x + MACHINERY.w, MACHINERY.y + MACHINERY.d / 2, MACHINERY.z + MACHINERY.h - 3]} dx={16} dy={-10} label="hoist drive" />
        <Cursor at={[HOIST_KEY.x + HOIST_KEY.w / 2, HOIST_KEY.y + HOIST_KEY.d / 2, HOIST_KEY.z + HOIST_KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
