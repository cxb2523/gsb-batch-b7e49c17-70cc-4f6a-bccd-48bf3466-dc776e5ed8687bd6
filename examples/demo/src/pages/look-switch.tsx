import type { ReactNode } from "react"

export const LOOKS = [
  { id: "plain", title: "Plain" },
  { id: "blueprint", title: "Blueprint" },
  { id: "paper", title: "Paper" },
  { id: "phosphor", title: "Phosphor" },
] as const

export type LookId = (typeof LOOKS)[number]["id"]

export const lookAttribute = (look: LookId): string | undefined => (look === "plain" ? undefined : look)

export function LookSwitch({ look, onChange }: { look: LookId; onChange: (look: LookId) => void }): ReactNode {
  return (
    <fieldset className="filter-group">
      <legend>Look</legend>
      <div className="filters">
        {LOOKS.map((option) => (
          <button key={option.id} type="button" className="pill" aria-pressed={look === option.id} onClick={() => onChange(option.id)}>
            {option.title}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
