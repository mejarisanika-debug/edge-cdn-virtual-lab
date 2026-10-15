import { describe, expect, it } from 'vitest'
import { sameWorkload, validateConfig } from '../config'
import { runSimulation } from '../engine'
import { computeMetrics, compareRuns } from '../metrics'
import { PRESETS, presetConfig } from '../presets'

const run = (c: ReturnType<typeof presetConfig>) => computeMetrics(runSimulation(c))

describe('presets', () => {
  it('every preset is a valid config with explanation text', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5)
    for (const p of PRESETS) {
      expect(validateConfig(presetConfig(p.id)), p.id).toEqual([])
      expect(p.summary.length).toBeGreaterThan(10)
      expect(p.expectation.length).toBeGreaterThan(10)
    }
  })

  it('baseline: turning collapsing + shield ON cuts origin fetches (same workload)', () => {
    const base = presetConfig('baseline')
    const on = { ...base, collapsingEnabled: true, shieldEnabled: true }
    expect(sameWorkload(base, on)).toBe(true)
    const cmp = compareRuns(run(base), run(on))
    expect(cmp.originReductionRatio).toBeGreaterThan(0.2)
  })

  it('warm: fewer origin fetches than the same settings cold', () => {
    const warm = presetConfig('warm')
    expect(run(warm).originFetches).toBeLessThan(run({ ...warm, warmCache: false }).originFetches)
  })

  it('flash crowd: collapsing+shield reduce origin fetches by more than half', () => {
    const f = presetConfig('flash')
    const off = run({ ...f, collapsingEnabled: false, shieldEnabled: false })
    const on = run(f)
    expect(compareRuns(off, on).originReductionRatio).toBeGreaterThan(0.5)
    expect(on.origin.maxQueueDepth).toBeLessThan(off.origin.maxQueueDepth)
  })

  it('many unique: collapsing helps far less than in the flash crowd', () => {
    const gain = (id: string) => {
      const c = presetConfig(id)
      return compareRuns(run({ ...c, collapsingEnabled: false }), run({ ...c, collapsingEnabled: true })).originReductionRatio
    }
    expect(gain('unique')).toBeLessThan(0.15)
    expect(gain('flash')).toBeGreaterThan(gain('unique'))
  })

  it('short TTL: produces expired misses and more origin fetches than a long TTL', () => {
    const t = presetConfig('ttl')
    const short = run(t)
    const long = run({ ...t, ttlMs: 600_000 })
    expect(short.layers.edge.expiredMisses).toBeGreaterThan(0)
    expect(short.originFetches).toBeGreaterThan(long.originFetches)
  })

  it('origin under pressure: collapsing ON shrinks the origin queue', () => {
    const p = presetConfig('pressure')
    expect(run({ ...p, collapsingEnabled: true }).origin.maxQueueDepth).toBeLessThan(run(p).origin.maxQueueDepth)
  })
})
