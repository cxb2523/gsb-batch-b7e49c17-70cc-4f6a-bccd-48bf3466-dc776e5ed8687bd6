import { describe, expect, it } from "vitest"
import { box3Schema, describe as explain, fitSchema, soundConfigSchema, soundNameSchema, soundNames, soundOptionsSchema, vec3Schema } from "../src/schema"

describe("schemas", () => {
  it("accept good figure data", () => {
    expect(box3Schema.safeParse({ x: 0, y: 0, z: 0, w: 10, d: 10, h: 0 }).success).toBe(true)
    expect(vec3Schema.safeParse([1, 2, 3]).success).toBe(true)
    expect(fitSchema.safeParse([{ x: 0, y: 0, z: 0, w: 1, d: 1, h: 1 }, [0, 0, 5]]).success).toBe(true)
  })
  it("reject boxes with negative or missing sizes, and say why", () => {
    const r = box3Schema.safeParse({ x: 0, y: 0, z: 0, w: -1, d: 10 })
    expect(r.success).toBe(false)
    if (!r.success) {
      const text = explain(r.error)
      expect(text).toContain("w cannot be negative")
      expect(text).toContain("h")
    }
  })
  it("reject numbers that are not finite", () => {
    expect(vec3Schema.safeParse([0, Number.NaN, 0]).success).toBe(false)
    expect(box3Schema.safeParse({ x: Number.POSITIVE_INFINITY, y: 0, z: 0, w: 1, d: 1, h: 1 }).success).toBe(false)
  })
  it("know every sound", () => {
    for (const name of soundNames) expect(soundNameSchema.safeParse(name).success).toBe(true)
    expect(soundNameSchema.safeParse("airhorn").success).toBe(false)
  })
  it("bound sound options and settings", () => {
    expect(soundOptionsSchema.safeParse({ count: 4, stagger: 0.06, delay: 0.3 }).success).toBe(true)
    expect(soundOptionsSchema.safeParse({ count: 0.5 }).success).toBe(false)
    expect(soundConfigSchema.safeParse({ volume: 2 }).success).toBe(false)
    expect(soundConfigSchema.safeParse({ storageKey: null, defaultOn: true, volume: 0.4 }).success).toBe(true)
  })
})
