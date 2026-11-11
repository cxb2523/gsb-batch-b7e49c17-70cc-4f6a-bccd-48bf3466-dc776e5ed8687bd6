import { type CSSProperties, useId, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, playSound, Ripple, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./shelf-label.css"

export const meta = {
  slug: "shelf-label",
  title: "Shelf label",
  industry: "retail",
  level: 1,
  blurb: "Press the update key: the e-paper label on the shelf edge flashes, the digits that changed flip over one by one from the right, and its light blinks.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "Callout"],
  sounds: ["press", "release", "roll"],
} satisfies FigureMeta

type Step = 0 | 1 | 2 | 3
type Glyph = { glyph: string; before: string; rank: number }

const DECK = { x: 0, y: 0, z: 0, w: 168, d: 74, h: 38 }
const RAIL = { x: 9, y: DECK.d, z: 5, w: 150, d: 3, h: 28 }
const LABEL = { x: 40, y: RAIL.y + RAIL.d, z: 3, w: 76, d: 6, h: 34 }
const SCREEN = { x: 3, y: 3, w: 56, h: 28 }
const KEY = { x: 116, y: 46, z: DECK.h, w: 46, d: 20, h: 5 }
const CAN = { w: 18, h: 28 }
const CANS = [8, 30].flatMap((y) => [26, 48, 70, 92].map((x) => ({ x, y, z: DECK.h, w: CAN.w, d: CAN.w, h: CAN.h })))
const STACK = { x: 26, y: 8, z: 0, w: 84, d: 40, h: DECK.h + CAN.h }
const PRICE: Readonly<Record<Step, string>> = { 0: "€2.99", 1: "€2.49", 2: "€1.99", 3: "€2.99" }
const WAS: Readonly<Record<Step, string | null>> = { 0: null, 1: "€2.99", 2: "€2.49", 3: "€1.99" }
const NEXT: Readonly<Record<Step, Step>> = { 0: 1, 1: 2, 2: 3, 3: 1 }
const UNIT = "€11.96/l"
const BARS = [0, 1.6, 3.8, 5, 7.2, 8.6, 10.8] as const
const REFRESH = "M3.4 -1.6A3.6 3.6 0 1 0 3.6 1.2M3.6 -3.6V-1.4H1.4"
const PRICE_TEXT = { x: SCREEN.x + 4, y: SCREEN.y + 18.6, size: 11, char: 6.6 }
const FLIP_STAGGER_MS = 50
const LED = { x: SCREEN.x + SCREEN.w + 8.5, y: 8, r: 2 }
const E_PAPER_AT = [LABEL.x + SCREEN.x + 6, LABEL.y + LABEL.d, LABEL.z + LABEL.h - SCREEN.y - SCREEN.h - 1.6] as const

function glyphsOf(step: Step): { glyphs: Glyph[]; turning: number } {
  const after = PRICE[step].split("")
  const before = (WAS[step] ?? PRICE[step]).split("")
  const glyphs: Glyph[] = []
  let turning = 0
  for (let index = after.length - 1; index >= 0; index--) {
    const glyph = after[index] ?? " "
    const was = before[index] ?? " "
    glyphs[index] = { glyph, before: was, rank: glyph === was ? -1 : turning }
    if (glyph !== was) turning++
  }
  return { glyphs, turning }
}

function Price({ step }: { step: Step }) {
  return glyphsOf(step).glyphs.map(({ glyph, before, rank }, index) => {
    const x = PRICE_TEXT.x + index * PRICE_TEXT.char
    return (
      <g key={index} style={{ "--flip-at": `${Math.max(0, rank) * FLIP_STAGGER_MS}ms` } as CSSProperties}>
        {rank >= 0 ? (
          <text className="ik-screen-text sl-flip-out" x={x} y={PRICE_TEXT.y} fontSize={PRICE_TEXT.size}>
            {before}
          </text>
        ) : null}
        <text className={rank >= 0 ? "ik-screen-text sl-flip-in" : "ik-screen-text"} x={x} y={PRICE_TEXT.y} fontSize={PRICE_TEXT.size}>
          {glyph}
        </text>
      </g>
    )
  })
}

function readoutOf(step: Step): string {
  const was = WAS[step]
  return was ? `${PRICE[step]} · was ${was}` : `${PRICE[step]} · shelf price`
}

export default function ShelfLabel() {
  const [step, setStep] = useState<Step>(0)
  const clip = useId().replace(/:/g, "")
  const update = () => setStep(NEXT[step])
  const demo = useDemoTap(
    () => {
      if (step === 0) update()
    },
    { delay: 500 },
  )
  const press = () => {
    demo.dismiss()
    const { turning } = glyphsOf(NEXT[step])
    if (turning > 0) playSound("roll", { count: turning, stagger: FLIP_STAGGER_MS / 1000 })
    update()
  }

  const was = WAS[step]
  const aiming = demo.phase === "aim" || demo.phase === "press"

  return (
    <Plate
      {...demo.plate}
      fig="Retail"
      name="Shelf label"
      hint={step === 0 ? "Press update" : "Press update again"}
      readout={readoutOf(step)}
      className="fig-shelf-label"
      data-synced={step > 0}
      fit={[DECK, RAIL, LABEL, KEY, STACK]}
      aspect={1.3}
      label="An electronic shelf label clipped to the price rail of a shelf of cold brew cans, with an update key on the shelf. Press update to flip the label to a new price; the old price is shown struck through."
    >
      <g ref={demo.ref}>
        <Box
          {...DECK}
          r={8}
          top={
            <>
              <path className="ik-detail" d={`M8 ${DECK.d - 5}h${DECK.w - 16}`} />
              {[20, 116].map((x) => (
                <path key={x} className="ik-detail" d={`M${x} 6v${DECK.d - 16}`} />
              ))}
            </>
          }
          side={
            <>
              {Array.from({ length: 6 }, (_, k) => (
                <rect key={k} className="ik-well" x={10 + k * 9} y={9} width={2.4} height={7} rx={1} />
              ))}
              <path className="ik-detail" d={`M6 26h${DECK.d - 12}`} />
            </>
          }
        />
        {CANS.map((can) => (
          <Box
            key={`${can.x}-${can.y}`}
            {...can}
            r={CAN.w / 2}
            top={
              <>
                <circle className="ik-detail" cx={CAN.w / 2} cy={CAN.w / 2} r={6.6} />
                <rect className="ik-detail" x={CAN.w / 2 - 2.6} y={4.6} width={5.2} height={3} rx={1.4} />
              </>
            }
          />
        ))}

        {step === 0 && !aiming ? <Ripple {...KEY} r={5} /> : null}
        <Press label="Update the shelf price" material="rubber" onPress={press} data-hot={step === 0}>
          <g>
            <Box
              {...KEY}
              r={5}
              top={
                <>
                  <text className="ik-label sl-key" x={5} y={12.6}>
                    UPDATE
                  </text>
                  <path className="ik-detail ik-thick sl-glyph" d={REFRESH} transform={`translate(${KEY.w - 9} ${KEY.d / 2})`} />
                </>
              }
            />
          </g>
        </Press>

        <Box {...RAIL} r={1.5} front={<path className="ik-detail" d={`M2 2.4h${RAIL.w - 4}M2 ${RAIL.h - 2.4}h${RAIL.w - 4}`} />} />
        <Box
          {...LABEL}
          r={2.5}
          front={
            <>
              <defs>
                <clipPath id={`${clip}-screen`}>
                  <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2} />
                </clipPath>
              </defs>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={2} />
              <g clipPath={`url(#${clip}-screen)`}>
                <text className="ik-screen-text ik-dim" x={SCREEN.x + 4} y={SCREEN.y + 7} fontSize={5.4}>
                  cold brew
                </text>
                <g key={`price-${step}`}>
                  <Price step={step} />
                </g>
                <g key={`sub-${step}`} className={step ? "ik-enter sl-later" : undefined}>
                  {was ? (
                    <>
                      <text className="ik-screen-text ik-dim" x={SCREEN.x + 4} y={SCREEN.y + 25.4} fontSize={5.2}>
                        was
                      </text>
                      <text className="ik-screen-text ik-dim sl-strike" x={SCREEN.x + 17} y={SCREEN.y + 25.4} fontSize={5.2}>
                        {was}
                      </text>
                    </>
                  ) : (
                    <text className="ik-screen-text ik-dim" x={SCREEN.x + 4} y={SCREEN.y + 25.4} fontSize={5.2}>
                      {UNIT}
                    </text>
                  )}
                </g>
                {step ? <rect key={`flash-${step}`} className="sl-flash" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} /> : null}
              </g>
              <circle className="sl-lens" cx={LED.x} cy={LED.y} r={LED.r} />
              <Glow key={`led-${step}`} on={step > 0} className="sl-led-glow">
                <circle className="sl-led" data-on={step > 0} cx={LED.x} cy={LED.y} r={LED.r} />
              </Glow>
              {BARS.map((x) => (
                <path key={x} className="ik-detail" d={`M${SCREEN.x + SCREEN.w + 3.4 + x} 15v12`} />
              ))}
            </>
          }
          side={<path className="ik-detail" d={`M1.5 3v${LABEL.h - 6}`} />}
        />

        <Callout at={E_PAPER_AT} dx={-16} dy={18} label="e-paper" />
        <Cursor at={[KEY.x + KEY.w / 2, KEY.y + KEY.d / 2, KEY.z + KEY.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
