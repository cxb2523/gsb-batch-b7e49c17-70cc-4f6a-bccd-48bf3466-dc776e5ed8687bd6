import { afterEach, describe, expect, it, vi } from "vitest"
import { configureSound, frame, playSound } from "../src"

const settle = () => new Promise((r) => setTimeout(r, 50))
afterEach(() => vi.restoreAllMocks())

describe("development checks", () => {
  it("explain a bad box passed to frame, once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const bad = { x: 0, y: 0, z: 0, w: -5, d: 1, h: 1 }
    frame([bad])
    frame([bad])
    await settle()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain("w cannot be negative")
  })
  it("explain an unknown sound", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    playSound("airhorn" as never)
    await settle()
    expect(String(warn.mock.calls[0]?.[0])).toContain('playSound("airhorn")')
  })
  it("explain bad settings and keep the good ones", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    configureSound({ volume: 3 })
    await settle()
    expect(String(warn.mock.calls[0]?.[0])).toContain("volume is between 0 and 1")
  })
})
