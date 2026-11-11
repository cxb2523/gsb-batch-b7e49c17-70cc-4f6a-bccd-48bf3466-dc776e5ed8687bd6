import type { FigureMeta } from "./figure-meta"
import type { LabPartName } from "./lab-parts"

export const TEXTURES = [
  { id: "engrave", title: "Engraving", blurb: "Ruled lines laid along each face: none on the lit tops, open on the fronts, close on the sides in shade." },
  { id: "halftone", title: "Halftone", blurb: "A dot screen printed in each face's own plane, fine on the fronts and heavy on the sides in shade. Lit tops stay clean." },
  { id: "stipple", title: "Stipple", blurb: "Pen dots scattered by hand, sparse on the fronts and dense on the sides in shade. Lit tops stay clean." },
  { id: "dither", title: "Dither", blurb: "An ordered 1-bit screen on the faces in shade, its density set by how much light each catches. Lit tops stay clean." },
  { id: "ascii", title: "ASCII", blurb: "Monospace glyphs set in each face's plane: colons on the fronts, rules on the sides in shade, lit tops left clean." },
] as const

export type TextureId = (typeof TEXTURES)[number]["id"]

export type LabMeta = Omit<FigureMeta, "industry"> & { textures: readonly TextureId[]; parts?: readonly LabPartName[]; headline?: string; pitch?: string }
