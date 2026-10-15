import type { LayerName, ServedBy, SimResult } from './types'

export interface LayerMetrics {
  lookups: number
  hits: number
  misses: number
  expiredMisses: number
  collapsed: number
  forwarded: number
  /** hits / lookups, or null when the layer received no lookups (avoids a fake 0%). */
  hitRatio: number | null
}

export interface Metrics {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  availabilityPct: number
  layers: Record<LayerName, LayerMetrics>
  servedBy: Record<ServedBy, number>
  /** Requests that waited on someone else's in-flight fetch (at any layer). */
  collapsedRequests: number
  originFetches: number
  /** Share of requests answered by a cache layer (edge, shared or shield) rather than the origin. */
  cacheHitRatio: number
  /** 1 - originFetches / totalRequests: how much origin work the CDN avoided vs. having no CDN. */
  originOffloadRatio: number
  avgLatencyMs: number
  avgSuccessLatencyMs: number
  avgFailedLatencyMs: number | null
  p50LatencyMs: number
  p95LatencyMs: number
  maxLatencyMs: number
  /** Completed requests per simulated second over the measured window. */
  throughputRps: number
  durationMs: number
  bytes: {
    deliveredKB: number
    originEgressKB: number
    savedKB: number
    savedRatio: number
  }
  origin: {
    peakConcurrency: number
    maxQueueDepth: number
    avgQueueWaitMs: number
  }
}

/** Nearest-rank percentile on an unsorted array: smallest value with at least p% of samples <= it. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]
}

export function computeMetrics(result: SimResult): Metrics {
  const recs = result.records
  const n = recs.length
  const servedBy: Record<ServedBy, number> = { edge: 0, shared: 0, shield: 0, origin: 0 }
  let latencySum = 0
  let successLatencySum = 0
  let failedLatencySum = 0
  let maxLatency = 0
  let delivered = 0
  let collapsedRequests = 0
  let successfulRequests = 0
  let failedRequests = 0
  const latencies: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const r = recs[i]
    latencies[i] = r.latencyMs
    latencySum += r.latencyMs
    if (r.latencyMs > maxLatency) maxLatency = r.latencyMs
    if (r.status === 'success' && r.servedBy !== 'none') {
      successfulRequests++
      servedBy[r.servedBy]++
      successLatencySum += r.latencyMs
      delivered += r.sizeKB
    } else {
      failedRequests++
      failedLatencySum += r.latencyMs
    }
    if (r.collapsed) collapsedRequests++
  }
  let originEgress = 0
  for (const f of result.originFetches) originEgress += f.sizeKB

  const layer = (name: LayerName): LayerMetrics => {
    const s = result.layers[name]
    return {
      lookups: s.lookups,
      hits: s.hits,
      misses: s.misses,
      expiredMisses: s.expiredMisses,
      collapsed: s.collapsed,
      forwarded: s.forwarded,
      hitRatio: s.lookups > 0 ? s.hits / s.lookups : null,
    }
  }

  const fetches = result.originFetches.length
  const duration = result.endTime - result.startTime
  const fromCache = servedBy.edge + servedBy.shared + servedBy.shield

  return {
    totalRequests: n,
    successfulRequests,
    failedRequests,
    availabilityPct: n > 0 ? (successfulRequests / n) * 100 : 100,
    layers: { edge: layer('edge'), shared: layer('shared'), shield: layer('shield') },
    servedBy,
    collapsedRequests,
    originFetches: fetches,
    cacheHitRatio: n ? fromCache / n : 0,
    originOffloadRatio: n ? 1 - fetches / n : 0,
    avgLatencyMs: n ? latencySum / n : 0,
    avgSuccessLatencyMs: successfulRequests ? successLatencySum / successfulRequests : 0,
    avgFailedLatencyMs: failedRequests ? failedLatencySum / failedRequests : null,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    maxLatencyMs: maxLatency,
    throughputRps: duration > 0 ? (n / duration) * 1000 : 0,
    durationMs: duration,
    bytes: {
      deliveredKB: delivered,
      originEgressKB: originEgress,
      savedKB: Math.max(0, delivered - originEgress),
      savedRatio: delivered > 0 ? Math.max(0, 1 - originEgress / delivered) : 0,
    },
    origin: {
      peakConcurrency: result.origin.peakConcurrency,
      maxQueueDepth: result.origin.maxQueueDepth,
      avgQueueWaitMs: fetches ? result.origin.totalQueueWaitMs / fetches : 0,
    },
  }
}

export interface Comparison {
  originFetchesDelta: number
  /** Positive = the candidate sent fewer fetches to the origin than the baseline. */
  originReductionRatio: number
  cacheHitRatioDelta: number
  avgLatencyDeltaMs: number
  p95LatencyDeltaMs: number
  availabilityDeltaPct: number
  failedRequestsDelta: number
}

/** Compare a candidate run with a baseline run (both should use the same workload + seed). */
export function compareRuns(baseline: Metrics, candidate: Metrics): Comparison {
  return {
    originFetchesDelta: candidate.originFetches - baseline.originFetches,
    originReductionRatio:
      baseline.originFetches > 0 ? 1 - candidate.originFetches / baseline.originFetches : 0,
    cacheHitRatioDelta: candidate.cacheHitRatio - baseline.cacheHitRatio,
    avgLatencyDeltaMs: candidate.avgLatencyMs - baseline.avgLatencyMs,
    p95LatencyDeltaMs: candidate.p95LatencyMs - baseline.p95LatencyMs,
    availabilityDeltaPct: candidate.availabilityPct - baseline.availabilityPct,
    failedRequestsDelta: candidate.failedRequests - baseline.failedRequests,
  }
}
