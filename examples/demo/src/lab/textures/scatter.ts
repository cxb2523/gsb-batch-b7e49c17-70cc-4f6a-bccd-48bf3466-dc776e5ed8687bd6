export type Speck = { x: number; y: number; r: number; order: number }

export type ScatterOptions = { count: number; w: number; d: number; seed: number; size: readonly [min: number, max: number]; inset?: number; round?: boolean }

const GOLDEN = 0.618033988749895

function seeded(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

const round2 = (value: number): number => Math.round(value * 100) / 100

export function scatter({ count, w, d, seed, size: [min, max], inset = 0, round = false }: ScatterOptions): readonly Speck[] {
  const random = seeded(seed)
  const [cx, cy] = [w / 2, d / 2]
  const [rx, ry] = [w / 2 - inset, d / 2 - inset]
  const specks: Speck[] = []
  let phase = random()
  for (let index = 0; index < count; index++) {
    phase = (phase + GOLDEN) % 1
    const along = (index + 0.5) / count
    const [u, v] = round ? [Math.sqrt(along) * Math.cos(phase * 2 * Math.PI), Math.sqrt(along) * Math.sin(phase * 2 * Math.PI)] : [phase * 2 - 1, along * 2 - 1]
    const jitter = 0.22 * (random() - 0.5)
    specks.push({ x: round2(cx + (u + jitter) * rx), y: round2(cy + (v - jitter) * ry), r: round2(min + random() * (max - min)), order: 0 })
  }
  const byDistance = specks.map((speck, index) => [Math.hypot(speck.x - cx, speck.y - cy), index] as const).sort((a, b) => a[0] - b[0])
  byDistance.forEach(([, index], rank) => {
    specks[index] = { ...specks[index]!, order: rank }
  })
  return specks
}
