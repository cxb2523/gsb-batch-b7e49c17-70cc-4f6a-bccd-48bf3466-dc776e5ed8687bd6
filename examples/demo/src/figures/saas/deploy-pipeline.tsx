import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, Signal, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./deploy-pipeline.css"

export const meta = {
  slug: "deploy-pipeline",
  title: "Deploy pipeline",
  industry: "saas",
  level: 4,
  blurb: "Press deploy: the build fan spins up, a signal runs build to test to ship, each stage ticks ok and a relay throws prod over to the new version.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path", "Callout"],
  sounds: ["press", "release", "motor", "process", "relay", "success", "whoosh"],
} satisfies FigureMeta

type Stage = "build" | "test" | "ship"
type Slot = { id: Stage; x: number; label: string }
type Kind = "deploy" | "rollback" | "oldest"
type Status = "idle" | "run" | "ok" | "on"
type Run = { id: number; kind: Kind | null; step: number; from: number; to: number }

const BASE = { x: 0, y: 0, z: 0, w: 184, d: 116, h: 8 }
const ST = { y: 12, z: BASE.h, w: 44, d: 34, h: 46 }
const LID = ST.z + ST.h
const MID = ST.y + ST.d / 2
const GLAND = { w: 6, d: 6, h: 3 }
const FIRST: Slot = { id: "build", x: 10, label: "BUILD" }
const LAST: Slot = { id: "ship", x: 130, label: "SHIP" }
const STAGES: readonly Slot[] = [FIRST, { id: "test", x: 70, label: "TEST" }, LAST]
const DEPLOY = { x: 12, y: 66, z: BASE.h, w: 78, d: 36, h: 7 }
const ROLLBACK = { x: 104, y: 70, z: BASE.h, w: 68, d: 28, h: 6 }
const SHAS = ["c07e1d", "9b4a2f", "a1f9c3", "5e8d70", "f2b61a", "7c3e94", "e41b08", "3d9f6c"] as const
const STEPS: Readonly<Record<Kind, readonly number[]>> = {
  deploy: [280, 640, 960, 1320, 1640, 2000],
  rollback: [300],
  oldest: [],
}
const CURRENT: readonly Stage[] = ["build", "build", "test", "test", "ship", "ship"]
const SIGNAL_MS = 320
const TRACE_MS = 280
const BUILD_MS = (STEPS.deploy[1] ?? 0) - (STEPS.deploy[0] ?? 0)
const LAMP_MS = 70
const FAN_BLADES = [0, 90, 180, 270] as const
const ARM = { x: 30, y: 30.5, length: 6.5 }
const PLATE_STYLE = { "--lamp": `${LAMP_MS}ms` } as CSSProperties
const CHECK = "M0 3l2.2 2.2L6.6 .8"
const BACK = "M5.5 1.2H2.4a2 2 0 0 0 0 4h4.2M3.6 0L2.4 1.2l1.2 1.2"

const version = (patch: number) => `v1.4.${patch}`
const sha = (patch: number) => SHAS[patch % SHAS.length] ?? SHAS[0]
const out = (x: number) => x + ST.w - 7
const into = (x: number) => x + 7
const cable = (x: number, next: number): Vec3[] =>
  curve([out(x), MID, LID + GLAND.h], [out(x) + 7, MID, LID + 16], [into(next) - 7, MID, LID + 16], [into(next), MID, LID + GLAND.h], 32)
const CABLES = STAGES.slice(0, -1).flatMap((stage, i) => {
  const next = STAGES[i + 1]
  return next ? [cable(stage.x, next.x)] : []
})
const BUS_Y = ST.y + ST.d + 10
const trace = (from: number, y: number, to: number): Vec3[] => [
  [from, y, BASE.h],
  [from, BUS_Y, BASE.h],
  [to, BUS_Y, BASE.h],
  [to, ST.y + ST.d, BASE.h],
]
const DEPLOY_TRACE = trace(DEPLOY.x + 60, DEPLOY.y, FIRST.x + ST.w / 2)
const ROLLBACK_TRACE = trace(ROLLBACK.x + 12, ROLLBACK.y, LAST.x + ST.w / 2)
const groove = (points: readonly Vec3[]) => `M${points.map(([x, y]) => `${x} ${y}`).join("L")}`

const finished = (run: Run) => run.kind === null || run.step >= STEPS[run.kind].length
const live = (run: Run) => (finished(run) ? run.to : run.from)

function statusOf(i: number, run: Run): Status {
  const ship = i === STAGES.length - 1
  if (run.kind === "deploy") {
    if (run.step >= 2 * i + 2) return ship ? "on" : "ok"
    if (run.step >= 2 * i + 1) return "run"
    return ship ? "ok" : "idle"
  }
  if (!ship) return "idle"
  if (run.kind === null) return "ok"
  return finished(run) ? "on" : "ok"
}

function readoutOf(run: Run): string {
  if (run.kind === null) return `prod · ${version(run.to)}`
  if (run.kind === "oldest") return `nothing older · ${version(run.to)}`
  if (run.kind === "rollback") return finished(run) ? `rolled back · ${version(run.to)}` : `rolling back · ${version(run.from)}`
  return finished(run) ? `live · ${version(run.to)}` : `deploying · ${CURRENT[run.step] ?? "ship"}`
}

function TopMark({ stage }: { stage: Stage }) {
  const cx = ST.w / 2
  const cy = ST.d / 2
  if (stage === "build")
    return (
      <g transform={`translate(${cx} ${cy})`}>
        <circle className="ik-well" r={8} />
        <g className="dp-fan ik-loop">
          {FAN_BLADES.map((turn) => (
            <path key={turn} className="ik-line" d="M1.8 .6Q4.4-2.8 6.9-1.4" transform={`rotate(${turn})`} />
          ))}
        </g>
        <circle className="ik-face ik-top" r={2.2} />
      </g>
    )
  if (stage === "test")
    return (
      <g transform={`translate(${cx} ${cy})`}>
        <circle className="ik-detail" r={7.5} />
        <path className="ik-detail" d={CHECK} transform="translate(-3.3 -3)" />
      </g>
    )
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <path className="ik-detail" d="M-6.5 1v5.5h13V1M0 3.5v-10M-3.5-3L0-6.5 3.5-3" />
    </g>
  )
}

export default function DeployPipeline() {
  const [run, setRun] = useState<Run>({ id: 0, kind: null, step: 0, from: 1, to: 1 })
  const [touched, setTouched] = useState(false)
  const timers = useRef<number[]>([])
  const stop = useRef(() => {})
  const stopMotor = useRef(() => {})
  const clear = () => {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
  }
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      stop.current()
      stopMotor.current()
    },
    [],
  )

  const start = (kind: Kind, to: number, audible: boolean) => {
    const id = run.id + 1
    const from = live(run)
    const steps = STEPS[kind]
    const end = steps[steps.length - 1] ?? 0
    clear()
    stop.current()
    stopMotor.current()
    if (audible && kind === "rollback") stop.current = playSound("whoosh")
    setRun({ id, kind, step: 0, from, to })
    timers.current = steps.map((at, i) =>
      window.setTimeout(() => {
        const step = i + 1
        setRun((r) => (r.id === id ? { ...r, step } : r))
        if (!audible || kind !== "deploy") return
        stop.current()
        if (step === 1) stopMotor.current = playSound("motor", { duration: BUILD_MS / 1000 })
        else if (step === steps.length) stop.current = playSound("relay")
        else if (step % 2 === 1) stop.current = playSound("process")
      }, at),
    )
    if (!audible || steps.length === 0) return
    if (kind === "rollback") timers.current.push(window.setTimeout(() => (stop.current = playSound("relay")), end))
    if (kind === "deploy") timers.current.push(window.setTimeout(() => (stop.current = playSound("success")), end + LAMP_MS))
  }
  const deploy = (audible: boolean) => start("deploy", live(run) + 1, audible)
  const rollback = () => {
    const prod = live(run)
    if (!finished(run)) start("rollback", run.from, true)
    else if (prod > 0) start("rollback", prod - 1, true)
    else start("oldest", prod, false)
  }
  const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(() => {
    if (run.kind === null) deploy(false)
  }, { delay: 500 })
  const press = (action: () => void) => {
    dismiss()
    setTouched(true)
    action()
  }

  const shown = run.kind === "deploy" ? (finished(run) ? run.to : run.from) : live(run)
  const rolled = run.kind === "rollback" && finished(run)
  const target = run.kind === "deploy" ? run.to : live(run)

  return (
    <Plate
      {...plate}
      fig="SaaS"
      name="Deploy pipeline"
      hint={run.kind === null ? "Press deploy" : "Deploy or roll back"}
      readout={readoutOf(run)}
      className="fig-deploy-pipeline"
      style={PLATE_STYLE}
      data-kind={run.kind ?? "idle"}
      fit={[BASE, { x: FIRST.x, y: ST.y, z: 0, w: 164, d: ST.d, h: LID + 16 }]}
      aspect={1.3}
      label="A deploy pipeline of three stages, build, test and ship, joined by cables. Press deploy to send a new version through every stage to production, or roll back to the previous version."
    >
      <g ref={demoAnchor}>
        <Box
          {...BASE}
          r={10}
          top={
            <>
              <path className="ik-detail" d={groove(DEPLOY_TRACE)} />
              <path className="ik-detail" d={groove(ROLLBACK_TRACE)} />
              {[
                [6, 6],
                [BASE.w - 6, 6],
                [6, BASE.d - 6],
                [BASE.w - 6, BASE.d - 6],
              ].map(([x, y]) => (
                <circle key={`${x}-${y}`} className="ik-detail" cx={x} cy={y} r={1.8} />
              ))}
            </>
          }
          front={Array.from({ length: 8 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${BASE.w - 40 + k * 3.4} 2.5v3`} />
          ))}
        />

        {STAGES.map((stage, i) => {
          const status = statusOf(i, run)
          const ship = stage.id === "ship"
          return (
            <g key={stage.id}>
              <g className="dp-stage" data-s={status}>
                <Box
                  x={stage.x}
                  {...ST}
                  r={5}
                  top={<TopMark stage={stage.id} />}
                  front={
                    <>
                      <rect className="ik-screen" x={4} y={4} width={36} height={20} rx={2.5} />
                      <g key={`${run.id}-${status}-${shown}`} className="ik-enter">
                        <text className="ik-screen-text ik-dim" x={7.5} y={10.8} fontSize={5.6}>
                          {stage.id === "build" ? `#${sha(target)}` : ship ? "prod" : "24 tests"}
                        </text>
                        {ship && rolled ? <path className="ik-screen-line" d={BACK} transform="translate(23 6.2) scale(.8)" /> : null}
                        {status === "run" ? (
                          <g className="dp-busy ik-loop">
                            {[0, 1, 2].map((k) => (
                              <rect key={k} className="dp-pip" x={7.5 + k * 5} y={16.4} width={3} height={3} rx={0.6} style={{ animationDelay: `${k * 90}ms` }} />
                            ))}
                          </g>
                        ) : ship ? (
                          <text className="ik-screen-text" x={7.5} y={20.6} fontSize={6.6}>
                            {version(shown)}
                          </text>
                        ) : status === "ok" ? (
                          <>
                            <path className="ik-screen-line" d={CHECK} transform="translate(7.5 15.2)" />
                            <text className="ik-screen-text" x={17} y={20.6} fontSize={6.6}>
                              ok
                            </text>
                          </>
                        ) : (
                          <text className="ik-screen-text ik-dim" x={7.5} y={20.6} fontSize={6.6}>
                            idle
                          </text>
                        )}
                      </g>
                      <Glow on={status === "run" || status === "on"} className="dp-glow">
                        <circle className="dp-light ik-loop" cx={7} cy={30.5} r={2} />
                      </Glow>
                      <text className="ik-label dp-name" x={12} y={32.6}>
                        {stage.label}
                      </text>
                      {ship ? (
                        <>
                          <path className="ik-detail" d={`M${ARM.x + ARM.length + 1.2} ${ARM.y - 2.4}v4.8`} />
                          <g transform={`translate(${ARM.x} ${ARM.y})`}>
                            <g className="dp-arm">
                              <path className="ik-line" d={`M0 0h${ARM.length}`} />
                            </g>
                            <circle className="ik-fill" r={1} />
                          </g>
                        </>
                      ) : null}
                      {Array.from({ length: 10 }, (_, k) => (
                        <path key={k} className="ik-detail" d={`M${6 + k * 3.6} 37.5v4.5`} />
                      ))}
                    </>
                  }
                  side={
                    <>
                      {Array.from({ length: 3 }, (_, k) => (
                        <path key={k} className="ik-detail" d={`M${4 + k * 3.4} 10v26`} />
                      ))}
                      {ship ? <rect className="ik-well" x={20} y={20} width={8} height={6} rx={1.2} /> : null}
                    </>
                  }
                />
              </g>
              {i > 0 ? <Box x={into(stage.x) - GLAND.w / 2} y={MID - GLAND.d / 2} z={LID} {...GLAND} r={1.5} /> : null}
              {!ship ? <Box x={out(stage.x) - GLAND.w / 2} y={MID - GLAND.d / 2} z={LID} {...GLAND} r={1.5} /> : null}
            </g>
          )
        })}

        {CABLES.map((points, i) => (
          <g key={`cable-${points.length}-${i}`}>
            <path className="ik-line dp-cable" d={path(points)} />
            {run.kind === "deploy" && run.step >= 2 * i + 2 ? <Signal key={`s-${run.id}`} points={points} duration={SIGNAL_MS} /> : null}
          </g>
        ))}

        {run.kind === "deploy" ? <Signal key={`d-${run.id}`} points={DEPLOY_TRACE} duration={TRACE_MS} /> : null}
        {run.kind === "rollback" ? <Signal key={`r-${run.id}`} points={ROLLBACK_TRACE} duration={STEPS.rollback[0] ?? TRACE_MS} /> : null}

        {!touched && run.kind === null && phase !== "aim" && phase !== "press" ? <Ripple {...DEPLOY} r={6} /> : null}
        <Press label={`Deploy ${version(live(run) + 1)}`} material="plastic" onPress={() => press(() => deploy(true))} data-hot={run.kind === null}>
          <g>
            <Box
              {...DEPLOY}
              r={6}
              top={
                <>
                  <text className="ik-label dp-key" x={10} y={21}>
                    DEPLOY
                  </text>
                  <path className="ik-detail ik-thick" d="M0 6h12M7 1l5 5-5 5" transform={`translate(${DEPLOY.w - 22} 12.5)`} />
                </>
              }
            />
          </g>
        </Press>
        <Press label="Roll back to the previous version" material="plastic" onPress={() => press(rollback)}>
          <g>
            <Box
              {...ROLLBACK}
              r={5}
              top={
                <>
                  <path className="ik-detail ik-thick" d={BACK} transform="translate(8 10.5) scale(1.3)" />
                  <text className="ik-label dp-key-small" x={20} y={17.2}>
                    ROLLBACK
                  </text>
                </>
              }
            />
          </g>
        </Press>

        <Callout at={[LAST.x + ST.w, ST.y + ST.d, LID]} dx={24} dy={-20} label={`prod · ${version(shown)}`} />
        <Cursor at={[DEPLOY.x + DEPLOY.w / 2, DEPLOY.y + DEPLOY.d / 2, DEPLOY.z + DEPLOY.h]} phase={phase} />
      </g>
    </Plate>
  )
}
