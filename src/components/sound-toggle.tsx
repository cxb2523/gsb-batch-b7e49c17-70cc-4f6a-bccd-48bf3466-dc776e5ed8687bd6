import type { ButtonHTMLAttributes, ReactNode } from "react"
import { classNames } from "../class-names"
import { playSound, primeSound } from "../sound/sound-player"
import { useSoundEnabled } from "../sound/use-sound-enabled"

export type SoundToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "aria-pressed">

export function SoundToggle({ className, children = "Sound", ...rest }: SoundToggleProps): ReactNode {
  const [on, setOn] = useSoundEnabled()
  const toggle = () => {
    setOn(!on)
    if (!on) playSound("toggle")
  }
  return (
    <button type="button" className={classNames("ik-sound-toggle", className)} aria-pressed={on} onClick={toggle} onPointerEnter={primeSound} {...rest}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" />
        {on ? <path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.5 3.8a6 6 0 0 1 0 8.4" /> : <path d="M10.5 6l3.5 4M14 6l-3.5 4" />}
      </svg>
      {children}
    </button>
  )
}
