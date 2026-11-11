import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { springEasing } from "../examples/demo/src/bench/spring-easing"
import { soundNames } from "../src/schema"
import { placement } from "../src/sound/sound-placement"
import { RECIPES } from "../src/sound/sound-recipes"
import type { Mixer } from "../src/sound/sound-voices"

function recordingMixer() {
  let voices = 0
  const param = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }
  const node = () => ({ connect: (next: unknown) => next, disconnect() {}, start() {}, stop() {}, type: "", buffer: null, loop: false, frequency: { ...param }, gain: { ...param }, Q: { ...param } })
  const voice = () => {
    voices++
    return node()
  }
  const context = { createOscillator: voice, createBufferSource: voice, createGain: node, createBiquadFilter: node }
  const mixer = { context, bus: node(), noise: {}, startAt: 0 } as unknown as Mixer
  return { mixer, voices: () => voices }
}

describe("sound recipes", () => {
  it.each(soundNames.map((name) => [name]))("%s makes sound and reports how long it lasts", (name) => {
    const { mixer, voices } = recordingMixer()
    const length = RECIPES[name](mixer, { pitch: 1, still: false, options: {} })
    expect(voices()).toBeGreaterThan(0)
    expect(Number.isFinite(length) && length > 0).toBe(true)
  })
  it("gives every material its own press", () => {
    const lengths = new Set(["plastic", "metal", "rubber", "glass", "paper"].map((material) => {
      const { mixer, voices } = recordingMixer()
      RECIPES.press(mixer, { pitch: 1, still: false, options: { material: material as never } })
      return voices()
    }))
    expect(lengths.size).toBeGreaterThan(1)
  })
  it("climbs the charge for as long as it is asked, then cuts", () => {
    const { mixer } = recordingMixer()
    expect(RECIPES.charge(mixer, { pitch: 1, still: false, options: { duration: 2 } })).toBeCloseTo(2.15, 5)
  })
  it("holds the motor for as long as it is asked to run", () => {
    const { mixer } = recordingMixer()
    expect(RECIPES.motor(mixer, { pitch: 1, still: false, options: { duration: 3 } })).toBeCloseTo(3.25, 5)
  })
  it("rolls once per wheel", () => {
    const one = recordingMixer()
    const three = recordingMixer()
    RECIPES.roll(one.mixer, { pitch: 1, still: false, options: {} })
    RECIPES.roll(three.mixer, { pitch: 1, still: false, options: { count: 3 } })
    expect(three.voices()).toBe(one.voices() * 3)
  })
})

describe("sound placement", () => {
  const plate = { x: 100, width: 400, height: 300 }
  it("pans a part by where it sits, gently", () => {
    expect(placement({ x: 100, width: 0, height: 10 }, plate).pan).toBeCloseTo(-0.35, 5)
    expect(placement({ x: 280, width: 40, height: 10 }, plate).pan).toBeCloseTo(0, 5)
    expect(placement({ x: 500, width: 0, height: 10 }, plate).pan).toBeCloseTo(0.35, 5)
  })
  it("sizes a part as a share of the plate", () => {
    expect(placement({ x: 100, width: 100, height: 75 }, plate).size).toBeCloseTo(0.25, 5)
  })
  it("stays centred when the plate has no size yet", () => {
    expect(placement({ x: 0, width: 10, height: 10 }, { x: 0, width: 0, height: 0 })).toEqual({})
  })
})

describe("the kit's spring", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")
  const generated = springEasing({ duration: 0.3, bounce: 0.25 })
  it("is the generated spring, not a hand-typed curve", () => {
    expect(styles).toContain(`--ik-spring: ${generated.easing};`)
  })
  it("lasts as long as the spring takes to settle", () => {
    const declared = Number(/--ik-t-spring: (\d+)ms;\n {2}\}/.exec(styles)?.[1])
    expect(Math.abs(declared - generated.milliseconds)).toBeLessThanOrEqual(10)
  })
  it("overshoots a little and comes to rest", () => {
    const stops = generated.easing.slice(7, -1).split(", ").map((stop) => Number(stop.split(" ")[0]))
    expect(Math.max(...stops)).toBeGreaterThan(1)
    expect(Math.max(...stops)).toBeLessThan(1.1)
    expect(stops.at(-1)).toBe(1)
  })
})
