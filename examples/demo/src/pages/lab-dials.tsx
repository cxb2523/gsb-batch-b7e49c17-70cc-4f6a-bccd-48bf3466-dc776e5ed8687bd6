import { type DialConfig, DialRoot, useDialKit } from "dialkit"
import "dialkit/styles.css"
import type { ReactNode } from "react"
import { useTheme } from "../app/theme-store"
import { block } from "../bench/bench-css"

const REACTOR = {
  explode: { gap: [26, 8, 26, 1] },
  light: { bloom: [1, 0, 2, 0.05], reach: [1, 0.5, 1.6, 0.05] },
  replay: { type: "action" },
} satisfies DialConfig

const REACTOR_SELECTOR = ".fig-arc-reactor"
const PRESS_SELECTOR = `${REACTOR_SELECTOR} .ik-press`

const pressReactor = () => document.querySelector(PRESS_SELECTOR)?.dispatchEvent(new MouseEvent("click", { bubbles: true }))

export default function LabDials(): ReactNode {
  const [theme] = useTheme()
  const reactor = useDialKit("Arc reactor", REACTOR, { id: "lab-arc-reactor", persist: true, onAction: pressReactor })
  const css = block(REACTOR_SELECTOR, [
    ["--lab-gap", String(reactor.explode.gap)],
    ["--lab-bloom-gain", String(reactor.light.bloom)],
    ["--lab-bloom-reach", String(reactor.light.reach)],
  ])
  return (
    <>
      <style>{css}</style>
      <DialRoot position="bottom-right" theme={theme} />
    </>
  )
}
