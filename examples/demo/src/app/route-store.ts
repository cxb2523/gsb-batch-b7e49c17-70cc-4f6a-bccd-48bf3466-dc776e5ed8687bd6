import { useSyncExternalStore } from "react"

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

const readHash = () => window.location.hash
const readServerHash = () => ""

export function useRoute(): readonly string[] {
  const hash = useSyncExternalStore(subscribe, readHash, readServerHash)
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean)
}

export const href = (...segments: readonly string[]) => `#/${segments.join("/")}`
