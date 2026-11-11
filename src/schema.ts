import * as z from "zod/mini"

const finite = (what: string) => z.number(`${what} must be a number`).check(z.refine(Number.isFinite, `${what} must be a finite number`))
const size = (what: string) => finite(what).check(z.gte(0, `${what} cannot be negative`))

export const vec3Schema = z.readonly(z.tuple([finite("x"), finite("y"), finite("z")]))

export const box3Schema = z.object({
  x: finite("x"),
  y: finite("y"),
  z: finite("z"),
  w: size("w"),
  d: size("d"),
  h: size("h"),
})

export const fitSchema = z.array(z.union([box3Schema, vec3Schema]))

export const plateFrameSchema = z.object({
  aspect: z.optional(finite("aspect").check(z.gt(0, "aspect must be greater than 0"))),
  pad: z.optional(size("pad").check(z.lte(2, "pad is a share of the figure's size; keep it under 2"))),
})

export const soundNames = ["press", "release", "toggle", "boot", "success", "error", "notify", "complete", "cascade", "whoosh", "paper", "process", "done", "tick", "latch", "relay", "motor", "charge", "roll", "beep"] as const

export const materials = ["plastic", "metal", "rubber", "glass", "paper"] as const

export const materialSchema = z.enum(materials, "is not one of isokit's materials")

export const soundNameSchema = z.enum(soundNames, "is not one of isokit's sounds")

export const soundOptionsSchema = z.object({
  count: z.optional(z.int("count must be a whole number").check(z.gte(1), z.lte(32, "count is at most 32"))),
  stagger: z.optional(size("stagger").check(z.lte(2, "stagger is in seconds; keep it under 2"))),
  delay: z.optional(size("delay").check(z.lte(5, "delay is in seconds; keep it under 5"))),
  duration: z.optional(size("duration").check(z.lte(10, "duration is in seconds; keep it under 10"))),
  material: z.optional(materialSchema),
  pan: z.optional(finite("pan").check(z.gte(-1, "pan is between -1 and 1"), z.lte(1, "pan is between -1 and 1"))),
  size: z.optional(size("size").check(z.lte(1, "size is a share of the plate, between 0 and 1"))),
})

export const soundConfigSchema = z.object({
  defaultOn: z.optional(z.boolean("defaultOn must be true or false")),
  storageKey: z.optional(z.nullable(z.string().check(z.minLength(1, "storageKey cannot be empty")))),
  volume: z.optional(finite("volume").check(z.gte(0, "volume is between 0 and 1"), z.lte(1, "volume is between 0 and 1"))),
})

export const storedSoundSchema = z.enum(["on", "off"])

export type Vec3 = z.infer<typeof vec3Schema>
export type Box3 = z.infer<typeof box3Schema>
export type Fit = z.infer<typeof fitSchema>
export type SoundName = z.infer<typeof soundNameSchema>
export type Material = z.infer<typeof materialSchema>
export type SoundOptions = z.infer<typeof soundOptionsSchema>
export type SoundConfig = z.infer<typeof soundConfigSchema>

export const describe = (error: z.core.$ZodError): string => z.prettifyError(error)
