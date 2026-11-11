import type { ReactNode } from "react"
import { CopyCommand } from "../app/copy-command"
import { Folder } from "../app/folder"
import { href } from "../app/route-store"
import { FIGURES, figureBySlug } from "../catalog/figure-registry"
import { type Brief, INDUSTRIES, type IndustryEntry } from "../catalog/industries"
import { LEVELS, type LevelEntry, type LevelNumber } from "../catalog/levels"

const MAKING_STEPS: ReadonlyArray<{ title: string; body: string }> = [
  { title: "Brief", body: "Name the object and what pressing it produces, in one line: object, what the pointer presses, what changes and what the read-out says." },
  { title: "Boxes", body: "Break the object into 3 to 8 boxes in world units, written as constants before any JSX. Give each part the two or three features that make it what it is." },
  { title: "Paint order", body: "Emit back to front: lower z first, then smaller x + y. A part sitting on another goes after it. Draw details on faces through top, front and side." },
  { title: "Wire", body: "Wrap each pressable part in Press, write the read-out on every press, keep timers in refs and play sound only for what the reader caused." },
  { title: "Frame", body: "Pass fit the most extreme pose, so nothing leaves the plate when it moves." },
  { title: "Shoot", body: "Screenshot light and dark, at desktop and phone width, before and after every press. Fix what you see and shoot again." },
  { title: "Hand over", body: "One line each: the object and what pressing produces, the files you added, and what you could not verify." },
]

const NO_BRIEFS: readonly Brief[] = []

const BRIEF_COUNT = INDUSTRIES.reduce((total, industry) => total + industry.briefs.length, 0)

function briefsByLevel(industry: IndustryEntry): ReadonlyMap<LevelNumber, readonly Brief[]> {
  const groups = new Map<LevelNumber, Brief[]>()
  for (const brief of industry.briefs) {
    const group = groups.get(brief.level)
    if (group) group.push(brief)
    else groups.set(brief.level, [brief])
  }
  return groups
}

const MATRIX = INDUSTRIES.map((industry) => ({ industry, byLevel: briefsByLevel(industry) }))

const scaffoldCommand = (industry: IndustryEntry, brief: Brief) => `npm run new:figure -- --industry ${industry.id} --slug ${brief.slug} --level ${brief.level} --title "${brief.title}"`

function LevelCard({ level }: { level: LevelEntry }): ReactNode {
  return (
    <article className="level-card">
      <p className="eyebrow">Level {level.level}</p>
      <h3>{level.name}</h3>
      <p>{level.promise}</p>
      <details className="level-recipe">
        <summary>What you need</summary>
        <ul className="level-ingredients">
          {level.ingredients.map((ingredient) => (
            <li key={ingredient}>{ingredient}</li>
          ))}
        </ul>
        <p className="level-timing">{level.timing}</p>
      </details>
      <ul className="chips">
        {level.examples.map((slug) => {
          const figure = figureBySlug.get(slug)
          return figure ? (
            <li key={slug}>
              <a href={href("figures", slug)}>{figure.title}</a>
            </li>
          ) : null
        })}
      </ul>
    </article>
  )
}

function BriefCell({ industry, briefs }: { industry: IndustryEntry; briefs: readonly Brief[] }): ReactNode {
  return (
    <ul className="brief-cell">
      {briefs.map((brief) =>
        figureBySlug.has(brief.slug) ? (
          <li key={brief.slug} className="brief brief-built">
            <a href={href("figures", brief.slug)}>{brief.title}</a>
            <span>built</span>
          </li>
        ) : (
          <li key={brief.slug} className="brief brief-open">
            <details>
              <summary>{brief.title}</summary>
              <p>{brief.brief}</p>
              <CopyCommand text={scaffoldCommand(industry, brief)} label={`the scaffold command for ${brief.title}`} />
            </details>
          </li>
        ),
      )}
    </ul>
  )
}

export function StudioPage(): ReactNode {
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">
          Studio · {INDUSTRIES.length} industries · {BRIEF_COUNT} briefs · {FIGURES.length} built
        </p>
        <h1>Make the next figure.</h1>
        <p className="lede">Pick an idea and copy its starter command. You get a working drawing to change, with the buttons already connected.</p>
      </header>

      <section className="figure-section" aria-labelledby="levels">
        <div className="section-head">
          <h2 id="levels">Start simple.</h2>
          <p>Choose how much your drawing needs to do. One button is often enough.</p>
        </div>
        <div className="level-grid">
          {LEVELS.map((level) => (
            <LevelCard key={level.level} level={level} />
          ))}
        </div>
      </section>

      <section className="figure-section" aria-labelledby="briefs">
        <div className="section-head">
          <h2 id="briefs">Find your next idea.</h2>
          <p>Open a folder to browse. Finished drawings link to an example; unfinished ideas include a starter command to run in this repository.</p>
        </div>
        <div className="brief-matrix">
          {MATRIX.map(({ industry, byLevel }) => (
            <Folder key={industry.id} title={industry.title} description={industry.blurb} count={`${industry.briefs.length} ideas`}>
              <div className="brief-row">
                {LEVELS.map((level) => {
                  const briefs = byLevel.get(level.level) ?? NO_BRIEFS
                  return (
                    <div key={level.level} className="brief-level" data-empty={briefs.length === 0 || undefined}>
                      <p className="brief-level-name">
                        L{level.level} · {level.name}
                      </p>
                      <BriefCell industry={industry} briefs={briefs} />
                    </div>
                  )
                })}
              </div>
            </Folder>
          ))}
        </div>
      </section>
      <section className="figure-section" aria-labelledby="making">
        <div className="section-head">
          <h2 id="making">How a figure is made</h2>
        </div>
        <ol className="steps making-steps">
          {MAKING_STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="n">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
