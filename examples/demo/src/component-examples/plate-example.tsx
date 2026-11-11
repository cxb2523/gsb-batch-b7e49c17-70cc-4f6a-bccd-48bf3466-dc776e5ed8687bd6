import { type ReactNode, useState } from "react"
import { Box, Plate, Press } from "react-isokit"
import { KEY } from "./example-key"

export function PlateExample(): ReactNode {
  const [presses, setPresses] = useState(0)
  return (
    <Plate fig="Fig 1" name="Key" hint="Press it" readout={`pressed ${presses}×`} fit={[KEY]} aspect={1.6} label="A single key on a plate, with a caption in each corner. Press it to count.">
      <Press label="Press the key" onPress={() => setPresses(presses + 1)}>
        <g>
          <Box {...KEY} r={10} />
        </g>
      </Press>
    </Plate>
  )
}
