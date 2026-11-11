import { type ReactNode, useState } from "react"
import { Box, Glow, Plate, Press } from "react-isokit"
import { KEY } from "./example-key"

const HOUSING = { x: -14, y: -40, z: 0, w: 88, d: 34, h: 30 }
const LAMP = { cx: 44, cy: 15, r: 5 }

export function GlowExample(): ReactNode {
  const [on, setOn] = useState(false)
  return (
    <Plate hint="Press the key · switch to dark to see it bloom" readout={on ? "lamp · on" : "lamp · off"} fit={[KEY, HOUSING]} aspect={1.6} label="A key that switches a lamp on and off. The lamp glows while it is on.">
      <Box {...HOUSING} r={8} front={<Glow on={on}><circle className={on ? "ik-dot" : "ik-fill"} {...LAMP} /></Glow>} />
      <Press label={on ? "Switch the lamp off" : "Switch the lamp on"} onPress={() => setOn(!on)} material="rubber" data-hot={!on}>
        <g>
          <Box {...KEY} r={10} />
        </g>
      </Press>
    </Plate>
  )
}
