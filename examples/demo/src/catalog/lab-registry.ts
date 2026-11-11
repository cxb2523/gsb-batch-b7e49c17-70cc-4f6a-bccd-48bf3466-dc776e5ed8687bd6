import type { ComponentType } from "react"
import { type LabMeta, TEXTURES } from "./lab-meta"
import { LAB_PARTS } from "./lab-parts"
import { LEVELS } from "./levels"

export type LabEntry = LabMeta & { Figure: ComponentType; path: string }

type LabModule = { meta?: LabMeta; default?: ComponentType }

const LAB_PATH = /\/lab\/figures\/([^/]+)\.tsx$/
const LEVEL_NUMBERS: ReadonlySet<number> = new Set(LEVELS.map((level) => level.level))
const TEXTURE_IDS: ReadonlySet<string> = new Set(TEXTURES.map((texture) => texture.id))
const PART_NAMES: ReadonlySet<string> = new Set(LAB_PARTS.map((part) => part.name))

export function labProblems(modules: Readonly<Record<string, LabModule>>): string[] {
  const problems: string[] = []
  for (const [path, module] of Object.entries(modules)) {
    const where = LAB_PATH.exec(path)
    const meta = module.meta
    if (!module.default) problems.push(`${path}: has no default export`)
    if (!meta) {
      problems.push(`${path}: exports no meta`)
      continue
    }
    if (where?.[1] !== meta.slug) problems.push(`${path}: file name differs from meta.slug "${meta.slug}"`)
    if (!LEVEL_NUMBERS.has(meta.level)) problems.push(`${path}: level ${String(meta.level)} is not 1 to 4`)
    for (const texture of meta.textures) if (!TEXTURE_IDS.has(texture)) problems.push(`${path}: unknown texture "${texture}"`)
    for (const part of meta.parts ?? []) if (!PART_NAMES.has(part)) problems.push(`${path}: unknown part "${part}"`)
  }
  return problems
}

export function buildLab(modules: Readonly<Record<string, LabModule>>): readonly LabEntry[] {
  const entries: LabEntry[] = []
  for (const [path, module] of Object.entries(modules)) {
    if (module.meta && module.default) entries.push({ ...module.meta, Figure: module.default, path })
  }
  return entries.sort((a, b) => a.level - b.level || a.title.localeCompare(b.title))
}

const modules = import.meta.glob<LabModule>("../lab/figures/*.tsx", { eager: true })

if (import.meta.env.DEV) {
  for (const problem of labProblems(modules)) console.error(`lab catalog: ${problem}`)
}

export const LAB_FIGURES: readonly LabEntry[] = buildLab(modules)

export const labBySlug: ReadonlyMap<string, LabEntry> = new Map(LAB_FIGURES.map((figure) => [figure.slug, figure]))
