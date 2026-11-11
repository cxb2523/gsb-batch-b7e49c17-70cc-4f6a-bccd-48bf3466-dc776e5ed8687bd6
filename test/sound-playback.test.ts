// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const engine = vi.hoisted(() => ({
  blocked: false,
  pending: [] as Array<() => void>,
  play: vi.fn(() => vi.fn()),
  setVolume: vi.fn(),
}))

vi.mock("../src/sound/sound-engine", async () => {
  // Controllable delayed loading: while `engine.blocked` the import only
  // resolves once releaseEngine() is called from the test.
  if (engine.blocked) await new Promise<void>((resolve) => engine.pending.push(resolve))
  return { play: engine.play, setVolume: engine.setVolume }
})

const releaseEngine = (): void => {
  engine.blocked = false
  for (const release of engine.pending.splice(0)) release()
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

// loadEngine() calls setVolume() once the engine module arrives, so a
// setVolume call is the observable signal that the engine really loaded.
const engineLoaded = (): void => {
  expect(engine.setVolume).toHaveBeenCalled()
}

const engineNeverLoaded = (): void => {
  expect(engine.setVolume).not.toHaveBeenCalled()
  expect(engine.play).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  engine.blocked = false
  engine.pending.length = 0
  engine.play.mockClear()
  engine.setVolume.mockClear()
  // Dev checks warn about the out-of-range volumes used in the clamp tests.
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("playSound gating", () => {
  it("stays silent and never loads the engine while sound is off", async () => {
    const { playSound } = await import("../src")
    const stop = playSound("press")
    expect(typeof stop).toBe("function")
    stop()
    await vi.dynamicImportSettled()
    await flush()
    engineNeverLoaded()
  })

  it("stays silent and never loads the engine before user activation", async () => {
    Object.defineProperty(navigator, "userActivation", { value: { hasBeenActive: false }, configurable: true })
    try {
      const { configureSound, playSound } = await import("../src")
      configureSound({ defaultOn: true, storageKey: "test:sound" })
      const stop = playSound("press")
      expect(typeof stop).toBe("function")
      stop()
      await vi.dynamicImportSettled()
      await flush()
      engineNeverLoaded()
    } finally {
      delete (navigator as { userActivation?: unknown }).userActivation
    }
  })
})

describe("deferred engine loading", () => {
  it("does not play when stopped before the engine finishes loading", async () => {
    const { configureSound, playSound } = await import("../src")
    configureSound({ defaultOn: true, storageKey: "test:sound" })
    engine.blocked = true
    const stop = playSound("press")
    stop()
    releaseEngine()
    await vi.dynamicImportSettled()
    await flush()
    engineLoaded()
    expect(engine.play).not.toHaveBeenCalled()
  })

  it("plays once the engine arrives and routes stop to the engine", async () => {
    const { configureSound, playSound } = await import("../src")
    configureSound({ defaultOn: true, storageKey: "test:sound" })
    const engineStop = vi.fn()
    engine.play.mockReturnValueOnce(engineStop)
    engine.blocked = true
    const stop = playSound("press")
    releaseEngine()
    await vi.dynamicImportSettled()
    await flush()
    expect(engine.play).toHaveBeenCalledWith("press", undefined)
    stop()
    expect(engineStop).toHaveBeenCalledTimes(1)
  })
})

describe("configureSound", () => {
  it("drops the cached preference and re-reads localStorage under the new key", async () => {
    const { configureSound, soundPreference } = await import("../src")
    configureSound({ defaultOn: true, storageKey: "test:a" })
    expect(soundPreference.get()).toBe(true)
    soundPreference.set(true)
    expect(localStorage.getItem("test:a")).toBe("on")
    localStorage.setItem("test:b", "off")
    const listener = vi.fn()
    const unsubscribe = soundPreference.subscribe(listener)
    configureSound({ defaultOn: true, storageKey: "test:b" })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(soundPreference.get()).toBe(false)
    unsubscribe()
  })

  it("clamps volume into the 0..1 range", async () => {
    const { configureSound } = await import("../src")
    const { soundVolume } = await import("../src/sound/sound-store")
    configureSound({ volume: 2 })
    expect(soundVolume()).toBe(1)
    configureSound({ volume: -0.5 })
    expect(soundVolume()).toBe(0)
    configureSound({ volume: 0.4 })
    expect(soundVolume()).toBe(0.4)
  })

  it("pushes a clamped volume into an already-loaded engine", async () => {
    const { configureSound, playSound } = await import("../src")
    configureSound({ defaultOn: true, storageKey: "test:sound" })
    playSound("press")
    await vi.dynamicImportSettled()
    await flush()
    engineLoaded()
    configureSound({ volume: 1.4 })
    await flush()
    expect(engine.setVolume).toHaveBeenLastCalledWith(1)
  })
})
