import { type ReactNode, useEffect, useRef, useState } from "react"
import { Box, curve, Plate, Press, path, playSound, Signal } from "react-isokit"

const HUB = { x: 0, y: 70, z: 0, w: 56, d: 40, h: 20 }
const LAMP = { x: 110, y: 0, z: 0, w: 34, d: 34, h: 30 }
const WIRE = curve([HUB.x + HUB.w, HUB.y + 20, 1], [HUB.x + HUB.w + 40, HUB.y + 20, 1], [LAMP.x + 17, LAMP.y + LAMP.d + 40, 1], [LAMP.x + 17, LAMP.y + LAMP.d, 1])
const ARRIVAL_MS = 420

export function SignalExample(): ReactNode {
  const [sent, setSent] = useState(0)
  const [lit, setLit] = useState(false)
  const arrival = useRef(0)
  useEffect(() => () => window.clearTimeout(arrival.current), [])
  const send = () => {
    setSent(sent + 1)
    setLit(false)
    window.clearTimeout(arrival.current)
    arrival.current = window.setTimeout(() => {
      setLit(true)
      playSound("done")
    }, ARRIVAL_MS)
  }
  return (
    <Plate hint="Press the hub" readout={sent ? (lit ? `delivered · ${sent}` : "sending") : "idle"} fit={[HUB, LAMP]} aspect={1.6} label="A hub wired to a lamp. Press the hub and a signal runs down the wire; the lamp lights when it arrives." data-lit={lit}>
      <Box {...LAMP} r={17} top={<circle className={lit ? "ik-dot" : "ik-fill"} cx={17} cy={17} r={6} />} />
      <path className="ik-line" d={path(WIRE)} />
      {sent ? <Signal key={sent} points={WIRE} delay={100} /> : null}
      <Press label="Send a signal" onPress={send} data-hot={!sent}>
        <g>
          <Box {...HUB} r={8} />
        </g>
      </Press>
    </Plate>
  )
}
