import { attribute, type FigureFiles, quoted, scope, type TemplateInput } from "./template-input.ts"

export function levelTwoCauseAndEffect(input: TemplateInput): FigureFiles {
  const tsx = `import { useEffect, useRef, useState } from "react"
import { Box, Cursor, curve, Glow, Plate, Press, path, playSound, Ripple, Signal, useDemoTap } from "react-isokit"
import type { FigureMeta } from "../../catalog/figure-meta"
import "./${input.slug}.css"

export const meta = {
  slug: ${quoted(input.slug)},
  title: ${quoted(input.title)},
  industry: ${quoted(input.industry)},
  level: 2,
  blurb: ${quoted(input.blurb)},
  uses: ["Plate", "Box", "Press", "Glow", "Signal", "Ripple", "Cursor", "useDemoTap", "curve", "path"],
  sounds: ["press", "release", "relay", "done"],
} satisfies FigureMeta

const SENDER = { x: 0, y: 78, z: 0, w: 62, d: 44, h: 16 }
const RECEIVER = { x: 96, y: 0, z: 0, w: 64, d: 52, h: 46 }
const SCREEN = { x: 8, y: 8, w: 48, h: 22 }
const CABLE = curve([SENDER.x + SENDER.w, SENDER.y + 22, 1], [SENDER.x + SENDER.w + 34, SENDER.y + 22, 1], [RECEIVER.x + 32, RECEIVER.y + RECEIVER.d + 34, 1], [RECEIVER.x + 32, RECEIVER.y + RECEIVER.d, 1])
const SIGNAL_DELAY_MS = 80
const SIGNAL_MS = 360
const ARRIVAL_MS = SIGNAL_DELAY_MS + SIGNAL_MS

export default function ${input.componentName}() {
  const [sent, setSent] = useState(0)
  const [arrived, setArrived] = useState(false)
  const arrival = useRef(0)
  const stopSound = useRef(() => {})
  useEffect(
    () => () => {
      window.clearTimeout(arrival.current)
      stopSound.current()
    },
    [],
  )
  const send = (audible: boolean) => {
    window.clearTimeout(arrival.current)
    stopSound.current()
    setSent((count) => count + 1)
    setArrived(false)
    arrival.current = window.setTimeout(() => {
      setArrived(true)
      if (!audible) return
      playSound("relay")
      stopSound.current = playSound("done")
    }, ARRIVAL_MS)
  }
  const demo = useDemoTap(() => send(false))
  const press = () => {
    demo.dismiss()
    send(true)
  }
  const aiming = demo.phase === "aim" || demo.phase === "press"
  const readout = sent === 0 ? "idle" : arrived ? \`delivered · \${sent}\` : "sending"
  return (
    <Plate
      {...demo.plate}
      fig="${attribute(input.industryTitle)}"
      name="${attribute(input.title)}"
      hint="Press the sender"
      readout={readout}
      className="fig-${input.slug}"
      data-arrived={arrived}
      fit={[SENDER, RECEIVER]}
      aspect={1.3}
      label="${attribute(input.label)}"
    >
      <g ref={demo.ref}>
        <path className="ik-line" d={path(CABLE)} />
        {sent ? <Signal key={sent} points={CABLE} delay={SIGNAL_DELAY_MS} duration={SIGNAL_MS} /> : null}
        {sent || aiming ? null : <Ripple x={SENDER.x} y={SENDER.y} z={SENDER.z} w={SENDER.w} d={SENDER.d} r={8} />}
        <Press label="Send to the receiver" material="rubber" onPress={press} data-hot={sent === 0}>
          <g>
            <Box {...SENDER} r={8} top={<circle className="ik-detail" cx={SENDER.w / 2} cy={SENDER.d / 2} r={9} />} />
          </g>
        </Press>
        <Box
          {...RECEIVER}
          r={8}
          top={
            <Glow on={arrived}>
              <circle className="lamp" cx={RECEIVER.w / 2} cy={RECEIVER.d / 2} r={6} />
            </Glow>
          }
          front={
            <>
              <rect className="ik-screen" x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx={3} />
              <text className="ik-screen-text" x={SCREEN.x + 6} y={SCREEN.y + 14} fontSize={7}>
                {arrived ? "received" : "waiting"}
              </text>
            </>
          }
        />
        <Cursor at={[SENDER.x + SENDER.w / 2, SENDER.y + SENDER.d / 2, SENDER.z + SENDER.h]} phase={demo.phase} />
      </g>
    </Plate>
  )
}
`
  const css = `${scope(input)} .lamp { fill: var(--ik-well); stroke: var(--ik-detail); vector-effect: non-scaling-stroke; transition: fill var(--ik-t-state) var(--ik-ease), stroke var(--ik-t-state) var(--ik-ease); }
${scope(input)} svg[data-arrived="true"] .lamp { fill: var(--ik-live); stroke: var(--ik-live); }
`
  return { tsx, css }
}
