import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, project, Ripple, type SoundName, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./wafer-probe.css"

export const meta = {
  slug: "wafer-probe",
  title: "Wafer prober",
  industry: "deeptech",
  level: 3,
  blurb: "Press probe: the head steps across six dies with a tick at every touchdown, marks each pass or fail, and the console tallies the yield. The next wafer drops onto the vacuum chuck and latches.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "project", "curve", "path", "Callout"],
  sounds: ["tick", "error", "done", "latch"],
} satisfies FigureMeta

type Wafer = { id: string; fail: number | null }

const FIRST: Wafer = { id: "W01", fail: 3 }
const WAFERS: readonly Wafer[] = [FIRST, { id: "W02", fail: null }, { id: "W03", fail: 1 }]

const BASE = { x: 0, y: 0, z: 0, w: 200, d: 132, h: 10 }
const STAGE = { x: 14, y: 18, z: BASE.h, w: 96, d: 96, h: 6 }
const CHUCK = { x: 17, y: 21, z: STAGE.z + STAGE.h, w: 90, d: 90, h: 8 }
const WAFER = { x: 22, y: 26, z: CHUCK.z + CHUCK.h, w: 80, d: 80, h: 2 }
const TOP = WAFER.z + WAFER.h
const MID = WAFER.w / 2
const PITCH = 10
const DIE = 8.4
const SPAN = [-3, -2, -1, 0, 1, 2, 3] as const
const DIES = SPAN.flatMap((j) => SPAN.filter((i) => Math.hypot(Math.abs(i) * PITCH + DIE / 2, Math.abs(j) * PITCH + DIE / 2) <= 37.6).map((i) => ({ i, j })))
const ROW = [-3, -2, -1, 0, 1, 2] as const

const UPRIGHT = { x: 2, y: 51, z: BASE.h, w: 10, d: 10, h: 56 }
const UPRIGHT_R = { ...UPRIGHT, x: 114 }
const BEAM = { x: 2, y: 51, z: UPRIGHT.z + UPRIGHT.h, w: 122, d: 10, h: 9 }
const PROBE_Y = WAFER.y + MID
const PARK = 20
const CARRIAGE = { x: PARK - 8, y: BEAM.y + BEAM.d, z: 50, w: 16, d: 10, h: 27 }
const COLUMN = { x: PARK - 2.5, y: PROBE_Y - 2.5, z: 35, w: 5, d: 5, h: CARRIAGE.z - 35 }
const NEEDLE = path([
  [PARK - 1.6, PROBE_Y, COLUMN.z],
  [PARK, PROBE_Y, TOP + 3],
])
const JACK = { x: UPRIGHT_R.x + UPRIGHT_R.w, y: 54, z: 14, w: 4, d: 4, h: 4 }
const CABLE = path(curve([JACK.x + JACK.w, 56, 16], [134, 56, 15], [132, 50, BASE.h + 0.6], [144, 40, BASE.h + 0.6], 28))
const CONSOLE = { x: 138, y: 16, z: BASE.h, w: 56, d: 42, h: 48 }
const KEY = { x: 144, y: 86, z: BASE.h, w: 46, d: 20, h: 6 }

const STEP_MS = 300
const TOUCH_MS = 190
const HOP_MS = 140
const LOAD_MS = 420
const END_MS = ROW.length * STEP_MS
const dieX = (i: number) => WAFER.x + MID + i * PITCH
const touchAt = (k: number) => k * STEP_MS + TOUCH_MS
const HOPS = ROW.map((i, k) => {
  const [dx, dy] = project(k === 0 ? dieX(i) - PARK : PITCH, 0, 0)
  return { dx, dy, k }
})
const CROSS = "M-2.2 -2.2l4.4 4.4M2.2 -2.2l-4.4 4.4"

function Head() {
  return (
    <g className="dip">
      <Box {...COLUMN} r={2.5} />
      <path className="ik-line" d={NEEDLE} />
      <Box
        {...CARRIAGE}
        r={2}
        className="carriage"
        top={<circle className="ik-detail" cx={CARRIAGE.w / 2} cy={CARRIAGE.d / 2} r={2.6} />}
        front={
          <>
            <circle className="ik-fill" cx={3.5} cy={4} r={0.8} />
            <circle className="ik-fill" cx={CARRIAGE.w - 3.5} cy={4} r={0.8} />
            <path className="ik-detail" d={`M${CARRIAGE.w / 2} 8v13`} />
          </>
        }
      />
    </g>
  )
}

export default function WaferProbe() {
  const [state, setState] = useState<{ wafer: number; probed: boolean; run: number; loaded: boolean }>({ wafer: 0, probed: false, run: 0, loaded: false })
  const [touched, setTouched] = useState(false)
  const stops = useRef<Array<() => void>>([])
  const timers = useRef<number[]>([])
  const hush = () => {
    for (const timer of timers.current) window.clearTimeout(timer)
    for (const stop of stops.current) stop()
    timers.current = []
    stops.current = []
  }
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      for (const stop of stops.current) stop()
    },
    [],
  )

  const wafer = WAFERS[state.wafer] ?? FIRST
  const passed = ROW.length - (wafer.fail === null ? 0 : 1)
  const yieldPct = Math.round((passed / ROW.length) * 100)
  const act = (audible: boolean) => {
    hush()
    const later = (ms: number, name: SoundName) => timers.current.push(window.setTimeout(() => stops.current.push(playSound(name)), ms))
    if (state.probed) {
      if (audible) later(LOAD_MS, "latch")
      setState({ wafer: (state.wafer + 1) % WAFERS.length, probed: false, run: state.run, loaded: true })
      return
    }
    if (audible) {
      ROW.forEach((_, k) => {
        later(touchAt(k), "tick")
      })
      if (wafer.fail !== null) later(touchAt(wafer.fail), "error")
      later(END_MS, "done")
    }
    setState({ ...state, probed: true, run: state.run + 1 })
  }
  const demo = useDemoTap(
    () => {
      if (!state.probed) act(false)
    },
    { delay: 1100 },
  )
  const press = () => {
    demo.dismiss()
    setTouched(true)
    act(true)
  }

  const head = HOPS.reduceRight<ReactNode>(
    (inner, hop) => (
      <g key={hop.k} className="hop" style={{ "--dx": `${hop.dx}px`, "--dy": `${hop.dy}px`, "--k": hop.k } as CSSProperties}>
        {inner}
      </g>
    ),
    <Head key={state.run} />,
  )

  return (
    <Plate
      {...demo.plate}
      fig="Deep tech"
      name="Wafer prober"
      hint={state.probed ? "Press for the next wafer" : "Press probe"}
      readout={state.probed ? `yield ${yieldPct}% · ${passed}/${ROW.length}` : `${wafer.id.toLowerCase()} · ready`}
      className="fig-wafer-probe"
      style={{ "--step": `${STEP_MS}ms`, "--hop": `${HOP_MS}ms`, "--load": `${LOAD_MS}ms`, "--end": `${END_MS}ms` } as CSSProperties}
      data-probed={state.probed}
      fit={[BASE, { ...BEAM, z: 0, h: BEAM.z + BEAM.h }, { ...CARRIAGE, x: dieX(Math.max(...ROW)) - CARRIAGE.w / 2, z: 0, h: CARRIAGE.z + CARRIAGE.h }, { ...CONSOLE, z: 0, h: CONSOLE.z + CONSOLE.h }]}
      aspect={1.3}
      label="A wafer prober: a silicon wafer on a vacuum chuck under a gantry probe head, beside a console. Press probe and the head tests six dies, marking each pass or fail while the console tallies the yield; press again to load the next wafer."
    >
      <g ref={demo.ref}>
        <Box {...BASE} r={10} />
        <Box {...UPRIGHT} r={2} />
        <Box
          {...STAGE}
          r={5}
          top={[
                [5, 5],
                [STAGE.w - 5, 5],
                [5, STAGE.d - 5],
                [STAGE.w - 5, STAGE.d - 5],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.2} />
              ))}
          front={<path className="ik-detail" d={`M8 3h${STAGE.w - 16}`} />}
        />
        <Box
          {...CHUCK}
          r={CHUCK.w / 2}
          top={
            <>
              <circle className="ik-detail" cx={CHUCK.w / 2} cy={CHUCK.d / 2} r={43} />
              {[0, 90, 180, 270].map((a) => (
                <circle key={a} className="ik-fill" cx={CHUCK.w / 2 + Math.cos((a * Math.PI) / 180) * 43} cy={CHUCK.d / 2 + Math.sin((a * Math.PI) / 180) * 43} r={0.9} />
              ))}
            </>
          }
        />
        <g key={wafer.id} className={state.loaded ? "wafer-load" : undefined}>
          <Box
            {...WAFER}
            r={WAFER.w / 2}
            top={
              <g className="ik-enter">
                {DIES.map(({ i, j }) => (
                  <rect key={`${i}-${j}`} className="ik-detail" x={MID + i * PITCH - DIE / 2} y={MID + j * PITCH - DIE / 2} width={DIE} height={DIE} rx={0.8} />
                ))}
                <path className="ik-well" d={`M${MID - 3} ${WAFER.d}a3 3 0 0 1 6 0z`} />
                {ROW.map((i, k) => (
                  <g key={i} className="hit" style={{ "--t": `${touchAt(k)}ms` } as CSSProperties} transform={`translate(${MID + i * PITCH} ${MID})`}>
                    {wafer.fail === k ? <path className="ik-line ik-thick" d={CROSS} /> : <circle className="ik-fill" r={2} />}
                  </g>
                ))}
              </g>
            }
          />
        </g>
        <Box {...UPRIGHT_R} r={2} side={<rect className="ik-well" x={4} y={UPRIGHT_R.z + UPRIGHT_R.h - 18} width={4} height={4} rx={0.8} />} />
        <Box {...JACK} r={1} />
        <path className="ik-line" d={CABLE} />
        <Box
          {...BEAM}
          r={2}
          front={<path className="ik-detail" d={`M12 3h${BEAM.w - 24}M12 6h${BEAM.w - 24}`} />}
        />
        <g className="head">{head}</g>
        <Box
          {...CONSOLE}
          r={6}
          top={
            <>
              <rect className="ik-detail" x={8} y={8} width={CONSOLE.w - 16} height={CONSOLE.d - 16} rx={4} />
              {Array.from({ length: 5 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M14 ${13 + k * 4}h${CONSOLE.w - 28}`} />
              ))}
            </>
          }
          side={Array.from({ length: 9 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${8 + k * 3.2} 8v14`} />
              ))}
          front={
            <>
              <rect className="ik-screen" x={5} y={5} width={CONSOLE.w - 10} height={27} rx={3} />
              <g key={wafer.id} className="ik-enter">
                <text className="ik-screen-text ik-dim" x={9} y={12.5} fontSize={5.6}>
                  {`${wafer.id} · ${ROW.length} dies`}
                </text>
              </g>
              {ROW.map((i, k) => (
                <g key={i} className="tally" style={{ "--t": `${touchAt(k)}ms` } as CSSProperties} transform={`translate(${9 + k * 6.8} 15.5)`}>
                  <rect className="cell" width={5} height={5} rx={0.8} />
                  <Glow on={state.probed} className="tally-glow">
                    <g className="hit">{wafer.fail === k ? <path className="cross" d="M1.2 1.2l2.6 2.6M3.8 1.2L1.2 3.8" /> : <rect className="pass" width={5} height={5} rx={0.8} />}</g>
                  </Glow>
                </g>
              ))}
              {state.probed ? (
                <g key={`p-${state.run}`}>
                  <text className="ik-screen-text ik-dim probing" x={9} y={28.5} fontSize={7.2}>
                    probing
                  </text>
                  <g className="ik-enter" style={{ animationDelay: `${END_MS}ms` }}>
                    <text className="ik-screen-text" x={9} y={28.5} fontSize={7.2}>
                      {`yield ${yieldPct}%`}
                    </text>
                  </g>
                </g>
              ) : (
                <g key={`r-${wafer.id}`} className="ik-enter">
                  <text className="ik-screen-text" x={9} y={28.5} fontSize={7.2}>
                    ready
                  </text>
                </g>
              )}
              <circle className="ik-fill" cx={9} cy={39} r={1.6} />
              {Array.from({ length: 4 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${15 + k * 3} 36v7`} />
              ))}
              <text className="ik-label tag" x={CONSOLE.w - 5} y={41.5} textAnchor="end">
                PROBER
              </text>
            </>
          }
        />

        {!touched && !state.probed && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...KEY} r={5} /> : null}
        <Press label={state.probed ? "Load the next wafer" : "Probe six dies"} material="plastic" onPress={press} data-hot={!state.probed}>
          <g>
            <Box
              {...KEY}
              r={5}
              top={
                <>
                  <text className="ik-label key" x={8} y={12.6}>
                    PROBE
                  </text>
                  <path className="ik-detail ik-thick pin" d="M3 0v4.6M1 2.8l2 2 2-2M0 7h6" transform={`translate(${KEY.w - 13} 6)`} />
                </>
              }
            />
          </g>
        </Press>
        <Callout at={[CHUCK.x + CHUCK.w / 2 + 45 / Math.SQRT2, CHUCK.y + CHUCK.d / 2 + 45 / Math.SQRT2, CHUCK.z + CHUCK.h / 2]} dx={14} dy={10} label="vacuum chuck" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
