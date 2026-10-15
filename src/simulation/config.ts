import type { SimConfig } from './types'

export const DEFAULT_CONFIG: SimConfig = {
  seed: 42,
  requestCount: 1000,
  edgeCount: 4,
  regionCount: 2,
  arrivalRatePerSec: 200,
  edgeSkew: 0,
  catalogSize: 200,
  zipfSkew: 1,
  uniqueKeyRatio: 0.1,
  hotObjectShare: 0,
  minObjectKB: 50,
  maxObjectKB: 500,
  edgeCapacity: 50,
  sharedCapacity: 150,
  shieldCapacity: 400,
  cachePolicy: 'LRU',
  ttlMs: 60_000,
  rttMs: { edge: 20, shared: 30, shield: 40, origin: 60 },
  originServiceMs: 150,
  originConcurrency: 20,
  collapsingEnabled: true,
  shieldEnabled: true,
  sharedTierEnabled: true,
  warmCache: false,
  warmGapMs: 2000,
  fault: {
    scenario: 'none',
    startMs: 500,
    endMs: 2500,
    targetEdgeIndex: 0,
    targetRegionIndex: 0,
    partitionLink: 'edge_to_shared',
    fallbackPolicy: 'bypass',
  },
}

/** Returns a list of human-readable problems; empty list means the config is valid. */
export function validateConfig(c: SimConfig): string[] {
  const errs: string[] = []
  const int = (v: number) => Number.isInteger(v)
  if (!int(c.requestCount) || c.requestCount < 1 || c.requestCount > 100_000)
    errs.push('requestCount must be an integer between 1 and 100,000')
  if (!int(c.edgeCount) || c.edgeCount < 1 || c.edgeCount > 12)
    errs.push('edgeCount must be an integer between 1 and 12')
  if (!int(c.regionCount) || c.regionCount < 1 || c.regionCount > c.edgeCount)
    errs.push('regionCount must be an integer between 1 and edgeCount')
  if (!(c.arrivalRatePerSec > 0)) errs.push('arrivalRatePerSec must be > 0')
  if (!(c.edgeSkew >= 0)) errs.push('edgeSkew must be >= 0')
  if (!int(c.catalogSize) || c.catalogSize < 1) errs.push('catalogSize must be an integer >= 1')
  if (!(c.zipfSkew >= 0)) errs.push('zipfSkew must be >= 0')
  if (!(c.uniqueKeyRatio >= 0 && c.uniqueKeyRatio <= 1)) errs.push('uniqueKeyRatio must be within 0..1')
  if (!(c.hotObjectShare >= 0 && c.hotObjectShare <= 1)) errs.push('hotObjectShare must be within 0..1')
  if (!(c.minObjectKB > 0 && c.maxObjectKB >= c.minObjectKB))
    errs.push('object sizes must satisfy 0 < minObjectKB <= maxObjectKB')
  for (const [name, v] of [
    ['edgeCapacity', c.edgeCapacity],
    ['sharedCapacity', c.sharedCapacity],
    ['shieldCapacity', c.shieldCapacity],
    ['originConcurrency', c.originConcurrency],
  ] as const) {
    if (!int(v) || v < 1) errs.push(`${name} must be an integer >= 1`)
  }
  if (!(c.ttlMs > 0)) errs.push('ttlMs must be > 0')
  for (const [name, v] of Object.entries(c.rttMs)) {
    if (!(v >= 0)) errs.push(`rttMs.${name} must be >= 0`)
  }
  if (!(c.originServiceMs >= 0)) errs.push('originServiceMs must be >= 0')
  if (!(c.warmGapMs >= 0)) errs.push('warmGapMs must be >= 0')
  if (c.fault) {
    if (!(c.fault.startMs >= 0)) errs.push('fault.startMs must be >= 0')
    if (!(c.fault.endMs >= c.fault.startMs)) errs.push('fault.endMs must be >= fault.startMs')
    if (c.fault.targetEdgeIndex < -1 || c.fault.targetEdgeIndex >= c.edgeCount)
      errs.push(`fault.targetEdgeIndex must be between -1 and ${c.edgeCount - 1}`)
    if (c.fault.targetRegionIndex < -1 || c.fault.targetRegionIndex >= c.regionCount)
      errs.push(`fault.targetRegionIndex must be between -1 and ${c.regionCount - 1}`)
  }
  return errs
}

const WORKLOAD_KEYS = [
  'seed', 'requestCount', 'edgeCount', 'regionCount', 'arrivalRatePerSec', 'edgeSkew', 'catalogSize',
  'zipfSkew', 'uniqueKeyRatio', 'hotObjectShare', 'minObjectKB', 'maxObjectKB',
] as const

/** True when two configs generate the identical request stream (so comparing their results is fair). */
export function sameWorkload(a: SimConfig, b: SimConfig): boolean {
  return WORKLOAD_KEYS.every((k) => a[k] === b[k])
}
