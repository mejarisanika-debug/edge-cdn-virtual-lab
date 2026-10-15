import { hashString, mulberry32 } from './rng'
import type { Phase, SimConfig, SimRequest } from './types'

/** Object size is a pure function of the key so every run sees identical objects. */
export function objectSizeKB(key: string, cfg: Pick<SimConfig, 'minObjectKB' | 'maxObjectKB'>): number {
  const span = Math.floor(cfg.maxObjectKB) - Math.floor(cfg.minObjectKB) + 1
  return Math.floor(cfg.minObjectKB) + (hashString(key) % span)
}

function buildCdf(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  return weights.map((w) => (acc += w / total))
}

function sample(cdf: number[], u: number): number {
  let lo = 0
  let hi = cdf.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cdf[mid] >= u) hi = mid
    else lo = mid + 1
  }
  return lo
}

export interface WorkloadOptions {
  offsetMs?: number
  idStart?: number
  phase?: Phase
}

/**
 * Generate the request stream. It depends ONLY on workload settings + seed (never on the
 * collapsing / shield / shared-tier toggles or cache sizes), so two runs that differ only in
 * toggles are driven by exactly the same traffic: that is what makes comparisons fair.
 * Each request consumes the same five random draws regardless of settings, keeping streams stable.
 */
export function generateWorkload(cfg: SimConfig, opts: WorkloadOptions = {}): SimRequest[] {
  const { offsetMs = 0, idStart = 0, phase = 'measured' } = opts
  const rng = mulberry32(cfg.seed)
  const zipfCdf = buildCdf(
    Array.from({ length: cfg.catalogSize }, (_, i) => 1 / Math.pow(i + 1, cfg.zipfSkew)),
  )
  const edgeCdf = buildCdf(
    Array.from({ length: cfg.edgeCount }, (_, i) => 1 / Math.pow(i + 1, cfg.edgeSkew)),
  )
  const meanGapMs = 1000 / cfg.arrivalRatePerSec
  const out: SimRequest[] = []
  let t = offsetMs
  let uniqueCounter = 0
  for (let i = 0; i < cfg.requestCount; i++) {
    const uGap = rng()
    const uClass = rng()
    const uKey = rng()
    const uEdge = rng()
    const uUnique = rng()
    t += -Math.log(1 - uGap) * meanGapMs
    let key: string
    if (uClass < cfg.hotObjectShare) {
      key = 'hot-0'
    } else if (uUnique < cfg.uniqueKeyRatio) {
      key = `unique-${uniqueCounter++}`
    } else {
      key = `obj-${sample(zipfCdf, uKey)}`
    }
    out.push({
      id: idStart + i,
      key,
      edgeIndex: sample(edgeCdf, uEdge),
      arrivalTime: t,
      sizeKB: objectSizeKB(key, cfg),
      phase,
    })
  }
  return out
}
