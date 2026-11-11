import { type ReactNode, useState } from "react"
import { Box, Plate, Press, playSound } from "react-isokit"
import { Callout, Dimension } from "react-isokit/drafting"

const CASE = { x: 0, y: 0, z: 0, w: 90, d: 60, h: 20 }
const LID_CLOSED = 4
const LID_OPEN = 26

export function DraftingExample(): ReactNode {
  const [open, setOpen] = useState(false)
  const lift = open ? LID_OPEN : LID_CLOSED
  const press = () => {
    setOpen(!open)
    playSound("latch")
  }
  return (
    <div data-look="blueprint">
      <Plate hint="Press the lid" readout={open ? `lid open · h ${CASE.h + lift}` : `lid shut · h ${CASE.h + lift}`} fit={[CASE, { ...CASE, h: CASE.h + LID_OPEN + 6 }, [CASE.w + 18, 0, 0]]} aspect={1.6} label="A case drawn as a blueprint, with its width and height dimensioned. Press the lid to open it; the height dimension follows.">
        <Box {...CASE} r={6} />
        <Press label={open ? "Close the lid" : "Open the lid"} onPress={press} sound={false} className="ik-lift" data-hot={!open}>
          <g className="drafting-lid" style={{ transform: `translateY(${LID_CLOSED - lift}px)` }}>
            <Box x={0} y={0} z={CASE.h + LID_CLOSED - 4} w={CASE.w} d={CASE.d} h={4} r={6} />
          </g>
        </Press>
        <Dimension from={[0, CASE.d, 0]} to={[CASE.w, CASE.d, 0]} offset={[0, 10, 0]} label={`w ${CASE.w}`} />
        <Dimension from={[CASE.w, 0, 0]} to={[CASE.w, 0, CASE.h + lift]} offset={[12, 0, 0]} label={`h ${CASE.h + lift}`} />
        <Callout at={[CASE.w / 2, CASE.d / 2, CASE.h + lift]} dx={-26} dy={-12} label="lid" />
      </Plate>
    </div>
  )
}
