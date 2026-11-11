import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, playSound, Ripple, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./feature-flags.css"

export const meta = {
  slug: "feature-flags",
  title: "Feature flags",
  industry: "saas",
  level: 2,
  blurb: "Flip a flag: the switch slides, its relay clicks, its light comes on and the users it rolls out to light up on the screen.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "Callout"],
  sounds: ["press", "release", "relay"],
} satisfies FigureMeta

type Flag = { id: string; label: string; pct: number; y: number }
type Last = { flag: number; on: boolean }

const BASE = { x: 0, y: 0, z: 0, w: 170, d: 118, h: 8 }
const RISER = { x: 0, y: 0, z: BASE.h, w: 170, d: 30, h: 50 }
const SLOT = { x: 44, w: 80, d: 4 }
const KNOB = { x: SLOT.x + 2, z: BASE.h, w: 24, d: 12, h: 7 }
const TRAVEL = SLOT.w - KNOB.w - 4
const SLIDE = `translate(${(TRAVEL * Math.cos(Math.PI / 6)).toFixed(3)}px, ${(TRAVEL * Math.sin(Math.PI / 6)).toFixed(3)}px)`
const ARM = { x: SLOT.x + SLOT.w + 3, length: 6.5 }
const CONTACT_X = ARM.x + ARM.length + 1.2
const LIGHT_X = 140
const RELAY_MS = 240
const FIRST: Flag = { id: "new-ui", label: "NEW-UI", pct: 50, y: 46 }
const NEAREST: Flag = { id: "dark", label: "DARK", pct: 75, y: 90 }
const FLAGS: readonly Flag[] = [FIRST, { id: "beta", label: "BETA", pct: 25, y: 68 }, NEAREST]
const COLS = 8
const ROWS = 3
const USERS = Array.from({ length: COLS * ROWS }, (_, i) => ({ i, c: i % COLS, r: Math.floor(i / COLS) }))
const SCREEN = { x: 8, y: 7, w: 118, h: 34 }
const PLATE_STYLE = { "--relay": `${RELAY_MS}ms` } as CSSProperties

const share = (flag: Flag) => Math.round((USERS.length * flag.pct) / 100)
const reaches = (f: number, flag: Flag, i: number) => (i * 13 + f * 7) % USERS.length < share(flag)

function readoutOf(last: Last | null, flag: Flag | undefined): string {
  if (!last || !flag) return "3 flags · all off"
  return last.on ? `${flag.id} · on · ${flag.pct}% of users` : `${flag.id} · off · 0% of users`
}

export default function FeatureFlags() {
  const [on, setOn] = useState<readonly boolean[]>([false, false, false])
  const [last, setLast] = useState<Last | null>(null)
  const [touched, setTouched] = useState(false)
  const relayAt = useRef(0)
  const stopRelay = useRef(() => {})
  useEffect(
    () => () => {
      window.clearTimeout(relayAt.current)
      stopRelay.current()
    },
    [],
  )

  const toggle = (f: number, audible: boolean) => {
    const next = on.map((value, i) => (i === f ? !value : value))
    window.clearTimeout(relayAt.current)
    stopRelay.current()
    if (audible)
      relayAt.current = window.setTimeout(() => {
        stopRelay.current = playSound("relay")
      }, RELAY_MS)
    setOn(next)
    setLast({ flag: f, on: next[f] ?? false })
  }
  const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(
    () => {
      if (!on[0]) toggle(0, false)
    },
    { delay: 1100 },
  )
  const press = (f: number) => {
    dismiss()
    setTouched(true)
    toggle(f, true)
  }

  const shown = last ? FLAGS[last.flag] : undefined
  const lit = (i: number) => last?.on === true && shown !== undefined && reaches(last.flag, shown, i)
  const count = USERS.filter((u) => lit(u.i)).length

  return (
    <Plate
      {...plate}
      fig="SaaS"
      name="Feature flags"
      hint="Flip a switch"
      readout={readoutOf(last, shown)}
      className="fig-feature-flags"
      style={PLATE_STYLE}
      fit={[BASE, { ...RISER, z: 0, h: RISER.z + RISER.h }]}
      aspect={1.3}
      label="A feature-flag panel with three slide switches, new UI, beta and dark, each wired through a relay to a light, and a screen of users. Flip a switch to turn its flag on and see the share of users it rolls out to."
    >
      <g ref={demoAnchor}>
        <Box
          {...BASE}
          r={10}
          top={
            <>
              {FLAGS.map((flag, f) => {
                const mid = flag.y + KNOB.d / 2
                return (
                  <g key={flag.id}>
                    <text className="ik-label ff-name" x={10} y={mid + 2.3}>
                      {flag.label}
                    </text>
                    <rect className="ik-well" x={SLOT.x} y={flag.y + (KNOB.d - SLOT.d) / 2} width={SLOT.w} height={SLOT.d} rx={SLOT.d / 2} />
                    <path className="ik-detail" d={`M${SLOT.x - 2.5} ${mid - 3.5}v7M${SLOT.x + SLOT.w + 0.5} ${mid - 3.5}v7`} />
                    <path className="ik-detail" d={`M${CONTACT_X} ${mid - 2.4}v4.8`} />
                    <g transform={`translate(${ARM.x} ${mid})`}>
                      <g className="ff-arm" data-on={on[f]}>
                        <path className="ik-line" d={`M0 0h${ARM.length}`} />
                      </g>
                      <circle className="ik-fill" r={1} />
                    </g>
                    <Glow on={on[f]} className="ff-lamp">
                      <circle className="ff-light" data-on={on[f]} data-last={last?.flag === f} cx={LIGHT_X} cy={mid} r={2.6} />
                    </Glow>
                    <text className="ik-label ff-pct" x={146} y={mid + 2}>
                      {flag.pct}%
                    </text>
                  </g>
                )
              })}
              {[
                [6, BASE.d - 6],
                [BASE.w - 6, BASE.d - 6],
              ].map(([x, y]) => (
                <circle key={`${x}-${y}`} className="ik-detail" cx={x} cy={y} r={1.8} />
              ))}
            </>
          }
        />
        <Box
          {...RISER}
          r={8}
          top={
            <>
              <path className="ik-detail" d={`M8 ${RISER.d - 7}h${RISER.w - 16}`} />
              <circle className="ik-detail" cx={8} cy={8} r={1.8} />
              <circle className="ik-detail" cx={RISER.w - 8} cy={8} r={1.8} />
            </>
          }
          front={
            <>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={4} />
              <g key={last ? `${last.flag}-${last.on}` : "rest"} className="ik-enter">
                <text className="ik-screen-text ik-dim" x={14} y={15.5} fontSize={5.6}>
                  {shown && last ? `${shown.id} · ${last.on ? "on" : "off"}` : "no flags on"}
                </text>
                <text className="ik-screen-text" x={14} y={30} fontSize={11}>
                  {last?.on && shown ? shown.pct : 0}%
                </text>
                <text className="ik-screen-text ik-dim" x={14} y={37.6} fontSize={5.6}>
                  {count} of {USERS.length} users
                </text>
              </g>
              {USERS.map((u) => (
                <Glow key={u.i} on={lit(u.i)}>
                  <circle className="ff-user" data-on={lit(u.i)} cx={70 + u.c * 7} cy={16 + u.r * 8.5} r={2} style={{ "--i": u.c + u.r } as CSSProperties} />
                </Glow>
              ))}
              <text className="ik-label ff-tag" x={134} y={14}>
                FLAGS
              </text>
              <circle className="ff-power" cx={156} cy={12} r={1.8} />
              {Array.from({ length: 8 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${135 + k * 3.4} 22v16`} />
              ))}
            </>
          }
          side={Array.from({ length: 5 }, (_, k) => <path key={k} className="ik-detail" d={`M${6 + k * 3.4} 12v26`} />)}
        />

        {FLAGS.map((flag, f) => (
          <g key={flag.id}>
            {f === 0 && !touched && last === null && phase !== "aim" && phase !== "press" ? <Ripple x={KNOB.x} y={flag.y} z={KNOB.z} w={KNOB.w} d={KNOB.d} r={3} /> : null}
            <g className="ff-slide" data-on={on[f]} style={on[f] ? { transform: SLIDE } : undefined}>
              <Press
                label={`Turn ${flag.id} ${on[f] ? "off" : "on"}`}
                material="plastic"
                onPress={() => press(f)}
                data-hot={last === null ? f === 0 : last.flag === f && !last.on}
              >
                <g>
                  <Box
                    x={KNOB.x}
                    y={flag.y}
                    z={KNOB.z}
                    w={KNOB.w}
                    d={KNOB.d}
                    h={KNOB.h}
                    r={3}
                    top={<path className="ik-detail" d="M8 3v6M12 3v6M16 3v6" />}
                    front={<path className="ik-detail" d={`M4 2.5h${KNOB.w - 8}`} />}
                  />
                </g>
              </Press>
            </g>
          </g>
        ))}

        <Callout at={[ARM.x + 3, NEAREST.y + KNOB.d / 2, BASE.h]} dx={10} dy={44} label="relay" />
        <Cursor at={[KNOB.x + KNOB.w / 2, FIRST.y + KNOB.d / 2, KNOB.z + KNOB.h]} phase={phase} />
      </g>
    </Plate>
  )
}
