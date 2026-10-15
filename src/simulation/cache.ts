import type { CachePolicy } from './types'

export type CacheLookup = 'hit' | 'miss' | 'expired'

interface Entry {
  expiresAt: number
  sizeKB: number
}

/**
 * A bounded cache with TTL expiry. Capacity counts objects (not bytes).
 * - LRU: a hit marks the object most-recently-used; the least-recently-used object is evicted.
 * - FIFO: hits do not change order; the oldest inserted object is evicted.
 * Expiry is checked lazily on lookup: an object is valid while now < expiresAt.
 */
export class TtlCache {
  private readonly map = new Map<string, Entry>()
  evictions = 0
  expirations = 0

  readonly capacity: number
  readonly ttlMs: number
  readonly policy: CachePolicy

  constructor(capacity: number, ttlMs: number, policy: CachePolicy) {
    this.capacity = capacity
    this.ttlMs = ttlMs
    this.policy = policy
  }

  get size(): number {
    return this.map.size
  }

  get(key: string, now: number): CacheLookup {
    const entry = this.map.get(key)
    if (!entry) return 'miss'
    if (now >= entry.expiresAt) {
      this.map.delete(key)
      this.expirations++
      return 'expired'
    }
    if (this.policy === 'LRU') {
      this.map.delete(key)
      this.map.set(key, entry)
    }
    return 'hit'
  }

  /** Store (or refresh) an object. The TTL restarts from `now`. */
  set(key: string, sizeKB: number, now: number): void {
    const existing = this.map.has(key)
    if (existing) {
      // Refresh in place; for FIFO the original insertion position is kept.
      if (this.policy === 'LRU') this.map.delete(key)
    } else {
      while (this.map.size >= this.capacity) {
        const oldest = this.map.keys().next().value as string
        this.map.delete(oldest)
        this.evictions++
      }
    }
    this.map.set(key, { expiresAt: now + this.ttlMs, sizeKB })
  }

  keys(): string[] {
    return [...this.map.keys()]
  }
}
