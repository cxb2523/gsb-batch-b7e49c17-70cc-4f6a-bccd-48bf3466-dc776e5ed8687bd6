import { type ReactNode, useState } from "react"
import { href } from "../app/route-store"
import { FIGURES, type FigureEntry, figuresByIndustry, figuresByPlace, NO_FIGURES, placeKey } from "../catalog/figure-registry"
import { INDUSTRIES, type IndustryId } from "../catalog/industries"
import { LEVELS, type LevelNumber } from "../catalog/levels"

type IndustryFilter = IndustryId | "all"
type LevelFilter = LevelNumber | "all"

const LEVEL_NAMES: ReadonlyMap<LevelNumber, string> = new Map(LEVELS.map((level) => [level.level, level.name]))
const BUILT_INDUSTRIES = INDUSTRIES.filter((industry) => figuresByIndustry.has(industry.id))
const BUILT_BY_ID = new Map(BUILT_INDUSTRIES.map((industry) => [industry.id, industry]))

export function LevelBadge({ level }: { level: LevelNumber }): ReactNode {
  return (
    <span className="level-badge" title={`Level ${level}: ${LEVEL_NAMES.get(level) ?? ""}`}>
      L{level} · {LEVEL_NAMES.get(level)}
    </span>
  )
}

function FigureCard({ figure }: { figure: FigureEntry }): ReactNode {
  const { Figure } = figure
  return (
    <figure className="figure-card">
      <Figure />
      <figcaption>
        <a href={href("figures", figure.slug)}>
          <strong>{figure.title}</strong>
        </a>
        <span>{figure.blurb}</span>
        <LevelBadge level={figure.level} />
      </figcaption>
    </figure>
  )
}

function FilterRow<Value extends string | number>({ label, options, value, onChange }: { label: string; options: ReadonlyArray<{ id: Value; title: string }>; value: Value; onChange: (next: Value) => void }): ReactNode {
  return (
    <fieldset className="filter-group">
      <legend>{label}</legend>
      <div className="filters">
        {options.map((option) => (
          <button key={option.id} type="button" className="pill" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
            {option.title}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

const INDUSTRY_OPTIONS: ReadonlyArray<{ id: IndustryFilter; title: string }> = [{ id: "all", title: "All industries" }, ...BUILT_INDUSTRIES.map((industry) => ({ id: industry.id, title: industry.title }))]
const LEVEL_OPTIONS: ReadonlyArray<{ id: LevelFilter; title: string }> = [{ id: "all", title: "All levels" }, ...LEVELS.map((level) => ({ id: level.level, title: `L${level.level} · ${level.name}` }))]

export function FiguresPage(): ReactNode {
  const [industry, setIndustry] = useState<IndustryFilter>("all")
  const [level, setLevel] = useState<LevelFilter>("all")
  const chosen = industry === "all" ? undefined : BUILT_BY_ID.get(industry)
  const shownIndustries = chosen ? [chosen] : BUILT_INDUSTRIES
  let shownCount = 0
  const sections = shownIndustries.map((entry) => {
    const figures = (level === "all" ? figuresByIndustry.get(entry.id) : figuresByPlace.get(placeKey(entry.id, level))) ?? NO_FIGURES
    shownCount += figures.length
    return { entry, figures }
  })
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">
          Figures · {FIGURES.length} · <a href={href("studio")}>make your own</a>
        </p>
        <h1>Press any of them.</h1>
        <p className="lede">Try a drawing, then open it to see how it works. Every example is a React component you can use and change.</p>
      </header>
      <div className="filter-panel">
        <FilterRow label="Industry" options={INDUSTRY_OPTIONS} value={industry} onChange={setIndustry} />
        <FilterRow label="Level" options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
        <p className="filter-count" role="status">{shownCount} {shownCount === 1 ? "example" : "examples"}</p>
      </div>
      {sections.map(({ entry, figures }) =>
        figures.length ? (
          <section key={entry.id} className="figure-section" aria-labelledby={`industry-${entry.id}`}>
            <div className="section-head">
              <h2 id={`industry-${entry.id}`}>{entry.title}</h2>
              <p>{entry.blurb}</p>
            </div>
            <div className="figure-grid">
              {figures.map((figure) => (
                <FigureCard key={figure.slug} figure={figure} />
              ))}
            </div>
          </section>
        ) : null,
      )}
      {shownCount ? null : (
        <p className="empty-note">
          No figure at this level yet. <a href={href("studio")}>Pick a brief in the studio</a> and build the first.
        </p>
      )}
    </main>
  )
}
