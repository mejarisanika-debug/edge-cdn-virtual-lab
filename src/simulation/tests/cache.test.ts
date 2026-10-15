import { describe, expect, it } from 'vitest'
import { TtlCache } from '../cache'

describe('TtlCache', () => {
  it('misses when empty, hits after set', () => {
    const c = new TtlCache(3, 1000, 'LRU')
    expect(c.get('a', 0)).toBe('miss')
    c.set('a', 10, 0)
    expect(c.get('a', 500)).toBe('hit')
  })

  it('expires exactly at set time + TTL and reports "expired"', () => {
    const c = new TtlCache(3, 1000, 'LRU')
    c.set('a', 10, 100)
    expect(c.get('a', 1099)).toBe('hit')
    expect(c.get('a', 1100)).toBe('expired')
    expect(c.get('a', 1101)).toBe('miss') // already removed
    expect(c.expirations).toBe(1)
  })

  it('refreshing an object restarts its TTL', () => {
    const c = new TtlCache(3, 1000, 'LRU')
    c.set('a', 10, 0)
    c.set('a', 10, 900)
    expect(c.get('a', 1500)).toBe('hit')
  })

  it('LRU evicts the least recently used object', () => {
    const c = new TtlCache(2, 10_000, 'LRU')
    c.set('a', 1, 0)
    c.set('b', 1, 0)
    c.get('a', 1) // a becomes most recent
    c.set('c', 1, 2) // evicts b
    expect(c.get('a', 3)).toBe('hit')
    expect(c.get('b', 3)).toBe('miss')
    expect(c.evictions).toBe(1)
  })

  it('FIFO evicts the oldest inserted object even if it was just used', () => {
    const c = new TtlCache(2, 10_000, 'FIFO')
    c.set('a', 1, 0)
    c.set('b', 1, 0)
    c.get('a', 1)
    c.set('c', 1, 2) // evicts a
    expect(c.get('a', 3)).toBe('miss')
    expect(c.get('b', 3)).toBe('hit')
  })

  it('never exceeds capacity', () => {
    const c = new TtlCache(5, 10_000, 'LRU')
    for (let i = 0; i < 50; i++) c.set(`k${i}`, 1, i)
    expect(c.size).toBe(5)
  })
})
