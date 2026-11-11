import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { INDUSTRIES } from "../examples/demo/src/catalog/industries.ts"
import { LEVELS } from "../examples/demo/src/catalog/levels.ts"
import { levelOneTap } from "./figure-templates/level-1-tap.ts"
import { levelTwoCauseAndEffect } from "./figure-templates/level-2-cause-and-effect.ts"
import { levelThreeSequence } from "./figure-templates/level-3-sequence.ts"
import { levelFourSystem } from "./figure-templates/level-4-system.ts"
import type { FigureFiles, TemplateInput } from "./figure-templates/template-input.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const FIGURES_DIR = join(ROOT, "examples/demo/src/figures")
const INDUSTRIES_FILE = join(ROOT, "examples/demo/src/catalog/industries.ts")
const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const USAGE = 'npm run new:figure -- --industry <id> --slug <kebab-case> --level <1-4> [--title "Title"]'

const TEMPLATES: ReadonlyMap<number, (input: TemplateInput) => FigureFiles> = new Map([
  [1, levelOneTap],
  [2, levelTwoCauseAndEffect],
  [3, levelThreeSequence],
  [4, levelFourSystem],
])

function fail(message: string): never {
  console.error(`new-figure: ${message}\nusage: ${USAGE}`)
  process.exit(1)
}

const titleFromSlug = (slug: string) => slug.replace(/-/g, " ").replace(/^./, (first) => first.toUpperCase())
const componentNameFromSlug = (slug: string) => slug.replace(/(^|-)([a-z0-9])/g, (_, __, letter: string) => letter.toUpperCase())
const pressSentence = (brief: string) => brief.slice(brief.indexOf(". ") + 2) || brief

function usedSlugs(): ReadonlySet<string> {
  const slugs = new Set<string>()
  if (!existsSync(FIGURES_DIR)) return slugs
  for (const folder of readdirSync(FIGURES_DIR, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue
    for (const file of readdirSync(join(FIGURES_DIR, folder.name))) {
      if (file.endsWith(".tsx")) slugs.add(file.slice(0, -4))
    }
  }
  return slugs
}

function addBrief(industryId: string, brief: { slug: string; title: string; level: number; brief: string }): void {
  const source = readFileSync(INDUSTRIES_FILE, "utf8")
  const industryAt = source.indexOf(`id: ${JSON.stringify(industryId)},`)
  const briefsAt = source.indexOf("briefs: [", industryAt)
  const closeAt = source.indexOf("\n    ],", briefsAt)
  if (industryAt < 0 || briefsAt < 0 || closeAt < 0) fail(`could not find the briefs of "${industryId}" in ${relative(ROOT, INDUSTRIES_FILE)}`)
  const line = `\n      { slug: ${JSON.stringify(brief.slug)}, title: ${JSON.stringify(brief.title)}, level: ${brief.level}, brief: ${JSON.stringify(brief.brief)} },`
  writeFileSync(INDUSTRIES_FILE, source.slice(0, closeAt) + line + source.slice(closeAt))
}

const { values } = parseArgs({
  options: {
    industry: { type: "string" },
    slug: { type: "string" },
    level: { type: "string" },
    title: { type: "string" },
  },
})

const industry = INDUSTRIES.find((entry) => entry.id === values.industry)
if (!industry) fail(`--industry must be one of: ${INDUSTRIES.map((entry) => entry.id).join(", ")}`)

const slug = values.slug ?? ""
if (!SLUG.test(slug)) fail("--slug must be kebab-case, starting with a letter, as in card-terminal")
if (usedSlugs().has(slug)) fail(`a figure called "${slug}" already exists; slugs are unique across industries`)

const level = Number(values.level)
const levelEntry = LEVELS.find((entry) => entry.level === level)
const template = TEMPLATES.get(level)
if (!levelEntry || !template) fail("--level must be 1, 2, 3 or 4")

const existing = industry.briefs.find((entry) => entry.slug === slug)
if (existing && existing.level !== level) fail(`the ${industry.title} brief for "${slug}" is level ${existing.level}; pass --level ${existing.level} or change the brief`)

const title = values.title ?? existing?.title ?? titleFromSlug(slug)
const briefText = existing?.brief ?? `${title}. What the pointer presses. What changes, and what the read-out says.`
const input: TemplateInput = {
  slug,
  title,
  industry: industry.id,
  industryTitle: industry.title,
  blurb: existing ? pressSentence(existing.brief) : `Press it and the ${title.toLowerCase()} answers.`,
  label: existing ? existing.brief : `${title}: press the highlighted part to see what it does.`,
  componentName: componentNameFromSlug(slug),
}

const files = template(input)
const folder = join(FIGURES_DIR, industry.id)
const tsxPath = join(folder, `${slug}.tsx`)
const cssPath = join(folder, `${slug}.css`)
if (existsSync(tsxPath) || existsSync(cssPath)) fail(`refusing to overwrite ${relative(ROOT, tsxPath)}`)
mkdirSync(folder, { recursive: true })
writeFileSync(tsxPath, files.tsx)
writeFileSync(cssPath, files.css)
if (!existing) addBrief(industry.id, { slug, title, level, brief: briefText })

console.log(`created ${relative(ROOT, tsxPath)}
created ${relative(ROOT, cssPath)}${existing ? "" : `\nadded a "${slug}" brief to ${relative(ROOT, INDUSTRIES_FILE)}; rewrite it in one line: object, what is pressed, what changes and the read-out`}

Level ${levelEntry.level}, ${levelEntry.name}: ${levelEntry.promise}

Next:
  1. npm run dev, then open #/figures/${slug}
  2. Redraw the boxes as the real object: ${existing ? existing.brief : briefText}
  3. Keep the wiring: useDemoTap, the ripple, a readout on every press, timers in refs
  4. Check it: npx tsc --noEmit && npx biome check . && npx vitest run test/figure-catalog.test.tsx
  5. Screenshot light and dark at desktop and phone width before handing it over`)
