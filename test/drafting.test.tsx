import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Callout, Dimension, dimension } from "../src/drafting"
import { gridSheet, gridTile, viewBoxRect } from "../src/geometry/grid"

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 2)

describe("dimension", () => {
  it("runs along +x at 30° and reads left to right", () => {
    const run = dimension([0, 0, 0], [100, 0, 0], [0, 10, 0])
    near(run.angle, 30)
    near(run.length, 100)
  })
  it("swaps its ends so the label never reads upside down", () => {
    const forward = dimension([0, 0, 0], [100, 0, 0], [0, 10, 0])
    const backward = dimension([100, 0, 0], [0, 0, 0], [0, 10, 0])
    expect(backward).toEqual(forward)
  })
  it("reads a height from the bottom up", () => {
    const rise = dimension([0, 0, 0], [0, 0, 40], [10, 0, 0])
    near(rise.angle, -90)
    near(rise.length, 40)
  })
  it("points its witness back at the measured edge", () => {
    const { angle, back } = dimension([0, 0, 0], [100, 0, 0], [0, 0, 12])
    const turn = (angle * Math.PI) / 180
    const screenX = back[0] * Math.cos(turn) - back[1] * Math.sin(turn)
    const screenY = back[0] * Math.sin(turn) + back[1] * Math.cos(turn)
    near(screenX, 0)
    near(screenY, 12)
  })
  it("renders as a drafting layer, with its label", () => {
    const html = renderToString(
      <svg>
        <Dimension from={[0, 0, 0]} to={[50, 0, 0]} offset={[0, 8, 0]} label="w 50" />
        <Callout at={[0, 0, 10]} label="lid" />
      </svg>,
    )
    expect(html.match(/ik-drafting/g)).toHaveLength(2)
    expect(html).toContain("w 50")
    expect(html).toContain("lid")
  })
})

describe("grid", () => {
  it("draws ground lines along both isometric axes", () => {
    const tile = gridTile(10)
    near(tile.height, 10)
    near(Math.atan2(tile.height, tile.width), Math.PI / 6)
  })
  it("reads a viewBox and covers three times its span", () => {
    expect(viewBoxRect("-10 -20 100 50")).toEqual({ x: -10, y: -20, width: 100, height: 50 })
    expect(gridSheet("-10 -20 100 50")).toEqual({ x: -110, y: -70, width: 300, height: 150 })
  })
})
