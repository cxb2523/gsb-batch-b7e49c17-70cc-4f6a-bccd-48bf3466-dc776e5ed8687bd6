import type { ComponentType } from "react"
import type { SoundName } from "react-isokit"
import type { FigureMeta, KitExport } from "./figure-meta"
import { INDUSTRIES, type IndustryId } from "./industries"
import { LEVELS, type LevelNumber } from "./levels"

export type FigureEntry = FigureMeta & { Figure: ComponentType; path: string }

type FigureModule = { meta?: FigureMeta; default?: ComponentType }

const FIGURE_PATH = /\/figures\/([^/]+)\/([^/]+)\.tsx$/
const INDUSTRY_ORDER: ReadonlyMap<string, number> = new Map(INDUSTRIES.map((industry, index) => [industry.id, index]))
const LEVEL_NUMBERS: ReadonlySet<number> = new Set(LEVELS.map((level) => level.level))

export function figureProblems(modules: Readonly<Record<string, FigureModule>>): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const [path, module] of Object.entries(modules)) {
    const where = FIGURE_PATH.exec(path)
    const meta = module.meta
    if (!where) problems.push(`${path}: a figure lives at figures/<industry>/<slug>.tsx`)
    if (!meta) problems.push(`${path}: exports no meta`)
    if (!module.default) problems.push(`${path}: has no default export`)
    if (!where || !meta) continue
    if (where[1] !== meta.industry) problems.push(`${path}: sits in "${where[1]}" but meta.industry is "${meta.industry}"`)
    if (where[2] !== meta.slug) problems.push(`${path}: file name "${where[2]}" differs from meta.slug "${meta.slug}"`)
    if (!INDUSTRY_ORDER.has(meta.industry)) problems.push(`${path}: unknown industry "${meta.industry}"`)
    if (!LEVEL_NUMBERS.has(meta.level)) problems.push(`${path}: level ${String(meta.level)} is not 1 to 4`)
    if (seen.has(meta.slug)) problems.push(`${path}: slug "${meta.slug}" is used twice`)
    seen.add(meta.slug)
  }
  return problems
}

function groupBy<Key, Value>(values: readonly Value[], keysOf: (value: Value) => readonly Key[]): ReadonlyMap<Key, readonly Value[]> {
  const groups = new Map<Key, Value[]>()
  for (const value of values) {
    for (const key of keysOf(value)) {
      const group = groups.get(key)
      if (group) group.push(value)
      else groups.set(key, [value])
    }
  }
  return groups
}

const byPlace = (a: FigureEntry, b: FigureEntry) => (INDUSTRY_ORDER.get(a.industry) ?? 0) - (INDUSTRY_ORDER.get(b.industry) ?? 0) || a.level - b.level || a.title.localeCompare(b.title)

export function buildFigures(modules: Readonly<Record<string, FigureModule>>): readonly FigureEntry[] {
  const entries: FigureEntry[] = []
  for (const [path, module] of Object.entries(modules)) {
    if (module.meta && module.default) entries.push({ ...module.meta, Figure: module.default, path })
  }
  return entries.sort(byPlace)
}

const modules = import.meta.glob<FigureModule>("../figures/*/*.tsx", { eager: true })

if (import.meta.env.DEV) {
  for (const problem of figureProblems(modules)) console.error(`figure catalog: ${problem}`)
}

export const FIGURES: readonly FigureEntry[] = buildFigures(modules)

export const figureBySlug: ReadonlyMap<string, FigureEntry> = new Map(FIGURES.map((figure) => [figure.slug, figure]))
export const figuresByIndustry: ReadonlyMap<IndustryId, readonly FigureEntry[]> = groupBy(FIGURES, (figure) => [figure.industry])
export const figuresByLevel: ReadonlyMap<LevelNumber, readonly FigureEntry[]> = groupBy(FIGURES, (figure) => [figure.level])
export const placeKey = (industry: IndustryId, level: LevelNumber) => `${industry}:${level}`
export const figuresByPlace: ReadonlyMap<string, readonly FigureEntry[]> = groupBy(FIGURES, (figure) => [placeKey(figure.industry, figure.level)])
export const figuresBySound: ReadonlyMap<SoundName, readonly FigureEntry[]> = groupBy(FIGURES, (figure) => figure.sounds)
export const figuresByComponent: ReadonlyMap<KitExport, readonly FigureEntry[]> = groupBy(FIGURES, (figure) => figure.uses)

export const NO_FIGURES: readonly FigureEntry[] = []
