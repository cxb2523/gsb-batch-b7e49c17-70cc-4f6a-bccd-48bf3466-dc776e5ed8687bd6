import type { ReactNode } from "react"
import { pusharyFrom } from "../app/links"
import { href } from "../app/route-store"
import { docSlugForExport } from "../catalog/component-docs"
import { type FigureEntry, figureBySlug } from "../catalog/figure-registry"
import { INDUSTRIES } from "../catalog/industries"
import { PUSHARY_FIGURES } from "../catalog/pushary-figures"
import { PUSHARY_ICON } from "../logos/agent-logos"
import { FiguresPage, LevelBadge } from "./figures-page"

const VARIATIONS = [
  { id: "default", title: "Default", look: undefined, className: undefined },
  { id: "dark", title: "Dark", look: undefined, className: "dark" },
  { id: "blueprint", title: "Blueprint", look: "blueprint", className: undefined },
  { id: "cyanotype", title: "Blueprint · dark", look: "blueprint", className: "dark" },
  { id: "paper", title: "Paper", look: "paper", className: undefined },
  { id: "phosphor", title: "Phosphor", look: "phosphor", className: "dark" },
] as const

const INDUSTRY_TITLES: ReadonlyMap<string, string> = new Map(INDUSTRIES.map((industry) => [industry.id, industry.title]))

function BuiltFrom({ figure }: { figure: FigureEntry }): ReactNode {
  return (
    <ul className="chips" aria-label="Built from">
      {figure.uses.map((name) => (
        <li key={name}>
          <a href={href("components", docSlugForExport(name))}>
            <code>{name}</code>
          </a>
        </li>
      ))}
    </ul>
  )
}

function PusharyCredit({ slug }: { slug: string }): ReactNode {
  const line = PUSHARY_FIGURES.get(slug)
  if (!line) return null
  return (
    <aside className="pushary-credit" aria-label="Pushary">
      <img src={PUSHARY_ICON} alt="" width={44} height={44} />
      <div className="pushary-credit-copy">
        <p className="eyebrow">
          From the maker of isokit · <span>Pushary</span>
        </p>
        <p>{line}</p>
      </div>
      <div className="cta">
        <a className="button button-secondary" href={pusharyFrom("figure", slug)} target="_blank" rel="noopener">
          See Pushary →
        </a>
      </div>
    </aside>
  )
}

function FigureSounds({ figure }: { figure: FigureEntry }): ReactNode {
  if (!figure.sounds.length) return null
  return (
    <section className="figure-section" aria-labelledby="sounds">
      <div className="section-head">
        <h2 id="sounds">Sounds</h2>
        <p>
          Played only for the reader's own presses. <a href={href("sound")}>Hear every sound</a>.
        </p>
      </div>
      <ul className="chips">
        {figure.sounds.map((sound) => (
          <li key={sound}>
            <a href={href("sound", sound)}>
              <code>{sound}</code>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FigureDetail({ figure }: { figure: FigureEntry }): ReactNode {
  const { Figure } = figure
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">
          <a href={href("figures")}>Figures</a> · {INDUSTRY_TITLES.get(figure.industry)} · <a href={href("studio")}>studio</a>
        </p>
        <h1>{figure.title}</h1>
        <p className="lede">{figure.blurb}</p>
        <LevelBadge level={figure.level} />
        <BuiltFrom figure={figure} />
      </header>
      <div className="figure-stage">
        <Figure />
      </div>
      <PusharyCredit slug={figure.slug} />
      <section className="figure-section" aria-labelledby="variations">
        <div className="section-head">
          <h2 id="variations">Variations</h2>
          <p>The same component in each look from react-isokit/themes.css, light and dark. Nothing in it changes: every colour comes from the --ik-* properties, and blueprint adds the drafting layer.</p>
        </div>
        <div className="variation-grid">
          {VARIATIONS.map((variation) => (
            <figure key={variation.id} className={variation.className} data-look={variation.look}>
              <Figure />
              <figcaption>
                <strong>{variation.title}</strong>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      <FigureSounds figure={figure} />
    </main>
  )
}

export function FigurePage({ slug }: { slug: string }): ReactNode {
  const figure = figureBySlug.get(slug)
  return figure ? <FigureDetail key={figure.slug} figure={figure} /> : <FiguresPage />
}
