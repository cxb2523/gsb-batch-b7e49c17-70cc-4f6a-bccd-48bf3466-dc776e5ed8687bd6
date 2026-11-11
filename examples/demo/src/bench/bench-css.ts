import type { TransitionConfig } from "dialkit"
import { type Spring, springEasing } from "./spring-easing"

export type Timing = { easing: string; milliseconds: number }

export type Declarations = ReadonlyArray<readonly [string, string]>

const DEFAULT_STIFFNESS = 100
const DEFAULT_DAMPING = 10
const DEFAULT_MASS = 1

export function springOf(transition: Extract<TransitionConfig, { type: "spring" }>): Spring {
  if (transition.visualDuration !== undefined) return { duration: transition.visualDuration, bounce: transition.bounce ?? 0 }
  const stiffness = transition.stiffness ?? DEFAULT_STIFFNESS
  const damping = transition.damping ?? DEFAULT_DAMPING
  const mass = transition.mass ?? DEFAULT_MASS
  const natural = Math.sqrt(stiffness / mass)
  return { duration: (2 * Math.PI) / (natural * 1.2), bounce: 1 - damping / (2 * Math.sqrt(stiffness * mass)) }
}

export function timingOf(transition: TransitionConfig): Timing {
  if (transition.type === "easing") return { easing: `cubic-bezier(${transition.ease.join(", ")})`, milliseconds: Math.round(transition.duration * 1000) }
  return springEasing(springOf(transition))
}

export const block = (selector: string, declarations: Declarations): string => `${selector} {\n${declarations.map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}`
