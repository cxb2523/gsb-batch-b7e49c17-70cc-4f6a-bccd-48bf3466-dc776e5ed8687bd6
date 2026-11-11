import { type CSSProperties, useId, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./smart-meter.css"

export const meta = {
  slug: "smart-meter",
  title: "Smart meter",
  industry: "energy",
  level: 1,
  blurb: "Press the display key: the meter's register rolls over to today, this week or the tariff, and a lamp marks the page it shows.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "curve", "path", "playSound", "Callout"],
  sounds: ["press", "release", "roll"],
} satisfies FigureMeta

type Page = 0 | 1 | 2 | 3
type Chart = "none" | "hours" | "days" | "band"
type View = { small: string; big: string; unit: string; chart: Chart; readout: string; hint: string; next: string }

const BASE = { x: 0, y: 0, z: 0, w: 150, d: 128, h: 8 }
const BODY = { x: 18, y: 10, z: BASE.h, w: 114, d: 50, h: 100 }
const COVER = { x: 26, y: BODY.y + BODY.d, z: BASE.h, w: 98, d: 26, h: 26 }
const KEY = { x: 66, y: 64, z: COVER.z + COVER.h, w: 52, d: 17, h: 5 }
const SCREEN = { x: 10, y: 9, w: 94, h: 34 }
const CHART = { x: 68, y: SCREEN.y + 29, w: 30, h: 18 }
const BIG = { x: 16, y: 35, size: 12, char: 7.2 }
const REGISTER = { places: 5, rise: 10.5, h: 13 }
const ROLL_STAGGER_MS = 50
const LAMPS = [
  { page: 1, label: "DAY", x: 16 },
  { page: 2, label: "WEEK", x: 46 },
  { page: 3, label: "TARIFF", x: 76 },
] as const
const NEXT: Readonly<Record<Page, Page>> = { 0: 1, 1: 2, 2: 3, 3: 1 }
const VIEWS: Readonly<Record<Page, View>> = {
  0: { small: "total import", big: "04213", unit: "kWh", chart: "none", readout: "total · 04213 kWh", hint: "Press display", next: "today" },
  1: { small: "today", big: "4.2", unit: "kWh", chart: "hours", readout: "4.2 kWh today", hint: "Press for this week", next: "this week" },
  2: { small: "this week", big: "27.6", unit: "kWh", chart: "days", readout: "27.6 kWh this week", hint: "Press for the tariff", next: "the tariff" },
  3: { small: "tariff · day", big: "24.5", unit: "p/kWh", chart: "band", readout: "tariff · 24.5p per kWh", hint: "Press for today", next: "today" },
}
const HOURS = [0.18, 0.12, 0.1, 0.14, 0.3, 0.62, 0.44, 0.36, 0.5, 0.82, 1, 0.58] as const
const DAYS = [0.62, 0.7, 0.55, 0.8, 0.74, 1, 0.48] as const
const PEAK = { from: 16 / 24, to: 19 / 24 }
const NIGHT = 7 / 24
const GLANDS = [36, 49, 62] as const
const CONDUIT = { x: 62, y: 108, w: 26, d: 12 }
const CABLES = GLANDS.map((g, k) =>
  path(
    curve(
      [COVER.x + g, COVER.y + COVER.d, BASE.h + 2.4],
      [COVER.x + g, COVER.y + COVER.d + 8, BASE.h + 0.6],
      [CONDUIT.x + 7 + k * 6, CONDUIT.y - 10, BASE.h + 0.6],
      [CONDUIT.x + 7 + k * 6, CONDUIT.y + CONDUIT.d / 2, BASE.h + 0.6],
    ),
  ),
)
const BARCODE = [0, 1.4, 2.2, 4, 5.6, 6.4, 8.2, 9, 10.8, 12.6, 13.4, 15, 16.8, 17.6, 19.4, 20.4] as const
const CYCLE = "M3.2 -2.4A4 4 0 1 0 4 1.2M3.2 -2.4V-5.2M3.2 -2.4H0.4"
const SEAL = { x: COVER.w - 8, y: 8 }
const OPTICAL_PORT = { x: 96, y: 60 }
const PORT_AT = [BODY.x + OPTICAL_PORT.x, BODY.y + BODY.d, BODY.z + BODY.h - OPTICAL_PORT.y] as const

type Wheel = { digit: string; before: string; rank: number }

const placesOf = (page: Page) => VIEWS[page].big.padEnd(REGISTER.places, " ").split("")

function wheelsOf(from: Page, to: Page): { wheels: Wheel[]; turning: number } {
  const before = placesOf(from)
  const after = placesOf(to)
  const wheels: Wheel[] = []
  let turning = 0
  for (let index = after.length - 1; index >= 0; index--) {
    const digit = after[index] ?? " "
    const was = before[index] ?? " "
    wheels[index] = { digit, before: was, rank: digit === was ? -1 : turning }
    if (digit !== was) turning++
  }
  return { wheels, turning }
}

function Chart({ chart }: { chart: Chart }) {
  if (chart === "hours")
    return HOURS.map((v, k) => <rect key={k} className="sm-bar" x={CHART.x + k * 2.6} y={CHART.y - v * CHART.h} width={1.7} height={v * CHART.h} rx={0.4} />)
  if (chart === "days") return DAYS.map((v, k) => <rect key={k} className="sm-bar" x={CHART.x + k * 4.4} y={CHART.y - v * CHART.h} width={3} height={v * CHART.h} rx={0.6} />)
  if (chart === "band")
    return (
      <>
        <rect className="sm-band" x={CHART.x} y={CHART.y - 7} width={CHART.w} height={5} rx={1} />
        <rect className="sm-night" x={CHART.x} y={CHART.y - 7} width={CHART.w * NIGHT} height={5} rx={1} />
        <rect className="sm-bar" x={CHART.x + CHART.w * PEAK.from} y={CHART.y - 7} width={CHART.w * (PEAK.to - PEAK.from)} height={5} />
        <path className="sm-now" d={`M${CHART.x + CHART.w * 0.58} ${CHART.y - 10}v8`} />
        <text className="ik-screen-text ik-dim" x={CHART.x} y={CHART.y - 12} fontSize={5.6}>
          peak 4-7
        </text>
      </>
    )
  return null
}

function Register({ page, from, clip }: { page: Page; from: Page; clip: string }) {
  return (
    <g clipPath={`url(#${clip})`}>
      {wheelsOf(from, page).wheels.map(({ digit, before, rank }, index) => {
        const x = BIG.x + index * BIG.char
        return (
          <g key={`${index}-${page}`} style={{ "--roll-at": `${Math.max(0, rank) * ROLL_STAGGER_MS}ms` } as CSSProperties}>
            {rank >= 0 ? (
              <text className="ik-screen-text sm-roll-out" x={x} y={BIG.y} fontSize={BIG.size}>
                {before}
              </text>
            ) : null}
            <text className={rank >= 0 ? "ik-screen-text sm-roll-in" : "ik-screen-text"} x={x} y={BIG.y} fontSize={BIG.size}>
              {digit}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export default function SmartMeter() {
  const [shown, setShown] = useState<{ page: Page; from: Page }>({ page: 0, from: 0 })
  const clip = useId().replace(/[^\w-]/g, "")
  const { page, from } = shown
  const turnTo = (next: Page) => setShown({ page: next, from: page })
  const demo = useDemoTap(
    () => {
      if (page === 0) turnTo(1)
    },
    { delay: 500 },
  )
  const press = () => {
    demo.dismiss()
    const next = NEXT[page]
    const { turning } = wheelsOf(page, next)
    if (turning > 0) playSound("roll", { count: turning, stagger: ROLL_STAGGER_MS / 1000 })
    turnTo(next)
  }

  const view = VIEWS[page]
  const resting = page === 0

  return (
    <Plate
      {...demo.plate}
      fig="Energy"
      name="Smart meter"
      hint={view.hint}
      readout={view.readout}
      className="fig-smart-meter"
      data-page={page}
      fit={[BASE, { ...BODY, z: 0, h: BODY.z + BODY.h }]}
      aspect={1.2}
      label="A home electricity meter on a wall board: a screen with a rolling register, three page lamps and a display key on its terminal cover. Press the key to roll the register through today's use, this week's use and the tariff."
    >
      <g ref={demo.ref}>
        <Box
          {...BASE}
          r={10}
          top={
            <>
              {[
                [8, 8],
                [BASE.w - 8, 8],
                [8, BASE.d - 8],
                [BASE.w - 8, BASE.d - 8],
              ].map(([cx, cy]) => (
                <circle key={`${cx}-${cy}`} className="ik-fill" cx={cx} cy={cy} r={1.6} />
              ))}
              <rect className="ik-well" x={CONDUIT.x} y={CONDUIT.y} width={CONDUIT.w} height={CONDUIT.d} rx={CONDUIT.d / 2} />
            </>
          }
        />
        <Box
          {...BODY}
          r={8}
          top={
            <>
              <rect className="ik-well" x={BODY.w / 2 - 11} y={7} width={22} height={5} rx={2.5} />
              {Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${32 + k * 10} ${BODY.d - 16}v8`} />
              ))}
              <circle className="ik-detail" cx={9} cy={BODY.d - 9} r={2} />
              <circle className="ik-detail" cx={BODY.w - 9} cy={BODY.d - 9} r={2} />
            </>
          }
          side={
            <>
              <rect className="ik-detail" x={10} y={14} width={30} height={26} rx={2} />
              {BARCODE.map((x) => (
                <path key={x} className="ik-detail" d={`M${15 + x} 19v10`} />
              ))}
              <path className="ik-detail" d="M15 34h14" />
              <circle className="ik-well" cx={25} cy={56} r={2.4} />
            </>
          }
          front={
            <>
              <defs>
                <clipPath id={`${clip}-screen`}>
                  <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={4} />
                </clipPath>
                <clipPath id={`${clip}-register`}>
                  <rect x={BIG.x - 1} y={BIG.y - REGISTER.rise} width={REGISTER.places * BIG.char + 2} height={REGISTER.h} />
                </clipPath>
              </defs>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={4} />
              <g clipPath={`url(#${clip}-screen)`}>
                <g key={page} className="ik-enter">
                  <text className="ik-screen-text ik-dim" x={BIG.x} y={18} fontSize={5.6}>
                    {view.small}
                  </text>
                  <text className="ik-screen-text ik-dim" x={BIG.x + view.big.length * BIG.char + 2} y={BIG.y} fontSize={6}>
                    {view.unit}
                  </text>
                  <Chart chart={view.chart} />
                </g>
                <Glow>
                  <Register page={page} from={from} clip={`${clip}-register`} />
                </Glow>
              </g>
              {LAMPS.map((lamp) => (
                <g key={lamp.page}>
                  <Glow on={page === lamp.page}>
                    <circle className="sm-lamp" data-on={page === lamp.page} cx={lamp.x} cy={50} r={2.2} />
                  </Glow>
                  <text className="ik-label sm-tag" x={lamp.x + 4.5} y={52}>
                    {lamp.label}
                  </text>
                </g>
              ))}
              <circle className="ik-fill" cx={16} cy={62} r={1.8} />
              <text className="ik-label sm-small" x={21} y={64}>
                1000 imp/kWh
              </text>
              <circle className="ik-detail" cx={OPTICAL_PORT.x} cy={OPTICAL_PORT.y} r={6} />
              <circle className="ik-well" cx={OPTICAL_PORT.x} cy={OPTICAL_PORT.y} r={3.4} />
            </>
          }
        />
        <Box
          {...COVER}
          r={5}
          top={
            <text className="ik-label sm-small" x={5} y={13}>
              230V 80A
            </text>
          }
          front={
            <>
              {[8, COVER.w - 8].map((cx) => (
                <g key={cx}>
                  <circle className="ik-well" cx={cx} cy={8} r={2.6} />
                  <path className="ik-detail" d={`M${cx - 1.6} 8h3.2`} />
                </g>
              ))}
              <path className="ik-detail" d={`M18 5h${COVER.w - 36}`} />
              <path className="ik-detail" d={`M${SEAL.x + 1.8} ${SEAL.y + 1.8}c2.6 2.4 2.4 5.4 -0.4 8.2`} />
              <circle className="ik-face" cx={SEAL.x + 1.2} cy={SEAL.y + 11.4} r={1.9} />
              <path className="ik-detail" d={`M${SEAL.x + 0.2} ${SEAL.y + 11.4}h2`} />
              {GLANDS.map((g) => (
                <path key={g} className="ik-detail" d={`M${g - 3.4} ${COVER.h}a3.4 3.4 0 0 1 6.8 0`} />
              ))}
            </>
          }
          side={<path className="ik-detail" d="M5 6h14M5 9.5h14" />}
        />
        {CABLES.map((d) => (
          <path key={d} className="ik-line" d={d} />
        ))}

        {resting && demo.phase !== "aim" && demo.phase !== "press" ? <Ripple {...KEY} r={5} /> : null}
        <Press label={`Show ${view.next}`} material="rubber" onPress={press} data-hot={resting}>
          <g>
            <Box
              {...KEY}
              r={5}
              top={
                <>
                  <text className="ik-label sm-key" x={7} y={11}>
                    DISPLAY
                  </text>
                  <path className="ik-detail ik-thick sm-cycle" d={CYCLE} transform={`translate(${KEY.w - 9} ${KEY.d / 2 + 0.6})`} />
                </>
              }
            />
          </g>
        </Press>
        <Callout at={PORT_AT} dx={60} dy={2} label="ir port" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
