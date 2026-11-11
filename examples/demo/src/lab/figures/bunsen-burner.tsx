import { type CSSProperties, useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, project, Ripple, top, useDemoTap, type Vec3 } from "react-isokit"
import type { LabMeta } from "../../catalog/lab-meta"
import { PrintDefs, usePrint } from "../textures/print"
import { scatter } from "../textures/scatter"
import { Stipple } from "../textures/stipple"
import "./bunsen-burner.css"

export const meta = {
  slug: "bunsen-burner",
  title: "Bunsen burner",
  level: 2,
  blurb: "Press the gas tap: the flame lights, the ink of the whole drawing warms, and the beaker on the tripod heats until it boils.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "playSound", "path", "curve", "project", "top"],
  sounds: ["whoosh", "process", "done", "toggle"],
  textures: ["engrave"],
} satisfies LabMeta

const TILE = { x: 0, y: 0, z: 0, w: 150, d: 132, h: 6 }
const FOOT = { x: 45, y: 43, z: 6, w: 34, d: 34, h: 5 }
const BARB = { x: 76, y: 57, z: 7, w: 9, d: 6, h: 3 }
const COLLAR = { x: 54, y: 52, z: 11, w: 16, d: 16, h: 8 }
const BARREL = { x: 56, y: 54, z: 19, w: 12, d: 12, h: 23 }
const TIP: Vec3 = [62, 60, 42]
const LEG = { w: 3, d: 3, z: 6, h: 72 }
const BACK_LEG = { ...LEG, x: 30, y: 32 }
const SIDE_LEGS = [
  { ...LEG, x: 92, y: 36 },
  { ...LEG, x: 33, y: 93 },
] as const
const GAUZE = { x: 28, y: 30, z: 80, w: 68, d: 68 }
const BEAKER = { x: 44, y: 46, z: 80, w: 36, d: 36, h: 34 }
const VALVE = { x: 102, y: 98, z: 6, w: 34, d: 22, h: 8 }
const KEY = { x: 105, y: 102, z: 14, w: 28, d: 14, h: 5 }
const HOSE = path(curve([111, 98, 9], [111, 76, 7], [100, 60, 7], [85, 60, 8.5], 18))
const MESH = Array.from({ length: 9 }, (_, k) => `M${6.8 + k * 6.8} 3V65M3 ${6.8 + k * 6.8}H65`).join("")
const GAUZE_AT = top(GAUZE.x, GAUZE.y, GAUZE.z)
const LIQUID_AT = top(BEAKER.x, BEAKER.y, BEAKER.z + BEAKER.h)
const SEAMS = "M50 0V132M100 0V132M0 44H150M0 88H150"
const MARKS = [8, 14, 20, 26].map((y, k) => `M${k % 2 ? 14 : 11} ${y}H18`).join("")
const BUBBLES = scatter({ count: 22, w: BEAKER.w, d: BEAKER.d, seed: 4, size: [0.7, 1.7], inset: 7, round: true })
const FLAME_AT = `translate(${project(...TIP).join(" ")})`
const HEAT_MS = 1600
const TIMING = { "--heat": `${HEAT_MS}ms` } as CSSProperties

export default function BunsenBurner() {
  const [lit, setLit] = useState(false)
  const [touched, setTouched] = useState(false)
  const print = usePrint()
  const stop = useRef(() => {})
  const timer = useRef(0)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const toggle = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stop.current()
    const next = !lit
    if (audible && next) {
      const heating = [playSound("whoosh"), playSound("process")]
      stop.current = () => {
        for (const cut of heating) cut()
      }
      timer.current = window.setTimeout(() => {
        stop.current()
        stop.current = playSound("done")
      }, HEAT_MS)
    }
    if (audible && !next) stop.current = playSound("toggle")
    setLit(next)
  }
  const { ref: demoAnchor, phase, dismiss, plate } = useDemoTap(
    () => {
      if (!lit) toggle(false)
    },
    { delay: 900 },
  )
  const press = () => {
    dismiss()
    setTouched(true)
    toggle(true)
  }

  const readout = lit ? "lit · boiling · 100 °C" : touched ? "off · cooling · 21 °C" : "off · 21 °C"

  return (
    <Plate
      {...plate}
      fig="Lab"
      name="Bunsen burner"
      hint={lit ? "Press to shut the gas" : "Press the gas tap"}
      readout={readout}
      className="fig-bunsen-burner"
      style={TIMING}
      data-lit={lit}
      fit={[TILE, BEAKER, VALVE]}
      aspect={1.25}
      label="A Bunsen burner under a tripod and gauze with a beaker of water, fed by a hose from a gas tap on the bench. Press the gas tap to light the flame and bring the beaker to the boil; press again to shut the gas."
    >
      <g ref={demoAnchor} className="tx-print" style={print.style} data-charged={lit}>
        <PrintDefs id={print.id} treatment="engrave" />
        <Box {...TILE} r={10} top={<path className="ik-detail" d={SEAMS} />} />
        <path className="ik-line ik-thick" d={HOSE} />
        <Box {...BACK_LEG} r={1.5} />
        <Box {...FOOT} r={FOOT.w / 2} top={<circle className="ik-detail" cx={FOOT.w / 2} cy={FOOT.d / 2} r={12} />} />
        <Box {...BARB} r={1.5} />
        <Box {...COLLAR} r={COLLAR.w / 2} front={<rect className="ik-well" x={5} y={2.5} width={6} height={4} rx={2} />} />
        <Box {...BARREL} r={BARREL.w / 2} top={<circle className="ik-well" cx={BARREL.w / 2} cy={BARREL.d / 2} r={3.4} />} side={<path className="ik-detail" d="M3 5v13" />} />
        {SIDE_LEGS.map((leg) => (
          <Box key={leg.x} {...leg} r={1.5} />
        ))}
        <g transform={FLAME_AT}>
          <g className="flame">
            <g className="flicker ik-loop">
              <Glow on={lit} className="flame-glow">
                <path className="flame-outer" d="M0 0C-6.6-3.2-6-14 0-24C6-14 6.6-3.2 0 0Z" />
                <path className="flame-core" d="M0-1.2C-3.1-3.4-2.9-9.2 0-13.8C2.9-9.2 3.1-3.4 0-1.2Z" />
              </Glow>
            </g>
          </g>
        </g>
        <g transform={GAUZE_AT}>
          <path className="ik-detail" d={MESH} />
          <rect className="ik-line" width={GAUZE.w} height={GAUZE.d} rx={3} />
        </g>
        <Box {...BEAKER} r={BEAKER.w / 2} front={<path className="ik-detail" d={MARKS} />} />
        <g transform={LIQUID_AT}>
          <circle className="liquid" cx={BEAKER.w / 2} cy={BEAKER.d / 2} r={15.2} />
          <Stipple specks={BUBBLES} on={lit} loop />
          <circle className="ik-detail rim" cx={BEAKER.w / 2} cy={BEAKER.d / 2} r={15.2} />
        </g>
        <Box {...VALVE} r={4} front={<path className="ik-detail" d="M5 4h24" />} side={<circle className="ik-well" cx={11} cy={4} r={2.2} />} />
        {!touched && !lit && phase !== "aim" && phase !== "press" ? <Ripple {...KEY} r={3} /> : null}
        <Press label={lit ? "Shut the gas" : "Open the gas tap"} onPress={press} material="metal" data-hot={!lit}>
          <g>
            <Box
              {...KEY}
              r={3}
              top={
                <>
                  <text className="ik-label key" x={4} y={9.6}>
                    GAS
                  </text>
                  <path className="ik-detail ik-thick arrow" d="M22 3.5v7M19 7.5l3 3 3-3" />
                </>
              }
            />
          </g>
        </Press>
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={phase} />
      </g>
    </Plate>
  )
}
