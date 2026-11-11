import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, Plate, Press, playSound, Ripple, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { LabMeta } from "../../catalog/lab-meta"
import { Bloom, BoltCircle, COIL_FILL, CoilRing, Drum, Exploded, extentOf, Lens, Lift, Lifted, type LightSource, RadialSlots, rim, Seat, windowsAround } from "../parts"
import "./arc-reactor.css"

export const meta = {
  slug: "arc-reactor",
  title: "Arc reactor",
  level: 3,
  blurb: "An arc reactor in seven parts, floating apart over its stand. Assemble: the casing, coil ring, slot ring and core seat one after another, the core charges with a rising whine, then light opens between the ten copper coils, the slot ring spins up and the core blooms.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "playSound", "project", "top", "Callout"],
  sounds: ["latch", "charge", "relay", "boot", "motor", "whoosh"],
  textures: [],
  parts: ["Exploded", "Drum", "Seat", "BoltCircle", "CoilRing", "RadialSlots", "Lens", "Bloom"],
  headline: "An arc reactor, in React.",
  pitch: "Seven SVG parts float apart. Press Assemble: they seat one after another, the core charges with a rising whine, and light opens between ten copper coils. No WebGL, no canvas, no 3D model. Built with isokit, which is free and open source.",
} satisfies LabMeta

type Mode = "exploded" | "assembled" | "apart"

const PLINTH = { x: 0, y: 0, z: 0, w: 120, d: 100, h: 10 }
const AXIS = { x: 50, y: 44 }
const at = (z: number): Vec3 => [AXIS.x, AXIS.y, z]
const MOUNT = { r: 22, z: PLINTH.h, h: 8 }
const REAR = { r: 29, z: MOUNT.z + MOUNT.h, h: 9 }
const HEATSINK = { r: 35, z: REAR.z + REAR.h, h: 11 }
const CASING = { r: 40, z: HEATSINK.z + HEATSINK.h, h: 9 }
const RING = { r: 44, bore: 25, z: CASING.z + CASING.h, h: 13, depth: 10 }
const RING_TOP = RING.z + RING.h
const FLOOR = RING_TOP - RING.depth
const COLLAR = { r: 19, z: FLOOR, h: 5 }
const CORE = { r: 10, z: COLLAR.z + COLLAR.h, h: 8 }
const CORE_TOP = CORE.z + CORE.h
const KEY = { x: 68, y: 84, z: PLINTH.h, w: 46, d: 12, h: 4 }
const DISPLAY = { x: 8, y: 1, w: 62, h: 8 }

const GAP = 26
const SPANS = [1, 1, 0.7, 0.75] as const
const JOINTS = SPANS.length
const COILS = 10
const SEAT_MS = 700
const SEAT_STAGGER_MS = 150
const SEATED_MS = SEAT_MS + (JOINTS - 1) * SEAT_STAGGER_MS
const CHARGE_MS = 800
const LIGHT_AT_MS = SEATED_MS + CHARGE_MS
const LIGHT_STEP_MS = 50
const SPOOL_MS = 1400
const SPIN_MS = 5600
const LAST_LIGHT = 6
const ONLINE_MS = LIGHT_AT_MS + LAST_LIGHT * LIGHT_STEP_MS

const TIMING = {
  "--lab-gap": GAP,
  "--lab-seat-ms": `${SEAT_MS}ms`,
  "--lab-seat-stagger": `${SEAT_STAGGER_MS}ms`,
  "--lab-light-at": `${LIGHT_AT_MS}ms`,
  "--ar-spool": `${SPOOL_MS}ms`,
  "--ar-spin": `${SPIN_MS}ms`,
  "--ar-spool-turn": `${(180 * SPOOL_MS) / SPIN_MS}deg`,
  "--ar-online": `${ONLINE_MS}ms`,
  "--ar-charge-at": `${SEATED_MS}ms`,
  "--ar-charge": `${CHARGE_MS}ms`,
} as CSSProperties
const LAST = { "--i": LAST_LIGHT } as CSSProperties

const rise = (joints: number): number => SPANS.slice(0, joints).reduce((sum, span) => sum + span * GAP, 0)
const FIT = [PLINTH, extentOf(AXIS, RING.r, RING.z + rise(2), RING.h), extentOf(AXIS, CORE.r, CORE.z + rise(4), CORE.h)]

const LIGHTS: readonly LightSource[] = [
  { x: 0, y: 0, r: RING.r * 2.7, step: LAST_LIGHT, weight: 0.45 },
  ...windowsAround(COILS, COIL_FILL, (RING.bore + RING.r) / 2).map(({ x, y, step }) => ({ x, y, r: 22, step, weight: 0.95 })),
  { x: 0, y: 0, r: RING.bore * 1.4, step: 0, weight: 0.75 },
  { x: 0, y: 0, r: CORE.r * 2.8, step: LAST_LIGHT, weight: 1 },
]

const SCREEN = [
  ...Array.from({ length: JOINTS + 1 }, (_, k) => ({
    text: `SEATED ${k}/${JOINTS}`,
    on: k === 0 ? 0 : SEAT_MS + (k - 1) * SEAT_STAGGER_MS,
    off: SEAT_MS + k * SEAT_STAGGER_MS,
  })),
  { text: "CHARGING", on: SEATED_MS + SEAT_STAGGER_MS, off: ONLINE_MS },
  { text: "ONLINE 3.0 GJ/S", on: ONLINE_MS, off: 0 },
].map((step, k, steps) => ({ ...step, last: k === steps.length - 1, style: { "--on": `${step.on}ms`, "--off": `${step.off}ms` } as CSSProperties }))

type Cue = { at: number; play: () => () => void }

const SEAT_SIZES = [0.52, 0.58, 0.26, 0.14] as const
const CUES: readonly Cue[] = [
  ...SEAT_SIZES.map((size, joint) => ({ at: SEAT_MS + joint * SEAT_STAGGER_MS, play: () => playSound("latch", { size }) })),
  { at: SEATED_MS, play: () => playSound("charge", { duration: CHARGE_MS / 1000 }) },
  { at: LIGHT_AT_MS, play: () => playSound("relay") },
  { at: LIGHT_AT_MS, play: () => playSound("boot") },
  { at: ONLINE_MS, play: () => playSound("motor", { duration: SPOOL_MS / 1000 }) },
]

const mid = (part: { z: number; h: number }): number => part.z + part.h / 2
const LABELS = [
  { joints: 0, at: rim(AXIS, REAR.r, mid(REAR), -45), dx: 26, dy: 12, label: "rear housing" },
  { joints: 0, at: rim(AXIS, HEATSINK.r, mid(HEATSINK), 135), dx: -16, dy: 10, label: "heatsink · 48 fins" },
  { joints: 1, at: rim(AXIS, CASING.r, mid(CASING), -45), dx: 18, dy: 6, label: "casing" },
  { joints: 2, at: rim(AXIS, RING.r, mid(RING), 135), dx: -14, dy: -4, label: "coil ring · 10 coils" },
  { joints: 3, at: rim(AXIS, COLLAR.r, COLLAR.z + COLLAR.h, -20), dx: 34, dy: -8, label: "slot ring" },
  { joints: 4, at: [AXIS.x, AXIS.y, CORE_TOP] as Vec3, dx: -30, dy: -14, label: "palladium core" },
]

export default function ArcReactor() {
  const [{ mode, run }, setState] = useState<{ mode: Mode; run: number }>({ mode: "exploded", run: 0 })
  const [touched, setTouched] = useState(false)
  const stop = useRef(() => {})
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const assembled = mode === "assembled"
  const toggle = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stop.current()
    if (audible && !assembled) {
      const playing: (() => void)[] = []
      stop.current = () => {
        for (const cut of playing) cut()
      }
      const cue = (index: number, since: number) => {
        const next = CUES[index]
        if (!next) return
        timer.current = window.setTimeout(() => {
          playing.push(next.play())
          cue(index + 1, next.at)
        }, next.at - since)
      }
      cue(0, 0)
    }
    if (audible && assembled) stop.current = playSound("whoosh")
    setState({ mode: assembled ? "apart" : "assembled", run: 1 - run })
  }
  const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(
    () => {
      if (mode === "exploded") toggle(false)
    },
    { delay: 900 },
  )
  const press = () => {
    dismiss()
    setTouched(true)
    toggle(true)
  }

  const readout = assembled ? "assembled · online · 3.0 GJ/s" : mode === "apart" ? "taken apart · 7 parts · offline" : "exploded · 7 parts · offline"

  return (
    <Plate
      {...plate}
      fig="Lab"
      name="Arc reactor"
      hint={assembled ? "Press to take it apart" : "Press to assemble"}
      readout={readout}
      className="fig-arc-reactor"
      style={TIMING}
      data-assembled={assembled}
      fit={FIT}
      aspect={0.95}
      label="An arc reactor in seven parts floating apart above its stand: a stepped rear housing, a finned heatsink, a casing, a ring wound with ten copper coils, a slotted ring and a palladium core. Assemble seats the casing, coil ring, slot ring and core one after another, charges the core and lights the reactor: light between the coils, a spinning slot ring and a glowing core. Take it apart to lift the parts away again."
    >
      <g ref={demoAnchor}>
        <Box
          {...PLINTH}
          r={6}
          front={
            <>
              <rect className="ik-screen" x={DISPLAY.x} y={DISPLAY.y} width={DISPLAY.w} height={DISPLAY.h} rx={1.2} />
              <g key={`screen-${run}`}>
                {assembled ? (
                  SCREEN.map(({ text, style, last }) => (
                    <text key={text} className={last ? "ik-screen-text shown" : "ik-screen-text shown passing"} x={DISPLAY.x + 3} y={DISPLAY.y + 5.9} fontSize={5.6} style={style}>
                      {text}
                    </text>
                  ))
                ) : (
                  <text className="ik-screen-text ik-dim" x={DISPLAY.x + 3} y={DISPLAY.y + 5.9} fontSize={5.6}>
                    {`OFFLINE 0/${JOINTS}`}
                  </text>
                )}
              </g>
            </>
          }
        />

        <Exploded assembled={assembled} joints={JOINTS}>
          <Drum at={at(MOUNT.z)} r={MOUNT.r} h={MOUNT.h} />
          <Drum at={at(REAR.z)} r={REAR.r} h={REAR.h} grooves={[REAR.h / 2]} />
          <Drum
            at={at(HEATSINK.z)}
            r={HEATSINK.r}
            h={HEATSINK.h}
            ribs={48}
            top={
              <>
                <Seat r={CASING.r - 9} hole={11} />
                <BoltCircle count={6} r={HEATSINK.r - 4} phase={15} />
              </>
            }
          />
          <Lift joint={0} span={SPANS[0]}>
            <Drum
              at={at(CASING.z)}
              r={CASING.r}
              h={CASING.h}
              grooves={[2.4]}
              top={
                <>
                  <Seat r={RING.bore + 2} hole={13} />
                  <BoltCircle count={10} r={CASING.r - 4.5} phase={9} />
                </>
              }
            />
            <Lift joint={1} span={SPANS[1]}>
              <CoilRing at={at(RING.z)} r={RING.r} bore={RING.bore} h={RING.h} depth={RING.depth} coils={COILS} lit={assembled}>
                <Lift joint={2} span={SPANS[2]}>
                  <g style={LAST}>
                    <Drum
                      at={at(COLLAR.z)}
                      r={COLLAR.r}
                      h={COLLAR.h}
                      top={
                        <g className="spin ik-loop">
                          <RadialSlots count={20} inner={11.5} outer={17} width={1.5} lit={assembled} />
                        </g>
                      }
                    />
                    <Lift joint={3} span={SPANS[3]}>
                      <Drum at={at(CORE.z)} r={CORE.r} h={CORE.h} grooves={[2]} top={<Lens r={CORE.r} lit={assembled} />} />
                    </Lift>
                  </g>
                </Lift>
              </CoilRing>
              <Bloom at={at(RING_TOP)} sources={LIGHTS} on={assembled} />
            </Lift>
          </Lift>

          <g className="labels">
            {LABELS.map(({ joints, at: anchor, dx, dy, label }) => (
              <Lifted key={label} spans={SPANS.slice(0, joints)}>
                <Callout at={anchor} dx={dx} dy={dy} label={label} />
              </Lifted>
            ))}
          </g>
        </Exploded>

        {!touched && mode === "exploded" && phase !== "aim" && phase !== "press" ? <Ripple {...KEY} r={3} /> : null}
        <Press label={assembled ? "Take it apart" : "Assemble"} onPress={press} material="metal" data-hot={!assembled}>
          <g>
            <Box
              {...KEY}
              r={3}
              top={
                <text className="ik-label key" x={KEY.w / 2} y={7.9} textAnchor="middle">
                  {assembled ? "TAKE APART" : "ASSEMBLE"}
                </text>
              }
            />
          </g>
        </Press>
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={phase} />
      </g>
    </Plate>
  )
}
