import type { SoundName, SoundOptions } from "../schema"
import { MATERIALS, type Strike } from "./sound-materials"
import { bell, type Mixer, noise, tone } from "./sound-voices"

export type Voicing = { pitch: number; still: boolean; options: SoundOptions }

export type Recipe = (mixer: Mixer, voicing: Voicing) => number

const CASCADE_SCALE = [392, 493.88, 587.33, 783.99, 987.77, 1174.66]
const BOOT_CHORD = [174.61, 220, 261.63, 349.23, 523.25]
const COMPLETE_PHRASE = [523.25, 659.25, 783.99]
const PROCESS_TICKS = [0.08, 0.19, 0.27, 0.42, 0.5]

export const amount = (value: number | undefined, low: number, high: number, fallback: number): number => (value === undefined || !Number.isFinite(value) ? fallback : Math.min(high, Math.max(low, value)))

const tuned = <Voice extends { frequency: number; glideTo?: number }>(voice: Voice, pitch: number): Voice => ({ ...voice, frequency: voice.frequency * pitch, ...(voice.glideTo === undefined ? {} : { glideTo: voice.glideTo * pitch }) })

function strike(mixer: Mixer, { click, body, ring }: Strike, pitch: number): void {
  noise(mixer, tuned(click, pitch))
  tone(mixer, tuned(body, pitch))
  if (ring) tone(mixer, tuned(ring, pitch))
}

const materialOf = (options: SoundOptions) => MATERIALS[options.material ?? "plastic"] ?? MATERIALS.plastic

export const RECIPES: Record<SoundName, Recipe> = {
  press: (mixer, { pitch, options }) => {
    strike(mixer, materialOf(options).press, pitch)
    return 0.2
  },
  release: (mixer, { pitch, options }) => {
    strike(mixer, materialOf(options).release, pitch)
    return 0.12
  },
  toggle: (mixer, { pitch }) => {
    noise(mixer, { frequency: 4200 * pitch, q: 1.8, decay: 0.012, peak: 0.16 })
    tone(mixer, { frequency: 900 * pitch, wave: "triangle", decay: 0.03, peak: 0.04 })
    return 0.06
  },
  boot: (mixer) => {
    for (const [index, frequency] of BOOT_CHORD.entries()) {
      tone(mixer, { frequency, wave: "triangle", at: index * 0.006, attack: 0.012, decay: 1.3, peak: 0.05 })
      tone(mixer, { frequency: frequency * 1.003, at: index * 0.006, attack: 0.012, decay: 1.1, peak: 0.03 })
    }
    return 1.4
  },
  success: (mixer) => {
    bell(mixer, 659.25, 0, 0.12)
    bell(mixer, 987.77, 0.075, 0.12, 0.5)
    return 0.6
  },
  error: (mixer) => {
    tone(mixer, { frequency: 392, wave: "triangle", decay: 0.15, peak: 0.1 })
    tone(mixer, { frequency: 311.13, wave: "triangle", at: 0.085, decay: 0.2, peak: 0.1 })
    return 0.32
  },
  notify: (mixer) => {
    bell(mixer, 1567.98, 0, 0.045, 0.22)
    bell(mixer, 2349.32, 0.06, 0.03, 0.2)
    return 0.3
  },
  complete: (mixer) => {
    for (const [index, frequency] of COMPLETE_PHRASE.entries()) bell(mixer, frequency, index * 0.07, 0.08, 0.5)
    return 0.7
  },
  cascade: (mixer, { still, options }) => {
    const count = Math.round(amount(options.count, 1, 32, 4))
    const land = still ? 0 : amount(options.delay, 0, 5, 0.3)
    const step = still ? 0 : amount(options.stagger, 0, 2, 0.06)
    for (let index = 0; index < count; index++) {
      const base = (CASCADE_SCALE[index % CASCADE_SCALE.length] ?? 392) * 2 ** Math.floor(index / CASCADE_SCALE.length)
      tone(mixer, { frequency: base * 1.5, glideTo: base, at: land + index * step, attack: 0.001, decay: 0.07, peak: 0.13 })
      noise(mixer, { frequency: 1400, filter: "lowpass", at: land + index * step, decay: 0.016, peak: 0.06 })
    }
    const lastLanding = land + (count - 1) * step
    bell(mixer, 1046.5, lastLanding + 0.14, 0.06, 0.32)
    bell(mixer, 1567.98, lastLanding + 0.19, 0.04, 0.3)
    return lastLanding + 0.6
  },
  whoosh: (mixer) => {
    noise(mixer, { frequency: 500, glideTo: 2600, q: 0.8, attack: 0.06, decay: 0.26, peak: 0.07 })
    tone(mixer, { frequency: 260, glideTo: 520, attack: 0.03, decay: 0.2, peak: 0.02 })
    return 0.36
  },
  paper: (mixer, { pitch }) => {
    noise(mixer, { frequency: 1500 * pitch, glideTo: 3200, q: 0.6, attack: 0.025, decay: 0.15, peak: 0.12 })
    noise(mixer, { frequency: 6000, filter: "highpass", q: 0.5, attack: 0.01, decay: 0.06, peak: 0.025 })
    return 0.2
  },
  process: (mixer) => {
    tone(mixer, { frequency: 110, attack: 0.08, decay: 0.5, peak: 0.014 })
    for (const at of PROCESS_TICKS) noise(mixer, { frequency: 3600 + Math.random() * 1600, q: 4, at, decay: 0.007, peak: 0.06 })
    return 0.62
  },
  done: (mixer) => {
    bell(mixer, 880, 0, 0.075, 0.32)
    bell(mixer, 1318.51, 0.045, 0.04, 0.26)
    return 0.4
  },
  tick: (mixer, { pitch }) => {
    noise(mixer, { frequency: 4600 * pitch, q: 3, decay: 0.005, peak: 0.32 })
    tone(mixer, { frequency: 1750 * pitch, decay: 0.006, peak: 0.06 })
    return 0.03
  },
  latch: (mixer, { pitch }) => {
    noise(mixer, { frequency: 2800 * pitch, q: 2, decay: 0.01, peak: 0.2 })
    tone(mixer, { frequency: 260 * pitch, glideTo: 150 * pitch, decay: 0.025, peak: 0.1 })
    noise(mixer, { frequency: 1300 * pitch, filter: "lowpass", at: 0.07, decay: 0.02, peak: 0.24 })
    tone(mixer, { frequency: 140 * pitch, glideTo: 62 * pitch, at: 0.07, decay: 0.06, peak: 0.2 })
    return 0.16
  },
  relay: (mixer, { pitch }) => {
    noise(mixer, { frequency: 6500 * pitch, filter: "highpass", q: 0.7, decay: 0.004, peak: 0.22 })
    noise(mixer, { frequency: 6500 * pitch, filter: "highpass", q: 0.7, at: 0.011, decay: 0.003, peak: 0.08 })
    tone(mixer, { frequency: 2400 * pitch, decay: 0.006, peak: 0.02 })
    return 0.05
  },
  motor: (mixer, { pitch, options }) => {
    const hold = amount(options.duration, 0.1, 10, 0.9)
    tone(mixer, { frequency: 82 * pitch, glideTo: 128 * pitch, wave: "triangle", attack: 0.09, hold, decay: 0.14, peak: 0.034 })
    tone(mixer, { frequency: 164 * pitch, glideTo: 256 * pitch, wave: "square", attack: 0.09, hold, decay: 0.1, peak: 0.004 })
    noise(mixer, { frequency: 380, filter: "lowpass", q: 0.8, attack: 0.09, hold, decay: 0.14, peak: 0.03 })
    return hold + 0.25
  },
  charge: (mixer, { pitch, options }) => {
    const rise = amount(options.duration, 0.1, 10, 0.9)
    tone(mixer, { frequency: 180 * pitch, glideTo: 1500 * pitch, attack: rise, decay: 0.12, peak: 0.05 })
    tone(mixer, { frequency: 181.5 * pitch, glideTo: 1512 * pitch, wave: "sawtooth", attack: rise, decay: 0.1, peak: 0.006 })
    noise(mixer, { frequency: 1400, glideTo: 6400, q: 2.5, attack: rise, decay: 0.08, peak: 0.025 })
    return rise + 0.15
  },
  roll: (mixer, { pitch, still, options }) => {
    const count = Math.round(amount(options.count, 1, 12, 1))
    const step = still ? 0.012 : amount(options.stagger, 0, 0.5, 0.045)
    for (let index = 0; index < count; index++) {
      noise(mixer, { frequency: (3800 - index * 260) * pitch, q: 2.5, at: index * step, decay: 0.006, peak: 0.26 })
      noise(mixer, { frequency: 1100, filter: "lowpass", at: index * step + 0.012, decay: 0.012, peak: 0.15 })
    }
    return (count - 1) * step + 0.06
  },
  beep: (mixer) => {
    tone(mixer, { frequency: 1975.53, wave: "square", attack: 0.003, hold: 0.07, decay: 0.03, peak: 0.018 })
    return 0.12
  },
}
