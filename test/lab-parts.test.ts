import { describe, expect, it } from "vitest"
import { clip, coilsAround, ellipseOf, FAR, NEAR, nearness, rim, ringPhase, windowsAround } from "../examples/demo/src/lab/parts/geometry"
import { project } from "../src"

const axis = { x: 40, y: 30 }

describe("lab part geometry", () => {
  it("draws a level circle as the ellipse its projected rim traces", () => {
    const { cx, cy, a, b } = ellipseOf(axis, 12, 7)
    const points = Array.from({ length: 360 }, (_, degrees) => project(...rim(axis, 12, 7, degrees)))
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    expect(xs.reduce((low, x) => Math.min(low, x), Infinity)).toBeCloseTo(cx - a, 1)
    expect(xs.reduce((high, x) => Math.max(high, x), -Infinity)).toBeCloseTo(cx + a, 1)
    expect(ys.reduce((low, y) => Math.min(low, y), Infinity)).toBeCloseTo(cy - b, 1)
    expect(ys.reduce((high, y) => Math.max(high, y), -Infinity)).toBeCloseTo(cy + b, 1)
  })

  it("keeps the outer wall's near half and a bore's far half", () => {
    const toward = (degrees: number) => Math.cos(((degrees - 45) * Math.PI) / 180)
    expect(toward((NEAR.from + NEAR.to) / 2)).toBeCloseTo(1)
    expect(toward((FAR.from + FAR.to) / 2)).toBeCloseTo(-1)
  })

  it("clips a turn to a window across the wrap, or drops it", () => {
    expect(clip({ from: 350, to: 370 }, NEAR)).toEqual({ from: -10, to: 10 })
    expect(clip({ from: 120, to: 150 }, NEAR)).toEqual({ from: 120, to: 135 })
    expect(clip({ from: 200, to: 220 }, NEAR)).toBeNull()
  })

  it("lights windows nearest first, in pairs, front to back", () => {
    const steps = coilsAround(10, 0.7, ringPhase(10), 0).map((coil) => coil.step)
    expect([...steps].sort((a, b) => a - b)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5])
    expect(nearness(45, 36)).toBe(0)
    expect(nearness(225, 36)).toBe(5)
  })

  it("places each window light at the middle of its gap", () => {
    const windows = windowsAround(10, 0.7, 30)
    const front = windows.find((window) => window.step === 0)
    expect(front?.x).toBeCloseTo(30 * Math.SQRT1_2)
    expect(front?.y).toBeCloseTo(30 * Math.SQRT1_2)
  })
})
