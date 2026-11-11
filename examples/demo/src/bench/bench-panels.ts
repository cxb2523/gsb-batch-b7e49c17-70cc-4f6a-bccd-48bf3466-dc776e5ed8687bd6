import type { DialConfig } from "dialkit"
import type { Material } from "react-isokit"
import { MATERIALS } from "../../../../src/sound/sound-materials"
import type { Declarations } from "./bench-css"
import { timingOf } from "./bench-css"

export const MOTION = {
  state: { type: "easing", duration: 0.26, ease: [0.32, 0.72, 0, 1] },
  enter: { type: "easing", duration: 0.15, ease: [0.23, 1, 0.32, 1] },
  move: { type: "easing", duration: 0.7, ease: [0.65, 0, 0.35, 1] },
  fall: { type: "easing", duration: 0.7, ease: [0.55, 0, 1, 0.45] },
  spring: { type: "spring", visualDuration: 0.3, bounce: 0.25 },
  press: [50, 0, 200, 5],
  stagger: [50, 0, 160, 5],
  travel: [2, 0, 6, 0.25],
  copy: { type: "action", label: "Copy as CSS" },
} satisfies DialConfig

export const LIGHT = {
  size: [5, 0, 16, 0.5],
  strength: [1, 0, 1, 0.05],
  on: [90, 0, 400, 10],
  off: [400, 0, 1200, 20],
  lines: { edge: [1.4, 0.5, 3, 0.05], crease: [1, 0.5, 2, 0.05], fine: [0.75, 0.25, 1.5, 0.05] },
} satisfies DialConfig

export const LOOKS = ["blueprint", "paper", "phosphor"] as const
export type Look = (typeof LOOKS)[number]

const SEEDS = {
  blueprint: { light: ["#f3f6fb", "#2d5fa8", "#123e86", "#2d5fa8", "#123e86"], dark: ["#1b4785", "#d6e5ff", "#ffffff", "#bcd6ff", "#ffffff"] },
  paper: { light: ["#f3ecdd", "#8a7a5c", "#2e2418", "#d4462a", "#d4462a"], dark: ["#24211c", "#a08f72", "#f3e9d4", "#ffd2a1", "#ff7a5c"] },
  phosphor: { light: ["#0d0a05", "#9a6614", "#ffb000", "#ffb000", "#ffb000"], dark: ["#070c08", "#33874a", "#7dff9a", "#39ff6a", "#7dff9a"] },
} as const satisfies Record<Look, Record<"light" | "dark", readonly string[]>>

const SEED_NAMES = ["paper", "pen", "live", "glow", "accent"] as const

const seedFolder = (colours: readonly string[]) => Object.fromEntries(SEED_NAMES.map((name, index) => [name, colours[index] ?? "#000000"]))

export const LOOK_SEEDS = Object.fromEntries(LOOKS.map((look) => [look, { _collapsed: look !== "blueprint", light: seedFolder(SEEDS[look].light), dark: seedFolder(SEEDS[look].dark) }])) as DialConfig

export type SeedValues = Record<"light" | "dark", Record<(typeof SEED_NAMES)[number], string>>

export const seedDeclarations = (seeds: SeedValues): Declarations => (["light", "dark"] as const).flatMap((scheme) => SEED_NAMES.map((name) => [`--ik-${name}-${scheme}`, seeds[scheme][name]] as const))

type MotionValues = { state: Parameters<typeof timingOf>[0]; enter: Parameters<typeof timingOf>[0]; move: Parameters<typeof timingOf>[0]; fall: Parameters<typeof timingOf>[0]; spring: Parameters<typeof timingOf>[0]; press: number; stagger: number; travel: number }

export function motionDeclarations(values: MotionValues): Declarations {
  const state = timingOf(values.state)
  const enter = timingOf(values.enter)
  const move = timingOf(values.move)
  const spring = timingOf(values.spring)
  return [
    ["--ik-ease", state.easing],
    ["--ik-ease-out", enter.easing],
    ["--ik-ease-move", move.easing],
    ["--ik-ease-fall", timingOf(values.fall).easing],
    ["--ik-spring", spring.easing],
    ["--ik-t-press", `${values.press}ms`],
    ["--ik-t-hover", `${enter.milliseconds}ms`],
    ["--ik-t-state", `${state.milliseconds}ms`],
    ["--ik-t-move", `${move.milliseconds}ms`],
    ["--ik-t-spring", `${spring.milliseconds}ms`],
    ["--ik-stagger", `${values.stagger}ms`],
    ["--ik-travel", `${values.travel}px`],
  ]
}

type LightValues = { size: number; strength: number; on: number; off: number; lines: { edge: number; crease: number; fine: number } }

export const lightDeclarations = (values: LightValues): Declarations => [
  ["--ik-glow-size", String(values.size)],
  ["--ik-glow-strength", String(values.strength)],
  ["--ik-t-glow-on", `${values.on}ms`],
  ["--ik-t-glow-off", `${values.off}ms`],
  ["--ik-weight-edge", String(values.lines.edge)],
  ["--ik-weight-crease", String(values.lines.crease)],
  ["--ik-weight-fine", String(values.lines.fine)],
]

const RANGES: Record<string, readonly [number, number, number]> = {
  frequency: [20, 12000, 10],
  glideTo: [20, 12000, 10],
  q: [0.1, 20, 0.1],
  attack: [0, 0.05, 0.001],
  decay: [0.001, 0.5, 0.001],
  peak: [0, 0.5, 0.005],
}

const dialFor = (voice: object): DialConfig =>
  Object.fromEntries(
    Object.entries(voice).flatMap(([field, value]) => {
      const range = RANGES[field]
      return typeof value === "number" && range ? [[field, [value, ...range] as [number, number, number, number]]] : []
    }),
  )

export const SOUND = {
  volume: [0.55, 0, 1, 0.05],
  ...Object.fromEntries(
    Object.entries(MATERIALS).map(([material, voice]) => [
      material,
      {
        _collapsed: material !== "plastic",
        hear: { type: "action", label: `Press and release ${material}` },
        ...Object.fromEntries(Object.entries(voice).map(([stroke, strike]) => [stroke, Object.fromEntries(Object.entries(strike).map(([part, settings]) => [part, dialFor(settings)]))])),
      },
    ]),
  ),
  recipes: { tick: { type: "action" }, latch: { type: "action" }, relay: { type: "action" }, motor: { type: "action" }, charge: { type: "action" }, roll: { type: "action" }, beep: { type: "action" } },
  copy: { type: "action", label: "Copy the material table" },
} as DialConfig

type Numbers = { [key: string]: number | Numbers }

function assignNumbers(target: Numbers, source: Numbers): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (typeof value === "number" && typeof current === "number") target[key] = value
    else if (typeof value === "object" && typeof current === "object") assignNumbers(current, value)
  }
}

export function tuneMaterials(values: Record<string, unknown>): void {
  for (const material of Object.keys(MATERIALS) as Material[]) {
    const tuned = values[material]
    if (tuned && typeof tuned === "object") assignNumbers(MATERIALS[material] as unknown as Numbers, tuned as Numbers)
  }
}

export const materialTable = (): string => `export const MATERIALS: Record<Material, MaterialVoice> = ${JSON.stringify(MATERIALS, null, 2)}`
