import { type ReactNode, useEffect, useRef, useState } from "react"
import { playSound } from "react-isokit"

const COPIED_MS = 1400

export function CopyCommand({ text, label }: { text: string; label?: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(resetTimer.current), [])
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        playSound("toggle")
        window.clearTimeout(resetTimer.current)
        resetTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS)
      },
      () => {},
    )
  }
  return (
    <button type="button" className="command" onClick={copy} aria-label={`Copy ${label ?? text}`}>
      <span aria-hidden="true">$</span>
      <code>{text}</code>
      <span className="copied" aria-live="polite">
        {copied ? "copied" : "copy"}
      </span>
    </button>
  )
}
