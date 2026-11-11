import type { ReactNode } from "react"
import { SoundToggle } from "react-isokit"

export function SoundToggleExample(): ReactNode {
  return (
    <div className="example-row">
      <SoundToggle className="pill" />
      <span>Remembers the reader's choice in localStorage.</span>
    </div>
  )
}
