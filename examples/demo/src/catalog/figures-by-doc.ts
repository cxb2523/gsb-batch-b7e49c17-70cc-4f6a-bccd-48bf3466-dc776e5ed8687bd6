import { DOCS, docSlugForExport } from "./component-docs"
import { FIGURES, type FigureEntry } from "./figure-registry"

function linkFiguresToDocs(): ReadonlyMap<string, readonly FigureEntry[]> {
  const links = new Map<string, Set<FigureEntry>>(DOCS.map((doc) => [doc.slug, new Set<FigureEntry>()]))
  for (const figure of FIGURES) {
    for (const name of figure.uses) links.get(docSlugForExport(name))?.add(figure)
  }
  return new Map([...links].map(([slug, figures]) => [slug, [...figures]]))
}

export const figuresByDocSlug: ReadonlyMap<string, readonly FigureEntry[]> = linkFiguresToDocs()
