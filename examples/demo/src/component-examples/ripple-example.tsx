import { type ReactNode, useState } from "react"
import { Box, Plate, Press, Ripple } from "react-isokit"
import { KEY } from "./example-key"

const RING_ROOM = { ...KEY, x: -8, y: -8, w: 76, d: 76 }

export function RippleExample(): ReactNode {
  const [touched, setTouched] = useState(false)
  return (
    <Plate hint={touched ? "Pressed · ripple gone" : "The ripple says: here"} readout={touched ? "touched" : "untouched"} fit={[KEY, RING_ROOM]} aspect={1.6} label="A key with a ripple breathing out from under it until it is pressed.">
      {touched ? null : <Ripple {...KEY} r={10} />}
      <Press label="Press the key" onPress={() => setTouched(!touched)} data-hot={!touched}>
        <g>
          <Box {...KEY} r={10} />
        </g>
      </Press>
    </Plate>
  )
}
