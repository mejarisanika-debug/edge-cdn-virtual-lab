import { describe, expect, it } from 'vitest'
import { InFlightTable } from '../requestCollapsing'

describe('InFlightTable', () => {
  it('first joiner is leader, later joiners of the same key are followers', () => {
    const t = new InFlightTable<string>()
    expect(t.join('a', 'w1')).toBe('leader')
    expect(t.join('a', 'w2')).toBe('follower')
    expect(t.join('a', 'w3')).toBe('follower')
    expect(t.complete('a')).toEqual(['w1', 'w2', 'w3'])
  })

  it('different keys are never collapsed together', () => {
    const t = new InFlightTable<string>()
    expect(t.join('a', 'w1')).toBe('leader')
    expect(t.join('b', 'w2')).toBe('leader')
    expect(t.size).toBe(2)
    expect(t.complete('a')).toEqual(['w1'])
    expect(t.has('b')).toBe(true)
  })

  it('after completion a new request becomes a fresh leader (only in-flight misses collapse)', () => {
    const t = new InFlightTable<string>()
    t.join('a', 'w1')
    t.complete('a')
    expect(t.join('a', 'w2')).toBe('leader')
  })
})
