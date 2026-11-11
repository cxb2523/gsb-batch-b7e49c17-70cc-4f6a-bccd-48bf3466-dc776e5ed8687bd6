import type * as Schemas from "./schema"

export const DEV: boolean = (() => {
  try {
    return process.env.NODE_ENV !== "production"
  } catch {
    return false
  }
})()

export type Checked = "box" | "fit" | "plate" | "soundName" | "soundOptions" | "soundConfig"

let schemas: Promise<typeof Schemas> | null = null
const reported = new Set<string>()

const schemaFor = (loaded: typeof Schemas, kind: Checked) =>
  ({
    box: loaded.box3Schema,
    fit: loaded.fitSchema,
    plate: loaded.plateFrameSchema,
    soundName: loaded.soundNameSchema,
    soundOptions: loaded.soundOptionsSchema,
    soundConfig: loaded.soundConfigSchema,
  })[kind]

export function check(kind: Checked, value: unknown, where: string): void {
  if (!DEV) return
  schemas ??= import("./schema")
  schemas.then(
    (loaded) => {
      const result = schemaFor(loaded, kind).safeParse(value)
      if (result.success) return
      const message = `react-isokit: ${where}\n${loaded.describe(result.error)}`
      if (reported.has(message)) return
      reported.add(message)
      console.warn(message)
    },
    () => {},
  )
}
