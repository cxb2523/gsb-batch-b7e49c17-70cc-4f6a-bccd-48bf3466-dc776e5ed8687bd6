import { type ReactNode, useState } from "react"
import { CopyCommand } from "../app/copy-command"
import { GITHUB_REPO } from "../app/links"
import { href } from "../app/route-store"
import { docSlugForExport } from "../catalog/component-docs"
import { GETTING_STARTED } from "../catalog/getting-started"
import { LAB_PARTS } from "../catalog/lab-parts"
import { LAB_FIGURES, type LabEntry, labBySlug } from "../catalog/lab-registry"
import { LabPage } from "./lab-page"
import { type LookId, LookSwitch, lookAttribute } from "./look-switch"

const PART_BY_NAME = new Map(LAB_PARTS.map((part) => [part.name, part]))
const SOURCE = `${GITHUB_REPO}/blob/main/examples/demo/src`
const sourceOf = (path: string): string => `${SOURCE}/${path.replace(/^\.\.\//, "")}`

function LabFigureDetail({ figure }: { figure: LabEntry }): ReactNode {
  const [look, setLook] = useState<LookId>("plain")
  const { Figure } = figure
  const parts = (figure.parts ?? []).flatMap((name) => PART_BY_NAME.get(name) ?? [])
  const others = LAB_FIGURES.filter((other) => other.slug !== figure.slug)
  return (
    <main className="page lab-landing">
      <header className="page-head">
        <p className="eyebrow">
          <a href={href("lab")}>Lab</a> · Free and open source
        </p>
        <h1>{figure.headline ?? figure.title}</h1>
        <p className="lede">{figure.pitch ?? figure.blurb}</p>
        <div className="cta lab-landing-cta">
          <CopyCommand text="npm i react-isokit" />
          <a className="button" href={sourceOf(figure.path)} target="_blank" rel="noopener">
            Read the source <span aria-hidden="true">→</span>
          </a>
          <a className="button button-secondary" href={GITHUB_REPO} target="_blank" rel="noopener">
            Star on GitHub
          </a>
        </div>
      </header>

      <div className="figure-stage lab-landing-stage" data-look={lookAttribute(look)}>
        <Figure />
      </div>
      <div className="filter-panel lab-landing-looks">
        <LookSwitch look={look} onChange={setLook} />
      </div>

      <section className="figure-section" aria-labelledby="built-from">
        <div className="section-head">
          <h2 id="built-from">Built from the kit</h2>
          <p>Every isokit export it uses. Each one links to its docs.</p>
        </div>
        <ul className="chips">
          {figure.uses.map((name) => (
            <li key={name}>
              <a href={href("components", docSlugForExport(name))}>
                <code>{name}</code>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {parts.length > 0 && (
        <section className="figure-section" aria-labelledby="parts">
          <div className="section-head">
            <h2 id="parts">Parts you can reuse</h2>
            <p>It is put together from small parts built on the kit's Box and Glow. They live in the studio's lab for now: copy them from the repo into your own figure.</p>
          </div>
          <dl className="part-list">
            {parts.map((part) => (
              <div key={part.name}>
                <dt>
                  <a href={`${SOURCE}/lab/parts/${part.file}`} target="_blank" rel="noopener">
                    <code>{part.name}</code>
                  </a>
                </dt>
                <dd>{part.what}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {figure.sounds.length > 0 && (
        <section className="figure-section" aria-labelledby="sounds">
          <div className="section-head">
            <h2 id="sounds">Sounds</h2>
            <p>
              Synthesized in the browser, no audio files, and played only for your own presses. Switch sound on in the header to hear them. <a href={href("sound")}>Hear every sound</a>.
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
      )}

      <section className="figure-section agent" aria-labelledby="make-your-own">
        <div className="section-head">
          <h2 id="make-your-own">Make your own</h2>
          <p>
            You need a React project and a coding agent. Prefer to write it yourself? <a href={href("components")}>Read the component docs</a> or start from one of the <a href={href("figures")}>examples</a>.
          </p>
        </div>
        <ol className="steps">
          {GETTING_STARTED.map((step, index) => (
            <li key={step.title}>
              <span className="n">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              <CopyCommand text={step.command} />
            </li>
          ))}
        </ol>
      </section>

      {others.length > 0 && (
        <section className="figure-section" aria-labelledby="more">
          <div className="section-head">
            <h2 id="more">More from the lab</h2>
          </div>
          <ul className="chips">
            {others.map((other) => (
              <li key={other.slug}>
                <a href={href("lab", other.slug)}>{other.title}</a>
              </li>
            ))}
            <li>
              <a href={href("figures")}>All figures</a>
            </li>
          </ul>
        </section>
      )}
    </main>
  )
}

export function LabFigurePage({ slug }: { slug: string }): ReactNode {
  const figure = labBySlug.get(slug)
  return figure ? <LabFigureDetail key={figure.slug} figure={figure} /> : <LabPage />
}
