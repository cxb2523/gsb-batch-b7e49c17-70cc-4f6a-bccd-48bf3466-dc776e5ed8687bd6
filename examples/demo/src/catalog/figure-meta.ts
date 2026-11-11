import type * as Kit from "react-isokit"
import type { SoundName } from "react-isokit"
import type * as Drafting from "react-isokit/drafting"
import type { IndustryId } from "./industries"
import type { LevelNumber } from "./levels"

export type KitExport = keyof typeof Kit | keyof typeof Drafting

export type FigureMeta = {
  slug: string
  title: string
  industry: IndustryId
  level: LevelNumber
  blurb: string
  uses: readonly KitExport[]
  sounds: readonly SoundName[]
}
