import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, project, Ripple, Signal, useDemoTap, type Vec3 } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./desk-globe.css"

export const meta = {
  slug: "desk-globe",
  title: "Desk globe",
  industry: "education",
  level: 2,
  blurb: "Press spin: a motor in the stand turns the globe to the next country, the lamp beside it lights and marks the spot, and the plaque names it.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path", "project", "playSound", "Callout"],
  sounds: ["press", "release", "motor", "done"],
} satisfies FigureMeta

type Country = { name: string; capital: string; land: string; city: readonly [number, number] }

const BASE = { x: 0, y: 0, z: 0, w: 172, d: 128, h: 8 }
const FOOT = { x: 28, y: 22, z: BASE.h, w: 44, d: 44, h: 5 }
const COLLAR = { x: 34, y: 28, z: FOOT.z + FOOT.h, w: 32, d: 32, h: 4 }
const VENTS = Array.from({ length: 24 }, (_, k) => {
  const a = (k * 15 * Math.PI) / 180
  const c = FOOT.w / 2
  return `M${(c + 17.4 * Math.cos(a)).toFixed(3)} ${(c + 17.4 * Math.sin(a)).toFixed(3)}L${(c + 20.4 * Math.cos(a)).toFixed(3)} ${(c + 20.4 * Math.sin(a)).toFixed(3)}`
}).join("")
const NECK = { x: 45, y: 39, z: COLLAR.z + COLLAR.h, w: 10, d: 10, h: 8 }
const STEM = { x: 47.5, y: 41.5, z: NECK.z + NECK.h, w: 5, d: 5, h: 12 }
const PIVOT: Vec3 = [50, 44, STEM.z + STEM.h]
const R = 32
const RING = R + 5
const TILT = 23.5
const TILT_RAD = (TILT * Math.PI) / 180
const SHIFT = (RING * Math.sin(TILT_RAD)) / (2 * Math.cos(Math.PI / 6))
const CENTER: Vec3 = [PIVOT[0] + SHIFT, PIVOT[1] - SHIFT, PIVOT[2] + RING * Math.cos(TILT_RAD)]
const [CX, CY] = project(...CENTER)
const NORTH_PIN: Vec3 = [CENTER[0] + SHIFT, CENTER[1] - SHIFT, CENTER[2] + RING * Math.cos(TILT_RAD)]
const GRADUATION = Array.from({ length: 11 }, (_, k) => {
  const a = ((105 + k * 15) * Math.PI) / 180
  const inner = k % 2 ? RING - 1.2 : RING - 2
  return `M${(inner * Math.cos(a)).toFixed(3)} ${(inner * Math.sin(a)).toFixed(3)}L${((RING + 2) * Math.cos(a)).toFixed(3)} ${((RING + 2) * Math.sin(a)).toFixed(3)}`
}).join("")
const SPOT = { x: 14, y: -4 }
const SPOT_AT: Vec3 = [CENTER[0] + SPOT.x / (2 * Math.cos(Math.PI / 6)), CENTER[1] - SPOT.x / (2 * Math.cos(Math.PI / 6)), CENTER[2] - SPOT.y]
const POLE = R * Math.cos((14 * Math.PI) / 180)
const FLAT = Math.sin((14 * Math.PI) / 180)
const MERIDIANS = [-90, -60, -30, 0, 30, 60].map((deg) => ({ deg, s0: Math.sin((deg * Math.PI) / 180), s1: Math.sin(((deg + 30) * Math.PI) / 180) }))
const LATITUDES = [-23.5, 0, 23.5].map((deg) => {
  const a = (deg * Math.PI) / 180
  return { deg, rx: R * Math.cos(a), ry: R * Math.cos(a) * FLAT, cy: -R * Math.sin(a) * Math.cos((14 * Math.PI) / 180) }
})

const LAMP_FOOT = { x: 120, y: 14, z: BASE.h, w: 30, d: 30, h: 5 }
const LAMP_WEIGHT = { x: 126, y: 20, z: LAMP_FOOT.z + LAMP_FOOT.h, w: 18, d: 18, h: 4 }
const LAMP_PIVOT = { x: 131, y: 25, z: LAMP_WEIGHT.z + LAMP_WEIGHT.h, w: 8, d: 8, h: 6 }
const HEAD = { cx: 100, cy: 15, z: 104 }
const SHADES = [
  { w: 26, h: 5 },
  { w: 18, h: 4 },
  { w: 11, h: 4 },
  { w: 6, h: 3 },
].reduce<{ x: number; y: number; z: number; w: number; d: number; h: number }[]>((stack, disc) => {
  const below = stack[stack.length - 1]
  const z = below ? below.z + below.h : HEAD.z
  stack.push({ x: HEAD.cx - disc.w / 2, y: HEAD.cy - disc.w / 2, z, w: disc.w, d: disc.w, h: disc.h })
  return stack
}, [])
const RIM = 13
const MOUTH = path(
  Array.from({ length: 13 }, (_, k): Vec3 => {
    const a = ((-45 + k * 15) * Math.PI) / 180
    return [HEAD.cx + RIM * Math.cos(a), HEAD.cy + RIM * Math.sin(a), HEAD.z]
  }),
)
const SHOULDER: Vec3 = [135, 29, LAMP_PIVOT.z + LAMP_PIVOT.h - 2]
const ELBOW: Vec3 = [146, 18, 76]
const NAPE: Vec3 = [HEAD.cx + 9, HEAD.cy, HEAD.z + 11]
const BULB: Vec3 = [HEAD.cx, HEAD.cy, HEAD.z]
const BEAM = [BULB, SPOT_AT] as const
const CONE = [path([[HEAD.cx - 8.5, HEAD.cy + 8.5, HEAD.z], SPOT_AT]), path([[HEAD.cx + 8.5, HEAD.cy - 8.5, HEAD.z], SPOT_AT])]
const ARM_GAP = 1.2
const SPRING = Array.from({ length: 9 }, (_, k): Vec3 => {
  const t = 0.3 + (k / 8) * 0.4
  const side = k % 2 ? 1.8 : -1.8
  return [SHOULDER[0] + (ELBOW[0] - SHOULDER[0]) * t + side, SHOULDER[1] + (ELBOW[1] - SHOULDER[1]) * t - side, SHOULDER[2] + (ELBOW[2] - SHOULDER[2]) * t]
})
const PLAQUE = { x: 4, y: 96, z: BASE.h, w: 64, d: 14, h: 22 }
const KEY = { x: 100, y: 92, z: BASE.h, w: 54, d: 24, h: 6 }
const CORD = path(curve([KEY.x, KEY.y + 8, BASE.h + 1.2], [86, KEY.y + 8, BASE.h + 1.2], [62, 82, BASE.h + 1.2], [56, FOOT.y + FOOT.d - 1, BASE.h + 1.2]))

const COUNTRIES: readonly Country[] = [
  { name: "Ghana", capital: "Accra", land: "M-4 -6L4 -6L5 2L2 6L-4 5L-5 -2Z", city: [1, 4] },
  { name: "Kenya", capital: "Nairobi", land: "M-5 -6L3 -7L6 -3L4 1L6 5L1 7L-3 4L-6 1Z", city: [0, 1] },
  { name: "Peru", capital: "Lima", land: "M-6 -6L-1 -7L3 -3L6 1L5 6L1 7L-2 3L-5 -1Z", city: [-3, 1] },
  { name: "Japan", capital: "Tokyo", land: "M2 -8L5 -6L4 -3L1 -4ZM0 -2L3 0L1 3L-2 4L-4 2L-1 1ZM-5 4L-3 5L-5 7L-7 6Z", city: [1, 0] },
  { name: "Egypt", capital: "Cairo", land: "M-6 -6L6 -6L6 6L-2 6L-6 2Z", city: [1, -4] },
  { name: "Canada", capital: "Ottawa", land: "M-8 -3L-5 -6L-2 -4L1 -7L4 -4L8 -5L8 3L3 4L0 2L-4 4L-8 2Z", city: [3, 2] },
  { name: "India", capital: "New Delhi", land: "M-6 -6L-1 -7L5 -5L6 -2L2 2L0 7L-2 2L-6 -1Z", city: [-1, -4] },
]
const FIRST = COUNTRIES[0] ?? { name: "Ghana", capital: "Accra", land: "", city: [0, 0] }
const SPIN_MS = 1000
const SETTLE_MS = 320
const BEAM_MS = 320
const ARRIVE_MS = SPIN_MS + BEAM_MS
const ms = (value: number) => `${value}ms`
const TIMING = { "--spin": ms(SPIN_MS), "--settle": ms(SETTLE_MS), "--arrive": ms(ARRIVE_MS) } as CSSProperties
const noop = () => {}

export default function DeskGlobe() {
  const [spins, setSpins] = useState(0)
  const [touched, setTouched] = useState(false)
  const stopMotor = useRef(noop)
  const stopDone = useRef(noop)
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stopMotor.current()
      stopDone.current()
    },
    [],
  )

  const spin = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stopMotor.current()
    stopDone.current()
    stopMotor.current = noop
    stopDone.current = noop
    if (audible) {
      stopMotor.current = playSound("motor", { duration: SPIN_MS / 1000 })
      timer.current = window.setTimeout(() => {
        stopDone.current = playSound("done")
      }, ARRIVE_MS)
    }
    setSpins(spins + 1)
  }
  const demo = useDemoTap(
    () => {
      if (spins === 0) spin(false)
    },
    { delay: 1100 },
  )
  const press = () => {
    demo.dismiss()
    setTouched(true)
    spin(true)
  }

  const country = COUNTRIES[spins % COUNTRIES.length] ?? FIRST
  const was = COUNTRIES[(spins + COUNTRIES.length - 1) % COUNTRIES.length] ?? FIRST
  const marked = spins > 0
  const readout = marked ? `${country.name} · ${country.capital}` : "at rest · lamp off"

  return (
    <Plate
      {...demo.plate}
      fig="Education"
      name="Desk globe"
      hint="Press spin"
      readout={readout}
      className="fig-desk-globe"
      style={TIMING}
      data-marked={marked}
      fit={[
        BASE,
        [CENTER[0] - RING / Math.sqrt(3), CENTER[1] + RING / Math.sqrt(3), CENTER[2]],
        [CENTER[0], CENTER[1], CENTER[2] + RING],
        { x: HEAD.cx - RIM, y: HEAD.cy - RIM, z: HEAD.z, w: 2 * RIM, d: 2 * RIM, h: 15 },
        ELBOW,
      ]}
      aspect={1.3}
      label="A desk globe on a stand beside an angled desk lamp, with a name plaque and a spin key. Press spin to turn the globe to the next country; the lamp marks it and the plaque names the country and its capital."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={12}
          top={
            <>
              <rect className="ik-detail" x={8} y={8} width={BASE.w - 16} height={BASE.d - 16} rx={7} />
              <circle className="ik-fill" cx={14} cy={BASE.d - 14} r={1.6} />
              <circle className="ik-fill" cx={BASE.w - 14} cy={BASE.d - 14} r={1.6} />
            </>
          }
        />
        <path className="ik-line" d={CORD} />

        <Box {...FOOT} r={FOOT.w / 2} top={<path className="ik-detail" d={VENTS} />} />
        <Box {...COLLAR} r={COLLAR.w / 2} top={<circle className="ik-detail" cx={COLLAR.w / 2} cy={COLLAR.d / 2} r={10} />} />
        <Box {...NECK} r={NECK.w / 2} />
        <Box {...STEM} r={STEM.w / 2} />

        <g transform={`translate(${CX.toFixed(3)} ${CY.toFixed(3)})`}>
          <circle className="ik-face dg-sphere" r={R} />
          <g transform={`rotate(${TILT})`}>
            {LATITUDES.map((lat) => (
              <path key={lat.deg} className={lat.deg === 0 ? "ik-detail dg-equator" : "ik-detail"} d={`M${-lat.rx} ${lat.cy}A${lat.rx} ${lat.ry} 0 0 0 ${lat.rx} ${lat.cy}`} />
            ))}
            <g key={`spin-${spins}`} className={spins ? "dg-spin" : undefined}>
              {MERIDIANS.map((m) => (
                <path
                  key={m.deg}
                  className="ik-detail dg-meridian"
                  d={`M0 ${-POLE}A${R} ${POLE} 0 0 1 0 ${POLE}`}
                  style={{ "--s0": m.s0.toFixed(4), "--s1": m.s1.toFixed(4) } as CSSProperties}
                />
              ))}
            </g>
            <path className="ik-line" d={`M0 ${-RING}V${-R}M0 ${R}V${RING}`} />
          </g>
          <g key={`land-${spins}`}>
            {marked ? (
              <g className="dg-leave">
                <Land country={was} lit={false} />
              </g>
            ) : null}
            <g className={marked ? "dg-arrive" : undefined}>
              <Land country={country} lit={marked} />
            </g>
            {marked ? <circle className="dg-ping" cx={SPOT.x + country.city[0]} cy={SPOT.y + country.city[1]} r={3} /> : null}
          </g>
          <circle className="ik-line" r={R} />
          <g transform={`rotate(${TILT})`}>
            <path className="ik-face dg-ring" d={ringBand(RING - 2, RING + 2)} />
            <path className="ik-detail" d={GRADUATION} />
            <circle className="ik-face ik-top" cx={0} cy={-RING} r={2.4} />
            <circle className="ik-face ik-top" cx={0} cy={RING} r={2.4} />
          </g>
        </g>

        <Box
          {...PLAQUE}
          r={3}
          top={<path className="ik-detail" d={`M4 ${PLAQUE.d - 4}h${PLAQUE.w - 8}`} />}
          front={
            <>
              <rect className="ik-screen" x={5} y={3} width={PLAQUE.w - 10} height={PLAQUE.h - 6.5} rx={2.5} />
              <g key={`plaque-${spins}`}>
                {marked ? (
                  <>
                    <text className="ik-screen-text ik-dim dg-turning" x={9} y={14} fontSize={5.6}>
                      turning…
                    </text>
                    <g className="ik-enter dg-named">
                      <PlaqueText country={country} />
                    </g>
                  </>
                ) : (
                  <g className="ik-enter">
                    <text className="ik-screen-text ik-dim" x={9} y={14} fontSize={5.6}>
                      lamp off
                    </text>
                  </g>
                )}
              </g>
              <circle className="ik-fill" cx={4} cy={PLAQUE.h - 1.8} r={0.8} />
              <circle className="ik-fill" cx={PLAQUE.w - 4} cy={PLAQUE.h - 1.8} r={0.8} />
            </>
          }
        />

        <Box {...LAMP_FOOT} r={LAMP_FOOT.w / 2} top={<circle className="ik-fill" cx={7} cy={LAMP_FOOT.d / 2 + 3} r={1.6} />} />
        <Box {...LAMP_WEIGHT} r={LAMP_WEIGHT.w / 2} />
        <Box {...LAMP_PIVOT} r={2} side={<circle className="ik-detail" cx={LAMP_PIVOT.d / 2} cy={LAMP_PIVOT.h / 2} r={1.6} />} />
        <Arm from={SHOULDER} to={ELBOW} />
        <path className="ik-detail" d={path(SPRING)} />
        {SHADES.map((disc, k) => (
          <Box key={disc.z} {...disc} r={disc.w / 2} top={k === SHADES.length - 1 ? <circle className="ik-fill" cx={disc.w / 2} cy={disc.d / 2} r={1} /> : null} />
        ))}
        <g key={`lamp-${spins}`}>
          {spins > 1 ? <LitMouth className="dg-lamp-off" /> : null}
          {marked ? <LitMouth className="dg-lamp-on" /> : null}
        </g>
        <Arm from={ELBOW} to={NAPE} />
        <circle className="ik-face ik-top" cx={project(...ELBOW)[0]} cy={project(...ELBOW)[1]} r={3.2} />
        <circle className="ik-fill" cx={project(...ELBOW)[0]} cy={project(...ELBOW)[1]} r={1} />
        <g key={`cone-${spins}`}>
          {marked ? (
            <g className="dg-cone">
              {CONE.map((d) => (
                <path key={d} className="ik-dash" d={d} />
              ))}
            </g>
          ) : null}
        </g>
        <g key={`beam-${spins}`}>
          {marked ? (
            <Glow>
              <Signal points={BEAM} delay={SPIN_MS} duration={BEAM_MS} />
            </Glow>
          ) : null}
        </g>

        {!touched && !marked && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...KEY} r={6} /> : null}
        <Press label="Spin the globe to the next country" material="plastic" onPress={press} data-hot={!marked}>
          <g>
            <Box
              {...KEY}
              r={6}
              top={
                <>
                  <text className="ik-label dg-key" x={9} y={15.6}>
                    SPIN
                  </text>
                  <g className="ik-detail ik-thick dg-arrow" transform={`translate(${KEY.w - 13} ${KEY.d / 2})`}>
                    <path d="M5 0A5 5 0 1 1 1.5 -4.8" />
                    <path d="M1.5 -4.8l-0.6 3.2M1.5 -4.8l-3.2 -0.4" />
                  </g>
                </>
              }
            />
          </g>
        </Press>
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
        <Callout at={NORTH_PIN} dx={-14} dy={-10} label="axis 23.5°" />
      </g>
    </Plate>
  )
}

function ringBand(inner: number, outer: number): string {
  const end = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    return `${(r * Math.cos(a)).toFixed(3)} ${(r * Math.sin(a)).toFixed(3)}`
  }
  return `M${end(outer, 90)}A${outer} ${outer} 0 0 1 ${end(outer, 270)}L${end(inner, 270)}A${inner} ${inner} 0 0 0 ${end(inner, 90)}Z`
}

function Arm({ from, to }: { from: Vec3; to: Vec3 }) {
  return (
    <>
      <path className="ik-line" d={path([[from[0] - ARM_GAP, from[1] + ARM_GAP, from[2]], [to[0] - ARM_GAP, to[1] + ARM_GAP, to[2]]])} />
      <path className="ik-line" d={path([[from[0] + ARM_GAP, from[1] - ARM_GAP, from[2]], [to[0] + ARM_GAP, to[1] - ARM_GAP, to[2]]])} />
    </>
  )
}

function Land({ country, lit }: { country: Country; lit: boolean }) {
  return (
    <g transform={`translate(${SPOT.x} ${SPOT.y}) scale(1.3)`}>
      <path className="dg-land" d={country.land} />
      <circle className="dg-city" data-lit={lit} cx={country.city[0]} cy={country.city[1]} r={1.6} />
    </g>
  )
}

function LitMouth({ className }: { className: string }) {
  return (
    <Glow>
      <path className={`ik-line dg-mouth ${className}`} d={MOUTH} />
    </Glow>
  )
}

function PlaqueText({ country }: { country: Country }) {
  return (
    <>
      <text className="ik-screen-text" x={9} y={10.8} fontSize={7}>
        {country.name}
      </text>
      <text className="ik-screen-text ik-dim" x={9} y={16.6} fontSize={5.6}>
        {country.capital}
      </text>
    </>
  )
}

