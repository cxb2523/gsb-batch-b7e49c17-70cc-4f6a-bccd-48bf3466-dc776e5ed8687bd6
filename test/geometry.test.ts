import { describe, expect, it } from "vitest"
import { corners, curve, frame, front, hull, outline, path, project, radius, side, top } from "../src"

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe("project", () => {
  it("puts the origin at the origin", () => expect(project(0, 0, 0)).toEqual([0, 0]))
  it("runs +x down-right and +y down-left at 30°", () => {
    const [x1, y1] = project(1, 0, 0)
    const [x2, y2] = project(0, 1, 0)
    near(Math.atan2(y1, x1), Math.PI / 6)
    near(Math.atan2(y2, x2), Math.PI - Math.PI / 6)
  })
  it("runs +z straight up, unscaled", () => expect(project(0, 0, 10)).toEqual([0, -10]))
  it("never shrinks with distance", () => {
    const a = project(0, 0, 0), b = project(10, 0, 0), c = project(100, 0, 0), d = project(110, 0, 0)
    near(b[0] - a[0], d[0] - c[0])
  })
})

describe("planes", () => {
  const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 2)
  const apply = (m: string, x: number, y: number): [number, number] => {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m.slice(7, -1).split(" ").map(Number)
    return [a * x + c * y + e, b * x + d * y + f]
  }
  it("top maps local (u, v) to world (x + u, y + v, z)", () => {
    const [sx, sy] = apply(top(5, 6, 7), 3, 4)
    const [ex, ey] = project(8, 10, 7)
    close(sx, ex); close(sy, ey)
  })
  it("front maps local (u, v) to world (x + u, y, z − v)", () => {
    const [sx, sy] = apply(front(5, 6, 7), 3, 4)
    const [ex, ey] = project(8, 6, 3)
    close(sx, ex); close(sy, ey)
  })
  it("side maps local (u, v) to world (x, y − u, z − v)", () => {
    const [sx, sy] = apply(side(5, 6, 7), 3, 4)
    const [ex, ey] = project(5, 3, 3)
    close(sx, ex); close(sy, ey)
  })
})

describe("frame", () => {
  const box = { x: 0, y: 0, z: 0, w: 100, d: 60, h: 40 }
  const view = (v: string) => {
    const [x = 0, y = 0, w = 0, h = 0] = v.split(" ").map(Number)
    return { x, y, w, h }
  }
  it("holds the aspect ratio", () => {
    const { w, h } = view(frame([box], 1.25))
    near(w / h, 1.25)
  })
  it("contains every corner", () => {
    const { x, y, w, h } = view(frame([box], 1.25))
    for (const c of corners(box)) {
      const [sx, sy] = project(...c)
      expect(sx).toBeGreaterThanOrEqual(x); expect(sx).toBeLessThanOrEqual(x + w)
      expect(sy).toBeGreaterThanOrEqual(y); expect(sy).toBeLessThanOrEqual(y + h)
    }
  })
  it("accepts loose points and survives nothing", () => {
    expect(frame([[0, 0, 0], [10, 10, 10]])).toMatch(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/)
    expect(frame([])).toBe("0 0 100 100")
  })
})

describe("solids", () => {
  it("hull keeps only the outside", () => {
    const pts = hull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]])
    expect(pts).toHaveLength(4)
  })
  it("outline is one closed path", () => {
    const d = outline({ x: 0, y: 0, z: 0, w: 40, d: 30, h: 10 }, 6)
    expect(d.startsWith("M")).toBe(true)
    expect(d.endsWith("Z")).toBe(true)
    expect(d.split("M")).toHaveLength(2)
  })
  it("radius is cut to half the shorter side", () => {
    expect(radius({ x: 0, y: 0, z: 0, w: 10, d: 40, h: 5 }, 20)).toBe(5)
    expect(radius({ x: 0, y: 0, z: 0, w: 10, d: 40, h: 5 }, -1)).toBe(0)
  })
  it("leaves out points that are not finite instead of breaking the view", () => {
    expect(frame([[0, 0, 0], [Number.NaN, 0, 0], [10, 10, 10]])).not.toContain("NaN")
  })
  it("curve starts and ends on its end points", () => {
    const pts = curve([0, 0, 0], [5, 0, 0], [5, 5, 0], [10, 10, 4], 10)
    expect(pts).toHaveLength(11)
    expect(pts[0]).toEqual([0, 0, 0])
    expect(pts[10]).toEqual([10, 10, 4])
  })
  it("path needs two points", () => {
    expect(path([[0, 0, 0]])).toBe("")
    expect(path([[0, 0, 0], [1, 0, 0]])).toMatch(/^M0 0L/)
  })
})

describe("frame, against every corner", () => {
  it("fits the same box as projecting all eight corners of each box", () => {
    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let round = 0; round < 200; round++) {
      const boxes = Array.from({ length: 1 + Math.floor(random() * 6) }, () => ({ x: random() * 200 - 100, y: random() * 200 - 100, z: random() * 60, w: random() * 80, d: random() * 80, h: random() * 40 }))
      const points = boxes.flatMap((box) => corners(box))
      expect(frame(boxes, 1.3)).toBe(frame(points, 1.3))
    }
  })
})
