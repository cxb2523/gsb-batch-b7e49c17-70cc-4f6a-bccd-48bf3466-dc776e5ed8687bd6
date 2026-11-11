import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TEXTURES } from "../examples/demo/src/catalog/lab-meta"
import { LAB_FIGURES } from "../examples/demo/src/catalog/lab-registry"
import * as kit from "../src"
import * as drafting from "../src/drafting"
import { soundNames } from "../src/schema"

const exportNames = new Set([...Object.keys(kit), ...Object.keys(drafting)])
const sounds = new Set<string>(soundNames)
const textures = new Set<string>(TEXTURES.map((texture) => texture.id))

describe("lab catalog", () => {
  it("files every lab figure at lab/figures/<slug>.tsx, each slug once", () => {
    for (const figure of LAB_FIGURES) expect(figure.path).toMatch(new RegExp(`/lab/figures/${figure.slug}\\.tsx$`))
    expect(new Set(LAB_FIGURES.map((figure) => figure.slug)).size).toBe(LAB_FIGURES.length)
  })

  it("names real kit exports, real sounds and known textures", () => {
    for (const figure of LAB_FIGURES) {
      for (const name of figure.uses) expect(exportNames.has(name), `${figure.slug} uses ${name}`).toBe(true)
      for (const sound of figure.sounds) expect(sounds.has(sound), `${figure.slug} plays ${sound}`).toBe(true)
      for (const texture of figure.textures) expect(textures.has(texture), `${figure.slug} wears ${texture}`).toBe(true)
    }
  })

  it.each(LAB_FIGURES.map((figure) => [figure.slug, figure] as const))("renders %s on the server with something to press and the textures it names", (_, figure) => {
    const { Figure } = figure
    const html = renderToString(<Figure />)
    expect(html).toContain('role="button"')
    expect(html.match(/<pattern id="tx-print[^"]*-(top|front|side|plane)"/g) ?? []).toHaveLength(4 * figure.textures.length)
    if (figure.textures.length) expect(html).toContain('class="tx-print"')
  })
})
