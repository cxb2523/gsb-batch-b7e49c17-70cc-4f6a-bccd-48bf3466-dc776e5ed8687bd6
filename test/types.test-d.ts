import { describe, expectTypeOf, it } from "vitest"
import type * as z from "zod/mini"
import { type Box3, type BoxProps, frame, type PressProps, playSound, type SoundName, type Vec3 } from "../src"
import type { box3Schema } from "../src/schema"

describe("types", () => {
  it("come from the schemas", () => {
    expectTypeOf<Box3>().toEqualTypeOf<z.infer<typeof box3Schema>>()
    expectTypeOf<Vec3>().toEqualTypeOf<readonly [number, number, number]>()
  })
  it("only take real sounds", () => {
    expectTypeOf(playSound).parameter(0).toEqualTypeOf<SoundName>()
    // @ts-expect-error
    playSound("airhorn")
  })
  it("need what a figure cannot draw without", () => {
    // @ts-expect-error
    const box: BoxProps = { x: 0, y: 0, z: 0, w: 1, d: 1 }
    // @ts-expect-error
    const press: PressProps = { onPress: () => {}, children: null }
    expectTypeOf(frame).parameter(0).toEqualTypeOf<ReadonlyArray<Box3 | Vec3>>()
    void box
    void press
  })
})
