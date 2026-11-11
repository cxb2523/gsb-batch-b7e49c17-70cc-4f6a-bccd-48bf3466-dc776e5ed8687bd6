// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import { Box, Plate, Press } from "../src"

const key = { x: 0, y: 0, z: 0, w: 40, d: 40, h: 10 }
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
afterEach(() => host?.remove())

function mount(onPress = () => {}) {
  host = document.createElement("div")
  document.body.append(host)
  act(() =>
    createRoot(host).render(
      <Plate label="A key" fit={[key]}>
        <Press label="Press" onPress={onPress}>
          <g><Box {...key} /></g>
        </Press>
      </Plate>,
    ),
  )
  const button = host.querySelector<SVGGElement>('[role="button"]')
  if (!button) throw new Error("no button")
  return button
}

describe("Press", () => {
  it("comes back up when focus leaves while it is held", () => {
    const button = mount()
    act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
    expect(button.getAttribute("data-down")).toBe("true")
    act(() => button.dispatchEvent(new FocusEvent("focusout", { bubbles: true })))
    expect(button.getAttribute("data-down")).toBe("false")
  })
  it("acts on release from the keyboard", () => {
    let n = 0
    const button = mount(() => n++)
    act(() => button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })))
    act(() => button.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })))
    expect(n).toBe(1)
  })
  it("sits in a labelled group", () => {
    mount()
    expect(host.querySelector("svg")?.getAttribute("role")).toBe("group")
  })
})
