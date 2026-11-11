import { type ReactNode, useState } from "react"
import { Box, Plate, Press } from "react-isokit"
import { KEY } from "./example-key"

export function PressExample(): ReactNode {
  const [releases, setReleases] = useState(0)
  return (
    <Plate hint="Pointer, Enter or Space" readout={releases ? `released ${releases}×` : "at rest"} fit={[KEY]} aspect={1.6} label="A key that goes down when pressed and acts on release.">
      <Press label="Press the key" onPress={() => setReleases(releases + 1)} data-hot={releases === 0}>
        <g>
          <Box {...KEY} r={10} />
        </g>
      </Press>
    </Plate>
  )
}
