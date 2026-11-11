import { lazy, type ReactNode, Suspense, useState } from "react"
import { href } from "../app/route-store"
import { TEXTURES } from "../catalog/lab-meta"
import { LAB_FIGURES, type LabEntry } from "../catalog/lab-registry"
import { LevelBadge } from "./figures-page"
import { type LookId, LookSwitch, lookAttribute } from "./look-switch"

const TEXTURE_TITLES: ReadonlyMap<string, string> = new Map(TEXTURES.map((texture) => [texture.id, texture.title]))

const LabDials = import.meta.env.DEV ? lazy(() => import("./lab-dials")) : null

function LabCard({ figure }: { figure: LabEntry }): ReactNode {
  const { Figure } = figure
  return (
    <figure className="figure-card">
      <Figure />
      <figcaption>
        <strong>
          <a href={href("lab", figure.slug)}>{figure.title}</a>
        </strong>
        <span>{figure.blurb}</span>
        <span className="lab-tags">
          <LevelBadge level={figure.level} />
          {figure.textures.map((texture) => (
            <span key={texture} className="level-badge">
              {TEXTURE_TITLES.get(texture)}
            </span>
          ))}
        </span>
      </figcaption>
    </figure>
  )
}

export function LabPage(): ReactNode {
  const [look, setLook] = useState<LookId>("plain")
  return (
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">Lab · experimental · {LAB_FIGURES.length}</p>
        <h1>The lab bench.</h1>
        <p className="lede">Technical figures built from parts that any figure can reuse: drums, bored rings, wound coils, slot rings, lenses and light. Press them to assemble and light them. Switch to blueprint for the drawing's callouts.</p>
      </header>
      <div className="filter-panel">
        <LookSwitch look={look} onChange={setLook} />
      </div>
      <section className="figure-section" aria-label="Lab figures" data-look={lookAttribute(look)}>
        <div className="figure-grid">
          {LAB_FIGURES.map((figure) => (
            <LabCard key={figure.slug} figure={figure} />
          ))}
        </div>
      </section>
      {LabDials && (
        <Suspense fallback={null}>
          <LabDials />
        </Suspense>
      )}
    </main>
  )
}
