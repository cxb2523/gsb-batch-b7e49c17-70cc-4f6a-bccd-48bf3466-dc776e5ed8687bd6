import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, Signal, type SoundName, type SoundOptions, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./gpu-cluster.css"

export const meta = {
  slug: "gpu-cluster",
  title: "GPU cluster",
  industry: "deeptech",
  level: 3,
  blurb: "Press train: the job runs down the cable, four GPU nodes light bottom to top with their fans spinning up, the loss curve falls one more epoch and its digits roll over.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path", "Callout"],
  sounds: ["boot", "cascade", "motor", "roll", "done"],
} satisfies FigureMeta

type Epoch = 0 | 1 | 2 | 3

const BASE = { x: 0, y: 0, z: 0, w: 180, d: 120, h: 8 }
const RACK = { x: 10, y: 10, w: 76, d: 64 }
const POST = 6
const PITCH = 18
const PLINTH = { x: RACK.x, y: RACK.y, z: BASE.h, w: RACK.w, d: RACK.d, h: 6 }
const Z0 = PLINTH.z + PLINTH.h
const TIERS = [0, 1, 2, 3] as const
const NODE = { x: RACK.x + POST, y: RACK.y + 1, w: RACK.w - 2 * POST, d: RACK.d - 3, h: 16 }
const CAP = { x: RACK.x, y: RACK.y, z: Z0 + TIERS.length * PITCH, w: RACK.w, d: RACK.d, h: 6 }
const LEFT = { x: RACK.x, y: RACK.y, z: Z0, w: POST, d: RACK.d, h: CAP.z - Z0 }
const RIGHT = { ...LEFT, x: RACK.x + RACK.w - POST }
const JACK = { x: RIGHT.x + RIGHT.w, y: 60.5, z: 20.5, w: 5, d: 5, h: 5 }
const HEAD = { x: 104, y: 22, z: BASE.h, w: 66, d: 42, h: 56 }
const KEY = { x: 116, y: 86, z: BASE.h, w: 46, d: 20, h: 6 }
const CABLE: readonly Vec3[] = curve([JACK.x + JACK.w, 63, 23], [99, 63, 22], [95, 60, BASE.h + 0.6], [113, 50, BASE.h + 0.6], 32)
const SIGNAL_PATH = [...CABLE].reverse()

const SIGNAL_MS = 320
const STAGGER_MS = 60
const DRAW_AT = 560
const DRAW_MS = 700
const FAN_MS = 1500
const READ_AT = DRAW_AT + DRAW_MS - 200
const ROLL_MS = 50
const NEXT: Readonly<Record<Epoch, Epoch>> = { 0: 1, 1: 2, 2: 3, 3: 0 }
const LOSS: Readonly<Record<Epoch, number>> = { 0: 2.3, 1: 0.91, 2: 0.63, 3: 0.42 }
const EPOCHS = [1, 2, 3] as const

const PLOT = { x: 10, y: 26, w: 46, h: 12 }
const READING = { x: PLOT.x, y: 22.5, size: 7, pitch: 4.2 }
const WHEELS_AT = READING.x + 5 * READING.pitch
const WHEEL_WINDOW = { x: WHEELS_AT - 0.6, y: 15.5, width: 4 * READING.pitch + 1.2, height: 8.6 }
const lossDigits = (epoch: Epoch) => LOSS[epoch].toFixed(2).split("")
const JITTER = [0, 0.5, -0.4, 0.45, -0.3, 0.35, -0.25, 0.2, 0]
const r2 = (n: number) => Math.round(n * 100) / 100
const yOf = (loss: number) => PLOT.y + ((Math.log(2.4) - Math.log(loss)) / (Math.log(2.4) - Math.log(0.3))) * PLOT.h
const fall = (t: number) => (Math.exp(-3 * t) - Math.exp(-3)) / (1 - Math.exp(-3))
const SEGMENTS = EPOCHS.map((epoch) => {
  const from = LOSS[(epoch - 1) as Epoch]
  const to = LOSS[epoch]
  return {
    epoch,
    points: JITTER.map((j, k) => {
      const t = k / (JITTER.length - 1)
      return `${r2(PLOT.x + (PLOT.w * (epoch - 1 + t)) / EPOCHS.length)},${r2(yOf(to + (from - to) * fall(t)) + j)}`
    }).join(" "),
  }
})

const SPOKES = Array.from({ length: 8 }, (_, k) => {
  const a = ((k * 45 + 22.5) * Math.PI) / 180
  return `M${r2(Math.cos(a) * 2)} ${r2(Math.sin(a) * 2)}L${r2(Math.cos(a) * 4.8)} ${r2(Math.sin(a) * 4.8)}`
}).join("")

function Fan({ cx, spin, delay }: { cx: number; spin: boolean; delay: string }) {
  return (
    <g transform={`translate(${cx} 8)`}>
      <g className="fan" data-spin={spin} style={{ "--t": delay } as CSSProperties}>
        <circle className="ik-detail" r={5.4} />
        <circle className="ik-detail" r={1.5} />
        <path className="ik-detail" d={SPOKES} />
      </g>
    </g>
  )
}

function RackHoles() {
  return (
    <>
      {Array.from({ length: 15 }, (_, k) => (
        <circle key={k} className="ik-fill" cx={POST / 2} cy={4 + k * 4.8} r={0.6} />
      ))}
    </>
  )
}

export default function GpuCluster() {
  const [run, setRun] = useState<{ epoch: Epoch; step: number }>({ epoch: 0, step: 0 })
  const [touched, setTouched] = useState(false)
  const stops = useRef<Array<() => void>>([])
  const timers = useRef<number[]>([])
  const clip = useId().replace(/[^\w-]/g, "")
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer)
      for (const stop of stops.current) stop()
    },
    [],
  )

  const { epoch, step } = run
  const rolling = epoch > 1
  const digits = lossDigits(epoch)
  const before = lossDigits(rolling ? ((epoch - 1) as Epoch) : epoch)
  const train = (audible: boolean) => {
    for (const timer of timers.current) window.clearTimeout(timer)
    for (const stop of stops.current) stop()
    timers.current = []
    stops.current = []
    const next = NEXT[epoch]
    if (audible && next > 0) {
      const later = (ms: number, name: SoundName, options?: SoundOptions) => timers.current.push(window.setTimeout(() => stops.current.push(playSound(name, options)), ms))
      const turning = epoch > 0 ? lossDigits(next).filter((digit, index) => digit !== digits[index]).length : 0
      if (epoch === 0) stops.current.push(playSound("boot"))
      stops.current.push(playSound("cascade", { count: TIERS.length, stagger: STAGGER_MS / 1000, delay: SIGNAL_MS / 1000 }))
      later(SIGNAL_MS, "motor", { duration: FAN_MS / 1000 })
      if (turning) later(READ_AT, "roll", { count: turning, stagger: ROLL_MS / 1000 })
      later(DRAW_AT + DRAW_MS, "done")
    }
    setRun({ epoch: next, step: step + 1 })
  }
  const demo = useDemoTap(
    () => {
      if (epoch === 0) train(false)
    },
    { delay: 500 },
  )
  const press = () => {
    demo.dismiss()
    setTouched(true)
    train(true)
  }

  const reset = epoch === 0 && step > 0
  const small = epoch === 0 ? "4 gpus · idle" : `epoch ${epoch}/3`
  const big = epoch === 0 ? "ready" : `loss ${LOSS[epoch].toFixed(2)}`

  return (
    <Plate
      {...demo.plate}
      fig="Deep tech"
      name="GPU cluster"
      hint={epoch === 0 ? "Press train" : epoch === 3 ? "Press to reset" : `Press for epoch ${epoch + 1}`}
      readout={epoch === 0 ? "idle · 4 nodes" : `epoch ${epoch} · loss ${LOSS[epoch].toFixed(2)}`}
      className="fig-gpu-cluster"
      style={{ "--fan": `${FAN_MS}ms`, "--draw": `${DRAW_MS}ms`, "--draw-at": `${DRAW_AT}ms`, "--read-at": `${READ_AT}ms`, "--roll-step": `${ROLL_MS}ms` } as CSSProperties}
      data-epoch={epoch}
      fit={[BASE, { x: RACK.x, y: RACK.y, z: 0, w: RACK.w, d: RACK.d, h: CAP.z + CAP.h }, { ...HEAD, z: 0, h: HEAD.z + HEAD.h }]}
      aspect={1.3}
      label="A GPU training cluster: four nodes in a rack, cabled to a head unit with a screen. Press train to run an epoch; the nodes light up, their fans spin and the loss curve falls."
    >
      <defs>
        <clipPath id={clip}>
          <rect {...WHEEL_WINDOW} />
        </clipPath>
      </defs>
      <g ref={demo.ref}>
        <Box {...BASE} r={10} />
        <Box {...PLINTH} r={3} front={<path className="ik-detail" d={`M4 3h${RACK.w - 8}`} />} />
        <Box {...LEFT} r={1.5} front={<RackHoles />} />
        {TIERS.map((tier) => {
          const on = epoch > 0
          const t = `${SIGNAL_MS + tier * STAGGER_MS}ms`
          const u = `${(TIERS.length - 1 - tier) * STAGGER_MS}ms`
          return (
            <Box
              key={tier}
              {...NODE}
              z={Z0 + tier * PITCH}
              r={2}
              front={
                <>
                  <path className="ik-detail" d="M2.5 3v10" />
                  <Fan key={`a-${step}`} cx={10} spin={on} delay={t} />
                  <Fan key={`b-${step}`} cx={24} spin={on} delay={t} />
                  {Array.from({ length: 6 }, (_, k) => (
                    <path key={k} className="ik-detail" d={`M${34 + k * 2.6} 4.5v7`} />
                  ))}
                  <g style={{ "--t": t, "--u": u } as CSSProperties}>
                    <Glow on={on} className="lamp-glow">
                      <circle key={`lamp-${step}`} className="lamp" data-on={on} data-off={reset} cx={57} cy={8} r={1.9} />
                    </Glow>
                  </g>
                </>
              }
            />
          )
        })}
        <Box
          {...RIGHT}
          r={1.5}
          front={<RackHoles />}
          side={
            <>
              {Array.from({ length: 9 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M22 ${8 + k * 5}h14M42 ${8 + k * 5}h14`} />
              ))}
              <rect className="ik-well" x={8} y={60} width={6} height={6} rx={1} />
            </>
          }
        />
        <Box
          {...CAP}
          r={3}
          top={
            <>
              <rect className="ik-detail" x={8} y={8} width={RACK.w - 16} height={RACK.d - 16} rx={4} />
              {Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M16 ${16 + k * 6.4}h${RACK.w - 32}`} />
              ))}
            </>
          }
        />
        <Box {...JACK} r={1} />
        <path className="ik-line" d={path(CABLE)} />
        {epoch > 0 ? <Signal key={step} points={SIGNAL_PATH} duration={SIGNAL_MS} /> : null}

        <Box
          {...HEAD}
          r={6}
          top={
            <>
              <rect className="ik-detail" x={8} y={8} width={HEAD.w - 16} height={HEAD.d - 16} rx={4} />
              {Array.from({ length: 18 }, (_, k) => (
                <circle key={k} className="ik-fill" cx={15 + (k % 6) * 7.2} cy={14 + Math.floor(k / 6) * 7} r={1.2} />
              ))}
            </>
          }
          side={
            <>
              {Array.from({ length: 9 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${8 + k * 3.2} 8v16`} />
              ))}
              <rect className="ik-well" x={8} y={44} width={9} height={6} rx={1.2} />
            </>
          }
          front={
            <>
              <rect className="ik-screen" x={6} y={6} width={HEAD.w - 12} height={36} rx={3} />
              <path className="axis" d={`M${PLOT.x} ${PLOT.y - 0.5}V${PLOT.y + PLOT.h + 0.5}H${PLOT.x + PLOT.w}`} />
              {EPOCHS.map((e) => (
                <path key={e} className="axis" d={`M${r2(PLOT.x + (PLOT.w * e) / EPOCHS.length)} ${PLOT.y + PLOT.h + 0.5}v1.6`} />
              ))}
              {SEGMENTS.map((seg) => (
                <polyline key={seg.epoch} className="curve" data-on={epoch >= seg.epoch} points={seg.points} pathLength={100} />
              ))}
              <g key={`s-${step}`} className="ik-enter" style={{ animationDelay: `${epoch ? SIGNAL_MS : 0}ms` }}>
                <text className="ik-screen-text ik-dim" x={PLOT.x} y={13.5} fontSize={5.6}>
                  {small}
                </text>
              </g>
              {rolling ? (
                <>
                  <text className="ik-screen-text" x={READING.x} y={READING.y} fontSize={READING.size}>
                    loss
                  </text>
                  <g clipPath={`url(#${clip})`}>
                    {digits.map((digit, index) => {
                      const turns = digit !== before[index]
                      const x = WHEELS_AT + index * READING.pitch
                      return (
                        <g key={`${index}-${step}`} style={{ "--i": digits.length - 1 - index } as CSSProperties}>
                          {turns ? (
                            <text className="ik-screen-text roll-out" x={x} y={READING.y} fontSize={READING.size}>
                              {before[index]}
                            </text>
                          ) : null}
                          <text className={turns ? "ik-screen-text roll-in" : "ik-screen-text"} x={x} y={READING.y} fontSize={READING.size}>
                            {digit}
                          </text>
                        </g>
                      )
                    })}
                  </g>
                </>
              ) : (
                <g key={`b-${step}`} className="ik-enter" style={{ animationDelay: `${epoch ? READ_AT : 0}ms` }}>
                  <text className="ik-screen-text" x={READING.x} y={READING.y} fontSize={READING.size}>
                    {big}
                  </text>
                </g>
              )}
              <circle className="ik-fill" cx={10} cy={49.5} r={1.6} />
              {Array.from({ length: 8 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${18 + k * 3} 46v7`} />
              ))}
              <text className="ik-label tag" x={46} y={51.5}>
                HEAD
              </text>
            </>
          }
        />

        {!touched && epoch === 0 && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...KEY} r={5} /> : null}
        <Press label={epoch === 0 ? "Train one epoch" : epoch === 3 ? "Reset the training run" : "Train the next epoch"} material="plastic" onPress={press} data-hot={epoch === 0}>
          <g>
            <Box
              {...KEY}
              r={5}
              top={
                <>
                  <text className="ik-label key" x={8} y={12.6}>
                    TRAIN
                  </text>
                  <path className="ik-detail ik-thick play" d="M0 0l5 3.2L0 6.4z" transform={`translate(${KEY.w - 14} 6.8)`} />
                </>
              }
            />
          </g>
        </Press>
        <Callout at={[RACK.x + RACK.w, RACK.y, CAP.z + CAP.h]} dx={16} dy={-12} label="4 nodes · 32 gpus" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
