import { vi } from 'vitest'

/**
 * Replace requestAnimationFrame/cancelAnimationFrame with a deterministic
 * queue. Callers decide when queued frames actually run via flushFrames().
 */
export function mockAnimationFrame() {
  let nextId = 1
  const queue = new Map()

  const raf = vi.fn((callback) => {
    const id = nextId++
    queue.set(id, callback)
    return id
  })

  const caf = vi.fn((id) => {
    queue.delete(id)
  })

  const flushFrames = (count = 1) => {
    for (let i = 0; i < count; i++) {
      const entries = Array.from(queue.entries())
      queue.clear()
      entries.forEach(([id, callback]) => callback(id))
    }
  }

  const pendingCount = () => queue.size

  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', caf)

  return { raf, caf, flushFrames, pendingCount }
}
