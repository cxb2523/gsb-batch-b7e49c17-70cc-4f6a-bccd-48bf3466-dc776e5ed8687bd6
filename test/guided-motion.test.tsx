// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { Box, Cursor, Flight, Plate, Press, path, project, Ripple, Signal, useDemoTap } from "../src"
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const key = { x: 0, y: 0, z: 0, w: 40, d: 40, h: 10 }
let host: HTMLDivElement
afterEach(() => host?.remove())

function render(node: React.ReactNode) {
  host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(node))
  return root
}

describe("Cursor", () => {
  it("draws nothing while waiting or done", () => {
    expect(renderToString(<svg><Cursor at={[0, 0, 0]} phase="waiting" /></svg>)).not.toContain("ik-cursor")
    expect(renderToString(<svg><Cursor at={[0, 0, 0]} phase="done" /></svg>)).not.toContain("ik-cursor")
  })
  it("puts its tip on the projected point", () => {
    const [x, y] = project(10, 20, 5)
    const html = renderToString(<svg><Cursor at={[10, 20, 5]} phase="aim" size={2} /></svg>)
    expect(html).toContain(`translate(${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}) scale(2)`)
    expect(html).toContain('data-phase="aim"')
  })
})

describe("Flight", () => {
  it("moves by the projected difference, in two groups so it arcs", () => {
    const [fx, fy] = project(0, 0, 0)
    const [tx, ty] = project(40, 0, 10)
    const html = renderToString(<svg><Flight from={[0, 0, 0]} to={[40, 0, 10]} delay={100} lift={10}><rect /></Flight></svg>)
    expect(html).toContain(`--ik-dx:${Math.round((tx - fx) * 1000) / 1000}px`)
    expect(html).toContain(`--ik-dy:${Math.round((ty - fy) * 1000) / 1000}px`)
    expect(html).toContain("--ik-lift:-10px")
    expect(html).toContain("animation-delay:100ms")
    expect(html).toContain('class="ik-flight-arc"')
  })
})

describe("Signal and Ripple", () => {
  it("runs a signal along the path of its points, measured by pathLength", () => {
    const points = [[0, 0, 0], [40, 0, 0], [40, 40, 0]] as const
    const html = renderToString(<svg><Signal points={points} delay={50} duration={200} /></svg>)
    expect(html).toContain(`d="${path(points)}"`)
    expect(html).toContain('pathLength="100"')
    expect(html).toContain("animation-duration:200ms")
  })
  it("keeps a ripple's radius inside its footprint", () => {
    const html = renderToString(<svg><Ripple x={0} y={0} z={0} w={20} d={10} r={30} /></svg>)
    expect(html).toContain('rx="5"')
    expect(html).toContain("ik-loop")
  })
  it("draws a ripple in the face it sits in, so it can ring a key on an upright face", () => {
    const html = renderToString(<svg><Ripple inFace x={4} y={6} w={20} d={10} r={3} /></svg>)
    expect(html).toContain('transform="translate(4 6)"')
    expect(html).not.toContain("matrix(")
  })
})

function DemoKey() {
  const demo = useDemoTap(() => {}, { threshold: 7 })
  return (
    <Plate label="A key" fit={[key]} readout={demo.phase} {...demo.plate}>
      <g ref={demo.ref}>
        <Press label="Press" onPress={demo.dismiss}>
          <g><Box {...key} /></g>
        </Press>
      </g>
    </Plate>
  )
}

describe("useDemoTap", () => {
  it("waits quietly without IntersectionObserver, survives a bad threshold, and stops on dismiss", () => {
    render(<DemoKey />)
    const live = () => host.querySelector("[aria-live]")?.textContent
    expect(live()).toBe("waiting")
    expect(host.querySelector("svg")?.hasAttribute("data-demo")).toBe(false)
    const button = host.querySelector<SVGGElement>('[role="button"]')
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(live()).toBe("done")
  })
})

describe("Press, hardened", () => {
  it("runs your pointer handler after its own, instead of replacing it", () => {
    let seen = 0
    render(
      <Plate label="A key" fit={[key]}>
        <Press label="Press" onPress={() => {}} onPointerDown={() => seen++}>
          <g><Box {...key} /></g>
        </Press>
      </Plate>,
    )
    const button = host.querySelector<SVGGElement>('[role="button"]')
    act(() => button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })))
    expect(seen).toBe(1)
    expect(button?.getAttribute("data-down")).toBe("true")
  })
  it("does not act when it became disabled while held from the keyboard", () => {
    let pressed = 0
    const part = (disabled: boolean) => (
      <Plate label="A key" fit={[key]}>
        <Press label="Press" onPress={() => pressed++} disabled={disabled}>
          <g><Box {...key} /></g>
        </Press>
      </Plate>
    )
    const root = render(part(false))
    const button = () => host.querySelector<SVGGElement>('[role="button"]')
    act(() => button()?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })))
    act(() => root.render(part(true)))
    act(() => button()?.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })))
    expect(pressed).toBe(0)
  })
})

describe("Plate", () => {
  it("has its live region from the first render, even when the readout starts empty", () => {
    expect(renderToString(<Plate label="A key" fit={[key]} readout={null} />)).toContain('aria-live="polite"')
  })
})
