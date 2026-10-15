import { beforeEach, describe, expect, it } from 'vitest'
import { runSimulation, simulateRequests } from '../engine'
import { computeMetrics } from '../metrics'
import { generateWorkload } from '../workload'
import { cfg, coldLatency, req, resetIds } from './helpers'

beforeEach(() => resetIds())

describe('cache hits and misses', () => {
  it('a cold request travels the whole hierarchy and costs one origin fetch', () => {
    const c = cfg()
    const r = simulateRequests(c, [req('a', 0, 0)])
    const m = computeMetrics(r)
    expect(m.originFetches).toBe(1)
    expect(m.servedBy.origin).toBe(1)
    expect(r.records[0].latencyMs).toBe(coldLatency(c))
    for (const l of ['edge', 'shared', 'shield'] as const) {
      expect(m.layers[l].misses).toBe(1)
      expect(m.layers[l].hits).toBe(0)
    }
  })

  it('an edge hit is served from the edge and creates NO upstream traffic', () => {
    const c = cfg()
    const r = simulateRequests(c, [req('a', 0, 0), req('a', 0, 10_000)])
    const m = computeMetrics(r)
    expect(m.originFetches).toBe(1)
    expect(m.servedBy.edge).toBe(1)
    expect(r.records[1].latencyMs).toBe(c.rttMs.edge)
    // second request never reached shared or shield
    expect(m.layers.shared.lookups).toBe(1)
    expect(m.layers.shield.lookups).toBe(1)
  })

  it('a shared-cache hit serves a different edge in the same region without reaching the origin', () => {
    const c = cfg({ regionCount: 2 })
    // edges 0 and 2 are both in region 0
    const r = simulateRequests(c, [req('a', 0, 0), req('a', 2, 10_000)])
    const m = computeMetrics(r)
    expect(m.originFetches).toBe(1)
    expect(m.servedBy.shared).toBe(1)
    expect(r.records[1].latencyMs).toBe(c.rttMs.edge + c.rttMs.shared)
    expect(m.layers.shield.lookups).toBe(1)
  })

  it('capacity eviction turns a repeat into a miss', () => {
    const c = cfg({ edgeCapacity: 1, sharedTierEnabled: false, shieldEnabled: false })
    const r = simulateRequests(c, [req('a', 0, 0), req('b', 0, 5000), req('a', 0, 10_000)])
    const m = computeMetrics(r)
    expect(m.layers.edge.hits).toBe(0)
    expect(m.originFetches).toBe(3)
  })
})

describe('TTL expiry', () => {
  it('an expired object causes an expired miss and a new origin fetch', () => {
    const c = cfg({ ttlMs: 2000 })
    const r = simulateRequests(c, [req('a', 0, 0), req('a', 0, 5000)])
    const m = computeMetrics(r)
    expect(m.originFetches).toBe(2)
    expect(m.layers.edge.expiredMisses).toBe(1)
    expect(m.layers.edge.hits).toBe(0)
  })

  it('a long TTL keeps the object: second request is a hit', () => {
    const r = simulateRequests(cfg({ ttlMs: 60_000 }), [req('a', 0, 0), req('a', 0, 5000)])
    expect(computeMetrics(r).originFetches).toBe(1)
  })
})

describe('request collapsing', () => {
  const burst = (key: string, n: number) => Array.from({ length: n }, () => req(key, 0, 0))

  it('ON: concurrent same-key misses share ONE origin fetch', () => {
    const r = simulateRequests(cfg({ collapsingEnabled: true }), burst('a', 10))
    const m = computeMetrics(r)
    expect(m.originFetches).toBe(1)
    expect(m.collapsedRequests).toBe(9)
    expect(m.layers.edge.collapsed).toBe(9)
    expect(m.layers.edge.forwarded).toBe(1)
    expect(r.records).toHaveLength(10)
    // followers received the leader's result at the same time
    expect(new Set(r.records.map((x) => x.latencyMs)).size).toBe(1)
  })

  it('OFF: the same burst sends one origin fetch per request', () => {
    const r = simulateRequests(cfg({ collapsingEnabled: false }), burst('a', 10))
    const m = computeMetrics(r)
    expect(m.originFetches).toBe(10)
    expect(m.collapsedRequests).toBe(0)
  })

  it('different keys are NOT collapsed together', () => {
    const reqs = ['a', 'b', 'c', 'd', 'e'].map((k) => req(k, 0, 0))
    const m = computeMetrics(simulateRequests(cfg({ collapsingEnabled: true }), reqs))
    expect(m.originFetches).toBe(5)
    expect(m.collapsedRequests).toBe(0)
  })

  it('only in-flight misses collapse: a request after the fill is a hit, not a follower', () => {
    const m = computeMetrics(simulateRequests(cfg(), [req('a', 0, 0), req('a', 0, 10_000)]))
    expect(m.collapsedRequests).toBe(0)
    expect(m.servedBy.edge).toBe(1)
  })

  it('collapses across edges at the shared/shield layers', () => {
    // edges 0 and 2 share region 0; separate edge caches, so edge-level cannot collapse them
    const r = simulateRequests(cfg({ regionCount: 2 }), [req('a', 0, 0), req('a', 2, 0)])
    const m = computeMetrics(r)
    expect(m.originFetches).toBe(1)
    expect(m.layers.edge.collapsed).toBe(0)
    expect(m.layers.shared.collapsed).toBe(1)
    expect(r.records.find((x) => x.edgeIndex === 2)?.collapsedAt).toBe('shared')
  })
})

describe('origin shielding', () => {
  // 4 edges, 2 regions: edges 0,2 -> region 0 ; edges 1,3 -> region 1
  const fourEdges = [0, 1, 2, 3].map((e) => req('a', e, 0))

  it('ON consolidates concurrent misses from every region into one origin fetch', () => {
    const m = computeMetrics(simulateRequests(cfg({ edgeCount: 4, regionCount: 2, shieldEnabled: true }), fourEdges))
    expect(m.originFetches).toBe(1)
    expect(m.layers.shield.collapsed).toBe(1)
  })

  it('OFF: each region fetches from the origin on its own', () => {
    const m = computeMetrics(simulateRequests(cfg({ edgeCount: 4, regionCount: 2, shieldEnabled: false }), fourEdges))
    expect(m.originFetches).toBe(2)
  })

  it('OFF and no shared tier: every edge hits the origin separately', () => {
    const m = computeMetrics(
      simulateRequests(cfg({ edgeCount: 4, shieldEnabled: false, sharedTierEnabled: false }), fourEdges),
    )
    expect(m.originFetches).toBe(4)
  })

  it('ON works as a cache even with collapsing OFF: a later request from another region is a shield hit', () => {
    const base = { edgeCount: 4, regionCount: 2, collapsingEnabled: false }
    const seq = () => [req('a', 0, 0), req('a', 1, 10_000)] // region 0 then region 1
    const on = computeMetrics(simulateRequests(cfg({ ...base, shieldEnabled: true }), seq()))
    resetIds()
    const off = computeMetrics(simulateRequests(cfg({ ...base, shieldEnabled: false }), seq()))
    expect(on.originFetches).toBe(1)
    expect(on.servedBy.shield).toBe(1)
    expect(off.originFetches).toBe(2)
  })
})

describe('unique keys', () => {
  it('all-unique workload: collapsing cannot help and every request reaches the origin', () => {
    const c = cfg({ uniqueKeyRatio: 1, requestCount: 300, collapsingEnabled: true })
    const m = computeMetrics(runSimulation(c))
    expect(m.originFetches).toBe(300)
    expect(m.collapsedRequests).toBe(0)
    expect(m.cacheHitRatio).toBe(0)
  })
})

describe('origin capacity', () => {
  it('limited concurrency queues fetches and raises latency', () => {
    const reqs = ['a', 'b', 'c'].map((k) => req(k, 0, 0))
    const c = cfg({ originConcurrency: 1 })
    const r = simulateRequests(c, reqs)
    const m = computeMetrics(r)
    expect(m.origin.peakConcurrency).toBe(1)
    expect(m.origin.maxQueueDepth).toBe(2)
    const lat = r.records.map((x) => x.latencyMs).sort((a, b) => a - b)
    expect(lat[0]).toBe(coldLatency(c))
    expect(lat[2]).toBe(coldLatency(c) + 2 * c.originServiceMs)
    expect(m.origin.avgQueueWaitMs).toBeCloseTo((0 + 150 + 300) / 3)
  })
})

describe('warm cache and determinism', () => {
  it('warm run has fewer origin fetches than cold for the same workload', () => {
    const base = cfg({ requestCount: 500, edgeCapacity: 500, sharedCapacity: 500, shieldCapacity: 500 })
    const cold = computeMetrics(runSimulation(base))
    const warm = computeMetrics(runSimulation({ ...base, warmCache: true }))
    expect(warm.totalRequests).toBe(500) // warm-up pass is excluded from metrics
    expect(warm.originFetches).toBeLessThan(cold.originFetches)
    expect(warm.cacheHitRatio).toBeGreaterThan(cold.cacheHitRatio)
  })

  it('same config + seed gives identical results; a different seed differs', () => {
    const a = computeMetrics(runSimulation(cfg({ requestCount: 400 })))
    const b = computeMetrics(runSimulation(cfg({ requestCount: 400 })))
    const c = computeMetrics(runSimulation(cfg({ requestCount: 400, seed: 7 })))
    expect(a).toEqual(b)
    expect(c).not.toEqual(a)
  })

  it('workload is identical across toggle changes (fair comparison)', () => {
    const w1 = generateWorkload(cfg({ collapsingEnabled: true, shieldEnabled: true }))
    const w2 = generateWorkload(cfg({ collapsingEnabled: false, shieldEnabled: false, edgeCapacity: 5, ttlMs: 10 }))
    expect(w1).toEqual(w2)
  })
})

describe('metrics are consistent with the simulation', () => {
  const c = cfg({ requestCount: 2000, arrivalRatePerSec: 1000, edgeCapacity: 20, hotObjectShare: 0.2 })
  const r = runSimulation(c)
  const m = computeMetrics(r)

  it('every request completes and is attributed to exactly one serving layer', () => {
    expect(m.totalRequests).toBe(2000)
    const s = m.servedBy
    expect(s.edge + s.shared + s.shield + s.origin).toBe(2000)
  })

  it('per-layer counters balance: lookups = hits + misses; misses = collapsed + forwarded', () => {
    for (const l of ['edge', 'shared', 'shield'] as const) {
      const x = m.layers[l]
      expect(x.hits + x.misses).toBe(x.lookups)
      expect(x.collapsed + x.forwarded).toBe(x.misses)
    }
    expect(m.layers.edge.lookups).toBe(2000)
  })

  it('every forward leaving the last cache layer is exactly one origin fetch', () => {
    expect(m.originFetches).toBe(m.layers.shield.forwarded)
    expect(m.originFetches).toBe(r.originFetches.length)
  })

  it('layers above a hit are not contacted: lookups at layer N+1 = forwards from layer N', () => {
    expect(m.layers.shared.lookups).toBe(m.layers.edge.forwarded)
    expect(m.layers.shield.lookups).toBe(m.layers.shared.forwarded)
  })

  it('bytes: delivered is the sum of object sizes; saved = delivered - origin egress', () => {
    const delivered = r.records.reduce((a, x) => a + x.sizeKB, 0)
    const egress = r.originFetches.reduce((a, x) => a + x.sizeKB, 0)
    expect(m.bytes.deliveredKB).toBe(delivered)
    expect(m.bytes.originEgressKB).toBe(egress)
    expect(m.bytes.savedKB).toBe(delivered - egress)
  })

  it('latency stats: avg within [min,max]; p50 <= p95 <= max', () => {
    expect(m.p50LatencyMs).toBeLessThanOrEqual(m.p95LatencyMs)
    expect(m.p95LatencyMs).toBeLessThanOrEqual(m.maxLatencyMs)
    expect(m.avgLatencyMs).toBeLessThanOrEqual(m.maxLatencyMs)
    expect(m.avgLatencyMs).toBeGreaterThanOrEqual(c.rttMs.edge)
  })
})

describe('scale', () => {
  it('10,000 requests complete quickly in one synchronous batch', () => {
    const t0 = performance.now()
    const m = computeMetrics(runSimulation(cfg({ requestCount: 10_000 })))
    expect(m.totalRequests).toBe(10_000)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})

describe('validation', () => {
  it('rejects invalid configs', () => {
    expect(() => runSimulation(cfg({ requestCount: 0 }))).toThrow(/requestCount/)
    expect(() => runSimulation(cfg({ edgeCount: 2, regionCount: 3 }))).toThrow(/regionCount/)
  })
})
