import { type CSSProperties, type ReactNode, useEffect, useId, useReducer, useRef } from "react"
import { Box, Cursor, Flight, front, Glow, Plate, Press, playSound, Ripple, type SoundName, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./vision-mixer.css"

export const meta = {
  slug: "vision-mixer",
  title: "Vision mixer",
  industry: "media",
  level: 4,
  blurb: "Press a camera, then cut: its picture flies from the preview monitor to program, the tally relay clicks over, the camera's tally lamp lights on air and the audio meter swings to its level.",
  uses: ["Plate", "Box", "Press", "Glow", "Flight", "Ripple", "Cursor", "useDemoTap", "front", "Callout"],
  sounds: ["press", "release", "process", "relay", "success", "whoosh"],
} satisfies FigureMeta

type Cam = 1 | 2 | 3 | 4
type Last = "start" | "select" | "clear" | "cut" | "black"
type State = { pgm: Cam | null; pvw: Cam | null; was: Cam | null; take: number; last: Last }
type Action = { type: "select"; cam: Cam } | { type: "cut" } | { type: "black" }

const DESK = { x: 0, y: 0, z: 0, w: 188, d: 122, h: 8 }
const BRIDGE = { x: 8, y: 6, z: DESK.h, w: 172, d: 28, h: 8 }
const MONITOR = { y: 11, z: BRIDGE.z + BRIDGE.h, w: 76, d: 14, h: 50 }
const PVW = { ...MONITOR, x: 14 }
const PGM = { ...MONITOR, x: 98 }
const SCREEN = { x: 5, y: 5, w: 66, h: 37 }
const PANEL = { x: 8, y: 44, z: DESK.h, w: 172, d: 70, h: 6 }
const DECK_Z = PANEL.z + PANEL.h
const CAMS: readonly Cam[] = [1, 2, 3, 4]
const KEY = { y: 56, z: DECK_Z, w: 22, d: 20, h: 5 }
const keyOf = (cam: Cam) => ({ ...KEY, x: 18 + (cam - 1) * 28 })
const FIRST_KEY = keyOf(2)
const CUT = { x: 138, y: 54, z: DECK_Z, w: 32, d: 24, h: 6 }
const FTB = { x: 138, y: 88, z: DECK_Z, w: 32, d: 16, h: 5 }
const METER = { x: 76, y: 100, z: DECK_Z, w: 42, d: 8, h: 14 }
const DIAL = { x: 21, y: 12.5, r: 8, needle: 9 }
const RELAY = { x: 10, y: 47, w: 16, d: 11 }
const ARM = { x: RELAY.x + 11, y: RELAY.y + RELAY.d / 2, length: 6, throw: 14 }
const RELAY_AT = [PANEL.x + RELAY.x + RELAY.w / 2, PANEL.y + RELAY.y + RELAY.d / 2, DECK_Z] as const
const FLY_MS = 560
const RELAY_MS = 60
const FADE_MS = 600
const NEEDLE_MS = 560
const SETTLE_MS = FLY_MS + Math.round(NEEDLE_MS * 0.375)
const TAKES = 8
const BARS = [0.5, 0.42, 0.34, 0.26, 0.18, 0.12, 0.06]
const STRIP = [0.08, 0.4, 0.16]
const START: State = { pgm: 1, pvw: null, was: null, take: 0, last: "start" }
const LEVEL: ReadonlyMap<Cam | null, number> = new Map<Cam | null, number>([
  [null, -48],
  [1, 22],
  [2, 9],
  [3, -16],
  [4, 0],
])
const SCALE = Array.from({ length: 9 }, (_, k) => {
  const deg = -40 + k * 10
  const a = ((deg - 90) * Math.PI) / 180
  const inner = DIAL.r - (deg >= 20 ? 2.6 : 1.4)
  return `M${(DIAL.x + inner * Math.cos(a)).toFixed(3)} ${(DIAL.y + inner * Math.sin(a)).toFixed(3)}L${(DIAL.x + DIAL.r * Math.cos(a)).toFixed(3)} ${(DIAL.y + DIAL.r * Math.sin(a)).toFixed(3)}`
}).join("")
const WINDINGS = Array.from({ length: 4 }, (_, k) => `M${RELAY.x + 2} ${RELAY.y + 3.4 + k * 1.4}h5`).join("")
const VENTS = Array.from({ length: 12 }, (_, k) => `M${8 + k * 5} 4v6`).join("")
const ms = (value: number) => `${value}ms`
const TIMING = { "--fly": ms(FLY_MS), "--fade": ms(FADE_MS), "--needle": ms(NEEDLE_MS) } as CSSProperties
const BLACK_IN = { "--t": ms(FADE_MS) } as CSSProperties
const screenOf = (monitor: typeof PVW): [number, number, number] => [monitor.x, monitor.y + monitor.d, monitor.z + monitor.h]

function mix(state: State, action: Action): State {
  switch (action.type) {
    case "select":
      if (action.cam === state.pgm) return state
      return action.cam === state.pvw ? { ...state, pvw: null, last: "clear" } : { ...state, pvw: action.cam, last: "select" }
    case "cut":
      return state.pvw === null ? state : { pgm: state.pvw, pvw: state.pgm, was: state.pgm, take: (state.take + 1) % TAKES, last: "cut" }
    case "black":
      return state.pgm === null ? state : { ...state, pgm: null, was: state.pgm, take: (state.take + 1) % TAKES, last: "black" }
  }
}

function readoutOf(state: State): string {
  if (state.last === "select") return `cam ${state.pvw} · preview`
  if (state.last === "clear") return "preview · clear"
  if (state.last === "black" || state.pgm === null) return "black · off air"
  return `cam ${state.pgm} · live`
}

function Person({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <>
      <circle className="vm-ink" cx={x} cy={y} r={r} />
      <path className="vm-ink" d={`M${x - r * 2.3} ${y + r * 4}C${x - r * 2.3} ${y + r * 1.6} ${x + r * 2.3} ${y + r * 1.6} ${x + r * 2.3} ${y + r * 4}Z`} />
    </>
  )
}

function Picture({ cam }: { cam: Cam | null }) {
  if (cam === null)
    return (
      <text className="ik-screen-text ik-dim" x={3.5} y={7.5} fontSize={5.6}>
        BLACK
      </text>
    )
  return (
    <>
      {cam === 1 ? (
        <>
          <Person x={33} y={15} r={5.5} />
          <rect className="vm-soft" x={4} y={27} width={22} height={4.5} rx={0.8} />
        </>
      ) : null}
      {cam === 2 ? (
        <>
          <Person x={21} y={17} r={4} />
          <Person x={45} y={17} r={4} />
          <rect className="vm-soft" x={5} y={28} width={56} height={9} rx={1} />
        </>
      ) : null}
      {cam === 3 ? (
        <>
          <path className="ik-screen-line ik-dim" d="M2 27H64M33 2v3M46 2v3M59 2v3" />
          <Person x={29.5} y={21.5} r={2} />
          <Person x={36.5} y={21.5} r={2} />
          <path className="vm-soft" d="M21 34L24.5 26.5H41.5L45 34Z" />
        </>
      ) : null}
      {cam === 4 ? (
        <>
          <path className="ik-screen-line ik-dim" d="M12 37V21M12 25l-4.5-3.5M12 22l4-4.5M12 29l-5-1.5" />
          <Person x={41} y={15} r={6} />
        </>
      ) : null}
      <Glow>
        <text className="ik-screen-text ik-dim" x={3.5} y={7.5} fontSize={5.6}>
          CAM {cam}
        </text>
      </Glow>
    </>
  )
}

function Bars() {
  return (
    <>
      {BARS.map((opacity, k) => (
        <rect key={opacity} className="vm-bar" x={(k * SCREEN.w) / BARS.length} y={0} width={SCREEN.w / BARS.length} height={27} style={{ opacity }} />
      ))}
      {STRIP.map((opacity, k) => (
        <rect key={opacity} className="vm-bar" x={(k * SCREEN.w) / STRIP.length} y={29} width={SCREEN.w / STRIP.length} height={8} style={{ opacity }} />
      ))}
    </>
  )
}

function Screen({ clip, children }: { clip: string; children: ReactNode }) {
  return (
    <>
      <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2} />
      <g clipPath={`url(#${clip})`}>
        <g transform={`translate(${SCREEN.x} ${SCREEN.y})`}>{children}</g>
      </g>
    </>
  )
}

function Bezel({ tag }: { tag: string }) {
  return (
    <>
      <text className="ik-label vm-tag" x={SCREEN.x} y={47.6}>
        {tag}
      </text>
      <circle className="ik-fill" cx={SCREEN.x + SCREEN.w - 2} cy={46} r={1.1} />
    </>
  )
}

function TallyRelay({ pgm, take }: { pgm: Cam | null; take: number }) {
  const turn = pgm === null ? 0 : take % 2 ? ARM.throw : -ARM.throw
  return (
    <>
      <rect className="ik-well" x={RELAY.x} y={RELAY.y} width={RELAY.w} height={RELAY.d} rx={1.5} />
      <rect className="ik-detail" x={RELAY.x + 2} y={RELAY.y + 2.2} width={5} height={6.6} rx={0.8} />
      <path className="ik-detail" d={WINDINGS} />
      <circle className="ik-fill" cx={ARM.x + ARM.length + 0.6} cy={ARM.y - 2.1} r={0.7} />
      <circle className="ik-fill" cx={ARM.x + ARM.length + 0.6} cy={ARM.y + 2.1} r={0.7} />
      <g transform={`translate(${ARM.x} ${ARM.y})`}>
        <g className="vm-armature" style={{ "--turn": `${turn}deg` } as CSSProperties}>
          <path className="ik-line" d={`M0 0h${ARM.length}`} />
        </g>
        <circle className="ik-fill" r={0.9} />
      </g>
      <text className="ik-label vm-tag" x={RELAY.x + RELAY.w + 3} y={RELAY.y + RELAY.d / 2 + 1.7}>
        TALLY
      </text>
    </>
  )
}

function MeterFace({ pgm }: { pgm: Cam | null }) {
  return (
    <>
      <rect className="ik-screen" x={4} y={2} width={METER.w - 8} height={9} rx={1.5} />
      <path className="vm-scale" d={SCALE} />
      <text className="ik-screen-text ik-dim vm-vu" x={6} y={9.6}>
        VU
      </text>
      <text className="ik-screen-text ik-dim vm-vu" x={METER.w - 6} y={9.6} textAnchor="end">
        PGM
      </text>
      <g transform={`translate(${DIAL.x} ${DIAL.y})`}>
        <g className="vm-needle" style={{ "--turn": `${LEVEL.get(pgm) ?? 0}deg` } as CSSProperties}>
          <path className="vm-needle-line" d={`M0 0V${-DIAL.needle}`} />
        </g>
      </g>
      <path className="ik-face" d={`M${DIAL.x - 3.5} ${DIAL.y}a3.5 3.5 0 0 1 7 0z`} />
    </>
  )
}

export default function VisionMixer() {
  const [state, dispatch] = useReducer(mix, START)
  const clip = useId().replace(/[^\w-]/g, "")
  const stops = useRef<Array<() => void>>([])
  const timers = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      for (const stop of stops.current) stop()
    },
    [],
  )

  const quiet = () => {
    for (const timer of timers.current) window.clearTimeout(timer)
    for (const stop of stops.current) stop()
    timers.current = []
    stops.current = []
  }
  const play = (name: SoundName) => {
    const stop = playSound(name)
    stops.current.push(stop)
    return stop
  }
  const later = (wait: number, then: () => void) => {
    timers.current.push(window.setTimeout(then, wait))
  }
  const select = (cam: Cam) => {
    quiet()
    dispatch({ type: "select", cam })
  }
  const cut = () => {
    quiet()
    const travel = play("process")
    later(FLY_MS, () => {
      travel()
      play("relay")
    })
    later(SETTLE_MS, () => play("success"))
    dispatch({ type: "cut" })
  }
  const black = () => {
    quiet()
    play("whoosh")
    later(FADE_MS, () => play("relay"))
    dispatch({ type: "black" })
  }
  const {
    ref: demoAnchor,
    phase,
    dismiss,
    plate,
  } = useDemoTap(
    () => {
      if (state.last === "start") select(2)
    },
    { delay: 1700 },
  )
  const act = (step: () => void) => () => {
    dismiss()
    step()
  }

  const { pgm, pvw, was, take, last } = state
  const aiming = phase === "aim" || phase === "press"
  const cutting = last === "cut"
  const cutHot = pvw !== null && !cutting
  const hotCam = cutHot || cutting ? null : pgm === 1 ? 2 : 1
  const landing = { "--t": ms(cutting ? FLY_MS : 0) } as CSSProperties
  const relayAt = cutting ? FLY_MS : last === "black" ? FADE_MS : 0
  const timing = { ...TIMING, "--relay-at": ms(relayAt), "--lamp": ms(relayAt === 0 ? 0 : relayAt + RELAY_MS) } as CSSProperties

  return (
    <Plate
      {...plate}
      fig="Media"
      name="Vision mixer"
      hint={cutHot ? "Press cut" : cutting ? "Pick the next camera" : "Press a camera"}
      readout={readoutOf(state)}
      className="fig-vision-mixer"
      style={timing}
      data-last={last}
      fit={[DESK, { x: PVW.x, y: PVW.y, z: 0, w: PGM.x + PGM.w - PVW.x, d: PVW.d, h: PVW.z + PVW.h }, [56, PVW.y + PVW.d, PVW.z + PVW.h + 14]]}
      aspect={1.3}
      label="A vision mixer: preview and program monitors on a bridge, and a panel with four camera keys with tally lamps, a cut key, a fade-to-black key, a tally relay and a program audio meter. Press a camera to put it on preview, then cut to send its picture to program; the relay clicks, the tally lamp follows and the meter swings to the camera's sound."
    >
      <g ref={demoAnchor}>
        <Box {...DESK} r={10} top={[6, DESK.w - 6].map((x) => <circle key={x} className="ik-detail" cx={x} cy={DESK.d - 5} r={1.8} />)} />
        <Box {...BRIDGE} r={4} front={<path className="ik-detail" d={`M8 4h${BRIDGE.w - 16}`} />} />
        <Box
          {...PVW}
          r={3}
          front={
            <>
              <defs>
                <clipPath id={clip}>
                  <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2} />
                </clipPath>
              </defs>
              <Screen clip={clip}>
                {cutting ? (
                  <g key={`pvw-${take}`} className="vm-show" style={landing}>
                    {pvw === null ? <Bars /> : <Picture cam={pvw} />}
                  </g>
                ) : (
                  <g key={`pvw-${pvw}-${take}`} className="ik-enter">
                    {pvw === null ? <Bars /> : <Picture cam={pvw} />}
                  </g>
                )}
              </Screen>
              <Bezel tag="PVW" />
            </>
          }
          top={<path className="ik-detail" d={VENTS} />}
        />
        <Box
          {...PGM}
          r={3}
          front={
            <>
              <Screen clip={clip}>
                {cutting || last === "black" ? (
                  <>
                    <g key={`was-${take}`} className={cutting ? "vm-was" : "vm-fade"} style={landing}>
                      <Picture cam={was} />
                    </g>
                    <g key={`pgm-${take}`} className="vm-show" style={cutting ? landing : BLACK_IN}>
                      <Picture cam={pgm} />
                    </g>
                  </>
                ) : (
                  <Picture cam={pgm} />
                )}
              </Screen>
              <Bezel tag="PGM" />
            </>
          }
          top={<path className="ik-detail" d={VENTS} />}
          side={Array.from({ length: 5 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M3 ${8 + k * 3.4}h${PGM.d - 6}`} />
          ))}
        />
        <Box
          {...PANEL}
          r={6}
          top={
            <>
              <text className="ik-label vm-tag" x={keyOf(1).x - PANEL.x} y={KEY.y + KEY.d - PANEL.y + 9}>
                PREVIEW
              </text>
              <path className="ik-detail" d={`M${CUT.x - PANEL.x - 7} 10v${PANEL.d - 20}`} />
              {[
                [5, 5],
                [PANEL.w - 5, 5],
                [5, PANEL.d - 5],
                [PANEL.w - 5, PANEL.d - 5],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.2} />
              ))}
              <TallyRelay pgm={pgm} take={take} />
            </>
          }
          front={<path className="ik-detail" d={`M10 3h${PANEL.w - 20}`} />}
        />

        {CAMS.map((cam) => {
          const key = keyOf(cam)
          return (
            <g key={cam}>
              {cam === 2 && last === "start" && !aiming ? <Ripple {...key} r={3} /> : null}
              <Press
                label={pvw === cam ? `Clear camera ${cam} from preview` : `Put camera ${cam} on preview`}
                material="plastic"
                onPress={act(() => select(cam))}
                disabled={pgm === cam}
                data-hot={hotCam === cam}
              >
                <g>
                  <Box
                    {...key}
                    r={3}
                    top={
                      <>
                        <text className="ik-label vm-key" x={4.5} y={14.5}>
                          {cam}
                        </text>
                        <path className="ik-detail" d="M12 9.5h5.5v4.5H12zM17.5 11l2.5-1.5v4.5l-2.5-1.5" />
                        <Glow on={pgm === cam} className="vm-lamp">
                          <circle className="vm-tally" data-on={pgm === cam} data-live={pgm === cam && cutting} cx={6} cy={4.8} r={2.1} />
                        </Glow>
                        <Glow on={pvw === cam} className="vm-lamp">
                          <rect className="vm-sel" data-on={pvw === cam} x={12} y={3.5} width={8} height={2.6} rx={1} />
                        </Glow>
                      </>
                    }
                  />
                </g>
              </Press>
            </g>
          )
        })}
        <Box
          {...METER}
          r={2}
          top={<path className="ik-detail" d={`M4 ${METER.d / 2}h${METER.w - 8}`} />}
          front={<MeterFace pgm={pgm} />}
          side={<circle className="ik-fill" cx={METER.d / 2} cy={METER.h / 2} r={1} />}
        />
        <Press label="Cut preview to program" material="plastic" onPress={act(cut)} disabled={pvw === null} data-hot={cutHot}>
          <g>
            <Box
              {...CUT}
              r={4}
              top={
                <text className="ik-label vm-cut" x={6} y={15.5}>
                  CUT
                </text>
              }
            />
          </g>
        </Press>
        <Press label="Fade program to black" material="plastic" onPress={act(black)} disabled={pgm === null}>
          <g>
            <Box
              {...FTB}
              r={3}
              top={
                <text className="ik-label vm-ftb" x={6} y={10.4}>
                  FTB
                </text>
              }
            />
          </g>
        </Press>

        {cutting && pgm !== null ? (
          <Flight key={`fly-${take}`} from={screenOf(PVW)} to={screenOf(PGM)} duration={FLY_MS} lift={30}>
            <g transform={front(...screenOf(PVW))}>
              <Screen clip={clip}>
                <Picture cam={pgm} />
              </Screen>
            </g>
          </Flight>
        ) : null}
        <Callout at={RELAY_AT} dx={-16} dy={-30} label="tally relay" />
        <Cursor at={[FIRST_KEY.x + FIRST_KEY.w / 2, FIRST_KEY.y + FIRST_KEY.d / 2, FIRST_KEY.z + FIRST_KEY.h]} phase={phase} />
      </g>
    </Plate>
  )
}
