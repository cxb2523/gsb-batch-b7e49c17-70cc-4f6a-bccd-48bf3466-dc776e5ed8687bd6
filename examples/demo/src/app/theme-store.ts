import { useSyncExternalStore } from "react"

export type Theme = "light" | "dark"

const STORAGE_KEY = "isokit-demo:theme"
const DEFAULT_THEME: Theme = "light"

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {}
}

function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("dark", theme === "dark")
}

function createThemeStore() {
  const listeners = new Set<() => void>()
  let current: Theme | null = null
  const get = (): Theme => {
    current ??= readStoredTheme()
    return current
  }
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get,
    getServer: (): Theme => DEFAULT_THEME,
    set(theme: Theme): void {
      if (theme === get()) return
      current = theme
      writeStoredTheme(theme)
      applyTheme(theme)
      for (const listener of listeners) listener()
    },
    start(): void {
      applyTheme(get())
    },
  }
}

export const themeStore = createThemeStore()

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.getServer)
  return [theme, themeStore.set]
}
