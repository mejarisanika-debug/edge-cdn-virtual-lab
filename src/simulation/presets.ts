import { DEFAULT_CONFIG } from './config'
import type { SimConfig } from './types'

export interface Preset {
  id: string
  name: string
  /** What the preset sets up. */
  summary: string
  /** What students should observe / what to try. */
  expectation: string
  overrides: Partial<SimConfig>
}

export const PRESETS: Preset[] = [
  {
    id: 'baseline',
    name: 'Baseline (cold cache)',
    summary: 'Empty caches, collapsing OFF, shield OFF. Moderate traffic.',
    expectation:
      'Many duplicate misses reach the origin. Run it, pin it as the baseline, then turn collapsing and the shield ON and run again.',
    overrides: { collapsingEnabled: false, shieldEnabled: false, requestCount: 1000, arrivalRatePerSec: 300 },
  },
  {
    id: 'warm',
    name: 'Warm cache',
    summary: 'The same workload runs once first (not measured); the measured pass starts with warm caches.',
    expectation: 'Far more hits and far fewer origin fetches than the same settings with a cold cache. Untick "Warm cache" to compare.',
    overrides: { warmCache: true, collapsingEnabled: true, shieldEnabled: true, edgeCapacity: 150, sharedCapacity: 250, shieldCapacity: 400 },
  },
  {
    id: 'flash',
    name: 'Flash crowd',
    summary: '60% of requests target one hot object, at a high arrival rate.',
    expectation: 'Without collapsing, a flood of duplicate fetches overloads the origin (see queue depth and P95). Collapsing + shield cut origin fetches sharply.',
    overrides: { hotObjectShare: 0.6, arrivalRatePerSec: 1500, requestCount: 2000, collapsingEnabled: true, shieldEnabled: true, originConcurrency: 10 },
  },
  {
    id: 'unique',
    name: 'Many unique objects',
    summary: '90% of requests are for objects nobody has requested before.',
    expectation: 'Caches cannot help and collapsing has almost nothing to merge: different keys are never collapsed. Origin fetches stay close to the request count.',
    overrides: { uniqueKeyRatio: 0.9, collapsingEnabled: true, shieldEnabled: true },
  },
  {
    id: 'ttl',
    name: 'Short TTL',
    summary: 'Objects expire after 1 second at every layer.',
    expectation: 'Look at "expired misses": cached objects keep expiring and being refetched, so origin fetches rise versus a long TTL.',
    overrides: { ttlMs: 1000, arrivalRatePerSec: 200, requestCount: 1000, collapsingEnabled: true, shieldEnabled: true },
  },
  {
    id: 'pressure',
    name: 'Origin under pressure',
    summary: 'Small origin (5 slots), heavy traffic, collapsing OFF.',
    expectation: 'The origin queue grows and latency explodes. Turn collapsing ON to see the queue drain.',
    overrides: { originConcurrency: 5, arrivalRatePerSec: 800, requestCount: 2000, hotObjectShare: 0.3, collapsingEnabled: false, shieldEnabled: true },
  },
  {
    id: 'fault_origin',
    name: 'Origin Outage (Chaos)',
    summary: 'Origin crashes between 1000ms–3500ms. Valid cached objects continue serving; uncached misses fail.',
    expectation: 'Observe cache survival: hit requests succeed, while cache misses return HTTP 503. Check the availability % and failed requests counter.',
    overrides: {
      requestCount: 1500,
      arrivalRatePerSec: 300,
      collapsingEnabled: true,
      shieldEnabled: true,
      sharedTierEnabled: true,
      fault: {
        scenario: 'origin_failure',
        startMs: 1000,
        endMs: 3500,
        targetEdgeIndex: 0,
        targetRegionIndex: 0,
        partitionLink: 'edge_to_shared',
        fallbackPolicy: 'bypass',
      },
    },
  },
  {
    id: 'fault_edge',
    name: 'Edge Failure & Failover',
    summary: 'Edge 1 crashes between 800ms–3000ms with resilient failover to regional shared cache.',
    expectation: 'Requests targeting Edge 1 bypass the dead local cache and route to the regional tier. Compare latency and regional lookups.',
    overrides: {
      requestCount: 1500,
      arrivalRatePerSec: 300,
      edgeCount: 4,
      regionCount: 2,
      collapsingEnabled: true,
      shieldEnabled: true,
      sharedTierEnabled: true,
      fault: {
        scenario: 'edge_failure',
        startMs: 800,
        endMs: 3000,
        targetEdgeIndex: 0,
        targetRegionIndex: 0,
        partitionLink: 'edge_to_shared',
        fallbackPolicy: 'bypass',
      },
    },
  },
]

export function presetConfig(id: string): SimConfig {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown preset: ${id}`)
  return {
    ...DEFAULT_CONFIG,
    ...p.overrides,
    fault: { ...DEFAULT_CONFIG.fault, ...(p.overrides.fault ?? {}) },
  }
}
