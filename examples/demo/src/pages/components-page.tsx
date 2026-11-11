import type { ReactNode } from "react"
import { NavigationPicker } from "../app/navigation-picker"
import { href } from "../app/route-store"
import { type ComponentDoc, DOC_GROUPS, DOCS, docBySlug, docsByGroup } from "../catalog/component-docs"
import { NO_FIGURES } from "../catalog/figure-registry"
import { figuresByDocSlug } from "../catalog/figures-by-doc"
import { EXAMPLES_BY_SLUG } from "../component-examples/examples-by-slug"

const NO_DOCS: readonly ComponentDoc[] = []
const NAVIGATION_GROUPS = [
  { label: "Start here", links: [{ label: "Overview", href: href("components") }] },
  ...DOC_GROUPS.map((group) => ({ label: group, links: (docsByGroup.get(group) ?? NO_DOCS).map((doc) => ({ label: doc.name, href: href("components", doc.slug) })) })),
]

function Sidebar({ current }: { current: string | undefined }): ReactNode {
  return (
    <nav className="docs-nav" aria-label="Components">
      {DOC_GROUPS.map((group) => (
        <div key={group}>
          <p className="eyebrow">{group}</p>
          <ul>
            {(docsByGroup.get(group) ?? NO_DOCS).map((doc) => (
              <li key={doc.slug}>
                <a href={href("components", doc.slug)} aria-current={current === doc.slug ? "page" : undefined}>
                  <code>{doc.name}</code>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Detail({ doc }: { doc: ComponentDoc }): ReactNode {
  const Example = EXAMPLES_BY_SLUG.get(doc.slug)
  const usedBy = figuresByDocSlug.get(doc.slug) ?? NO_FIGURES
  return (
    <article className="docs-detail">
      <p className="eyebrow">
        {doc.group} · {doc.kind}
      </p>
      <h1>
        <code>{doc.name}</code>
      </h1>
      <p className="lede">{doc.summary}</p>
      <pre className="signature">
        <code>{doc.signature}</code>
      </pre>
      {Example ? (
        <div className="docs-example">
          <Example />
        </div>
      ) : null}
      <h2>{doc.kind === "Hook" ? "Arguments and result" : "Props"}</h2>
      <div className="table-wrap" role="region" aria-label={`${doc.name} properties`} tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Default</th>
              <th scope="col">What it does</th>
            </tr>
          </thead>
          <tbody>
            {doc.props.map((prop) => (
              <tr key={prop.name}>
                <td>
                  <code>{prop.name}</code>
                </td>
                <td>
                  <code>{prop.type}</code>
                </td>
                <td>{prop.fallback ? <code>{prop.fallback}</code> : "—"}</td>
                <td>{prop.about}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Usage</h2>
      <pre>
        <code>{doc.usage}</code>
      </pre>
      <h2>Notes</h2>
      <ul className="notes">
        {doc.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {usedBy.length ? (
        <>
          <h2>In the figures</h2>
          <ul className="chips">
            {usedBy.map((figure) => (
              <li key={figure.slug}>
                <a href={href("figures", figure.slug)}>{figure.title}</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  )
}

function Overview(): ReactNode {
  return (
    <article className="docs-detail">
      <p className="eyebrow">Components · {DOCS.length} pages</p>
      <h1>Everything in the kit.</h1>
      <p className="lede">The pieces behind the drawings. Start with Plate, Box and Press, then add motion or sound. Each page includes a working example and the code to use it.</p>
      <div className="docs-cards">
        {DOCS.map((doc) => (
          <a key={doc.slug} className="docs-card" href={href("components", doc.slug)}>
            <span className="eyebrow">{doc.group}</span>
            <code>{doc.name}</code>
            <span>{doc.summary}</span>
          </a>
        ))}
      </div>
    </article>
  )
}

export function ComponentsPage({ slug }: { slug: string | undefined }): ReactNode {
  const doc = slug ? docBySlug.get(slug) : undefined
  return (
    <main className="page docs">
      <div className="docs-picker">
        <NavigationPicker label="Components" current={{ label: doc?.name ?? "Overview", href: doc ? href("components", doc.slug) : href("components") }} groups={NAVIGATION_GROUPS} />
      </div>
      <Sidebar current={doc?.slug} />
      {doc ? <Detail key={doc.slug} doc={doc} /> : <Overview />}
    </main>
  )
}
