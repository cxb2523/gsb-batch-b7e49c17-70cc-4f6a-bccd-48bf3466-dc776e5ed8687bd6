export type Spring = { duration: number; bounce: number }

export type SpringEasing = { easing: string; milliseconds: number }

const SETTLED = 0.001
const SAMPLES = 160

const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places

export function springPosition({ duration, bounce }: Spring): (seconds: number) => number {
  const natural = (2 * Math.PI) / (duration * 1.2)
  const damping = Math.min(1, Math.max(0.05, 1 - bounce))
  if (damping >= 1) return (t) => 1 - Math.exp(-natural * t) * (1 + natural * t)
  const decay = damping * natural
  const ringing = natural * Math.sqrt(1 - damping * damping)
  return (t) => 1 - Math.exp(-decay * t) * (Math.cos(ringing * t) + (decay / ringing) * Math.sin(ringing * t))
}

export function settleSeconds({ duration, bounce }: Spring): number {
  const natural = (2 * Math.PI) / (duration * 1.2)
  const damping = Math.min(1, Math.max(0.05, 1 - bounce))
  if (damping >= 1) return -Math.log(SETTLED / 4) / natural
  return -Math.log(SETTLED * Math.sqrt(1 - damping * damping)) / (damping * natural)
}

export function springEasing(spring: Spring, tolerance = 0.004): SpringEasing {
  const seconds = settleSeconds(spring)
  const position = springPosition(spring)
  const values = Array.from({ length: SAMPLES + 1 }, (_, index) => (index === SAMPLES ? 1 : position((index / SAMPLES) * seconds)))
  const valueAt = (index: number): number => values[index] ?? 1
  const kept = [0]
  let anchor = 0
  for (let candidate = 2; candidate <= SAMPLES; candidate++) {
    let drifts = false
    for (let between = anchor + 1; between < candidate && !drifts; between++) {
      const along = (between - anchor) / (candidate - anchor)
      drifts = Math.abs(valueAt(anchor) + (valueAt(candidate) - valueAt(anchor)) * along - valueAt(between)) > tolerance
    }
    if (drifts) {
      anchor = candidate - 1
      kept.push(anchor)
    }
  }
  kept.push(SAMPLES)
  const stops = kept.map((index, order) => (order === 0 ? "0" : order === kept.length - 1 ? "1" : `${round(valueAt(index), 3)} ${round((index / SAMPLES) * 100, 1)}%`))
  return { easing: `linear(${stops.join(", ")})`, milliseconds: Math.round(seconds * 1000) }
}
