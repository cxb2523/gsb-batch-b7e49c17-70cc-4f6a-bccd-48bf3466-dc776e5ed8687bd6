import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FIGURES } from "../examples/demo/src/catalog/figure-registry"
import { INDUSTRIES } from "../examples/demo/src/catalog/industries"
import { LEVELS } from "../examples/demo/src/catalog/levels"
import * as kit from "../src"
import * as drafting from "../src/drafting"
import { soundNames } from "../src/schema"

const exportNames = new Set([...Object.keys(kit), ...Object.keys(drafting)])
const sounds = new Set<string>(soundNames)
const levels = new Set<number>(LEVELS.map((level) => level.level))
const briefsByIndustry = new Map(INDUSTRIES.map((industry) => [industry.id as string, new Map<string, number>(industry.briefs.map((brief) => [brief.slug, brief.level]))]))

describe("figure catalog", () => {
  it("has every figure, each with a unique slug", () => {
    expect(FIGURES.length).toBeGreaterThanOrEqual(22)
    expect(new Set(FIGURES.map((figure) => figure.slug)).size).toBe(FIGURES.length)
  })

  it("files every figure at figures/<industry>/<slug>.tsx", () => {
    for (const figure of FIGURES) expect(figure.path).toMatch(new RegExp(`/figures/${figure.industry}/${figure.slug}\\.tsx$`))
  })

  it("gives every figure a known industry, a level, real exports and real sounds", () => {
    for (const figure of FIGURES) {
      expect(briefsByIndustry.has(figure.industry), figure.slug).toBe(true)
      expect(levels.has(figure.level), figure.slug).toBe(true)
      for (const name of figure.uses) expect(exportNames.has(name), `${figure.slug} uses ${name}`).toBe(true)
      for (const sound of figure.sounds) expect(sounds.has(sound), `${figure.slug} plays ${sound}`).toBe(true)
    }
  })

  it("lists every figure as a brief in its industry, at the same level", () => {
    for (const figure of FIGURES) expect(briefsByIndustry.get(figure.industry)?.get(figure.slug), figure.slug).toBe(figure.level)
  })

  it("keeps brief slugs unique across industries", () => {
    const slugs = INDUSTRIES.flatMap((industry) => industry.briefs.map((brief) => brief.slug))
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it.each(FIGURES.map((figure) => [figure.slug, figure] as const))("renders %s on the server, as a group with something to press", (_, figure) => {
    const { Figure } = figure
    const html = renderToString(<Figure />)
    expect(html).toContain('role="group"')
    expect(html).toContain('role="button"')
    expect(html.match(/class="ik-credit"/g)).toHaveLength(1)
  })
})
