import { describe, expect, it } from 'vitest'
import { compareRuns, computeMetrics, percentile } from '../metrics'
import { runSimulation } from '../engine'
import { cfg } from './helpers'

describe('percentile (nearest-rank)', () => {
  it('computes known values', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    expect(percentile(v, 50)).toBe(50)
    expect(percentile(v, 95)).toBe(95)
    expect(percentile(v, 100)).toBe(100)
    expect(percentile([5], 95)).toBe(5)
    expect(percentile([], 95)).toBe(0)
  })
  it('does not depend on input order', () => {
    expect(percentile([9, 1, 5, 3, 7], 50)).toBe(5)
  })
})

describe('compareRuns', () => {
  it('reports origin reduction when collapsing + shield are enabled vs. disabled', () => {
    const w = { requestCount: 2000, arrivalRatePerSec: 2000, hotObjectShare: 0.5, uniqueKeyRatio: 0 }
    const off = computeMetrics(runSimulation(cfg({ ...w, collapsingEnabled: false, shieldEnabled: false })))
    const on = computeMetrics(runSimulation(cfg({ ...w, collapsingEnabled: true, shieldEnabled: true })))
    const cmp = compareRuns(off, on)
    expect(on.originFetches).toBeLessThan(off.originFetches)
    expect(cmp.originReductionRatio).toBeGreaterThan(0)
    expect(cmp.originFetchesDelta).toBe(on.originFetches - off.originFetches)
  })
})
