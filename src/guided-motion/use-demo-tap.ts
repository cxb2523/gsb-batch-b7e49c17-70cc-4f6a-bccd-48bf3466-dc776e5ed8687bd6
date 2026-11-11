import { useCallback, useEffect, useRef, useState } from "react"
import { DEV } from "../development-checks"
import { canObserveIntersection, prefersReducedMotion } from "../environment"

export type DemoPhase = "waiting" | "aim" | "press" | "release" | "done"

export type DemoTapOptions = {
  delay?: number | undefined
  threshold?: number | undefined
}

export type DemoTap = {
  ref: (element: SVGElement | null) => void
  phase: DemoPhase
  dismiss: () => void
  plate: { "data-demo"?: "press" }
}

type DemoRun = { dismissed: boolean; fired: boolean; timers: number[] }

const AIM_MS = 320
const PRESS_MS = 200
const RELEASE_MS = 560
const DEFAULT_DELAY_MS = 500
const DEFAULT_THRESHOLD = 0.6
const RATIO_TOLERANCE = 0.01
const WATCHING: IntersectionObserverInit = { threshold: Array.from({ length: 21 }, (_, step) => step / 20) }
const PRESSING_PLATE = Object.freeze({ "data-demo": "press" } as const)
const IDLE_PLATE = Object.freeze({})

const clampShare = (threshold: number): number => Math.min(1, Math.max(0, Number.isFinite(threshold) ? threshold : DEFAULT_THRESHOLD))

function isVisibleEnough(entry: IntersectionObserverEntry, share: number): boolean {
  if (!entry.isIntersecting) return false
  const figureHeight = entry.boundingClientRect.height
  const fits = entry.rootBounds && figureHeight > 0 ? entry.rootBounds.height / figureHeight : 1
  return entry.intersectionRatio + RATIO_TOLERANCE >= Math.min(share, fits)
}

function clearTimers(run: DemoRun): void {
  for (const timer of run.timers) window.clearTimeout(timer)
  run.timers = []
}

export function useDemoTap(onTap: () => void, { delay = DEFAULT_DELAY_MS, threshold = DEFAULT_THRESHOLD }: DemoTapOptions = {}): DemoTap {
  const target = useRef<SVGElement | null>(null)
  const latestOnTap = useRef(onTap)
  const run = useRef<DemoRun>({ dismissed: false, fired: false, timers: [] })
  const [phase, setPhase] = useState<DemoPhase>("waiting")
  const share = clampShare(threshold)

  useEffect(() => {
    latestOnTap.current = onTap
  })

  const dismiss = useCallback(() => {
    run.current.dismissed = true
    clearTimers(run.current)
    setPhase("done")
  }, [])

  const ref = useCallback((element: SVGElement | null) => {
    target.current = element
    if (DEV && element && !element.ownerSVGElement) console.warn("react-isokit: useDemoTap's ref must go on an element inside the figure's svg, not on the svg itself")
  }, [])

  useEffect(() => {
    const svg = target.current?.ownerSVGElement
    const state = run.current
    if (state.fired || state.dismissed) {
      setPhase("done")
      return
    }
    setPhase("waiting")
    if (!svg || prefersReducedMotion() || !canObserveIntersection()) return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (!entry || state.dismissed || state.fired) return
      if (!isVisibleEnough(entry, share)) {
        clearTimers(state)
        setPhase("waiting")
        return
      }
      if (state.timers.length > 0) return
      const after = (ms: number, step: () => void) => window.setTimeout(step, ms)
      state.timers = [
        after(delay, () => setPhase("aim")),
        after(delay + AIM_MS, () => setPhase("press")),
        after(delay + AIM_MS + PRESS_MS, () => {
          state.fired = true
          observer.disconnect()
          setPhase("release")
          latestOnTap.current()
        }),
        after(delay + AIM_MS + PRESS_MS + RELEASE_MS, () => setPhase("done")),
      ]
    }, WATCHING)
    svg.addEventListener("pointerdown", dismiss, true)
    svg.addEventListener("keydown", dismiss, true)
    observer.observe(svg)
    return () => {
      observer.disconnect()
      svg.removeEventListener("pointerdown", dismiss, true)
      svg.removeEventListener("keydown", dismiss, true)
      clearTimers(state)
    }
  }, [delay, share, dismiss])

  return { ref, phase, dismiss, plate: phase === "press" ? PRESSING_PLATE : IDLE_PLATE }
}
