import { beforeEach, describe, expect, it } from 'vitest'
import { runSimulation, simulateRequests } from '../engine'
import { compareRuns, computeMetrics } from '../metrics'
import { cfg, req, resetIds } from './helpers'

beforeEach(() => resetIds())

describe('Origin Failure & Cache Survivability', () => {
  it('serves valid cached items as hits while uncached misses fail during origin outage', () => {
    const c = cfg({
      fault: {
        scenario: 'origin_failure',
        startMs: 1000,
        endMs: 3000,
        targetEdgeIndex: 0,
        targetRegionIndex: 0,
        partitionLink: 'edge_to_shared',
        fallbackPolicy: 'bypass',
      },
    })

    // req 1 at t=0: cold, reaches origin, caches object 'cached-key'
    // req 2 at t=1500 (during outage): request for 'cached-key' -> HIT at edge!
    // req 3 at t=1600 (during outage): request for 'new-key' -> MISS, reaches down origin -> FAILS
    // req 4 at t=3500 (after recovery): request for 'new-key' -> MISS, reaches restored origin -> SUCCEEDS
    const requests = [
      req('cached-key', 0, 0),
      req('cached-key', 0, 1500),
      req('new-key', 0, 1600),
      req('new-key', 0, 3500),
    ]

    const result = simulateRequests(c, requests)
    const m = computeMetrics(result)

    expect(m.totalRequests).toBe(4)
    expect(m.successfulRequests).toBe(3)
    expect(m.failedRequests).toBe(1)
    expect(m.availabilityPct).toBe(75)

    // req 1: cold success from origin
    expect(result.records[0].status).toBe('success')
    expect(result.records[0].servedBy).toBe('origin')

    // req 2: served from edge cache despite origin being dead
    expect(result.records[1].status).toBe('success')
    expect(result.records[1].servedBy).toBe('edge')

    // req 3: uncached miss reaches down origin and fails
    expect(result.records[2].status).toBe('failed')
    expect(result.records[2].servedBy).toBe('none')
    expect(result.records[2].error).toContain('Origin offline')

    // req 4: after recovery, succeeds from origin
    expect(result.records[3].status).toBe('success')
    expect(result.records[3].servedBy).toBe('origin')
  })

  it('fails in-flight follower requests when leader origin fetch fails', () => {
    const c = cfg({
      collapsingEnabled: true,
      fault: {
        scenario: 'origin_failure',
        startMs: 500,
        endMs: 2500,
        targetEdgeIndex: 0,
        targetRegionIndex: 0,
        partitionLink: 'edge_to_shared',
        fallbackPolicy: 'bypass',
      },
    })

    // Both requests arrive during the outage for the same uncached key
    const requests = [req('hot-miss', 0, 1000), req('hot-miss', 0, 1005)]
    const result = simulateRequests(c, requests)
    const m = computeMetrics(result)

    expect(m.failedRequests).toBe(2)
    expect(m.successfulRequests).toBe(0)
    expect(m.availabilityPct).toBe(0)
    expect(result.records[0].status).toBe('failed')
    expect(result.records[1].status).toBe('failed')
    expect(result.records[1].collapsed).toBe(true)

    // Failed requests must NOT have populated the edge cache
    resetIds()
    const checkCache = simulateRequests(c, [req('hot-miss', 0, 3000)])
    expect(checkCache.records[0].servedBy).toBe('origin') // not cached
  })
})

describe('Edge Cache Failure & Fallback', () => {
  it('resilient fallback: traffic to failed edge bypasses local cache to regional shared tier', () => {
    const c = cfg({
      edgeCount: 4,
      regionCount: 2,
      fault: {
        scenario: 'edge_failure',
        startMs: 500,
        endMs: 2000,
        targetEdgeIndex: 0, // edge-0 is down
        targetRegionIndex: 0,
        partitionLink: 'edge_to_shared',
        fallbackPolicy: 'bypass',
      },
    })

    // edge 0 receives requests before, during, and after outage
    const requests = [
      req('obj-a', 0, 0),    // t=0: normal edge lookup
      req('obj-b', 0, 1000), // t=1000: edge-0 down -> failover to regional cache
      req('obj-c', 0, 3000), // t=3000: edge-0 restored -> normal edge lookup
    ]

    const result = simulateRequests(c, requests)
    const m = computeMetrics(result)

    expect(m.successfulRequests).toBe(3)
    expect(m.failedRequests).toBe(0)
    expect(m.availabilityPct).toBe(100)

    // Middle request bypassed edge-0 and was served upstream
    expect(result.records[1].status).toBe('success')
    expect(result.records[1].servedBy).toBe('origin')
    expect(result.layers.edge.lookups).toBe(2) // only req 0 and req 2 looked up edge-0
  })

  it('fail-closed: traffic to failed edge drops when fallback is disabled', () => {
    const c = cfg({
      fault: {
        scenario: 'edge_failure',
        startMs: 500,
        endMs: 2000,
        targetEdgeIndex: 0,
        targetRegionIndex: 0,
        partitionLink: 'edge_to_shared',
        fallbackPolicy: 'fail',
      },
    })

    const requests = [req('obj-a', 0, 1000)]
    const result = simulateRequests(c, requests)
    const m = computeMetrics(result)

    expect(m.failedRequests).toBe(1)
    expect(m.availabilityPct).toBe(0)
    expect(result.records[0].status).toBe('failed')
    expect(result.records[0].error).toContain('Edge offline')
  })
})

describe('Regional Shared Cache Failure', () => {
  it('edges bypass failed regional cache directly to shield and origin', () => {
    const c = cfg({
      edgeCount: 4,
      regionCount: 2,
      shieldEnabled: true,
      fault: {
        scenario: 'shared_failure',
        startMs: 500,
        endMs: 2000,
        targetEdgeIndex: 0,
        targetRegionIndex: 0, // shared-0 is down
        partitionLink: 'edge_to_shared',
        fallbackPolicy: 'bypass',
      },
    })

    // edge 0 is in region 0
    const requests = [req('obj-x', 0, 1000)]
    const result = simulateRequests(c, requests)
    const m = computeMetrics(result)

    expect(m.successfulRequests).toBe(1)
    expect(m.failedRequests).toBe(0)
    expect(result.records[0].status).toBe('success')
    // Regional cache was bypassed
    expect(result.layers.shared.lookups).toBe(0)
    // Reached shield/origin
    expect(result.layers.shield.lookups).toBe(1)
  })
})

describe('Network Partition Between Layers', () => {
  it('shield-to-origin partition: cache hits serve normally, misses fail with HTTP 504', () => {
    const c = cfg({
      fault: {
        scenario: 'network_partition',
        startMs: 1000,
        endMs: 3000,
        targetEdgeIndex: 0,
        targetRegionIndex: 0,
        partitionLink: 'shield_to_origin',
        fallbackPolicy: 'bypass',
      },
    })

    const requests = [
      req('cached', 0, 0),     // t=0: pre-cached
      req('cached', 0, 1500),  // t=1500: hit at edge
      req('uncached', 0, 1600),// t=1600: cannot cross to origin -> fails
    ]

    const result = simulateRequests(c, requests)
    const m = computeMetrics(result)

    expect(m.successfulRequests).toBe(2)
    expect(m.failedRequests).toBe(1)
    expect(result.records[1].status).toBe('success')
    expect(result.records[2].status).toBe('failed')
    expect(result.records[2].error).toContain('origin unreachable')
  })
})

describe('Metrics & Baseline Comparison for Faults', () => {
  it('correctly reports availability delta and failed requests delta in comparison', () => {
    const baseConfig = cfg({ requestCount: 200, arrivalRatePerSec: 200 })
    const faultConfig = cfg({
      requestCount: 200,
      arrivalRatePerSec: 200,
      fault: {
        scenario: 'origin_failure',
        startMs: 200,
        endMs: 800,
        targetEdgeIndex: 0,
        targetRegionIndex: 0,
        partitionLink: 'edge_to_shared',
        fallbackPolicy: 'bypass',
      },
    })

    const baseline = computeMetrics(runSimulation(baseConfig))
    const chaos = computeMetrics(runSimulation(faultConfig))
    const cmp = compareRuns(baseline, chaos)

    expect(baseline.availabilityPct).toBe(100)
    expect(baseline.failedRequests).toBe(0)
    expect(chaos.availabilityPct).toBeLessThan(100)
    expect(chaos.failedRequests).toBeGreaterThan(0)

    expect(cmp.availabilityDeltaPct).toBeCloseTo(chaos.availabilityPct - 100)
    expect(cmp.failedRequestsDelta).toBe(chaos.failedRequests)
  })

  it('normal operation produces 100% availability and identical regression behavior', () => {
    const c = cfg({ fault: { ...cfg().fault, scenario: 'none' } })
    const r = runSimulation(c)
    const m = computeMetrics(r)

    expect(m.availabilityPct).toBe(100)
    expect(m.failedRequests).toBe(0)
    expect(m.successfulRequests).toBe(m.totalRequests)
    for (const rec of r.records) {
      expect(rec.status).toBe('success')
      expect(rec.servedBy).not.toBe('none')
    }
  })
})
