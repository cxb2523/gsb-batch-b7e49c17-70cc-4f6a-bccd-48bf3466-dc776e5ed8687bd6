import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, path, playSound, project, Ripple, useDemoTap, type Vec3 } from "react-isokit"
import { Dimension } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./vault-door.css"

export const meta = {
  slug: "vault-door",
  title: "Vault door",
  industry: "fintech",
  level: 3,
  blurb: "Press the wheel: it ticks through its detents, the five bolts draw back one after another and the round door swings open on its hinge. Press again and the bolts latch home.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "path", "project", "Dimension"],
  sounds: ["press", "release", "tick", "cascade", "complete", "whoosh", "latch"],
} satisfies FigureMeta

type Phase = "locked" | "open" | "shut"
type Motion = { phase: Phase; swingAt: number }

const BASE = { x: 0, y: 0, z: 0, w: 180, d: 132, h: 8 }
const WALL = { x: 6, y: 6, z: BASE.h, w: 168, d: 30, h: 112 }
const FACE_Y = WALL.y + WALL.d
const FACE_TOP = WALL.z + WALL.h
const R = 38
const PROUD = 4
const DOOR = { x: 70, z: 64 }
const OPENING = R + 2.5
const COLLAR = R + 13
const HINGE_GAP = 7
const HINGE = { x: DOOR.x + R + HINGE_GAP, y: FACE_Y + PROUD, z: DOOR.z + R }
const HINGE_AT = project(HINGE.x, HINGE.y, HINGE.z)
const SWING = 2 * R + HINGE_GAP
const CENTER = { x: -(R + HINGE_GAP), y: R }
const HOLE = { x: DOOR.x - WALL.x, y: FACE_TOP - DOOR.z }
const ROOM = { x: HOLE.x + WALL.d, y: HOLE.y - WALL.d }
const PIN = { x: HINGE.x - 2.5, y: HINGE.y - 2.5, z: DOOR.z - 33, w: 5, d: 5, h: 66 }
const KNUCKLES = [DOOR.z - 30, DOOR.z + 20].map((z) => ({ x: HINGE.x - 4.5, y: HINGE.y - 4.5, z, w: 9, d: 9, h: 10 }))
const STRAPS = KNUCKLES.map((knuckle) => HINGE.z - knuckle.z - knuckle.h / 2)
const STRAP_X = CENTER.x + R - 12
const TIMELOCK = { x: 126, y: FACE_Y, z: 62, w: 46, d: 5, h: 36 }
const SCREEN = { x: 4, y: 4, w: 38, h: 22 }
const WHEEL = { hub: 5, rimIn: 12, rimOut: 14.5, spoke: 19, knob: 2.6 }
const BOLT = { from: R - 14, len: 20, w: 6.4, travel: -8 }
const STAGGER_MS = 60
const BOLT_AT = 160
const BOLT_MS = 280
const BOLT_DEGS = [72, 126, 180, 234, 288] as const
const SWING_AT = BOLT_AT + (BOLT_DEGS.length - 1) * STAGGER_MS + BOLT_MS + 80
const SWING_MS = 900
const THROW_GAP_MS = 60
const THROW_RUN_MS = (BOLT_DEGS.length - 1) * STAGGER_MS + BOLT_MS
const WHEEL_MS = 640
const DETENTS = 3
const DETENT_MS = WHEEL_MS / DETENTS
const TICK_INTO_DETENT = 0.3
const TICKS_AT = Array.from({ length: DETENTS }, (_, i) => Math.round((i + TICK_INTO_DETENT) * DETENT_MS))
const LATCH_SEAT_MS = 70
const RATCHET = { inner: 7.2, outer: 10, from: 15, step: 30 }
const REST: Motion = { phase: "locked", swingAt: SWING_AT }
const r3 = (n: number) => Math.round(n * 1000) / 1000
const radians = (deg: number) => (deg * Math.PI) / 180
const share = (n: number) => Math.min(1, Math.max(0, n))
const BOLTS = BOLT_DEGS.map((deg, i) => {
  const back = BOLT_DEGS.length - 1 - i
  return {
    deg,
    timing: {
      "--draw": `${BOLT_AT + i * STAGGER_MS}ms`,
      "--drawn": `${BOLT_AT + i * STAGGER_MS + BOLT_MS}ms`,
      "--back": `${back * STAGGER_MS}ms`,
      "--travel": `${BOLT.travel}px`,
    } as CSSProperties,
  }
})
const SPOKES = [45, 135, 225, 315] as const
const RATCHET_TEETH = `${Array.from({ length: 360 / RATCHET.step }, (_, k) => {
  const a = radians(RATCHET.from + k * RATCHET.step)
  return `${k === 0 ? "M" : "L"}${r3(Math.cos(a) * RATCHET.inner)} ${r3(Math.sin(a) * RATCHET.inner)}L${r3(Math.cos(a) * RATCHET.outer)} ${r3(Math.sin(a) * RATCHET.outer)}`
}).join("")}Z`
const RIVETS = Array.from({ length: 24 }, (_, k) => k * 15).filter((deg) => BOLT_DEGS.every((bolt) => Math.abs(bolt - deg) > 10))
const BOXES = Array.from({ length: 42 }, (_, k) => ({ x: ROOM.x - 36 + (k % 6) * 12, y: ROOM.y - 32 + Math.floor(k / 6) * 9 }))
const ARC: Vec3[] = Array.from({ length: 19 }, (_, k) => {
  const a = radians(k * 5)
  return [HINGE.x - SWING * Math.cos(a), HINGE.y + SWING * Math.sin(a), BASE.h]
})
const ring = (r0: number, r1: number) => `M${r1} 0A${r1} ${r1} 0 1 0 ${-r1} 0A${r1} ${r1} 0 1 0 ${r1} 0ZM${r0} 0A${r0} ${r0} 0 1 1 ${-r0} 0A${r0} ${r0} 0 1 1 ${r0} 0Z`
const WHEEL_RIM = ring(WHEEL.rimIn, WHEEL.rimOut)
const COLLAR_RING = ring(OPENING, COLLAR)

function WheelBody({ depth }: { depth: boolean }) {
  const solid = depth ? "vd-rim" : "ik-face ik-top"
  return (
    <>
      {depth
        ? null
        : SPOKES.map((deg) => (
            <g key={deg} transform={`rotate(${deg})`}>
              <rect className="ik-face" x={WHEEL.hub - 1} y={-1.3} width={WHEEL.spoke - WHEEL.hub + 1} height={2.6} rx={1} />
            </g>
          ))}
      <path className={solid} d={WHEEL_RIM} fillRule="evenodd" />
      {SPOKES.map((deg) => (
        <circle key={deg} className={solid} cx={r3(Math.cos(radians(deg)) * WHEEL.spoke)} cy={r3(Math.sin(radians(deg)) * WHEEL.spoke)} r={WHEEL.knob} />
      ))}
      <circle className={solid} r={WHEEL.hub} />
      {depth ? null : <circle className="ik-detail" r={2} />}
    </>
  )
}

export default function VaultDoor() {
  const [motion, setMotion] = useState<Motion>(REST)
  const clip = useId().replace(/:/g, "")
  const stop = useRef(() => {})
  const timers = useRef<number[]>([])
  const since = useRef(0)
  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id)
      stop.current()
    },
    [],
  )

  const { phase } = motion
  const open = phase === "open"
  const swing = phase === "locked" ? undefined : phase
  const later = (at: number, play: () => void) => {
    timers.current.push(window.setTimeout(play, at))
  }
  const toggle = (audible: boolean) => {
    const now = performance.now()
    const swung = share((now - since.current - motion.swingAt) / SWING_MS)
    since.current = now
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
    stop.current()
    if (audible) for (const at of TICKS_AT) later(at, () => playSound("tick"))
    if (open) {
      const swingAt = -(1 - swung) * SWING_MS
      if (audible) {
        stop.current = playSound("whoosh")
        later(swingAt + SWING_MS + THROW_GAP_MS + THROW_RUN_MS - LATCH_SEAT_MS, () => {
          stop.current = playSound("latch")
        })
      }
      setMotion({ phase: "shut", swingAt })
      return
    }
    const ajar = phase === "shut" ? 1 - swung : 0
    const swingAt = ajar > 0 ? -ajar * SWING_MS : SWING_AT
    if (audible) {
      if (ajar === 0) stop.current = playSound("cascade", { count: BOLTS.length, stagger: STAGGER_MS / 1000, delay: (BOLT_AT + BOLT_MS) / 1000 })
      later(swingAt + SWING_MS, () => {
        stop.current = playSound("complete")
      })
    }
    setMotion({ phase: "open", swingAt })
  }
  const demo = useDemoTap(
    () => {
      if (phase === "locked") toggle(false)
    },
    { delay: 1700 },
  )
  const press = () => {
    demo.dismiss()
    toggle(true)
  }

  const settledAt = motion.swingAt + SWING_MS
  const throwAt = settledAt + THROW_GAP_MS
  const lockedAt = throwAt + THROW_RUN_MS
  const timing = {
    "--swing-at": `${motion.swingAt}ms`,
    "--swing-ms": `${SWING_MS}ms`,
    "--wheel-ms": `${WHEEL_MS}ms`,
    "--bolt-ms": `${BOLT_MS}ms`,
    "--throw-at": `${throwAt}ms`,
    "--thrown-at": `${throwAt + BOLT_MS}ms`,
    "--lit": `${settledAt}ms`,
  } as CSSProperties
  const readout = open ? `unlocked · ${BOLTS.length} of ${BOLTS.length} bolts` : phase === "shut" ? `relocked · ${BOLTS.length} bolts thrown` : `locked · ${BOLTS.length} bolts thrown`

  return (
    <Plate
      {...demo.plate}
      fig="Fintech"
      name="Vault door"
      hint={open ? "Press the wheel to lock" : "Press the wheel"}
      readout={readout}
      className="fig-vault-door"
      style={timing}
      data-open={open}
      fit={[BASE, WALL, TIMELOCK, { x: HINGE.x - 10, y: HINGE.y, z: DOOR.z - R, w: 12, d: SWING, h: 2 * R }]}
      aspect={1.3}
      label="A round bank vault door in a steel wall, with a spoked wheel, five locking bolts and a time lock beside it. Press the wheel: the bolts draw back one after another and the door swings open; press it again to shut and lock it."
    >
      <g ref={demo.ref}>
        <defs>
          <clipPath id={clip}>
            <circle cx={HOLE.x} cy={HOLE.y} r={OPENING} />
          </clipPath>
        </defs>
        <Box {...BASE} r={10} top={<rect className="ik-detail" x={8} y={FACE_Y + 6} width={BASE.w - 16} height={BASE.d - FACE_Y - 14} rx={6} />} />
        <Box
          {...WALL}
          r={4}
          top={<rect className="ik-detail" x={5} y={5} width={WALL.w - 10} height={WALL.d - 10} rx={3} />}
          front={
            <>
              <g transform={`translate(${HOLE.x} ${HOLE.y})`}>
                <path className="ik-face" d={COLLAR_RING} fillRule="evenodd" />
                <circle className="ik-detail" r={COLLAR - 4} />
                {RIVETS.map((deg) => (
                  <circle key={deg} className="ik-fill" cx={r3(Math.cos(radians(deg)) * (COLLAR - 4))} cy={r3(Math.sin(radians(deg)) * (COLLAR - 4))} r={1.2} />
                ))}
                <circle className="ik-well" r={OPENING} />
              </g>
              <g clipPath={`url(#${clip})`}>
                <circle className="vd-room" cx={ROOM.x} cy={ROOM.y} r={OPENING} />
                {BOXES.map((box) => (
                  <g key={`${box.x}-${box.y}`}>
                    <rect className="ik-detail" x={box.x} y={box.y} width={10} height={7} rx={1} />
                    <path className="ik-detail" d={`M${box.x + 4} ${box.y + 3.5}h2`} />
                  </g>
                ))}
              </g>
              {BOLTS.map((bolt) => (
                <g key={bolt.deg} transform={`translate(${HOLE.x - PROUD} ${HOLE.y + PROUD}) rotate(${bolt.deg})`}>
                  <rect className="ik-well" x={R - 1} y={-4} width={9} height={8} rx={1.5} />
                </g>
              ))}
              <text className="ik-label vd-sign" x={TIMELOCK.x - WALL.x} y={FACE_TOP - TIMELOCK.z - TIMELOCK.h - 6}>
                VAULT 01
              </text>
              {Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${TIMELOCK.x - WALL.x + 4} ${FACE_TOP - TIMELOCK.z + 12 + k * 3.4}h${TIMELOCK.w - 8}`} />
              ))}
              <path className="ik-detail" d={`M6 ${WALL.h - 7}h${WALL.w - 12}`} />
            </>
          }
          side={[16, 40, 64, 88].map((y) => (
            <path key={y} className="ik-detail" d={`M5 ${y}h${WALL.d - 10}`} />
          ))}
        />
        <path className="ik-dash" d={path(ARC)} />

        <Box
          {...TIMELOCK}
          r={2}
          front={
            <>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2.5} />
              <Glow>
                <text className="ik-screen-text ik-dim" x={SCREEN.x + 3.5} y={SCREEN.y + 6.6} fontSize={5.6}>
                  time lock
                </text>
                {BOLTS.map((bolt, i) => (
                  <rect key={bolt.deg} className="vd-pip" style={bolt.timing} x={SCREEN.x + 3.5 + i * 6.2} y={SCREEN.y + 9} width={5} height={3} rx={0.6} />
                ))}
                <g key={phase}>
                  {phase === "locked" ? (
                    <text className="ik-screen-text" x={SCREEN.x + 3.5} y={SCREEN.y + 19.5} fontSize={7.4}>
                      locked
                    </text>
                  ) : (
                    <>
                      <text className="ik-screen-text vd-shown vd-passing" x={SCREEN.x + 3.5} y={SCREEN.y + 19.5} fontSize={7.4} style={{ "--on": "0ms", "--off": `${open ? settledAt : lockedAt}ms` } as CSSProperties}>
                        {open ? "locked" : "open"}
                      </text>
                      <text className="ik-screen-text vd-shown" x={SCREEN.x + 3.5} y={SCREEN.y + 19.5} fontSize={7.4} style={{ "--on": `${open ? settledAt : lockedAt}ms` } as CSSProperties}>
                        {open ? "open" : "locked"}
                      </text>
                    </>
                  )}
                </g>
              </Glow>
              <Glow on={open} className="vd-lamp-glow">
                <circle className="vd-lamp" cx={8} cy={31} r={2} />
              </Glow>
              <path className="ik-detail" d={`M14 31h${TIMELOCK.w - 20}`} />
            </>
          }
        />

        <Box {...PIN} r={PIN.w / 2} />
        {KNUCKLES.map((knuckle) => (
          <Box key={knuckle.z} {...knuckle} r={knuckle.w / 2} />
        ))}

        <g transform={`translate(${r3(HINGE_AT[0])} ${r3(HINGE_AT[1])})`}>
          <g className="vd-door" data-swing={swing}>
            <g className="vd-edge" data-swing={swing}>
              <circle className="vd-rim" cx={CENTER.x} cy={CENTER.y} r={R} />
            </g>
            <g className="vd-mid" data-swing={swing}>
              <circle className="vd-rim" cx={CENTER.x} cy={CENTER.y} r={R} />
            </g>
            <circle className="ik-face" cx={CENTER.x} cy={CENTER.y} r={R} />
            <circle className="ik-detail" cx={CENTER.x} cy={CENTER.y} r={R - 4} />
            <circle className="ik-detail" cx={CENTER.x} cy={CENTER.y} r={WHEEL.spoke + 3.5} />
            <g transform={`translate(${CENTER.x} ${CENTER.y})`}>
              <path className="ik-detail" d={RATCHET_TEETH} />
            </g>
            {BOLTS.map((bolt) => (
              <g key={bolt.deg} transform={`translate(${CENTER.x} ${CENTER.y}) rotate(${bolt.deg})`}>
                <rect className="ik-well" x={BOLT.from + BOLT.travel - 1.5} y={-BOLT.w / 2 - 1} width={R - BOLT.from - BOLT.travel + 0.5} height={BOLT.w + 2} rx={2} />
              </g>
            ))}
            <g className="vd-proud" data-swing={swing}>
              {BOLTS.map((bolt) => (
                <g key={bolt.deg} transform={`translate(${CENTER.x} ${CENTER.y}) rotate(${bolt.deg})`}>
                  <g className="vd-bolt" style={bolt.timing}>
                    <rect className="vd-rim" x={BOLT.from} y={-BOLT.w / 2} width={BOLT.len} height={BOLT.w} rx={2} />
                  </g>
                </g>
              ))}
            </g>
            {BOLTS.map((bolt) => (
              <g key={bolt.deg} transform={`translate(${CENTER.x} ${CENTER.y}) rotate(${bolt.deg})`}>
                <g className="vd-bolt" style={bolt.timing}>
                  <rect className="ik-face ik-top" x={BOLT.from} y={-BOLT.w / 2} width={BOLT.len} height={BOLT.w} rx={2} />
                  <path className="ik-detail" d={`M${BOLT.from + 3} 0h${BOLT.len - 8}`} />
                </g>
              </g>
            ))}
            {STRAPS.map((y) => (
              <g key={y}>
                <rect className="ik-face ik-top" x={STRAP_X} y={y - 4} width={-3 - STRAP_X} height={8} rx={2} />
                <circle className="ik-fill" cx={STRAP_X + 4} cy={y} r={1.1} />
                <circle className="ik-fill" cx={-8} cy={y} r={1.1} />
              </g>
            ))}

            {phase === "locked" && demo.phase !== "aim" && demo.phase !== "press" ? (
              <Ripple inFace x={CENTER.x - WHEEL.spoke - 1} y={CENTER.y - WHEEL.spoke - 1} w={2 * WHEEL.spoke + 2} d={2 * WHEEL.spoke + 2} r={WHEEL.spoke + 1} />
            ) : null}
            <Press label={open ? "Turn the wheel to shut and lock the door" : "Turn the wheel to unlock the door"} material="metal" onPress={press} data-hot={!open}>
              <g>
                <g transform={`translate(${CENTER.x} ${CENTER.y})`}>
                  <g className="vd-proud" data-swing={swing}>
                    <g className="vd-wheel" data-swing={swing}>
                      <WheelBody depth />
                    </g>
                  </g>
                  <g className="vd-wheel" data-swing={swing}>
                    <WheelBody depth={false} />
                  </g>
                </g>
              </g>
            </Press>
          </g>
        </g>

        <Dimension from={[DOOR.x - R, FACE_Y, DOOR.z - R]} to={[DOOR.x - R, FACE_Y, DOOR.z + R]} offset={[R - COLLAR - 3, 0, 0]} label={`ø ${2 * R}`} />
        <Cursor at={[DOOR.x, HINGE.y, DOOR.z]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
