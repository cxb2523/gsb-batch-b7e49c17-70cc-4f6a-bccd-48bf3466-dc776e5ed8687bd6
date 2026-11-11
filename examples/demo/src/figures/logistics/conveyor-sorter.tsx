import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, front, Glow, Plate, Press, playSound, project, Ripple, type SoundName, type SoundOptions, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./conveyor-sorter.css"

export const meta = {
  slug: "conveyor-sorter",
  title: "Conveyor sorter",
  industry: "logistics",
  level: 3,
  blurb: "Press sort: the belt motor runs six parcels out of the scan tunnel, and each diverter's solenoid clicks as its arm swings across to peel its parcels off into their bin.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "front", "project", "Callout"],
  sounds: ["press", "release", "motor", "relay", "cascade", "complete"],
} satisfies FigureMeta

type Counts = readonly [number, number, number]
type Parcel = { bin: number; slot: number; start: number; contact: number; landing: number; until: number | undefined }
type Wave = {
  counts: Counts
  parcels: readonly Parcel[]
  arms: readonly { open: number; shut: number }[]
  relays: readonly number[]
  tallies: readonly (readonly number[])[]
  first: number
  last: number
  drive: CSSProperties
  motor: SoundOptions
}
type Run = { batch: number; prior: number; settled: boolean }

const BASE = { x: 0, y: 0, z: 0, w: 204, d: 120, h: 8 }
const BED = { x: 10, y: 8, z: 26, w: 184, d: 38, h: 8 }
const BELT_Z = BED.z + BED.h
const BELT_FRONT = BED.y + BED.d
const RAIL = { x: BED.x, y: 16, z: BELT_Z, w: BED.w, d: 3, h: 9 }
const ARM = { y: RAIL.y + RAIL.d + 0.5, top: BELT_Z + 10, length: 36, height: 8 }
const HINGES = [64, 106, 148] as const
const LEG_XS = [16, 98, 180] as const
const LEG_YS = [12, 39] as const
const TUNNEL = { x: 160, y: 12, z: BELT_Z, w: 30, d: 36, h: 22 }
const BEACON = { x: 170, y: 24, z: TUNNEL.z + TUNNEL.h, w: 6, d: 6, h: 5 }
const DRIVE = { x: BED.x + BED.w + 1, y: 22, z: 20, w: 8, d: 16, h: 14 }
const PULLEY = { cx: 8, cy: 7, r: 4 }
const SPOKE_TURN = 120
const PULLEY_SPOKES = [0, SPOKE_TURN, 2 * SPOKE_TURN].map((turn) => `M0 0L${(Math.cos((turn * Math.PI) / 180) * PULLEY.r).toFixed(3)} ${(Math.sin((turn * Math.PI) / 180) * PULLEY.r).toFixed(3)}`).join("")
const DEGREES_PER_UNIT = 6
const BIN = { y: BELT_FRONT + 2, d: 40, w: 36, wall: 2, floor: 2, h: 8 }
const CONSOLE = { x: 162, y: 80, z: BASE.h, w: 38, d: 30, h: 24 }
const KEY = { x: 166, y: 87, z: CONSOLE.z + CONSOLE.h, w: 30, d: 15, h: 4 }
const SCREEN = { x: 3, y: 3, w: 32, h: 19 }
const PARCEL = { w: 14, d: 14, h: 10 }
const LANE_Y = 32.5
const START_X = 176
const SLOTS = [
  { x: 10, y: 11 },
  { x: 26, y: 11 },
  { x: 18, y: 27 },
] as const
const SPEED = 0.2
const STEP_MS = 220
const SWING_MS = 180
const ARM_CLEAR = 13.5
const DIAG_MS = (ARM_CLEAR * Math.SQRT2) / SPEED
const DIAG = 20.5
const PEEL_MS = 420
const TIMING = { "--swing-ms": `${SWING_MS}ms`, "--peel-ms": `${PEEL_MS}ms` } as CSSProperties
const START: Run = { batch: 0, prior: 0, settled: false }
const MANIFESTS: readonly Counts[] = [
  [2, 3, 1],
  [3, 1, 2],
  [1, 2, 3],
]

const binX = (bin: number) => (HINGES[bin] ?? 0) - DIAG - BIN.w / 2 + 1
const contactX = (bin: number) => (HINGES[bin] ?? 0) + 1
const slotCenter = (bin: number, slot: number) => [binX(bin) + (SLOTS[slot]?.x ?? 0), BIN.y + (SLOTS[slot]?.y ?? 0)] as const
const ms = (value: number) => `${Math.round(value)}ms`
const px = (value: number) => `${Math.round(value * 1000) / 1000}px`

function buildWave(counts: Counts): Wave {
  const bins = counts.flatMap((count, bin) => Array.from({ length: count }, () => bin))
  const seen = [0, 0, 0]
  const drafts = bins.map((bin, rank) => {
    const contact = rank * STEP_MS
    const slot = seen[bin] ?? 0
    seen[bin] = slot + 1
    return { bin, slot, contact, start: contact - (START_X - contactX(bin)) / SPEED }
  })
  let earliest = Infinity
  for (const draft of drafts) earliest = Math.min(earliest, draft.start)
  const parcels = drafts.map((draft, rank) => {
    const contact = draft.contact - earliest
    const next = drafts[rank + 1]
    return { bin: draft.bin, slot: draft.slot, start: draft.start - earliest, contact, landing: contact + PEEL_MS, until: next ? next.contact - earliest + PEEL_MS : undefined }
  })
  const arms = [0, 1, 2].map((bin) => {
    let open = Infinity
    let shut = 0
    for (const parcel of parcels) {
      if (parcel.bin !== bin) continue
      open = Math.min(open, parcel.contact - SWING_MS - 20)
      shut = Math.max(shut, parcel.contact + DIAG_MS + 40)
    }
    return { open, shut }
  })
  const tallies = [0, 1, 2].map((bin) => parcels.flatMap((parcel) => (parcel.bin === bin ? [parcel.landing] : [])))
  const first = parcels[0]?.landing ?? 0
  const last = parcels[parcels.length - 1]?.landing ?? 0
  let belt = 0
  for (const parcel of parcels) belt = Math.max(belt, parcel.contact)
  const turn = Math.round((belt * SPEED * DEGREES_PER_UNIT) / SPOKE_TURN) * SPOKE_TURN
  const relays = arms.flatMap((arm) => (Number.isFinite(arm.open) ? [arm.open] : []))
  return { counts, parcels, arms, relays, tallies, first, last, drive: { "--belt-ms": ms(belt), "--turn": `${turn}deg` } as CSSProperties, motor: { duration: belt / 1000 } }
}

const WAVES: readonly Wave[] = MANIFESTS.map(buildWave)
const ROLLERS = Array.from({ length: 30 }, (_, k) => 6 + k * 6)
function peelVars(parcel: Parcel): CSSProperties {
  const contact = contactX(parcel.bin)
  const [slotX, slotY] = slotCenter(parcel.bin, parcel.slot)
  const at = (x: number, y: number, z: number) => project(x - contact, y - LANE_Y, z - BELT_Z)
  const points = [at(contact - DIAG, LANE_Y + DIAG, BELT_Z), at(slotX, slotY, BASE.h + BIN.floor)]
  const [beltX, beltY] = project(contact - START_X, 0, 0)
  const vars: Record<string, string> = { "--bx": px(beltX), "--by": px(beltY), "--start": ms(parcel.start), "--run": ms((START_X - contact) / SPEED), "--contact": ms(parcel.contact), "--on": ms(parcel.landing) }
  points.forEach(([x, y], k) => {
    vars[`--x${k + 1}`] = px(x)
    vars[`--y${k + 1}`] = px(y)
  })
  if (parcel.until !== undefined) vars["--off"] = ms(parcel.until)
  return vars as CSSProperties
}

function ParcelBox({ x, y, z }: { x: number; y: number; z: number }) {
  return (
    <Box
      x={x - PARCEL.w / 2}
      y={y - PARCEL.d / 2}
      z={z}
      w={PARCEL.w}
      d={PARCEL.d}
      h={PARCEL.h}
      r={1.2}
      top={
        <>
          <path className="ik-detail" d={`M${PARCEL.w / 2} 0.8v${PARCEL.d - 1.6}`} />
          <rect className="ik-detail" x={2} y={2} width={4} height={3} rx={0.5} />
        </>
      }
      front={<path className="ik-detail" d={`M${PARCEL.w / 2} 0.8v${PARCEL.h - 1.6}`} />}
    />
  )
}

function Arm({ bin, swing }: { bin: number; swing: { open: number; shut: number } | undefined }) {
  const hinge = HINGES[bin] ?? 0
  return (
    <g transform={front(hinge, ARM.y, ARM.top)}>
      <g className={swing ? "cs-arm run" : "cs-arm"} style={swing ? ({ "--open": ms(swing.open), "--shut": ms(swing.shut) } as CSSProperties) : undefined}>
        <rect className="cs-paddle" width={ARM.length} height={ARM.height} rx={2} />
        <path className="ik-detail" d={`M5 ${ARM.height / 2}h${ARM.length - 10}`} />
      </g>
    </g>
  )
}

function Tally({ times }: { times: readonly number[] | undefined }) {
  const x = 0
  if (!times)
    return (
      <text className="ik-screen-text ik-dim" x={x} y={0} fontSize={7.5}>
        0
      </text>
    )
  return (
    <>
      {[0, ...times].map((on, k) => (
        <text
          key={on}
          className={k === times.length ? "ik-screen-text cs-shown" : "ik-screen-text cs-shown cs-passing"}
          x={x}
          y={0}
          fontSize={7.5}
          style={{ "--on": ms(on), "--off": ms(times[k] ?? 0) } as CSSProperties}
        >
          {k}
        </text>
      ))}
    </>
  )
}

type Timers = { current: number[] }
type Stops = { current: Array<() => void> }

function release(timers: Timers, stops: Stops) {
  for (const timer of timers.current) window.clearTimeout(timer)
  for (const stop of stops.current) stop()
  timers.current = []
  stops.current = []
}

export default function ConveyorSorter() {
  const [run, setRun] = useState(START)
  const timers = useRef<number[]>([])
  const stops = useRef<Array<() => void>>([])
  const clip = useId().replace(/:/g, "")
  useEffect(() => () => release(timers, stops), [])

  const { batch, prior, settled } = run
  const current = batch > 0 ? WAVES[batch - 1] : undefined
  const previous = prior > 0 ? WAVES[prior - 1] : undefined
  const later = (wait: number, step: () => void) => timers.current.push(window.setTimeout(step, wait))
  const sound = (name: SoundName, options?: SoundOptions) => stops.current.push(playSound(name, options))
  const sort = (audible: boolean) => {
    release(timers, stops)
    const next = (batch % WAVES.length) + 1
    const plan = WAVES[next - 1]
    if (!plan) return
    if (audible) {
      sound("motor", plan.motor)
      for (const at of plan.relays) later(at, () => sound("relay"))
      sound("cascade", { count: plan.parcels.length, stagger: STEP_MS / 1000, delay: plan.first / 1000 })
    }
    later(plan.last, () => {
      setRun((now) => ({ ...now, settled: true }))
      if (audible) sound("complete")
    })
    setRun({ batch: next, prior: batch, settled: false })
  }
  const demo = useDemoTap(() => {
    if (batch === 0) sort(false)
  }, { delay: 1100 })
  const press = () => {
    demo.dismiss()
    sort(true)
  }

  const aiming = demo.phase === "aim" || demo.phase === "press"
  const running = current !== undefined && !settled
  const readout = !current ? "ready · 6 parcels in" : settled ? `6 sorted · ${current.counts.join(" · ")}` : `sorting · batch ${batch}`

  return (
    <Plate
      {...demo.plate}
      fig="Logistics"
      name="Conveyor sorter"
      hint="Press sort"
      readout={readout}
      className="fig-conveyor-sorter"
      style={TIMING}
      fit={[BASE, { ...BED, z: 0, h: BEACON.z + BEACON.h }]}
      aspect={1.3}
      label="A parcel conveyor running out of a scan tunnel, with three diverter arms over three bins and a console. Press sort to send six parcels down the belt; each arm swings across in turn and peels its parcels off into its bin while the screen counts them."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={10}
          top={
            <>
              <circle className="ik-detail" cx={8} cy={BASE.d - 8} r={1.8} />
              <circle className="ik-detail" cx={BASE.w - 6} cy={6} r={1.8} />
            </>
          }
        />
        {LEG_YS.flatMap((y) => LEG_XS.map((x) => <Box key={`${x}-${y}`} x={x} y={y} z={BASE.h} w={5} d={5} h={BED.z - BASE.h} r={1.5} />))}
        <Box
          {...BED}
          r={3}
          top={ROLLERS.map((x) => (
                <path key={x} className="ik-detail" d={`M${x} ${RAIL.y + RAIL.d - BED.y + 0.8}V${BED.d - 1}`} />
              ))}
          front={
            <>
              <path className="ik-detail" d={`M6 3h${BED.w - 12}`} />
              {LEG_XS.map((x) => (
                <circle key={x} className="ik-fill" cx={x - BED.x + 2.5} cy={5.5} r={1} />
              ))}
            </>
          }
        />
        {HINGES.map((hinge) => (
          <Box key={hinge} x={hinge - 6} y={9.5} z={BELT_Z} w={12} d={6} h={12} r={2} top={<circle className="ik-detail" cx={6} cy={3} r={1.6} />} />
        ))}
        <Box {...RAIL} r={1} front={<path className="ik-detail" d={`M4 3h${RAIL.w - 8}`} />} />
        <g key={`arms-${batch}`}>
          {HINGES.map((hinge, bin) => (
            <g key={hinge}>
              <Arm bin={bin} swing={current?.arms[bin]} />
              <Box x={hinge - 2} y={ARM.y - 2} z={BELT_Z} w={4} d={4} h={ARM.top - BELT_Z + 3} r={2} />
            </g>
          ))}
        </g>
        {HINGES.map((hinge, bin) => {
          const x = binX(bin)
          return (
            <g key={hinge}>
              <Box x={x} y={BIN.y} z={BASE.h} w={BIN.w} d={BIN.d} h={BIN.floor} r={2} top={<rect className="ik-well" x={2} y={2} width={BIN.w - 4} height={BIN.d - 4} rx={1} />} />
              <Box x={x} y={BIN.y} z={BASE.h + BIN.floor} w={BIN.w} d={BIN.wall} h={BIN.h} r={0.6} />
              <Box x={x} y={BIN.y + BIN.wall} z={BASE.h + BIN.floor} w={BIN.wall} d={BIN.d - 2 * BIN.wall} h={BIN.h} r={0.6} />
            </g>
          )
        })}

        {previous ? (
          <g key={`left-${batch}`} className="cs-leaving">
            {previous.parcels.map((parcel) => {
              const [x, y] = slotCenter(parcel.bin, parcel.slot)
              return <ParcelBox key={`${parcel.bin}-${parcel.slot}`} x={x} y={y} z={BASE.h + BIN.floor} />
            })}
          </g>
        ) : null}
        {current ? (
          <g key={`wave-${batch}`}>
            {current.parcels.map((parcel) => (
              <g key={`${parcel.bin}-${parcel.slot}`} className="cs-belt" style={peelVars(parcel)}>
                <g className="cs-peel">
                  <g className={parcel.until === undefined ? "cs-parcel cs-last" : "cs-parcel"}>
                    <ParcelBox x={START_X} y={LANE_Y} z={BELT_Z} />
                  </g>
                </g>
              </g>
            ))}
          </g>
        ) : null}

        <Box
          {...TUNNEL}
          r={3}
          top={
            <>
              <rect className="ik-detail" x={4} y={4} width={TUNNEL.w - 8} height={TUNNEL.d - 8} rx={2} />
              {[0, 1, 2, 3].map((k) => (
                <path key={k} className="ik-detail" d={`M8 ${24 + k * 2.4}h8`} />
              ))}
            </>
          }
          front={
            <>
              <rect className="ik-well" x={4} y={5} width={22} height={4} rx={1} />
              <path className="ik-detail" d="M6 7h18" />
              <text className="ik-label cs-tag" x={4} y={16.5}>
                SCAN
              </text>
            </>
          }
          side={Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${8 + k * 3.4} 5v12`} />
              ))}
        />
        <Box
          {...BEACON}
          r={3}
          top={
            <Glow on={running}>
              <circle className="cs-lamp" data-on={running} cx={BEACON.w / 2} cy={BEACON.d / 2} r={1.8} />
            </Glow>
          }
        />
        <Box
          {...DRIVE}
          r={1.5}
          top={<rect className="ik-detail" x={2} y={4} width={DRIVE.w - 4} height={5} rx={0.6} />}
          front={<path className="ik-detail" d="M2 3v8M4 3v8M6 3v8" />}
          side={
            <g transform={`translate(${PULLEY.cx} ${PULLEY.cy})`}>
              <circle className="ik-well" r={PULLEY.r + 0.9} />
              <g key={`drive-${batch}`} className={current ? "cs-pulley run" : "cs-pulley"} style={current?.drive}>
                <circle className="ik-detail" r={PULLEY.r} />
                <path className="ik-detail" d={PULLEY_SPOKES} />
              </g>
              <circle className="ik-fill" r={1} />
            </g>
          }
        />

        {HINGES.map((hinge, bin) => {
          const x = binX(bin)
          return (
            <g key={hinge}>
              <Box x={x + BIN.w - BIN.wall} y={BIN.y + BIN.wall} z={BASE.h + BIN.floor} w={BIN.wall} d={BIN.d - 2 * BIN.wall} h={BIN.h} r={0.6} />
              <Box
                x={x}
                y={BIN.y + BIN.d - BIN.wall}
                z={BASE.h + BIN.floor}
                w={BIN.w}
                d={BIN.wall}
                h={BIN.h}
                r={0.6}
                front={
                  <>
                    <rect className="ik-well" x={BIN.w / 2 - 5} y={1.5} width={10} height={5} rx={1} />
                    <text className="ik-label cs-bin" x={BIN.w / 2} y={5.6} textAnchor="middle">
                      {bin + 1}
                    </text>
                  </>
                }
              />
            </g>
          )
        })}

        <Box
          {...CONSOLE}
          r={4}
          front={
            <>
              <defs>
                <clipPath id={`${clip}-screen`}>
                  <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
                </clipPath>
              </defs>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
              <g clipPath={`url(#${clip}-screen)`} key={`screen-${batch}`}>
                <Glow>
                  {current ? (
                    <>
                      <text className="ik-screen-text ik-dim cs-shown cs-passing" x={SCREEN.x + 3} y={SCREEN.y + 6.5} fontSize={5.2} style={{ "--on": "0ms", "--off": ms(current.last) } as CSSProperties}>
                        sorting
                      </text>
                      <text className="ik-screen-text ik-dim cs-shown" x={SCREEN.x + 3} y={SCREEN.y + 6.5} fontSize={5.2} style={{ "--on": ms(current.last) } as CSSProperties}>
                        6 sorted
                      </text>
                    </>
                  ) : (
                    <text className="ik-screen-text ik-dim" x={SCREEN.x + 3} y={SCREEN.y + 6.5} fontSize={5.2}>
                      ready
                    </text>
                  )}
                  {[0, 1, 2].map((bin) => (
                    <g key={bin} transform={`translate(${SCREEN.x + 4 + bin * 9.5} ${SCREEN.y + 16})`}>
                      <Tally times={current?.tallies[bin]} />
                    </g>
                  ))}
                </Glow>
              </g>
              {Array.from({ length: 3 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M4 ${SCREEN.y + SCREEN.h + 2 + k * 2}h${CONSOLE.w - 8}`} />
              ))}
            </>
          }
          side={Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${8 + k * 3.4} 5v12`} />
              ))}
        />
        {batch || aiming ? null : <Ripple {...KEY} r={4} />}
        <Press label="Sort the next batch" material="rubber" onPress={press} data-hot={batch === 0}>
          <g>
            <Box
              {...KEY}
              r={4}
              top={
                <>
                  <text className="ik-label cs-key" x={5} y={9.8}>
                    SORT
                  </text>
                  <path className="ik-detail ik-thick cs-arrow" d="M0 0h7M4 -3l3 3-3 3" transform={`translate(${KEY.w - 10.5} ${KEY.d / 2})`} />
                </>
              }
            />
          </g>
        </Press>
        <Callout at={[HINGES[0], ARM.y, ARM.top + 3]} dx={10} dy={-22} label="diverter" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
