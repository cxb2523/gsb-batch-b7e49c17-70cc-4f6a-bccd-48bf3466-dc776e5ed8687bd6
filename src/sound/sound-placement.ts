import type { SoundOptions } from "../schema"

export type Placement = Pick<SoundOptions, "pan" | "size">

type Area = { x: number; width: number; height: number }

const PAN_REACH = 0.35

export function placement(part: Area, plate: Area): Placement {
  if (!(plate.width > 0 && plate.height > 0)) return {}
  const across = (part.x + part.width / 2 - plate.x) / plate.width
  return {
    pan: Math.max(-1, Math.min(1, across * 2 - 1)) * PAN_REACH,
    size: Math.min(1, Math.sqrt((part.width * part.height) / (plate.width * plate.height))),
  }
}

export function placeSound(part: Element): Placement {
  const plate = part.closest("svg")
  return plate ? placement(part.getBoundingClientRect(), plate.getBoundingClientRect()) : {}
}
