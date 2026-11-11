import { type CSSProperties, useId, useState } from "react"
import { Box, Plate, Press, playSound } from "react-isokit"
import { Callout } from "react-isokit/drafting"
import "./tally-counter.css"
import type { FigureMeta } from "../../catalog/figure-meta"

const BODY = { x: 0, y: 0, z: 0, w: 64, d: 40, h: 50 }
const STEM = { x: 22, y: 10, z: 50, w: 20, d: 20, h: 10 }
const CAP = { x: 18, y: 6, z: 60, w: 28, d: 28, h: 4 }
const KNOB = { x: 64, y: 13, z: 28, w: 6, d: 12, h: 12 }
const WINDOW = { x: 8, y: 10, w: 48, h: 18 }
const WHEELS = 4
const PITCH = WINDOW.w / WHEELS
const DIGIT_Y = WINDOW.y + 13.5
const CYCLE = 10 ** WHEELS
const ROLL_STAGGER_MS = 50
const ROLL_TIMING = { "--roll-stagger": `${ROLL_STAGGER_MS}ms` } as CSSProperties
const KNOB_RIBS = [3, 6, 9].map((y) => <path key={y} className="ik-detail" d={`M1.2 ${y}h3.6`} />)
const LABEL_AT = [WINDOW.x, BODY.y + BODY.d, BODY.h - WINDOW.y - WINDOW.h / 2] as const

type Tally = { count: number; previous: number; reset: boolean }
const START: Tally = { count: 0, previous: 0, reset: false }

const wheelsOf = (count: number) => String(count).padStart(WHEELS, "0").split("")

function turnOrder(now: readonly string[], then: readonly string[]): number[] {
  const order: number[] = []
  let next = 0
  for (let index = now.length - 1; index >= 0; index--) order[index] = now[index] === then[index] ? -1 : next++
  return order
}

export function TallyCounter({ theme }: { theme: string }) {
  const [tally, setTally] = useState(START)
  const clip = `tally-${useId().replace(/[^\w-]/g, "")}`
  const wheels = wheelsOf(tally.count)
  const before = wheelsOf(tally.previous)
  const order = turnOrder(wheels, before)

  const turn = (count: number, reset: boolean) => {
    const turning = turnOrder(wheelsOf(count), wheels).filter((rank) => rank >= 0).length
    setTally({ count, previous: tally.count, reset })
    if (turning) playSound("roll", { count: turning, stagger: ROLL_STAGGER_MS / 1000 })
  }

  return (
    <Plate
      fig="Fig 6"
      name={theme}
      hint="Press the top"
      readout={`${tally.reset ? "reset · " : ""}count ${wheels.join("")}`}
      className="fig-tally-counter"
      style={ROLL_TIMING}
      fit={[BODY, CAP, KNOB]}
      aspect={1.1}
      pad={0.14}
      label={`A tally counter in the ${theme} theme. Press the top to count; the side knob resets it.`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} rx={3} />
        </clipPath>
      </defs>
      <Box
        {...BODY}
        r={14}
        front={
          <>
            <rect className="ik-screen" x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} rx={3} />
            <g clipPath={`url(#${clip})`}>
              {wheels.map((digit, index) => {
                const rank = order[index] ?? -1
                const x = WINDOW.x + PITCH * index + PITCH / 2
                return (
                  <g key={`${index}-${tally.count}`} style={{ "--i": rank } as CSSProperties}>
                    {rank >= 0 && (
                      <text className="ik-screen-text wheel-out" x={x} y={DIGIT_Y} fontSize={11} textAnchor="middle">
                        {before[index]}
                      </text>
                    )}
                    <text className={rank >= 0 ? "ik-screen-text wheel-in" : "ik-screen-text"} x={x} y={DIGIT_Y} fontSize={11} textAnchor="middle">
                      {digit}
                    </text>
                  </g>
                )
              })}
            </g>
            {[1, 2, 3].map((i) => (
              <path key={i} className="ik-detail" d={`M${WINDOW.x + i * PITCH} ${WINDOW.y + 2}v${WINDOW.h - 4}`} />
            ))}
            <circle className="ik-well" cx={32} cy={39} r={4} />
          </>
        }
      />
      <Press label="Reset the count" material="metal" onPress={() => turn(0, true)} data-hot={tally.reset}>
        <g>
          <Box
            {...KNOB}
            r={3}
            top={KNOB_RIBS}
            front={KNOB_RIBS}
            side={
              <>
                <circle className="ik-detail" cx={6} cy={6} r={2.6} />
                <path className="ik-detail" d="M4.4 6h3.2" />
              </>
            }
          />
        </g>
      </Press>
      <Press label="Count one more" material="metal" onPress={() => turn((tally.count + 1) % CYCLE, false)} data-hot={!tally.reset}>
        <g>
          <Box {...STEM} r={9} />
          <Box {...CAP} r={13} top={<circle className="ik-detail" cx={CAP.w / 2} cy={CAP.d / 2} r={8} />} />
        </g>
      </Press>
      <Callout at={LABEL_AT} dx={-8} dy={-22} label="4 wheels" />
    </Plate>
  )
}

export const meta = {
  slug: "tally-counter",
  title: "Tally counter",
  industry: "agents",
  level: 1,
  blurb: "Press the plunger and the count rolls on, carrying wheel to wheel; the side knob resets it.",
  uses: ["Plate", "Box", "Press", "playSound", "Callout"],
  sounds: ["press", "release", "roll"],
} satisfies FigureMeta

export default function TallyCounterFigure() {
  return <TallyCounter theme="Default" />
}
