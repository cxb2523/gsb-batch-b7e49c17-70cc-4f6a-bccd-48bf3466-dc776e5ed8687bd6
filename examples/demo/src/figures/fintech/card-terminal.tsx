import { type CSSProperties, useEffect, useId, useRef, useState } from "react"
import { Box, Cursor, Glow, Plate, Press, playSound, project, Ripple, useDemoTap } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./card-terminal.css"

export const meta = {
  slug: "card-terminal",
  title: "Card terminal",
  industry: "fintech",
  level: 1,
  blurb: "Press OK: the screen goes from the amount to approved, the status light comes on and the printer feeds out the receipt.",
  uses: ["Plate", "Box", "Press", "Glow", "Ripple", "Cursor", "useDemoTap", "project", "Callout"],
  sounds: ["press", "release", "success", "motor", "paper"],
} satisfies FigureMeta

const DECK = { x: 0, y: 0, z: 0, w: 96, d: 164, h: 14 }
const HEAD = { x: 0, y: 0, z: DECK.h, w: 96, d: 56, h: 34 }
const SLOT_TOP = HEAD.z + HEAD.h
const ROLL = { x: 10, y: 6, z: SLOT_TOP, w: 76, d: 24, h: 6 }
const PAPER = { x: 24, y: ROLL.y + ROLL.d + 2, z: SLOT_TOP, w: 48, d: 1.5, h: 11 }
const FEED = 16
const RECEIPT = { ...PAPER, z: SLOT_TOP - FEED, h: PAPER.h + FEED }
const FED = { ...PAPER, h: PAPER.h + FEED }
const FEED_MS = 900
const RISE = 120
const KEY = { w: 22, d: 13, h: 3 }
const COL_X = 9.5
const COL_PITCH = 29
const ROW_Y = 66
const ROW_PITCH = 17
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const
const KEYS = DIGITS.map((label, i) => ({ label, x: COL_X + (i % 3) * COL_PITCH, y: ROW_Y + Math.floor(i / 3) * ROW_PITCH }))
const FN_Y = ROW_Y + 4 * ROW_PITCH + 2
const CANCEL = { x: COL_X, y: FN_Y, z: DECK.h, w: KEY.w, d: 15, h: KEY.h }
const CLEAR = { ...CANCEL, x: COL_X + COL_PITCH }
const OK = { ...CANCEL, x: COL_X + 2 * COL_PITCH, h: 4 }
const CARD = { x: 20, y: DECK.d, z: 3.4, w: 56, d: 30, h: 1.6 }
const SCREEN = { x: 13, y: 5, w: 70, h: 24 }
const SALES = ["€24.90", "€8.40", "€61.00", "€3.20"] as const
const CYCLE = 2 * SALES.length
const TEAR_Y = PAPER.y - HEAD.y + PAPER.d + 2.4
const TEAR_TEETH = Array.from({ length: 27 }, (_, k) => `${k === 0 ? "M" : "L"}${PAPER.x - 3 + k * 2} ${TEAR_Y + (k % 2) * 1.3}`).join("")
const RECEIPT_ROWS = [
  { y: PAPER.h + 1.5, item: 18, price: 6 },
  { y: PAPER.h + 4.5, item: 12, price: 6 },
  { y: PAPER.h + 7.5, item: 22, price: 6 },
] as const
const RECEIPT_RULE = PAPER.h + 10.5
const RECEIPT_TOTAL = PAPER.h + 13.5
const [LEFT_X, LEFT_Y] = project(PAPER.x - 1, PAPER.y + PAPER.d, SLOT_TOP)
const [FRONT_X, FRONT_Y] = project(PAPER.x + PAPER.w, PAPER.y + PAPER.d, SLOT_TOP)
const [RIGHT_X, RIGHT_Y] = project(PAPER.x + PAPER.w, PAPER.y - 1, SLOT_TOP)
const SLOT_CLIP = `M${LEFT_X} ${LEFT_Y - RISE}L${LEFT_X} ${LEFT_Y}L${FRONT_X} ${FRONT_Y}L${RIGHT_X} ${RIGHT_Y}L${RIGHT_X} ${RIGHT_Y - RISE}Z`
const FEEDING = { "--feed": `${FEED_MS}ms`, "--rise": `${-FEED}px` } as CSSProperties

const saleOf = (presses: number) => SALES[Math.floor(presses / 2) % SALES.length] ?? SALES[0]

export default function CardTerminal() {
  const [presses, setPresses] = useState(0)
  const clip = useId().replace(/[^\w-]/g, "")
  const stopResult = useRef(() => {})
  const stopMotor = useRef(() => {})
  useEffect(
    () => () => {
      stopResult.current()
      stopMotor.current()
    },
    [],
  )

  const approved = presses % 2 === 1
  const amount = saleOf(presses)
  const next = (audible: boolean) => {
    const following = (presses % CYCLE) + 1
    stopResult.current()
    stopMotor.current()
    if (audible && following % 2 === 1) {
      stopResult.current = playSound("success")
      stopMotor.current = playSound("motor", { duration: FEED_MS / 1000 })
    } else if (audible) {
      stopResult.current = playSound("paper")
    }
    setPresses(following)
  }
  const demo = useDemoTap(
    () => {
      if (presses === 0) next(false)
    },
    { delay: 500 },
  )
  const press = () => {
    demo.dismiss()
    next(true)
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"

  return (
    <Plate
      {...demo.plate}
      fig="Fintech"
      name="Card terminal"
      hint={approved ? "Press OK for the next sale" : "Press OK"}
      readout={`${amount} · ${approved ? "approved · receipt out" : "enter pin"}`}
      className="fig-card-terminal"
      data-approved={approved}
      fit={[DECK, { ...HEAD, z: 0, h: SLOT_TOP }, FED, CARD]}
      aspect={1.25}
      label="A countertop card terminal with a receipt printer, a screen, a keypad and a card in its chip slot. Press the OK key to approve the payment and print the receipt; press it again to tear it off and ring up the next sale."
    >
      <g ref={demo.ref}>
        <defs>
          <clipPath id={clip}>
            <path d={SLOT_CLIP} />
          </clipPath>
        </defs>
        <Box
          {...DECK}
          r={12}
          top={
            <>
              <rect className="ik-detail" x={4} y={HEAD.d + 4} width={DECK.w - 8} height={DECK.d - HEAD.d - 9} rx={6} />
              <circle className="ik-fill" cx={DECK.w / 2} cy={DECK.d - 2.5} r={0.9} />
            </>
          }
          front={
            <>
              <rect className="ik-well" x={CARD.x - DECK.x - 4} y={DECK.h - CARD.z - CARD.h - 0.8} width={CARD.w + 8} height={CARD.h + 1.6} rx={1.2} />
              <path className="ik-detail" d={`M15 3.5h${DECK.w - 30}`} />
            </>
          }
          side={<path className="ik-detail" d={`M15 7h${DECK.d - 30}`} />}
        />
        <Box
          {...HEAD}
          r={12}
          top={
            <>
              <rect className="ik-well" x={PAPER.x - 3} y={PAPER.y - HEAD.y - 1.2} width={PAPER.w + 6} height={PAPER.d + 2.4} rx={1.2} />
              <path className="ik-detail" d={TEAR_TEETH} />
              <g className="ik-detail" transform={`translate(${HEAD.w / 2 - 6} ${HEAD.d - 10})`}>
                <path d="M0 -2.2a3 3 0 0 1 0 4.4" />
                <path d="M2.4 -4.4a6 6 0 0 1 0 8.8" />
                <path d="M4.8 -6.6a9 9 0 0 1 0 13.2" />
              </g>
              <Glow on={approved}>
                <circle className="ct-lamp" cx={HEAD.w - 14} cy={HEAD.d - 10} r={2.6} />
              </Glow>
            </>
          }
          front={
            <>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={3} />
              <Glow>
                <g key={presses} className="ik-enter">
                  <text className="ik-screen-text ik-dim" x={SCREEN.x + 6} y={SCREEN.y + 8} fontSize={5.6}>
                    {approved ? `${amount} · ••42` : "enter pin · ••••"}
                  </text>
                  <text className="ik-screen-text" x={SCREEN.x + 6} y={SCREEN.y + 19.5} fontSize={9}>
                    {approved ? "approved" : amount}
                  </text>
                  {approved ? <path className="ik-screen-line" d={`M${SCREEN.x + 60} ${SCREEN.y + 15}l3 3 6-6.5`} /> : null}
                </g>
              </Glow>
            </>
          }
          side={
            <>
              <rect className="ik-well" x={15} y={9} width={HEAD.d - 30} height={2.4} rx={1.2} />
              {Array.from({ length: 5 }, (_, k) => (
                <path key={k} className="ik-detail" d={`M${17 + k * 3.4} 17v11`} />
              ))}
            </>
          }
        />
        <Box
          {...ROLL}
          r={8}
          top={
            <>
              <path className="ik-detail" d={`M6 ${ROLL.d - 6}h${ROLL.w - 12}`} />
              <rect className="ik-detail" x={ROLL.w / 2 - 7} y={4} width={14} height={4} rx={2} />
            </>
          }
        />
        <g clipPath={`url(#${clip})`}>
          <g className="ct-receipt" style={FEEDING}>
            <Box
              {...RECEIPT}
              front={
                <>
                  <path className="ik-detail" d={`M6 4h${PAPER.w - 24}M6 7h${PAPER.w - 30}`} />
                  <path className="ik-detail" d={`M${PAPER.w - 12} 4h6M${PAPER.w - 12} 7h6`} />
                  {RECEIPT_ROWS.map((row) => (
                    <path key={row.y} className="ik-detail" d={`M6 ${row.y}h${row.item}M${PAPER.w - 6 - row.price} ${row.y}h${row.price}`} />
                  ))}
                  <path className="ik-detail ct-rule" d={`M6 ${RECEIPT_RULE}h${PAPER.w - 12}`} />
                  <path className="ik-line" d={`M6 ${RECEIPT_TOTAL}h10M${PAPER.w - 16} ${RECEIPT_TOTAL}h10`} />
                </>
              }
            />
          </g>
        </g>

        {KEYS.map((key) => (
          <Box
            key={key.label}
            x={key.x}
            y={key.y}
            z={DECK.h}
            w={KEY.w}
            d={KEY.d}
            h={KEY.h}
            r={3}
            top={
              <text className="ik-label ct-digit" x={KEY.w / 2} y={KEY.d / 2 + 2.2} textAnchor="middle">
                {key.label}
              </text>
            }
          />
        ))}
        <Box {...CANCEL} r={3} top={<path className="ik-detail ik-thick" d={`M${CANCEL.w / 2 - 2.6} ${CANCEL.d / 2 - 2.6}l5.2 5.2m0-5.2l-5.2 5.2`} />} />
        <Box {...CLEAR} r={3} top={<path className="ik-detail ik-thick" d={`M${CLEAR.w / 2 + 1.6} ${CLEAR.d / 2 - 3}l-3.2 3 3.2 3`} />} />

        {presses || aiming ? null : <Ripple {...OK} r={3} />}
        <Press label={approved ? "Ring up the next sale" : "Approve the payment"} material="rubber" onPress={press} data-hot={!approved}>
          <g>
            <Box
              {...OK}
              r={3}
              top={
                <>
                  <circle className="ik-detail ik-thick" cx={6.5} cy={OK.d / 2} r={2.6} />
                  <text className="ik-label ct-ok" x={11} y={OK.d / 2 + 2.2}>
                    OK
                  </text>
                </>
              }
            />
          </g>
        </Press>

        <Box
          {...CARD}
          r={2}
          top={
            <>
              <path className="ik-detail" d={`M6 ${CARD.d - 13}h8M17 ${CARD.d - 13}h8M28 ${CARD.d - 13}h8M39 ${CARD.d - 13}h8`} />
              <path className="ik-detail" d={`M6 ${CARD.d - 7}h20`} />
              <circle className="ik-detail" cx={CARD.w - 12} cy={CARD.d - 7} r={3} />
              <circle className="ik-detail" cx={CARD.w - 8} cy={CARD.d - 7} r={3} />
            </>
          }
        />

        <Callout at={[ROLL.x + 4, ROLL.y + ROLL.d - 4, ROLL.z + ROLL.h]} dx={-20} dy={-14} label="printer" />
        <Cursor at={[OK.x + OK.w / 2, OK.y + OK.d / 2, OK.z + OK.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
