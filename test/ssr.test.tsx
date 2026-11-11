import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Box, Plate, Press, playSound, SoundToggle } from "../src"

describe("server rendering", () => {
  it("renders a whole figure with no DOM", () => {
    const key = { x: 0, y: 0, z: 0, w: 40, d: 40, h: 10 }
    const html = renderToString(
      <Plate label="A key" fit={[key]} fig="Fig 1" name="Key" hint="Press it" readout="rest">
        <Press label="Press" onPress={() => {}}><g><Box {...key} r={6} top={<rect className="ik-detail" width={4} height={4} />} /></g></Press>
      </Plate>,
    )
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="A key"')
    expect(html).toContain('role="button"')
    expect(html).toContain("viewBox=")
    expect(html).toContain("Fig 1")
  })
  it("renders the sound switch off by default", () => {
    expect(renderToString(<SoundToggle />)).toContain('aria-pressed="false"')
  })
  it("plays nothing on the server", () => {
    expect(() => playSound("press")()).not.toThrow()
  })
})
