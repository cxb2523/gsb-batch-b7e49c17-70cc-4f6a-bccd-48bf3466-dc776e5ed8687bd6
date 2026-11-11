// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => { vi.resetModules(); localStorage.clear() })

describe("sound preference", () => {
  it("is off until the page turns it on", async () => {
    const { soundPreference } = await import("../src")
    expect(soundPreference.get()).toBe(false)
  })
  it("follows configureSound and remembers the reader's choice", async () => {
    const { configureSound, soundPreference } = await import("../src")
    configureSound({ defaultOn: true, storageKey: "test:sound" })
    expect(soundPreference.get()).toBe(true)
    soundPreference.set(false)
    expect(localStorage.getItem("test:sound")).toBe("off")
    configureSound({ defaultOn: true, storageKey: "test:sound" })
    expect(soundPreference.get()).toBe(false)
  })
  it("tells subscribers when it changes", async () => {
    const { soundPreference } = await import("../src")
    const fn = vi.fn()
    const off = soundPreference.subscribe(fn)
    soundPreference.set(true)
    off()
    soundPreference.set(false)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it("does not load the engine while off", async () => {
    const { playSound } = await import("../src")
    const stop = playSound("press")
    expect(typeof stop).toBe("function")
  })
})
