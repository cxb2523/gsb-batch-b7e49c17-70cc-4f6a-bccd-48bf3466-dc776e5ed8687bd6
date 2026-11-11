import type { SoundConfig } from "../schema"

type Listener = () => void

const settings = { defaultOn: false, storageKey: "isokit:sound" as string | null, volume: 0.55 }
const listeners = new Set<Listener>()
let enabled: boolean | null = null

const notify = (): void => {
  for (const listener of listeners) listener()
}

function readStored(): string | null {
  try {
    return settings.storageKey ? localStorage.getItem(settings.storageKey) : null
  } catch {
    return null
  }
}

function writeStored(on: boolean): void {
  try {
    if (settings.storageKey) localStorage.setItem(settings.storageKey, on ? "on" : "off")
  } catch {}
}

export const soundVolume = (): number => settings.volume

export function applySoundConfig(next: SoundConfig): void {
  if (typeof next.defaultOn === "boolean") settings.defaultOn = next.defaultOn
  if (next.storageKey === null || (typeof next.storageKey === "string" && next.storageKey)) settings.storageKey = next.storageKey
  if (typeof next.volume === "number" && Number.isFinite(next.volume)) settings.volume = Math.min(1, Math.max(0, next.volume))
  enabled = null
  notify()
}

export function isSoundEnabled(): boolean {
  if (enabled === null) {
    const stored = readStored()
    enabled = stored === "on" ? true : stored === "off" ? false : settings.defaultOn
  }
  return enabled
}

export const soundPreference: {
  subscribe(listener: () => void): () => void
  get(): boolean
  getServer(): boolean
  set(on: boolean): void
} = {
  subscribe(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get: isSoundEnabled,
  getServer: () => settings.defaultOn,
  set(on) {
    enabled = on
    writeStored(on)
    notify()
  },
}
