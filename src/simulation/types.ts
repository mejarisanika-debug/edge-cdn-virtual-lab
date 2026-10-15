/**
 * Typed models for the Edge CDN simulation.
 * All times are in simulated milliseconds. All sizes are in KB.
 */

export type LayerName = 'edge' | 'shared' | 'shield'
export type ServedBy = LayerName | 'origin'
export type CachePolicy = 'LRU' | 'FIFO'
export type Phase = 'warmup' | 'measured'

export type FaultScenario =
  | 'none'
  | 'edge_failure'
  | 'shared_failure'
  | 'origin_failure'
  | 'network_partition'

export type PartitionLink = 'edge_to_shared' | 'shared_to_shield' | 'shield_to_origin'
export type FallbackPolicy = 'bypass' | 'fail'

export interface FaultConfig {
  scenario: FaultScenario
  /** Start time of failure in simulated ms (measured phase relative). */
  startMs: number
  /** End time / recovery time in simulated ms (measured phase relative). */
  endMs: number
  /** Target edge index (0..edgeCount-1, or -1 for all edges). */
  targetEdgeIndex: number
  /** Target region index (0..regionCount-1, or -1 for all regions). */
  targetRegionIndex: number
  /** Partition link when scenario is 'network_partition'. */
  partitionLink: PartitionLink
  /** Fallback routing policy when a tier is unavailable or partitioned. */
  fallbackPolicy: FallbackPolicy
}

export interface SimConfig {
  /** Seed for the workload generator. Same seed + workload settings => identical request stream. */
  seed: number

  // ---- Workload ----
  requestCount: number
  edgeCount: number
  /** Number of regions. Each region has its own shared (regional) cache. Edge i belongs to region i % regionCount. */
  regionCount: number
  /** Mean arrival rate (Poisson process). Higher => more concurrent misses. */
  arrivalRatePerSec: number
  /** 0 = requests spread evenly over edges; larger = more traffic concentrated on edge 0. */
  edgeSkew: number
  /** Number of distinct "catalog" objects (keys obj-0 ... obj-N-1). */
  catalogSize: number
  /** Zipf exponent. 0 = every catalog object equally popular; ~1 = a few objects dominate. */
  zipfSkew: number
  /** Probability (0..1) that a request is for a never-seen-before unique object. */
  uniqueKeyRatio: number
  /** Probability (0..1) that a request targets one single hot object (flash crowd). */
  hotObjectShare: number
  minObjectKB: number
  maxObjectKB: number

  // ---- Caches ----
  /** Capacity in number of objects (not bytes) per cache node. */
  edgeCapacity: number
  sharedCapacity: number
  shieldCapacity: number
  cachePolicy: CachePolicy
  /** Time-to-live applied at every cache layer, counted from the moment an object is stored there. */
  ttlMs: number

  // ---- Network (round-trip times) ----
  rttMs: {
    /** client <-> edge */
    edge: number
    /** previous layer <-> shared cache */
    shared: number
    /** previous layer <-> origin shield */
    shield: number
    /** previous layer <-> origin */
    origin: number
  }

  // ---- Origin ----
  /** Time the origin needs to produce one object once it starts working on it. */
  originServiceMs: number
  /** Max simultaneous fetches the origin serves; extra fetches wait in a FIFO queue. */
  originConcurrency: number

  // ---- Feature toggles ----
  collapsingEnabled: boolean
  shieldEnabled: boolean
  sharedTierEnabled: boolean

  // ---- Warm cache experiment ----
  /** Run the same workload once first (unmeasured) so measured traffic starts with warm caches. */
  warmCache: boolean
  /** Idle time between the warm-up pass and the measured pass. TTLs keep ticking during it. */
  warmGapMs: number

  // ---- Fault Injection & Recovery (Simulated) ----
  fault: FaultConfig
}

export interface SimRequest {
  id: number
  key: string
  edgeIndex: number
  arrivalTime: number
  sizeKB: number
  phase: Phase
}

export interface RequestRecord {
  id: number
  key: string
  edgeIndex: number
  regionIndex: number
  arrivalTime: number
  completionTime: number
  latencyMs: number
  /** Which layer (or origin) produced the bytes for this request, or 'none' if failed. */
  servedBy: ServedBy | 'none'
  /** True if this request waited on another request's in-flight fetch instead of sending its own. */
  collapsed: boolean
  collapsedAt: LayerName | null
  sizeKB: number
  status: 'success' | 'failed'
  error?: string
}

export interface LayerStats {
  lookups: number
  hits: number
  /** misses = collapsed + forwarded */
  misses: number
  /** Subset of misses where the object was present but its TTL had run out. */
  expiredMisses: number
  /** Misses that joined an existing in-flight fetch (no upstream request sent). */
  collapsed: number
  /** Misses that sent their own request upstream. */
  forwarded: number
  fills: number
  evictions: number
}

export interface NodeStats extends LayerStats {
  nodeId: string
  layer: LayerName
  /** Edge index (edge nodes) or region index (shared nodes); null for the shield. */
  index: number | null
}

export interface OriginFetchRecord {
  key: string
  sizeKB: number
  /** Time the fetch reached the origin. */
  arrivedAt: number
  startedAt: number
  finishedAt: number
  queueWaitMs: number
  /** The layer that sent this fetch (the layer directly below the origin on the path). */
  requestedBy: LayerName
}

export type SimEventKind =
  | 'arrive'
  | 'hit'
  | 'miss'
  | 'collapsed'
  | 'forward'
  | 'fill'
  | 'origin_queued'
  | 'origin_start'
  | 'origin_done'
  | 'complete'
  | 'fault_start'
  | 'recovery'
  | 'request_failed'
  | 'fallback'

export interface SimEvent {
  seq: number
  t: number
  requestId: number
  kind: SimEventKind
  layer: LayerName | 'origin' | 'client'
  nodeId: string
  key: string
  detail?: string
  /** For 'arrive' and 'forward': the node the request is being sent to. */
  target?: string
}

export interface OriginSummary {
  fetches: number
  peakConcurrency: number
  maxQueueDepth: number
  totalQueueWaitMs: number
}

export interface SimResult {
  config: SimConfig
  /** Only measured-phase requests. */
  records: RequestRecord[]
  originFetches: OriginFetchRecord[]
  layers: Record<LayerName, LayerStats>
  nodes: NodeStats[]
  origin: OriginSummary
  events: SimEvent[]
  eventsTruncated: boolean
  /** Measured pass: first arrival to last completion. */
  startTime: number
  endTime: number
}
