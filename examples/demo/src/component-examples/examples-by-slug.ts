import type { ComponentType } from "react"
import { BoxExample } from "./box-example"
import { DemoTapExample } from "./demo-tap-example"
import { DraftingExample } from "./drafting-example"
import { FlightExample } from "./flight-example"
import { GeometryExample } from "./geometry-example"
import { GlowExample } from "./glow-example"
import { PlateExample } from "./plate-example"
import { PressExample } from "./press-example"
import { RippleExample } from "./ripple-example"
import { SignalExample } from "./signal-example"
import { SoundToggleExample } from "./sound-toggle-example"

export const EXAMPLES_BY_SLUG: ReadonlyMap<string, ComponentType> = new Map<string, ComponentType>([
  ["plate", PlateExample],
  ["box", BoxExample],
  ["press", PressExample],
  ["glow", GlowExample],
  ["drafting", DraftingExample],
  ["use-demo-tap", DemoTapExample],
  ["cursor", DemoTapExample],
  ["ripple", RippleExample],
  ["signal", SignalExample],
  ["flight", FlightExample],
  ["sound-toggle", SoundToggleExample],
  ["geometry", GeometryExample],
])
