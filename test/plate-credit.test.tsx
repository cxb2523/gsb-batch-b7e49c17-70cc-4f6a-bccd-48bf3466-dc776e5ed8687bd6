// @vitest-environment jsdom
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Plate } from "../src"

describe("Plate maker credit", () => {
  it("includes a usable maker link without requiring captions or browser APIs", () => {
    const host = document.createElement("div")
    host.innerHTML = renderToString(<Plate label="Drawing" viewBox="0 0 100 100" />)
    const link = host.querySelector("a")
    expect(link?.textContent).toBe("Made with isokit · pushary.com")
    const url = new URL(link?.href ?? "")
    expect(url.origin).toBe("https://pushary.com")
    expect(url.searchParams.get("utm_source")).toBe("isokit")
    expect(link?.target).toBe("_blank")
    expect(link?.relList.contains("noopener")).toBe(true)
    expect(link?.relList.contains("noreferrer")).toBe(true)
    expect(host.querySelector("svg a")).toBeNull()
    expect(host.querySelector("svg")?.hasAttribute("credit")).toBe(false)
  })

  it("keeps attribution out of announcements and preserves the readout", () => {
    const host = document.createElement("div")
    host.innerHTML = renderToString(<Plate label="Drawing" viewBox="0 0 100 100" hint="Press it" readout="allowed" />)
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("allowed")
    expect(host.querySelector("a")?.closest("[aria-live]")).toBeNull()
    expect(host.querySelectorAll("a")).toHaveLength(1)
  })

  it("allows unbranded use without changing SVG props or the live region", () => {
    const host = document.createElement("div")
    host.innerHTML = renderToString(<Plate label="Drawing" viewBox="0 0 100 100" credit={false} readout={null} data-ready="yes" />)
    expect(host.querySelector("a")).toBeNull()
    expect(host.querySelector('[aria-live="polite"]')).not.toBeNull()
    expect(host.querySelector("svg")?.getAttribute("data-ready")).toBe("yes")
    expect(host.querySelector("svg")?.hasAttribute("credit")).toBe(false)
    expect(host.textContent).not.toContain("pushary")
  })
})
