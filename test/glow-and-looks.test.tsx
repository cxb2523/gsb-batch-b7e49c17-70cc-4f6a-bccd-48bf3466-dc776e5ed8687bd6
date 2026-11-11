// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Glow, Plate } from "../src"

const render = (node: React.ReactNode) => {
  const host = document.createElement("div")
  host.innerHTML = renderToString(node)
  return host
}

describe("Glow", () => {
  it("draws its children once to read and twice as hidden light", () => {
    const host = render(
      <svg>
        <Glow on={false}>
          <circle className="ik-dot" r={2} />
        </Glow>
      </svg>,
    )
    expect(host.querySelectorAll("circle")).toHaveLength(3)
    expect(host.querySelectorAll('.ik-halo[aria-hidden="true"]')).toHaveLength(2)
    expect(host.querySelector(".ik-glow")?.getAttribute("data-on")).toBe("false")
  })
})

describe("Plate looks", () => {
  it("names its look and lays a grid that only a look reveals", () => {
    const host = render(<Plate label="Drawing" viewBox="0 0 100 80" look="blueprint" />)
    const plate = host.querySelector(".ik-plate")
    expect(plate?.getAttribute("data-look")).toBe("blueprint")
    const pattern = host.querySelector("pattern")
    const sheet = host.querySelector("rect.ik-grid")
    expect(sheet?.getAttribute("fill")).toBe(`url(#${pattern?.id})`)
    expect(sheet?.getAttribute("width")).toBe("300")
  })
  it("leaves the look unset by default", () => {
    expect(render(<Plate label="Drawing" viewBox="0 0 100 80" />).querySelector(".ik-plate")?.hasAttribute("data-look")).toBe(false)
  })
  it("keeps every colour a look sets in one colour space", () => {
    const themes = readFileSync("src/themes.css", "utf8")
    const colours = [...themes.matchAll(/--ik-(?!drafting|glow-strength|strength|[a-z]+-(?:light|dark))[a-z-]+: ([^;]+);/g)].map(([, value]) => value)
    expect(colours.length).toBeGreaterThan(20)
    for (const value of colours) expect(value).toMatch(/^(color-mix\(in oklab,|var\(--ik-(paper|pen|live)\)$)/)
  })
})
