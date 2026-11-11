import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, Signal, top, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./cash-machine.css"

export const meta = {
  slug: "cash-machine",
  title: "Cash machine",
  industry: "fintech",
  level: 2,
  blurb: "Press withdraw: a signal runs down the cable to the vault, its wheel turns and the feeder motor runs three notes out of the cash slot.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path", "top", "Callout"],
  sounds: ["press", "release", "process", "paper", "motor"],
} satisfies FigureMeta

const BASE = { x: 0, y: 0, z: 0, w: 178, d: 126, h: 8 }
const VAULT = { x: 106, y: 8, z: BASE.h, w: 62, d: 54, h: 60 }
const GLAND = { x: VAULT.x + 8, y: VAULT.y + VAULT.d, z: BASE.h + 2, w: 8, d: 3, h: 6 }
const ATM = { x: 10, y: 50, z: BASE.h, w: 62, d: 44, h: 100 }
const HOOD = { x: ATM.x - 2, y: ATM.y - 2, z: ATM.z + ATM.h, w: ATM.w + 4, d: ATM.d + 4, h: 12 }
const PORT = { x: ATM.x + ATM.w, y: ATM.y + 26, z: 11, w: 3, d: 6, h: 6 }
const SHELF = { x: ATM.x, y: ATM.y + ATM.d, z: 54, w: ATM.w, d: 22, h: 6 }
const KEY = { x: ATM.x + 26, y: SHELF.y + 4, z: SHELF.z + SHELF.h, w: 34, d: 13, h: 4 }
const SCREEN = { x: 11, y: 8, w: 40, h: 28 }
const SLOT = { x: 12, y: 72, w: 38, h: 4 }
const NOTE = { x: ATM.x + 16, w: 30, len: 30 }
const NOTES = [
  { z: 33.4, out: 18, dx: 0 },
  { z: 34.7, out: 17, dx: 1.5 },
  { z: 36, out: 16, dx: 3 },
] as const
const WHEEL = { cx: 41, cy: 29, r: 10.5 }
const DIAL = { cx: 20, cy: 16, r: 6 }
const SPOKES = [-90, 30, 150].map((deg) => (deg * Math.PI) / 180)
const TICKS = Array.from({ length: 12 }, (_, k) => (k * Math.PI) / 6)
const CABLE = curve(
  [PORT.x + PORT.w, PORT.y + PORT.d / 2, PORT.z + PORT.h / 2],
  [PORT.x + 18, PORT.y + PORT.d / 2, BASE.h + 0.6],
  [GLAND.x + GLAND.w / 2, GLAND.y + 26, BASE.h + 0.6],
  [GLAND.x + GLAND.w / 2, GLAND.y + GLAND.d, GLAND.z + GLAND.h / 2],
  40,
)
const CABLE_MID = CABLE[Math.floor(CABLE.length / 2)] ?? [GLAND.x, GLAND.y, BASE.h]
const SIGNAL_AT = 120
const SIGNAL_MS = 520
const ARRIVE_MS = SIGNAL_AT + SIGNAL_MS
const NOTES_AT = ARRIVE_MS + 260
const NOTE_STAGGER_MS = 60
const FEED_MS = 600
const RUN_MS = (NOTES.length - 1) * NOTE_STAGGER_MS + FEED_MS
const LAND_MS = NOTES_AT + RUN_MS
const FEEDING = { "--feed": `${FEED_MS}ms` } as CSSProperties
const AMOUNT = 60
const OPENING = 1300
const CYCLE = 5

const euros = (value: number) => `€${value.toLocaleString("en-US")}`
const balanceAfter = (count: number) => OPENING - AMOUNT * count

export default function CashMachine() {
  const [count, setCount] = useState(0)
  const clip = useId().replace(/:/g, "")
  const stop = useRef(() => {})
  const stopMotor = useRef(() => {})
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
      stopMotor.current()
    },
    [],
  )

  const withdraw = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stop.current()
    stopMotor.current()
    if (audible) {
      stop.current = playSound("process")
      timer.current = window.setTimeout(() => {
        stop.current()
        stop.current = playSound("paper")
        stopMotor.current = playSound("motor", { duration: RUN_MS / 1000 })
      }, NOTES_AT)
    }
    setCount((count % CYCLE) + 1)
  }
  const demo = useDemoTap(
    () => {
      if (count === 0) withdraw(false)
    },
    { delay: 1100 },
  )
  const press = () => {
    demo.dismiss()
    withdraw(true)
  }

  const fresh = count === 0
  const before = balanceAfter(Math.max(0, count - 1))
  const after = balanceAfter(count)
  const readout = fresh ? `ready · balance ${euros(OPENING)}` : `${euros(AMOUNT)} · balance ${euros(after)}`

  return (
    <Plate
      {...demo.plate}
      fig="Fintech"
      name="Cash machine"
      hint={fresh ? "Press withdraw" : "Withdraw again"}
      readout={readout}
      className="fig-cash-machine"
      data-fresh={fresh}
      fit={[BASE, { ...ATM, z: 0, h: HOOD.z + HOOD.h }, HOOD, SHELF, VAULT]}
      aspect={1.3}
      style={FEEDING}
      label="A cash machine wired to a vault. Press withdraw: the request runs down the cable to the vault, its wheel turns, and the feeder runs sixty euros in notes out of the cash slot."
    >
      <g ref={demo.ref}>
        <defs>
          <clipPath id={clip}>
            <rect x={-4} y={0} width={NOTE.w + 12} height={40} />
          </clipPath>
        </defs>
        <Box {...BASE} r={10} top={<rect className="ik-detail" x={8} y={8} width={BASE.w - 16} height={BASE.d - 16} rx={6} />} />

        <Box
          {...VAULT}
          r={4}
          top={
            <>
              <rect className="ik-detail" x={5} y={5} width={VAULT.w - 10} height={VAULT.d - 10} rx={3} />
              {[
                [9, 9],
                [VAULT.w - 9, 9],
                [9, VAULT.d - 9],
                [VAULT.w - 9, VAULT.d - 9],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.3} />
              ))}
            </>
          }
          front={
            <>
              <rect className="ik-detail" x={9} y={4} width={VAULT.w - 13} height={VAULT.h - 12} rx={3} />
              <rect className="ik-face" x={6.5} y={10} width={4} height={8} rx={1} />
              <rect className="ik-face" x={6.5} y={32} width={4} height={8} rx={1} />
              <circle className="ik-face ik-top" cx={DIAL.cx} cy={DIAL.cy} r={DIAL.r} />
              {TICKS.map((a) => (
                <path key={a} className="ik-detail" d={`M${DIAL.cx + Math.cos(a) * 4.2} ${DIAL.cy + Math.sin(a) * 4.2}L${DIAL.cx + Math.cos(a) * 5.4} ${DIAL.cy + Math.sin(a) * 5.4}`} />
              ))}
              <circle className="ik-detail" cx={DIAL.cx} cy={DIAL.cy} r={2.4} />
              <path className="ik-fill" d={`M${DIAL.cx} ${DIAL.cy - DIAL.r - 1}l1.4-2.2h-2.8z`} />
              <circle className="ik-detail" cx={WHEEL.cx} cy={WHEEL.cy} r={WHEEL.r - 3} />
              <g transform={`translate(${WHEEL.cx} ${WHEEL.cy})`}>
                <g key={count} className="cm-wheel" data-turn={!fresh} style={{ "--t": `${ARRIVE_MS}ms` } as CSSProperties}>
                  {SPOKES.map((a) => (
                    <g key={a}>
                      <path className="ik-line" d={`M0 0L${Math.cos(a) * WHEEL.r} ${Math.sin(a) * WHEEL.r}`} />
                      <circle className="ik-face ik-top" cx={Math.cos(a) * WHEEL.r} cy={Math.sin(a) * WHEEL.r} r={1.8} />
                    </g>
                  ))}
                  <circle className="ik-face ik-top" r={2.8} />
                </g>
              </g>
              <path className="ik-detail" d={`M9 ${VAULT.h - 4.5}h${VAULT.w - 18}`} />
            </>
          }
          side={
            <>
              {Array.from({ length: 5 }, (_, k) => (
                <g key={k}>
                  <circle className="ik-fill" cx={7 + k * 9.5} cy={6} r={1.2} />
                  <circle className="ik-fill" cx={7 + k * 9.5} cy={VAULT.h - 6} r={1.2} />
                </g>
              ))}
              <path className="ik-detail" d={`M6 ${VAULT.h / 2}h${VAULT.d - 12}`} />
            </>
          }
        />
        <Box {...GLAND} r={1.5} />

        <Box
          {...ATM}
          r={4}
          top={<rect className="ik-detail" x={5} y={5} width={ATM.w - 10} height={ATM.d - 10} rx={3} />}
          front={
            <>
              <rect className="ik-well" x={SCREEN.x - 2} y={SCREEN.y - 3} width={SCREEN.w + 4} height={SCREEN.h + 6} rx={4} />
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
              {[0, 1, 2, 3].map((k) => (
                <g key={k}>
                  <rect className="ik-face" x={4.5} y={SCREEN.y + 2 + k * 7} width={3.6} height={4.5} rx={0.8} />
                  <rect className="ik-face" x={ATM.w - 8.1} y={SCREEN.y + 2 + k * 7} width={3.6} height={4.5} rx={0.8} />
                </g>
              ))}
              <Glow>
                <g key={`small-${count}`}>
                  {fresh ? (
                    <text className="ik-screen-text ik-dim" x={SCREEN.x + 4} y={SCREEN.y + 8} fontSize={5.6}>
                      fast cash
                    </text>
                  ) : (
                    <>
                      <text className="ik-screen-text ik-dim cm-shown cm-passing" x={SCREEN.x + 4} y={SCREEN.y + 8} fontSize={5.6} style={{ "--on": "0ms", "--off": `${NOTES_AT}ms` } as CSSProperties}>
                        checking
                      </text>
                      <text className="ik-screen-text ik-dim cm-shown" x={SCREEN.x + 4} y={SCREEN.y + 8} fontSize={5.6} style={{ "--on": `${NOTES_AT}ms` } as CSSProperties}>
                        take cash
                      </text>
                    </>
                  )}
                </g>
                <g key={`big-${count}`} className="ik-enter">
                  <text className="ik-screen-text" x={SCREEN.x + 4} y={SCREEN.y + 18.5} fontSize={9}>
                    {euros(AMOUNT)}
                  </text>
                </g>
                <g key={`balance-${count}`}>
                  {fresh ? (
                    <text className="ik-screen-text ik-dim" x={SCREEN.x + 4} y={SCREEN.y + 25} fontSize={5.6}>
                      bal {euros(OPENING)}
                    </text>
                  ) : (
                    <>
                      <text className="ik-screen-text ik-dim cm-shown cm-passing" x={SCREEN.x + 4} y={SCREEN.y + 25} fontSize={5.6} style={{ "--on": "0ms", "--off": `${ARRIVE_MS}ms` } as CSSProperties}>
                        bal {euros(before)}
                      </text>
                      <text className="ik-screen-text ik-dim cm-shown" x={SCREEN.x + 4} y={SCREEN.y + 25} fontSize={5.6} style={{ "--on": `${ARRIVE_MS}ms` } as CSSProperties}>
                        bal {euros(after)}
                      </text>
                    </>
                  )}
                </g>
              </Glow>
              <rect className="ik-detail" x={36} y={40} width={20} height={4.5} rx={1.5} />
              <rect className="ik-well" x={39} y={41.6} width={14} height={1.4} rx={0.7} />
              <rect className="ik-detail" x={SLOT.x - 4} y={SLOT.y - 5} width={SLOT.w + 8} height={SLOT.h + 10} rx={3} />
              <rect className="ik-well" x={SLOT.x} y={SLOT.y} width={SLOT.w} height={SLOT.h} rx={1.5} />
              <rect className="ik-well" x={ATM.w - 12} y={SLOT.y - 8} width={6} height={1.6} rx={0.8} />
              <path className="ik-detail" d={`M6 ${ATM.h - 8}h${ATM.w - 12}`} />
            </>
          }
          side={
            <>
              {Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${10 + k * 3.4} 10v18`} />
              ))}
              <circle className="ik-well" cx={32} cy={40} r={2.4} />
              <path className="ik-detail" d={`M6 ${ATM.h - 8}h${ATM.d - 12}`} />
            </>
          }
        />
        <Box {...PORT} r={1} />
        <Box
          {...HOOD}
          r={5}
          top={<rect className="ik-detail" x={5} y={5} width={HOOD.w - 10} height={HOOD.d - 10} rx={3} />}
          front={
            <>
              <text className="ik-label cm-hood" x={HOOD.w / 2 - 12} y={8.6}>
                CASH
              </text>
              <rect className="ik-detail" x={5} y={3.5} width={10} height={5.5} rx={1} />
              <circle className="ik-detail" cx={10} cy={6.25} r={1.6} />
            </>
          }
        />

        <path className="ik-line" d={path(CABLE)} />
        {fresh ? null : (
          <Glow key={`signal-${count}`}>
            <Signal points={CABLE} delay={SIGNAL_AT} duration={SIGNAL_MS} />
          </Glow>
        )}

        {fresh ? null : (
          <g key={`notes-${count}`}>
            {NOTES.map((note, k) => (
              <g key={note.z} transform={top(NOTE.x + note.dx, ATM.y + ATM.d, note.z)} clipPath={`url(#${clip})`}>
                <g className="cm-note" style={{ "--t": `${NOTES_AT + k * NOTE_STAGGER_MS}ms`, "--in": `${-note.out - 1}px`, "--lit": `${LAND_MS}ms` } as CSSProperties}>
                  <rect className={k === NOTES.length - 1 ? "ik-face ik-top cm-lead" : "ik-face ik-top"} x={0} y={note.out - NOTE.len} width={NOTE.w} height={NOTE.len} rx={1.2} />
                  <rect className="ik-detail" x={2.5} y={note.out - NOTE.len + 2.5} width={NOTE.w - 5} height={NOTE.len - 5} rx={1} />
                  <circle className="ik-detail" cx={NOTE.w - 8} cy={note.out - 8} r={3.2} />
                  <text className="ik-label cm-note-value" x={5} y={note.out - 5}>
                    20
                  </text>
                </g>
              </g>
            ))}
          </g>
        )}

        <Box
          {...SHELF}
          r={3}
          top={Array.from({ length: 12 }, (_, k) => (
            <rect key={k} className="ik-detail" x={5 + (k % 3) * 7} y={3 + Math.floor(k / 3) * 4.2} width={5.2} height={3} rx={0.8} />
          ))}
          front={<path className="ik-detail" d={`M5 3h${SHELF.w - 10}`} />}
        />

        {fresh && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...KEY} r={3} /> : null}
        <Press label="Withdraw sixty euros" material="metal" onPress={press} data-hot={fresh}>
          <g>
            <Box
              {...KEY}
              r={3}
              top={
                <text className="ik-label cm-key" x={2.6} y={8.6}>
                  WITHDRAW
                </text>
              }
            />
          </g>
        </Press>
        <Callout at={CABLE_MID} dx={12} dy={16} label="host link" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
