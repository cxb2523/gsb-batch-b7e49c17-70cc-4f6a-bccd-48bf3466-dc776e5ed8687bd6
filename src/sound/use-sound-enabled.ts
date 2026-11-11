import { useSyncExternalStore } from "react"
import { soundPreference } from "./sound-store"

export function useSoundEnabled(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(soundPreference.subscribe, soundPreference.get, soundPreference.getServer)
  return [on, soundPreference.set]
}
