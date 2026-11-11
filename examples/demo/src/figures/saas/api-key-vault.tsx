import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, Flight, Glow, Plate, Press, playSound, project, Ripple, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./api-key-vault.css"

export const meta = {
  slug: "api-key-vault",
  title: "API key vault",
  industry: "saas",
  level: 3,
  blurb: "Press rotate: the dial ticks round, the old key card flies out, a new one drops into the slot, the catch latches it and the old key is revoked.",
  uses: ["Plate", "Box", "Press", "Flight", "Glow", "Ripple", "Cursor", "useDemoTap", "project", "Callout"],
  sounds: ["press", "release", "paper", "tick", "latch", "success"],
} satisfies FigureMeta

const BASE = { x: 0, y: 0, z: 0, w: 128, d: 124, h: 8 }
const VAULT = { x: 12, y: 10, z: BASE.h, w: 100, d: 68, h: 60 }
const CARD = { x: VAULT.x + 28, y: VAULT.y + 32, z: VAULT.z + VAULT.h, w: 44, d: 3, h: 30 }
const CATCH = { x: CARD.x + CARD.w + 1, y: CARD.y - 1, z: VAULT.z + VAULT.h, w: 6, d: CARD.d + 2, h: 2.5 }
const CATCH_TRAVEL = 5
const KEY = { x: 12, y: 94, z: BASE.h, w: 66, d: 22, h: 6 }
const OUT: Vec3 = [134, CARD.y - 14, BASE.h]
const DROP = 28
const OUT_MS = 600
const DROP_AT = 380
const DROP_MS = 360
const LAND_MS = DROP_AT + DROP_MS
const SEAT_MS = 120
const SHOWN_MS = LAND_MS + SEAT_MS
const REVOKE_MS = 360
const DETENTS = 3
const DETENT_MS = 70
const OUT_LIFT = 56
const DIAL = { x: 28, y: 44.5, r: 7.5 }
const KEYS = ["4f2a", "9c1e", "7b03", "e85d", "21fa"] as const
const SLOTS = [0, 1] as const
const TICKS = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6)
const SPOKES = [-90, 30, 150].map((deg) => (deg * Math.PI) / 180)
const RIVETS = [0, 1, 2, 3, 4]
const SPIN = "M4.5 0A4.5 4.5 0 1 1 1.39-4.28M.21-6.6L1.39-4.28L-.93-3.1"
const [OPEN_X, OPEN_Y] = project(CATCH_TRAVEL, 0, 0)
const PLATE_STYLE = {
  "--out": `${OUT_MS}ms`,
  "--land": `${LAND_MS}ms`,
  "--seat": `${SEAT_MS}ms`,
  "--revoke": `${REVOKE_MS}ms`,
  "--dial": `${DETENTS * DETENT_MS}ms`,
  "--open-x": `${OPEN_X.toFixed(3)}px`,
  "--open-y": `${OPEN_Y.toFixed(3)}px`,
} as CSSProperties

const keyAt = (gen: number) => KEYS[((gen % KEYS.length) + KEYS.length) % KEYS.length] ?? KEYS[0]
const masked = (key: string) => `sk_live_••••${key}`
const held = (gen: number, slot: number) => (gen % 2 === slot ? gen : gen - 1)
const point = (a: number, r: number) => `${DIAL.x + Math.cos(a) * r} ${DIAL.y + Math.sin(a) * r}`

function Card({ z, suffix }: { z: number; suffix: string }) {
  return (
    <Box
      {...CARD}
      z={z}
      r={1.2}
      front={
        <>
          <rect className="ik-well" x={5} y={5} width={9} height={7} rx={1.2} />
          <path className="ik-detail" d="M5 8.5h9M9.5 5v7" />
          <text className="ik-label card-tag" x={39} y={10} textAnchor="end">
            LIVE
          </text>
          <circle className="ik-detail" cx={8} cy={21} r={2.6} />
          <path className="ik-detail" d="M10.6 21h7.4M15 21v2.4M18 21v3" />
          <text className="ik-label suffix" x={39} y={25} textAnchor="end">
            {suffix}
          </text>
        </>
      }
    />
  )
}

type Pending = { timers: { current: number[] }; stops: { current: Array<() => void> } }

function release(timers: Pending["timers"], stops: Pending["stops"]) {
  for (const timer of timers.current) window.clearTimeout(timer)
  for (const stop of stops.current) stop()
  timers.current = []
  stops.current = []
}

export default function ApiKeyVault() {
  const [gen, setGen] = useState(0)
  const [touched, setTouched] = useState(false)
  const stops = useRef<Array<() => void>>([])
  const timers = useRef<number[]>([])
  useEffect(() => () => release(timers, stops), [])

  const later = (wait: number, step: () => void) => timers.current.push(window.setTimeout(step, wait))
  const rotate = (audible: boolean) => {
    release(timers, stops)
    if (audible) {
      stops.current.push(playSound("paper"))
      for (let detent = 1; detent <= DETENTS; detent++) later(detent * DETENT_MS, () => stops.current.push(playSound("tick")))
      later(LAND_MS, () => stops.current.push(playSound("latch")))
      later(SHOWN_MS, () => stops.current.push(playSound("success")))
    }
    setGen(gen + 1)
  }
  const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(
    () => {
      if (gen === 0) rotate(false)
    },
    { delay: 600 },
  )
  const press = () => {
    dismiss()
    setTouched(true)
    rotate(true)
  }

  const key = keyAt(gen)
  const fresh = gen === 0

  return (
    <Plate
      {...plate}
      fig="SaaS"
      name="API key vault"
      hint={fresh ? "Press rotate" : "Rotate again"}
      readout={fresh ? `1 live key · ${key}` : `rotated · 2 keys → 1 · ${key}`}
      className="fig-api-key-vault"
      style={PLATE_STYLE}
      data-fresh={fresh}
      fit={[
        BASE,
        VAULT,
        { ...CARD, z: CARD.z + DROP },
        { ...CARD, x: CARD.x + 54, z: CARD.z + 33 },
        { ...CARD, x: OUT[0], y: OUT[1], z: OUT[2] },
      ]}
      aspect={1.3}
      label="An API key vault with the live key on its screen, a combination dial, and a key card held in the slot on its lid by a catch. Press rotate to swap in a new key card and revoke the old key."
    >
      <g ref={demoAnchor}>
        <Box {...BASE} r={10} />
        <Box
          {...VAULT}
          r={6}
          top={
            <>
              <rect className="ik-detail" x={6} y={6} width={VAULT.w - 12} height={VAULT.d - 12} rx={5} />
              {[
                [12, 12],
                [VAULT.w - 12, 12],
                [12, VAULT.d - 12],
                [VAULT.w - 12, VAULT.d - 12],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.4} />
              ))}
              <rect className="ik-well" x={CARD.x - VAULT.x - 3} y={CARD.y - VAULT.y - 2} width={CARD.w + 6} height={CARD.d + 4} rx={1.5} />
              <rect className="ik-well" x={CATCH.x - VAULT.x - 1} y={CATCH.y - VAULT.y} width={CATCH.w + CATCH_TRAVEL + 2} height={CATCH.d} rx={1} />
            </>
          }
          front={
            <>
              <rect className="ik-detail" x={3.5} y={3.5} width={VAULT.w - 7} height={VAULT.h - 7} rx={4} />
              <rect className="ik-face" x={1.5} y={11} width={4} height={9} rx={1} />
              <rect className="ik-face" x={1.5} y={40} width={4} height={9} rx={1} />
              <rect className="ik-screen" x={11} y={9} width={78} height={22} rx={3} />
              <Glow>
                <rect className="pip" data-on="true" x={79} y={12.5} width={3} height={3} rx={0.6} />
              </Glow>
              <rect className="pip" x={84} y={12.5} width={3} height={3} rx={0.6} />
              {fresh ? null : (
                <g key={`pip-${gen}`} className="old-pip">
                  <Glow>
                    <rect className="pip" data-on="true" x={84} y={12.5} width={3} height={3} rx={0.6} />
                  </Glow>
                </g>
              )}
              <g key={gen}>
                <g className="ik-enter" style={{ animationDelay: fresh ? "0ms" : `${REVOKE_MS}ms` }}>
                  <text className="ik-screen-text ik-dim" x={16} y={17} fontSize={5.6}>
                    {fresh ? "1 live key" : "old key revoked"}
                  </text>
                </g>
                <g className="ik-enter" style={{ animationDelay: fresh ? "0ms" : `${SHOWN_MS}ms` }}>
                  <text className="ik-screen-text" x={16} y={27} fontSize={6.8}>
                    {masked(key)}
                  </text>
                </g>
              </g>
              <circle className="ik-face ik-top" cx={DIAL.x} cy={DIAL.y} r={DIAL.r} />
              {TICKS.map((a) => (
                <path key={a} className="ik-detail" d={`M${point(a, 5.3)}L${point(a, 6.6)}`} />
              ))}
              <g transform={`translate(${DIAL.x} ${DIAL.y})`}>
                <g className="dial" style={{ "--step": gen * DETENTS } as CSSProperties}>
                  <circle className="ik-detail" r={3.4} />
                  <path className="ik-line" d="M0-1.2V-4.6" />
                </g>
              </g>
              <path className="ik-fill" d="M28 35.4l1.6-2.6h-3.2z" />
              {SPOKES.map((a) => (
                <g key={a}>
                  <path className="ik-line" d={`M66 44.5L${66 + Math.cos(a) * 8.5} ${44.5 + Math.sin(a) * 8.5}`} />
                  <circle className="ik-fill" cx={66 + Math.cos(a) * 8.5} cy={44.5 + Math.sin(a) * 8.5} r={1.7} />
                </g>
              ))}
              <circle className="ik-face ik-top" cx={66} cy={44.5} r={2.8} />
              <path className="ik-detail" d="M86 40v9M89.5 40v9" />
            </>
          }
          side={
            <>
              {RIVETS.map((k) => (
                <g key={k}>
                  <circle className="ik-fill" cx={7 + k * 13.5} cy={6} r={1.3} />
                  <circle className="ik-fill" cx={7 + k * 13.5} cy={VAULT.h - 6} r={1.3} />
                </g>
              ))}
              <path className="ik-detail" d={`M6 ${VAULT.h / 2}h${VAULT.d - 12}`} />
            </>
          }
        />
        {SLOTS.map((slot) => {
          const g = held(gen, slot)
          const on = g === gen
          return (
            <g
              key={slot}
              className="card"
              data-on={g >= 0 && on}
              data-live={on && !fresh}
              style={{ "--t": `${on && !fresh ? LAND_MS : 0}ms` } as CSSProperties}
            >
              {g >= 0 ? <Card z={CARD.z} suffix={keyAt(g)} /> : null}
            </g>
          )
        })}
        <g key={`catch-${gen}`} className={fresh ? undefined : "catch"}>
          <Box {...CATCH} r={1} top={<path className="ik-detail" d={`M${CATCH.w - 2} 1v${CATCH.d - 2}`} />} />
        </g>
        {!touched && fresh && phase !== "aim" && phase !== "press" ? <Ripple {...KEY} r={6} /> : null}
        <Press label="Rotate the API key" material="metal" onPress={press} data-hot={fresh}>
          <g>
            <Box
              {...KEY}
              r={6}
              top={
                <>
                  <text className="ik-label key" x={8} y={13.6}>
                    ROTATE
                  </text>
                  <path className="ik-detail ik-thick spin" d={SPIN} transform={`translate(${KEY.w - 13} ${KEY.d / 2 + 0.5})`} />
                </>
              }
            />
          </g>
        </Press>
        {fresh ? null : (
          <g key={gen}>
            <Flight from={[CARD.x, CARD.y, CARD.z]} to={OUT} duration={OUT_MS} lift={OUT_LIFT}>
              <g className="gone">
                <Card z={CARD.z} suffix={keyAt(gen - 1)} />
              </g>
            </Flight>
            <Flight from={[CARD.x, CARD.y, CARD.z + DROP]} to={[CARD.x, CARD.y, CARD.z]} delay={DROP_AT} duration={DROP_MS} lift={0}>
              <Card z={CARD.z + DROP} suffix={key} />
            </Flight>
          </g>
        )}
        <Callout at={[CARD.x + CARD.w, CARD.y, CARD.z + CARD.h]} dx={18} dy={-12} label={`live · ${key}`} />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={phase} />
      </g>
    </Plate>
  )
}
