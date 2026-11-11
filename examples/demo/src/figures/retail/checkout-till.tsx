import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, curve, front, Glow, Plate, Press, path, playSound, Ripple, Signal, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./checkout-till.css"

export const meta = {
  slug: "checkout-till",
  title: "Checkout till",
  industry: "retail",
  level: 2,
  blurb: "Press total: the till shows the sum, a signal runs down the cable, the printer's motor turns the paper roll and the receipt feeds out.",
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path", "front", "Callout"],
  sounds: ["press", "release", "paper", "process", "motor"],
} satisfies FigureMeta

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6
type Sale = { id: string; items: number; total: string }

const BASE = { x: 0, y: 0, z: 0, w: 184, d: 134, h: 8 }
const DRAWER = { x: 8, y: 44, z: BASE.h, w: 96, d: 78, h: 20 }
const NECK = { x: 46, y: 48, z: DRAWER.z + DRAWER.h, w: 20, d: 8, h: 10 }
const DISPLAY = { x: 18, y: 46, z: NECK.z + NECK.h, w: 76, d: 12, h: 32 }
const KEYBED = { x: 12, y: 64, z: DRAWER.z + DRAWER.h, w: 88, d: 48, h: 6 }
const KEY = { w: 11, d: 9, h: 3 }
const LABELS = [
  ["7", "8", "9", "−"],
  ["4", "5", "6", "+"],
  ["1", "2", "3", "0"],
] as const
const KEYS = LABELS.flatMap((row, r) => row.map((label, c) => ({ label, x: KEYBED.x + 6 + c * 13, y: KEYBED.y + 7 + r * 12, z: KEYBED.z + KEYBED.h, ...KEY })))
const TOTAL = { x: KEYBED.x + 60, y: KEYBED.y + 7, z: KEYBED.z + KEYBED.h, w: 23, d: 33, h: 5 }
const JACK = { x: DRAWER.x + DRAWER.w, y: 100, z: 13, w: 3, d: 6, h: 6 }
const PRINTER = { x: 122, y: 24, z: BASE.h, w: 48, d: 54, h: 22 }
const LID = { x: 125, y: 27, z: PRINTER.z + PRINTER.h, w: 42, d: 30, h: 6 }
const SLOT = { x: 8, y: 36.5, w: 32, d: 2.5 }
const PAPER = { x: PRINTER.x + 10, y: PRINTER.y + SLOT.y + SLOT.d / 2, z: PRINTER.z + PRINTER.h, w: 28 }
const CABLE = curve([JACK.x + JACK.w, JACK.y + 3, JACK.z + 3], [JACK.x + 14, JACK.y + 3, JACK.z - 1], [126, 98, BASE.h + 0.6], [134, 70, BASE.h + 0.6], 32)
const SIGNAL_DELAY_MS = 80
const SIGNAL_MS = 460
const ARRIVE_MS = SIGNAL_DELAY_MS + SIGNAL_MS
const FEED_MS = 900
const TIMING = { "--arrive": `${ARRIVE_MS}ms`, "--feed": `${FEED_MS}ms` } as CSSProperties
const ROLL_WINDOW = { x: 37, y: 11, r: 7.4 }
const ROLL = { paper: 5.8, core: 2.2 }
const SPOKES = [0, 120, 240]
  .map((deg) => {
    const a = (deg * Math.PI) / 180
    return `M${(Math.cos(a) * ROLL.core).toFixed(3)} ${(Math.sin(a) * ROLL.core).toFixed(3)}L${(Math.cos(a) * (ROLL.paper - 1.2)).toFixed(3)} ${(Math.sin(a) * (ROLL.paper - 1.2)).toFixed(3)}`
  })
  .join("")
const ROLL_AT = [PRINTER.x + PRINTER.w, PRINTER.y + PRINTER.d - ROLL_WINDOW.x, PRINTER.z + PRINTER.h - ROLL_WINDOW.y - ROLL.paper] as const
const SALES: readonly Sale[] = [
  { id: "0412", items: 4, total: "€18.40" },
  { id: "0413", items: 2, total: "€6.90" },
  { id: "0414", items: 3, total: "€11.25" },
]
const NEXT: Readonly<Record<Step, Step>> = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 1 }
const PREVIOUS: Readonly<Record<Step, Step>> = { 0: 0, 1: 6, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }
const TALLEST = 26 + 5 * 4

const saleOf = (step: Step): Sale => SALES[Math.max(0, step - 1) % SALES.length] ?? SALES[0]!
const heightOf = (sale: Sale) => 26 + 5 * sale.items
const tornTop = (h: number, w: number) => `M0 0V${-h + 1.2}${"l1.75 -1.2l1.75 1.2".repeat(Math.round(w / 3.5))}V0Z`

function Receipt({ sale, clip }: { sale: Sale; clip: string }) {
  const h = heightOf(sale)
  return (
    <>
      <path className="ik-face" d={tornTop(h, PAPER.w)} />
      <g clipPath={`url(#${clip})`}>
        <text className="ik-screen-text ik-dim" x={PAPER.w / 2} y={-h + 8} fontSize={4.4} textAnchor="middle">
          #{sale.id}
        </text>
        {Array.from({ length: sale.items }, (_, k) => (
          <path key={k} className="ik-detail" d={`M3 ${-h + 13 + k * 5}h${9 + ((k * 5) % 7)}M${PAPER.w - 9} ${-h + 13 + k * 5}h6`} />
        ))}
        <path className="ik-detail" d={`M3 -13h${PAPER.w - 6}`} strokeDasharray="1 2" />
        <text className="ik-screen-text" x={3} y={-4.6} fontSize={6.6}>
          {sale.total}
        </text>
      </g>
    </>
  )
}

function PaperRoll({ step, feeding }: { step: Step; feeding: boolean }) {
  return (
    <>
      <circle className="ik-well" cx={ROLL_WINDOW.x} cy={ROLL_WINDOW.y} r={ROLL_WINDOW.r} />
      <g transform={`translate(${ROLL_WINDOW.x} ${ROLL_WINDOW.y})`}>
        <circle className="ik-detail" r={ROLL.paper} />
        <g key={step} className={feeding ? "ct-roll" : undefined}>
          <path className="ik-detail" d={SPOKES} />
          <path className="ik-line" d={`M${ROLL.core} 0H${ROLL.paper}`} />
        </g>
        <circle className="ik-fill" r={ROLL.core - 0.6} />
      </g>
    </>
  )
}

function readoutOf(step: Step): string {
  const sale = saleOf(step)
  return step === 0 ? `${sale.items} items · open` : `${sale.items} items · ${sale.total}`
}

export default function CheckoutTill() {
  const [step, setStep] = useState<Step>(0)
  const stop = useRef(() => {})
  const timer = useRef(0)
  const clip = useId().replace(/:/g, "")
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stop.current()
    },
    [],
  )

  const total = (audible: boolean) => {
    window.clearTimeout(timer.current)
    stop.current()
    if (audible) {
      const tearing = step > 0 ? playSound("paper") : () => {}
      const travelling = playSound("process")
      stop.current = () => {
        tearing()
        travelling()
      }
      timer.current = window.setTimeout(() => {
        travelling()
        stop.current = playSound("motor", { duration: FEED_MS / 1000 })
      }, ARRIVE_MS)
    }
    setStep(NEXT[step])
  }
  const demo = useDemoTap(
    () => {
      if (step === 0) total(false)
    },
    { delay: 1100 },
  )
  const press = () => {
    demo.dismiss()
    total(true)
  }

  const sale = saleOf(step)
  const printed = step > 0
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const receipts = printed ? [{ step: PREVIOUS[step], state: "gone" }, { step, state: "out" }] : []

  return (
    <Plate
      {...demo.plate}
      fig="Retail"
      name="Checkout till"
      hint={printed ? "Press total for the next sale" : "Press total"}
      readout={readoutOf(step)}
      className="fig-checkout-till"
      style={TIMING}
      data-printed={printed}
      fit={[BASE, { ...DISPLAY, z: 0, h: DISPLAY.z + DISPLAY.h }, [PAPER.x, PAPER.y, PAPER.z + TALLEST + 2], [PAPER.x + PAPER.w, PAPER.y, PAPER.z + TALLEST + 2]]}
      aspect={1.3}
      label="A checkout till with a cash drawer, a keypad and a display, cabled to a receipt printer. Press total to sum the sale; a signal runs to the printer and the receipt feeds out."
    >
      <g ref={demo.ref}>
        <Box {...BASE} r={12} top={<rect className="ik-detail" x={8} y={8} width={BASE.w - 16} height={BASE.d - 16} rx={7} />} />
        <Box
          {...DRAWER}
          r={6}
          front={
            <>
              <path className="ik-detail" d={`M5 3.5h${DRAWER.w - 10}`} />
              <rect className="ik-well" x={34} y={8} width={28} height={5} rx={2.5} />
              <circle className="ik-well" cx={84} cy={11} r={2.4} />
              <path className="ik-detail" d="M84 9.6v2.8" />
            </>
          }
          side={Array.from({ length: 5 }, (_, k) => (
            <path key={k} className="ik-detail" d={`M${44 + k * 3.4} 5v10`} />
          ))}
        />
        <Box {...NECK} r={3} />
        <Box
          {...DISPLAY}
          r={4}
          top={<path className="ik-detail" d={`M8 ${DISPLAY.d / 2}h${DISPLAY.w - 16}`} />}
          front={
            <>
              <rect className="ik-screen" x={5} y={5} width={DISPLAY.w - 10} height={22} rx={3} />
              <Glow>
                <g key={`small-${step}`} className="ik-enter">
                  <text className="ik-screen-text ik-dim" x={10} y={12.6} fontSize={5.6}>
                    #{sale.id} · {printed ? "total" : "open"}
                  </text>
                </g>
                <g key={`big-${step}`} className="ik-enter">
                  <text className="ik-screen-text" x={10} y={23.6} fontSize={10}>
                    {printed ? sale.total : `${sale.items} items`}
                  </text>
                </g>
              </Glow>
              <circle className="ik-fill" cx={DISPLAY.w - 8} cy={29.5} r={1.2} />
            </>
          }
        />
        <Box {...KEYBED} r={5} top={<path className="ik-detail" d={`M6 ${KEYBED.d - 4}h${KEYBED.w - 12}`} />} />
        {KEYS.map((key) => (
          <Box
            key={key.label}
            {...key}
            r={2}
            top={
              <text className="ik-label ct-key" x={3.6} y={6.4}>
                {key.label}
              </text>
            }
          />
        ))}

        {step === 0 && !aiming ? <Ripple {...TOTAL} r={4} /> : null}
        <Press label="Total the sale" material="plastic" onPress={press} data-hot={!printed}>
          <g>
            <Box
              {...TOTAL}
              r={4}
              top={
                <>
                  <path className="ik-detail ik-thick ct-equals" d="M8.5 9h6M8.5 12.5h6" />
                  <text className="ik-label ct-total" x={2.6} y={25}>
                    TOTAL
                  </text>
                </>
              }
            />
          </g>
        </Press>

        <Box {...JACK} r={1} />
        <path className="ik-line" d={path(CABLE)} />
        {printed ? <Signal key={step} points={CABLE} delay={SIGNAL_DELAY_MS} duration={SIGNAL_MS} /> : null}

        <Box
          {...PRINTER}
          r={6}
          top={
            <>
              <rect className="ik-well" x={SLOT.x} y={SLOT.y} width={SLOT.w} height={SLOT.d} rx={1.2} />
              <path className="ik-detail" d={`M${SLOT.x - 1} ${SLOT.y + 5}${"l1 1.1l1 -1.1".repeat(17)}`} />
            </>
          }
          front={
            <>
              <circle className="ct-led" cx={7} cy={7} r={2.2} />
              <Glow key={`led-${step}`} on={printed} className="ct-led-glow">
                <circle className="ct-led-lit" data-on={printed} cx={7} cy={7} r={2.2} />
              </Glow>
              <rect className="ik-well" x={13} y={4.5} width={11} height={5} rx={2.5} />
              <text className="ik-label ct-tag" x={13.4} y={16.5}>
                FEED
              </text>
              {Array.from({ length: 5 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${31 + k * 3} 5v12`} />
              ))}
            </>
          }
          side={
            <>
              {Array.from({ length: 6 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${10 + k * 3.4} 6v10`} />
              ))}
              <PaperRoll step={step} feeding={printed} />
            </>
          }
        />
        <Box {...LID} r={8} top={<path className="ik-detail" d={`M6 ${LID.d - 6}h${LID.w - 12}`} />} />

        <g transform={front(PAPER.x, PAPER.y, PAPER.z)}>
          <defs>
            <clipPath id={`${clip}-slot`}>
              <rect x={-4} y={-120} width={PAPER.w + 8} height={120} />
            </clipPath>
            <clipPath id={`${clip}-paper`}>
              <rect x={0.5} y={-120} width={PAPER.w - 1} height={120} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clip}-slot)`}>
            <path className="ik-face" d={tornTop(3, PAPER.w)} />
            {receipts.map((receipt) => {
              const shown = saleOf(receipt.step)
              return (
                <g key={receipt.step} className="ct-receipt" data-state={receipt.state}>
                  <g className="ct-feed" style={{ "--rh": `${heightOf(shown)}px` } as CSSProperties}>
                    <Receipt sale={shown} clip={`${clip}-paper`} />
                  </g>
                </g>
              )
            })}
          </g>
        </g>

        <Callout at={ROLL_AT} dx={14} dy={26} label="paper roll" />
        <Cursor at={[TOTAL.x + TOTAL.w / 2, TOTAL.y + TOTAL.d / 2, TOTAL.z + TOTAL.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
