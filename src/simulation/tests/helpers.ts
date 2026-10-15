import { DEFAULT_CONFIG } from '../config'
import type { SimConfig, SimRequest } from '../types'

export function cfg(overrides: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, originConcurrency: 1000, ttlMs: 1_000_000, ...overrides }
}

let nextId = 0
export function req(key: string, edgeIndex: number, arrivalTime: number): SimRequest {
  return { id: nextId++, key, edgeIndex, arrivalTime, sizeKB: 100, phase: 'measured' }
}
export function resetIds(): void {
  nextId = 0
}

/** Full cold path latency for shared+shield enabled: client RTT + each hop RTT + origin service. */
export function coldLatency(c: SimConfig): number {
  return c.rttMs.edge + c.rttMs.shared + c.rttMs.shield + c.rttMs.origin + c.originServiceMs
}
