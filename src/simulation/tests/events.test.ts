import { describe, expect, it } from 'vitest'
import { runSimulation } from '../engine'
import { computeMetrics } from '../metrics'
import { cfg } from './helpers'

describe('event log (drives the animation) matches the simulation', () => {
  const c = cfg({ requestCount: 800, arrivalRatePerSec: 800, hotObjectShare: 0.3 })
  const r = runSimulation(c)
  const m = computeMetrics(r)
  const count = (kind: string, layer: string) => r.events.filter((e) => e.kind === kind && e.layer === layer).length

  it('is not truncated for this size and is in chronological order', () => {
    expect(r.eventsTruncated).toBe(false)
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].t).toBeGreaterThanOrEqual(r.events[i - 1].t)
  })

  it('hit / miss / collapsed event counts equal the per-layer metrics', () => {
    for (const l of ['edge', 'shared', 'shield'] as const) {
      expect(count('hit', l)).toBe(m.layers[l].hits)
      expect(count('miss', l)).toBe(m.layers[l].misses)
      expect(count('collapsed', l)).toBe(m.layers[l].collapsed)
      expect(count('forward', l)).toBe(m.layers[l].forwarded)
    }
  })

  it('one arrive and one complete event per request; one origin_done per origin fetch', () => {
    expect(r.events.filter((e) => e.kind === 'arrive')).toHaveLength(800)
    expect(r.events.filter((e) => e.kind === 'complete')).toHaveLength(800)
    expect(r.events.filter((e) => e.kind === 'origin_done')).toHaveLength(m.originFetches)
  })

  it('forward and arrive events name the node they send to', () => {
    for (const e of r.events) if (e.kind === 'forward' || e.kind === 'arrive') expect(e.target).toBeTruthy()
    const toOrigin = r.events.filter((e) => e.kind === 'forward' && e.target === 'origin')
    expect(toOrigin).toHaveLength(m.originFetches)
  })

  it('log is capped by maxLoggedEvents and flagged', () => {
    const small = runSimulation(c, { maxLoggedEvents: 100 })
    expect(small.events).toHaveLength(100)
    expect(small.eventsTruncated).toBe(true)
    expect(computeMetrics(small)).toEqual(m) // metrics never depend on the log
  })
})
