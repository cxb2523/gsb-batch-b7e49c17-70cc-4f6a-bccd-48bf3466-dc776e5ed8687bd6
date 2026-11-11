import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, front, Glow, Plate, Press, path, playSound, project, Ripple, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./vending-machine.css"

export const meta = {
  slug: "vending-machine",
  title: "Vending machine",
  industry: "retail",
  level: 3,
  blurb: "Press B2: the motor turns the coil, the cans step forward, the front one falls into the tray with a thunk and the tray light comes on.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "path", "project", "front", "Callout"],
  sounds: ["press", "release", "motor", "latch", "complete", "whoosh"],
} satisfies FigureMeta

type Run = 0 | 1 | 2 | 3 | 4
type Kind = "bag" | "can" | "bottle"
type Coil = { near: string; far: string }
type Row = { id: string; z: number; kind: Kind; coils: readonly Coil[] }

const BASE = { x: 0, y: 0, z: 0, w: 150, d: 98, h: 6 }
const MX = 10
const MY = 10
const W = 132
const D = 60
const BEZEL = 3
const FRONT_Y = MY + D
const PLINTH = { x: MX, y: MY, z: BASE.h, w: W, d: D, h: 28 }
const FLOOR = PLINTH.z + PLINTH.h
const WINDOW = { left: MX + 20, right: MX + 92, bottom: FLOOR + 12, top: FLOOR + 96 }
const INNER = { x: MX + 4, w: WINDOW.right - MX - 4 }
const LEFT = { x: MX, y: MY, z: FLOOR, w: 4, d: D - BEZEL, h: WINDOW.top - FLOOR }
const BACK = { x: INNER.x, y: MY, z: FLOOR, w: INNER.w, d: 3, h: WINDOW.top - FLOOR }
const FRAME_LEFT = { x: MX, y: FRONT_Y - BEZEL, z: FLOOR, w: WINDOW.left - MX, d: BEZEL, h: WINDOW.top - FLOOR }
const FRAME_FOOT = { x: WINDOW.left, y: FRONT_Y - BEZEL, z: FLOOR, w: WINDOW.right - WINDOW.left, d: BEZEL, h: WINDOW.bottom - FLOOR }
const COLUMN = { x: WINDOW.right, y: MY, z: FLOOR, w: MX + W - WINDOW.right, d: D, h: WINDOW.top - FLOOR }
const HEADER = { x: MX, y: MY, z: WINDOW.top, w: W, d: D, h: 12 }
const LEDGE = { x: COLUMN.x + 2, y: FRONT_Y, z: WINDOW.bottom - 4, w: 36, d: 22, h: 6 }
const SHELF = { y: MY + 3, d: 43, h: 2 }
const ROW_PITCH = 26
const COLS = [INNER.x + 11, INNER.x + 33, INNER.x + 55] as const
const RADIUS = 7
const PITCH = 14
const TURNS = 3
const COIL_Y0 = SHELF.y + 1
const SAMPLES = 72
const SPOTS = [0, 1, 2].map((k) => COIL_Y0 + PITCH * (TURNS - 0.5 - k))
const BACK_TO_FRONT = [...SPOTS].reverse()
const EDGE_Y = FRONT_Y - BEZEL - 6
const SEEN = FRONT_Y - SPOTS[0]!
const CAN = { w: 11, h: 16 }
const BIN = { x: 22, y: 6, w: 48, h: 19 }
const BIN_FLOOR = FLOOR - BIN.y - BIN.h + 0.5
const FRAMES = 8
const TURN_MS = 600
const DROP_MS = 1040
const LAND_MS = Math.round(DROP_MS * 0.92)
const SENSE_MS = 140
const LIT_MS = LAND_MS + SENSE_MS
const TIMING = { "--turn": `${TURN_MS}ms`, "--lit": `${LIT_MS}ms` } as CSSProperties
const KEY = { w: 9.6, d: 5.4, h: 2.2 }
const KEY_ROWS = ["A", "B", "C"] as const
const KEYS = KEY_ROWS.flatMap((row, r) => [1, 2, 3].map((n, c) => ({ id: `${row}${n}`, x: LEDGE.x + 2.4 + c * 11, y: LEDGE.y + 2.4 + r * 6.6, z: LEDGE.z + LEDGE.h, ...KEY })))
const B2 = KEYS[4]!
const NEXT: Readonly<Record<Run, Run>> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 1 }
const STOCK: Readonly<Record<Run, number>> = { 0: 3, 1: 2, 2: 1, 3: 0, 4: 3 }

function coilOf(cx: number, zc: number, phase: number): Coil {
  let near = ""
  let far = ""
  let run: Vec3[] = []
  let runNear = Math.cos(phase) + Math.sin(phase) > 0
  for (let k = 0; k <= SAMPLES; k++) {
    const t = (k / SAMPLES) * TURNS * 2 * Math.PI
    const a = t + phase
    const point: Vec3 = [cx + RADIUS * Math.cos(a), COIL_Y0 + (PITCH * t) / (2 * Math.PI), zc + RADIUS * Math.sin(a)]
    const isNear = Math.cos(a) + Math.sin(a) > 0
    run.push(point)
    if (isNear !== runNear) {
      if (runNear) near += path(run)
      else far += path(run)
      run = [point]
      runNear = isNear
    }
  }
  if (runNear) near += path(run)
  else far += path(run)
  return { near, far }
}

const axisOf = (z: number) => z + SHELF.h + RADIUS + 0.5
const ROW_KINDS: ReadonlyArray<{ id: string; kind: Kind }> = [
  { id: "C", kind: "bag" },
  { id: "B", kind: "can" },
  { id: "A", kind: "bottle" },
]
const ROWS: readonly Row[] = ROW_KINDS.map((row, r) => {
  const z = FLOOR + r * ROW_PITCH
  return { ...row, z, coils: COLS.map((cx) => coilOf(cx, axisOf(z), 0)) }
})
const ROW_B = ROWS[1]!
const B2_X = COLS[1]
const B2_Z = ROW_B.z + SHELF.h
const B2_FRAMES = Array.from({ length: FRAMES - 1 }, (_, k) => coilOf(B2_X, axisOf(ROW_B.z), (-2 * Math.PI * (k + 1)) / FRAMES))

const offset = (from: Vec3, to: Vec3) => {
  const [ax, ay] = project(...from)
  const [bx, by] = project(...to)
  return { x: `${(bx - ax).toFixed(2)}px`, y: `${(by - ay).toFixed(2)}px` }
}
const STEP_BACK = offset([0, SPOTS[0]!, 0], [0, SPOTS[1]!, 0])
const TO_EDGE = offset([0, SPOTS[0]!, B2_Z], [0, EDGE_Y, B2_Z])
const TO_TRAY = offset([0, SPOTS[0]!, B2_Z], [0, EDGE_Y, BIN_FLOOR])
const TO_BOUNCE = offset([0, SPOTS[0]!, B2_Z], [0, EDGE_Y, BIN_FLOOR + 2])
const DROP_STYLE = { "--ex": TO_EDGE.x, "--ey": TO_EDGE.y, "--fy": TO_TRAY.y, "--by": TO_BOUNCE.y, "--d": `${DROP_MS}ms` } as CSSProperties
const FRAME_MS = TURN_MS / FRAMES
const PIPS = [0, TURN_MS, LAND_MS] as const
const PIP_TIMING = new Map(PIPS.map((at) => [at, { "--t": `${at}ms` } as CSSProperties]))
const COIL_AT = [B2_X + RADIUS, COIL_Y0 + PITCH * 2, axisOf(ROW_B.z)] as const

function Product({ kind, cx, cy, z }: { kind: Kind; cx: number; cy: number; z: number }): ReactNode {
  if (kind === "bag") {
    return (
      <Box
        x={cx - 7.5}
        y={cy - 2}
        z={z}
        w={15}
        d={4}
        h={17}
        r={1.5}
        front={
          <>
            <path className="ik-detail" d="M1.5 2.4h12" />
            <rect className="ik-detail" x={3.5} y={6.5} width={8} height={6} rx={2.5} />
          </>
        }
      />
    )
  }
  if (kind === "bottle") {
    return (
      <>
        <Box x={cx - 5} y={cy - 5} z={z} w={10} d={10} h={11} r={5} />
        <Box x={cx - 2.2} y={cy - 2.2} z={z + 11} w={4.4} d={4.4} h={4} r={2.2} />
        <Box x={cx - 2.7} y={cy - 2.7} z={z + 15} w={5.4} d={5.4} h={2.4} r={2.7} />
      </>
    )
  }
  return (
    <Box
      x={cx - CAN.w / 2}
      y={cy - CAN.w / 2}
      z={z}
      w={CAN.w}
      d={CAN.w}
      h={CAN.h}
      r={CAN.w / 2}
      top={
        <>
          <circle className="ik-detail" cx={CAN.w / 2} cy={CAN.w / 2} r={3.8} />
          <path className="ik-detail" d={`M${CAN.w / 2 - 1.6} 3.4h3.2`} />
        </>
      }
    />
  )
}

function readoutOf(run: Run): string {
  if (run === 0) return "B2 · €1.50 · 3 left"
  if (run === 4) return "B2 · restocked · 3 left"
  const left = STOCK[run]
  return `B2 · €1.50 · dispensed · ${left ? `${left} left` : "sold out"}`
}

export default function VendingMachine() {
  const [run, setRun] = useState<Run>(0)
  const stops = useRef<Array<() => void>>([])
  const timer = useRef(0)
  const clip = useId().replace(/:/g, "")
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      for (const stop of stops.current) stop()
    },
    [],
  )

  const act = (audible: boolean) => {
    const next = NEXT[run]
    window.clearTimeout(timer.current)
    for (const stop of stops.current) stop()
    stops.current = []
    if (audible && next === 4) stops.current.push(playSound("whoosh"))
    if (audible && next !== 4) {
      stops.current.push(playSound("motor", { duration: TURN_MS / 1000 }))
      timer.current = window.setTimeout(() => {
        stops.current.push(playSound("latch"))
        timer.current = window.setTimeout(() => {
          stops.current.push(playSound("complete"))
        }, SENSE_MS)
      }, LAND_MS)
    }
    setRun(next)
  }
  const demo = useDemoTap(
    () => {
      if (run === 0) act(false)
    },
    { delay: 1700 },
  )
  const press = () => {
    demo.dismiss()
    act(true)
  }

  const stock = STOCK[run]
  const vending = run >= 1 && run <= 3
  const restocked = run === 4
  const idle = run === 0 || restocked
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const after = restocked ? "loaded" : stock ? "thanks" : "empty"

  const b2Cans = Array.from({ length: stock }, (_, j) => {
    const k = stock - 1 - j
    const can = <Product kind="can" cx={B2_X} cy={SPOTS[k]!} z={B2_Z} />
    if (vending) {
      return (
        <g key={`${run}-${k}`} className="vm-advance" style={{ "--i": k + 1, "--px": STEP_BACK.x, "--py": STEP_BACK.y } as CSSProperties}>
          {can}
        </g>
      )
    }
    if (restocked) {
      return (
        <g key={`${run}-${k}`} className="vm-load" style={{ "--i": stock - 1 - k, "--px": STEP_BACK.x, "--py": STEP_BACK.y } as CSSProperties}>
          {can}
        </g>
      )
    }
    return <g key={`${run}-${k}`}>{can}</g>
  })
  const dropping = vending ? (
    <g key={`drop-${run}`} className="vm-drop" style={DROP_STYLE}>
      <Product kind="can" cx={B2_X} cy={SPOTS[0]!} z={B2_Z} />
    </g>
  ) : null

  const coilsOf = (row: Row, half: keyof Coil) =>
    row.coils.map((coil, c) => {
      const turning = vending && row === ROW_B && c === 1
      return (
        <g key={`${row.id}${c}-${half}-${turning ? run : "rest"}`} className={turning ? "vm-turning" : undefined} style={turning ? ({ "--f": `${TURN_MS - FRAME_MS}ms`, "--at": `${FRAME_MS}ms` } as CSSProperties) : undefined}>
          <path className={half === "near" ? "ik-line" : "ik-detail"} d={coil[half]} />
        </g>
      )
    })
  const framesOf = (half: keyof Coil) =>
    vending
      ? B2_FRAMES.map((coil, k) => (
          <g key={`${run}-${k}-${half}`} className="vm-frame" style={{ "--f": `${FRAME_MS}ms`, "--at": `${(k + 1) * FRAME_MS}ms` } as CSSProperties}>
            <path className={half === "near" ? "ik-line" : "ik-detail"} d={coil[half]} />
          </g>
        ))
      : null

  const rowOf = (row: Row) => (
    <g key={row.id}>
      <Box x={INNER.x} y={SHELF.y} z={row.z} w={INNER.w} d={SHELF.d} h={SHELF.h} r={1} />
      {coilsOf(row, "far")}
      {row === ROW_B ? framesOf("far") : null}
      {COLS.map((cx, c) =>
        row === ROW_B && c === 1 ? <g key={cx}>{b2Cans}</g> : <g key={cx}>{BACK_TO_FRONT.map((cy) => <Product key={cy} kind={row.kind} cx={cx} cy={cy} z={row.z + SHELF.h} />)}</g>,
      )}
      {coilsOf(row, "near")}
      {row === ROW_B ? framesOf("near") : null}
    </g>
  )

  return (
    <Plate
      {...demo.plate}
      fig="Retail"
      name="Vending machine"
      hint={run === 3 ? "Press B2 to restock" : idle ? "Press B2" : "Press B2 again"}
      readout={readoutOf(run)}
      className="fig-vending-machine"
      style={TIMING}
      fit={[BASE, { x: MX, y: MY, z: 0, w: W, d: D, h: HEADER.z + HEADER.h }, LEDGE]}
      aspect={0.86}
      label="A vending machine with a glass front over three rows of product coils, a screen, a keypad and a delivery tray. Press B2 to buy a can: the coil turns, the can drops into the tray and the tray light comes on."
    >
      <g ref={demo.ref}>
        <defs>
          <clipPath id={`${clip}-chute`}>
            <rect transform={front(0, FRONT_Y - BEZEL, FLOOR)} x={-60} y={-200} width={320} height={200} />
          </clipPath>
          <clipPath id={`${clip}-bin`}>
            <rect transform={front(MX, FRONT_Y, FLOOR)} x={BIN.x} y={BIN.y} width={BIN.w} height={BIN.h} rx={3} />
          </clipPath>
        </defs>
        <Box {...BASE} r={10} top={<rect className="ik-detail" x={6} y={6} width={BASE.w - 12} height={BASE.d - 12} rx={6} />} />
        <Box
          {...PLINTH}
          r={4}
          top={<rect className="ik-well" x={B2_X - MX - 8} y={SHELF.y + SHELF.d - MY} width={16} height={FRONT_Y - BEZEL - SHELF.y - SHELF.d} rx={2} />}
          front={
            <>
              <rect className="ik-well" x={BIN.x} y={BIN.y} width={BIN.w} height={BIN.h} rx={3} />
              <rect className="vm-tray" x={BIN.x + 8} y={2.6} width={BIN.w - 16} height={1.4} rx={0.7} />
              <Glow key={`tray-${run}`} on={vending} className="vm-tray-glow">
                <rect className="vm-tray-lit" data-on={vending} x={BIN.x + 8} y={2.6} width={BIN.w - 16} height={1.4} rx={0.7} />
              </Glow>
              <path className="ik-detail" d={`M${BIN.x + 3} ${BIN.y + 3}h${BIN.w - 6}`} />
              {Array.from({ length: 9 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${96 + k * 3.6} 9v12`} />
              ))}
            </>
          }
          side={Array.from({ length: 6 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${10 + k * 3.4} 8v14`} />
          ))}
        />
        <g clipPath={`url(#${clip}-bin)`}>{dropping}</g>

        <Box {...LEFT} r={1} />
        <Box {...BACK} r={1} />
        {rowOf(ROWS[0]!)}
        {rowOf(ROW_B)}
        <g clipPath={`url(#${clip}-chute)`}>{dropping}</g>
        {rowOf(ROWS[2]!)}

        <Box
          {...FRAME_LEFT}
          r={1}
          front={
            <>
              {ROWS.map((row) => (
                <text key={row.id} className="ik-label vm-axis" x={7} y={WINDOW.top - row.z - SEEN + 9}>
                  {row.id}
                </text>
              ))}
              <path className="ik-detail" d={`M3 8v${FRAME_LEFT.h - 16}`} />
            </>
          }
        />
        <Box
          {...FRAME_FOOT}
          r={1}
          front={COLS.map((cx, c) => (
            <text key={cx} className="ik-label vm-axis" x={cx + SEEN - WINDOW.left - 2} y={8.6}>
              {c + 1}
            </text>
          ))}
        />
        <g transform={front(WINDOW.left, FRONT_Y, WINDOW.top)}>
          <path className="ik-detail" d="M5 26L26 5M5 38L38 5" />
        </g>

        <Box
          {...COLUMN}
          r={2}
          front={
            <>
              <rect className="ik-screen" x={4} y={6} width={COLUMN.w - 8} height={24} rx={3} />
              <Glow>
                <g key={`small-${run}`} className="ik-enter">
                  <text className="ik-screen-text ik-dim" x={7.5} y={13.5} fontSize={5.6}>
                    B2 €1.50
                  </text>
                </g>
                <g key={`big-${run}`}>
                  {vending ? (
                    <>
                      <text className="ik-screen-text vm-shown vm-passing" x={7.5} y={22.6} fontSize={6.4} style={{ "--on": "0ms", "--off": `${LIT_MS}ms` } as CSSProperties}>
                        vending
                      </text>
                      <text className="ik-screen-text vm-shown" x={7.5} y={22.6} fontSize={6.4} style={{ "--on": `${LIT_MS}ms` } as CSSProperties}>
                        {after}
                      </text>
                    </>
                  ) : (
                    <g className="ik-enter">
                      <text className="ik-screen-text" x={7.5} y={22.6} fontSize={6.4}>
                        {restocked ? after : "ready"}
                      </text>
                    </g>
                  )}
                </g>
              </Glow>
              {PIPS.map((at, k) => (
                <g key={`${run}-${at}`} style={PIP_TIMING.get(at)}>
                  <Glow on={vending} className="vm-pip-glow">
                    <rect className="vm-pip" data-on={vending} x={7.5 + k * 6} y={25.4} width={4} height={1.8} rx={0.9} />
                  </Glow>
                </g>
              ))}
              <circle className="ik-detail" cx={11} cy={40} r={4.6} />
              <path className="ik-detail" d="M9.6 38.2a2.4 2.4 0 0 1 0 3.6M11.6 37a4 4 0 0 1 0 6" />
              <rect className="ik-well" x={25} y={35} width={3.4} height={10} rx={1.4} />
              <rect className="ik-well" x={7} y={54} width={COLUMN.w - 14} height={12} rx={2.5} />
              <text className="ik-label vm-tag" x={7.4} y={72}>
                RETURN
              </text>
            </>
          }
          side={
            <>
              <rect className="ik-detail" x={6} y={6} width={D - 12} height={COLUMN.h - 12} rx={3} />
              {Array.from({ length: 5 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M14 ${60 + k * 3.6}h${D - 28}`} />
              ))}
            </>
          }
        />
        <Box
          {...HEADER}
          r={4}
          top={<rect className="ik-detail" x={6} y={6} width={W - 12} height={D - 12} rx={3} />}
          front={
            <>
              <text className="ik-label vm-brand" x={8} y={8.4}>
                DRINKS · SNACKS
              </text>
              <circle className="ik-fill" cx={W - 8} cy={6} r={1.4} />
            </>
          }
          side={<path className="ik-detail" d={`M6 6h${D - 12}`} />}
        />

        <Box {...LEDGE} r={2.5} front={<path className="ik-detail" d={`M3 2h${LEDGE.w - 6}`} />} />
        {KEYS.map((key) =>
          key === B2 ? (
            <g key={key.id}>
              {run === 0 && !aiming ? <Ripple {...B2} r={1.6} /> : null}
              <Press label={run === 3 ? "Restock coil B2" : "Buy B2 for €1.50"} material="metal" onPress={press} data-hot={idle}>
                <g>
                  <Box
                    {...B2}
                    r={1.6}
                    top={
                      <text className="ik-label vm-key" x={2.2} y={4.3}>
                        B2
                      </text>
                    }
                  />
                </g>
              </Press>
            </g>
          ) : (
            <Box
              key={key.id}
              {...key}
              r={1.6}
              top={
                <text className="ik-label vm-key" x={2.2} y={4.3}>
                  {key.id}
                </text>
              }
            />
          ),
        )}
        <Callout at={COIL_AT} dx={-56} dy={-16} label="spiral coil" />
        <Cursor at={[B2.x + B2.w / 2, B2.y + B2.d / 2, B2.z + B2.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
