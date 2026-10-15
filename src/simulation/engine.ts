import { TtlCache } from './cache'
import { validateConfig } from './config'
import { EventQueue } from './eventQueue'
import { layerPath, nodeIdFor, regionOf } from './originShield'
import { InFlightTable } from './requestCollapsing'
import type {
  LayerName,
  LayerStats,
  NodeStats,
  OriginFetchRecord,
  RequestRecord,
  ServedBy,
  SimConfig,
  SimEvent,
  SimEventKind,
  SimRequest,
  SimResult,
} from './types'
import { generateWorkload } from './workload'

/**
 * CACHE-FILL POLICY (documented model decision)
 * "Fill on the return path, at every layer that was on the request path."
 * When an object comes back from upstream (shield, shared tier or origin), EVERY layer it passes
 * on the way down stores a copy, each with its own TTL starting at the moment it is stored.
 * A cache hit at layer L stops the request there: layers above L are never contacted and the
 * origin fetch count does not change. Layers below L are filled as the response returns.
 */

type Done = (time: number, servedBy: ServedBy | 'none', error?: string) => void

interface CacheNode {
  id: string
  layer: LayerName
  index: number | null
  cache: TtlCache
  inflight: InFlightTable<Done>
  stats: LayerStats
}

interface OriginJob {
  key: string
  sizeKB: number
  measured: boolean
  requestedBy: LayerName
  arrivedAt: number
  done: Done
  requestId: number
}

export interface SimOptions {
  /** Max events kept in the log (the log is for display only; metrics never depend on it). */
  maxLoggedEvents?: number
}

const emptyStats = (): LayerStats => ({
  lookups: 0,
  hits: 0,
  misses: 0,
  expiredMisses: 0,
  collapsed: 0,
  forwarded: 0,
  fills: 0,
  evictions: 0,
})

/** Run the full simulation for a config, generating the workload (and warm-up pass if requested). */
export function runSimulation(config: SimConfig, options: SimOptions = {}): SimResult {
  const errs = validateConfig(config)
  if (errs.length) throw new Error(`Invalid config: ${errs.join('; ')}`)
  let requests: SimRequest[]
  if (config.warmCache) {
    const warm = generateWorkload(config, { phase: 'warmup' })
    const lastWarmArrival = warm[warm.length - 1].arrivalTime
    const measured = generateWorkload(config, {
      offsetMs: lastWarmArrival + config.warmGapMs,
      idStart: warm.length,
      phase: 'measured',
    })
    requests = [...warm, ...measured]
  } else {
    requests = generateWorkload(config)
  }
  return simulateRequests(config, requests, options)
}

/** Core event-driven simulation over an explicit list of requests (also used directly by tests). */
export function simulateRequests(
  config: SimConfig,
  requests: SimRequest[],
  options: SimOptions = {},
): SimResult {
  const maxLogged = options.maxLoggedEvents ?? 50_000
  const q = new EventQueue()
  const path = layerPath(config)
  const collapsing = config.collapsingEnabled

  // ---- Fault timing & state ----
  const warmOffset =
    config.warmCache && requests.some((r) => r.phase === 'warmup')
      ? (requests.find((r) => r.phase === 'measured')?.arrivalTime ?? 0)
      : 0
  const fault = config.fault
  const hasFault = fault && fault.scenario !== 'none'
  const faultStart = warmOffset + (fault?.startMs ?? 0)
  const faultEnd = warmOffset + (fault?.endMs ?? 0)
  const isFaultActiveAt = (t: number) => hasFault && t >= faultStart && t < faultEnd

  // ---- Build cache nodes ----
  const nodes = new Map<string, CacheNode>()
  const mk = (id: string, layer: LayerName, index: number | null, cap: number): void => {
    nodes.set(id, {
      id,
      layer,
      index,
      cache: new TtlCache(cap, config.ttlMs, config.cachePolicy),
      inflight: new InFlightTable<Done>(),
      stats: emptyStats(),
    })
  }
  for (let i = 0; i < config.edgeCount; i++) mk(`edge-${i}`, 'edge', i, config.edgeCapacity)
  if (config.sharedTierEnabled)
    for (let r = 0; r < config.regionCount; r++) mk(`shared-${r}`, 'shared', r, config.sharedCapacity)
  if (config.shieldEnabled) mk('shield', 'shield', null, config.shieldCapacity)

  // ---- Origin (capacity-limited FIFO server) ----
  const originQueue: OriginJob[] = []
  let busy = 0
  const originSummary = { fetches: 0, peakConcurrency: 0, maxQueueDepth: 0, totalQueueWaitMs: 0 }
  const originFetches: OriginFetchRecord[] = []

  // ---- Event log ----
  const events: SimEvent[] = []
  let eventsTruncated = false
  let eventSeq = 0
  const log = (
    t: number,
    requestId: number,
    kind: SimEventKind,
    layer: SimEvent['layer'],
    nodeId: string,
    key: string,
    measured: boolean,
    detail?: string,
    target?: string,
  ): void => {
    if (!measured) return
    if (events.length >= maxLogged) {
      eventsTruncated = true
      return
    }
    events.push({ seq: eventSeq++, t, requestId, kind, layer, nodeId, key, detail, target })
  }

  // Schedule fault injection & recovery marker events
  if (hasFault) {
    const faultTargetNode =
      fault.scenario === 'origin_failure'
        ? 'origin'
        : fault.scenario === 'edge_failure'
          ? (fault.targetEdgeIndex === -1 ? 'edge-all' : `edge-${fault.targetEdgeIndex}`)
          : fault.scenario === 'shared_failure'
            ? (fault.targetRegionIndex === -1 ? 'shared-all' : `shared-${fault.targetRegionIndex}`)
            : fault.partitionLink
    const faultLayer =
      fault.scenario === 'origin_failure'
        ? 'origin'
        : fault.scenario === 'edge_failure'
          ? 'edge'
          : fault.scenario === 'shared_failure'
            ? 'shared'
            : 'shield'
    const faultDesc =
      fault.scenario === 'origin_failure'
        ? 'Origin object store offline'
        : fault.scenario === 'edge_failure'
          ? `Edge node ${fault.targetEdgeIndex === -1 ? 'all' : fault.targetEdgeIndex} offline`
          : fault.scenario === 'shared_failure'
            ? `Regional cache ${fault.targetRegionIndex === -1 ? 'all' : fault.targetRegionIndex} offline`
            : `Network partition active: ${fault.partitionLink}`

    q.schedule(faultStart, (t) => {
      log(t, 0, 'fault_start', faultLayer, faultTargetNode, '', true, faultDesc)
    })
    q.schedule(faultEnd, (t) => {
      log(t, 0, 'recovery', faultLayer, faultTargetNode, '', true, `${faultDesc} recovered`)
    })
  }

  const records: RequestRecord[] = []

  // ---- Origin handling ----
  const isOriginDown = (t: number) => isFaultActiveAt(t) && fault.scenario === 'origin_failure'

  const startJob = (job: OriginJob, t: number): void => {
    busy++
    if (busy > originSummary.peakConcurrency) originSummary.peakConcurrency = busy
    const wait = t - job.arrivedAt
    log(t, job.requestId, 'origin_start', 'origin', 'origin', job.key, job.measured, `waited ${wait.toFixed(0)}ms`)
    q.schedule(t + config.originServiceMs, (te) => {
      busy--
      if (isOriginDown(te)) {
        log(te, job.requestId, 'request_failed', 'origin', 'origin', job.key, job.measured, 'Origin failure: job aborted (HTTP 503)')
        job.done(te, 'none', 'Origin failure: job aborted (HTTP 503)')
      } else {
        if (job.measured) {
          originSummary.fetches++
          originSummary.totalQueueWaitMs += wait
          originFetches.push({
            key: job.key,
            sizeKB: job.sizeKB,
            arrivedAt: job.arrivedAt,
            startedAt: t,
            finishedAt: te,
            queueWaitMs: wait,
            requestedBy: job.requestedBy,
          })
        }
        log(te, job.requestId, 'origin_done', 'origin', 'origin', job.key, job.measured)
        job.done(te, 'origin')
      }
      const next = originQueue.shift()
      if (next) startJob(next, te)
    })
  }

  const originFetch = (
    t: number,
    req: SimRequest,
    requestedBy: LayerName,
    done: Done,
  ): void => {
    if (isOriginDown(t)) {
      log(t, req.id, 'request_failed', 'origin', 'origin', req.key, req.phase === 'measured', 'Origin offline (HTTP 503 Service Unavailable)')
      done(t, 'none', 'Origin offline (HTTP 503 Service Unavailable)')
      return
    }
    const job: OriginJob = {
      key: req.key,
      sizeKB: req.sizeKB,
      measured: req.phase === 'measured',
      requestedBy,
      arrivedAt: t,
      done,
      requestId: req.id,
    }
    if (busy < config.originConcurrency) {
      startJob(job, t)
    } else {
      originQueue.push(job)
      if (job.measured && originQueue.length > originSummary.maxQueueDepth)
        originSummary.maxQueueDepth = originQueue.length
      log(t, req.id, 'origin_queued', 'origin', 'origin', req.key, job.measured, `queue depth ${originQueue.length}`)
    }
  }

  // ---- Cache lookup at one level of a request's path ----
  const lookup = (
    req: SimRequest,
    chain: CacheNode[],
    level: number,
    t: number,
    state: { collapsedAt: LayerName | null },
    done: Done,
  ): void => {
    const measured = req.phase === 'measured'
    if (level === chain.length) {
      // Past the last cache layer: check if partition from origin
      if (isFaultActiveAt(t) && fault.scenario === 'network_partition' && fault.partitionLink === 'shield_to_origin') {
        log(t, req.id, 'request_failed', 'shield', 'shield', req.key, measured, 'Network partition: origin unreachable (HTTP 504)')
        done(t, 'none', 'Network partition: origin unreachable (HTTP 504)')
        return
      }
      originFetch(t, req, chain[chain.length - 1].layer, done)
      return
    }
    const node = chain[level]

    // Check layer-specific faults
    if (node.layer === 'shared') {
      const isSharedDown = isFaultActiveAt(t) && fault.scenario === 'shared_failure' &&
        (fault.targetRegionIndex === -1 || fault.targetRegionIndex === node.index)
      const isEdgeSharedPartition = isFaultActiveAt(t) && fault.scenario === 'network_partition' &&
        fault.partitionLink === 'edge_to_shared'

      if (isSharedDown || isEdgeSharedPartition) {
        if (fault.fallbackPolicy === 'bypass') {
          const nextLevel = level + 1
          const nextRtt = nextLevel < chain.length ? config.rttMs[chain[nextLevel].layer] : config.rttMs.origin
          const nextId = nextLevel < chain.length ? chain[nextLevel].id : 'origin'
          log(t, req.id, 'fallback', node.layer, node.id, req.key, measured, isSharedDown ? 'Regional cache down -> bypassed upstream' : 'Partition active -> bypassed regional tier', nextId)
          q.schedule(t + nextRtt / 2, (tNext) => {
            lookup(req, chain, nextLevel, tNext, state, (tResp, servedBy, err) => {
              q.schedule(tResp + nextRtt / 2, (tBack) => {
                done(tBack, servedBy, err)
              })
            })
          })
          return
        } else {
          const reason = isSharedDown ? 'Regional cache offline (HTTP 502)' : 'Network partition: edge-to-shared unreachable (HTTP 504)'
          log(t, req.id, 'request_failed', node.layer, node.id, req.key, measured, reason)
          done(t, 'none', reason)
          return
        }
      }
    }

    if (node.layer === 'shield') {
      const isSharedShieldPartition = isFaultActiveAt(t) && fault.scenario === 'network_partition' &&
        fault.partitionLink === 'shared_to_shield'

      if (isSharedShieldPartition) {
        if (fault.fallbackPolicy === 'bypass') {
          log(t, req.id, 'fallback', 'shield', 'shield', req.key, measured, 'Partition active: shield bypassed to origin', 'origin')
          q.schedule(t + config.rttMs.origin / 2, (tOrigin) => {
            originFetch(tOrigin, req, 'shared', (tResp, servedBy, err) => {
              q.schedule(tResp + config.rttMs.origin / 2, (tBack) => {
                done(tBack, servedBy, err)
              })
            })
          })
          return
        } else {
          log(t, req.id, 'request_failed', 'shield', 'shield', req.key, measured, 'Network partition: shared-to-shield link down (HTTP 504)')
          done(t, 'none', 'Network partition: shared-to-shield link down (HTTP 504)')
          return
        }
      }
    }

    const st = node.stats
    const count = measured
    if (count) st.lookups++
    const result = node.cache.get(req.key, t)
    if (result === 'hit') {
      if (count) st.hits++
      log(t, req.id, 'hit', node.layer, node.id, req.key, measured)
      done(t, node.layer)
      return
    }
    if (count) {
      st.misses++
      if (result === 'expired') st.expiredMisses++
    }
    log(t, req.id, 'miss', node.layer, node.id, req.key, measured, result === 'expired' ? 'expired (TTL)' : undefined)

    let waiters: Done[] | null = null
    if (collapsing) {
      const role = node.inflight.join(req.key, done)
      if (role === 'follower') {
        if (count) st.collapsed++
        state.collapsedAt ??= node.layer
        log(t, req.id, 'collapsed', node.layer, node.id, req.key, measured, 'joined in-flight fetch')
        return
      }
    } else {
      waiters = [done]
    }

    if (count) st.forwarded++
    const nextRtt = level + 1 < chain.length ? config.rttMs[chain[level + 1].layer] : config.rttMs.origin
    const nextId = level + 1 < chain.length ? chain[level + 1].id : 'origin'
    log(t, req.id, 'forward', node.layer, node.id, req.key, measured, `-> ${nextId}`, nextId)
    q.schedule(t + nextRtt / 2, (tArrive) => {
      lookup(req, chain, level + 1, tArrive, state, (tResp, servedBy, error) => {
        q.schedule(tResp + nextRtt / 2, (tBack) => {
          if (servedBy !== 'none') {
            node.cache.set(req.key, req.sizeKB, tBack)
            if (count) st.fills++
            log(tBack, req.id, 'fill', node.layer, node.id, req.key, measured)
          }
          const list = collapsing ? node.inflight.complete(req.key) : (waiters as Done[])
          for (const w of list) w(tBack, servedBy, error)
        })
      })
    })
  }

  // ---- Schedule every request arrival (one heap, not one timer per request) ----
  for (const req of requests) {
    const measured = req.phase === 'measured'
    q.schedule(req.arrivalTime, (tArrive) => {
      log(tArrive, req.id, 'arrive', 'client', 'client', req.key, measured, `edge-${req.edgeIndex}`, `edge-${req.edgeIndex}`)
      const chain: CacheNode[] = path.map((layer) => nodes.get(nodeIdFor(layer, req.edgeIndex, config)) as CacheNode)
      const state = { collapsedAt: null as LayerName | null }

      const isEdgeDown = isFaultActiveAt(tArrive + config.rttMs.edge / 2) && fault.scenario === 'edge_failure' &&
        (fault.targetEdgeIndex === -1 || fault.targetEdgeIndex === req.edgeIndex)

      if (isEdgeDown) {
        if (fault.fallbackPolicy === 'bypass' && chain.length > 1) {
          // Failover to regional shared tier directly
          const nextNode = chain[1]
          const failoverRtt = config.rttMs.edge + config.rttMs[nextNode.layer]
          log(tArrive, req.id, 'fallback', 'edge', `edge-${req.edgeIndex}`, req.key, measured, 'Edge offline -> failover to regional shared cache', nextNode.id)
          q.schedule(tArrive + failoverRtt / 2, (tNext) => {
            lookup(req, chain, 1, tNext, state, (tDone, servedBy, error) => {
              q.schedule(tDone + failoverRtt / 2, (tClient) => {
                if (!measured) return
                const isSuccess = servedBy !== 'none'
                records.push({
                  id: req.id,
                  key: req.key,
                  edgeIndex: req.edgeIndex,
                  regionIndex: regionOf(req.edgeIndex, config.regionCount),
                  arrivalTime: req.arrivalTime,
                  completionTime: tClient,
                  latencyMs: tClient - req.arrivalTime,
                  servedBy,
                  status: isSuccess ? 'success' : 'failed',
                  error: isSuccess ? undefined : (error ?? 'Request failed'),
                  collapsed: state.collapsedAt !== null,
                  collapsedAt: state.collapsedAt,
                  sizeKB: req.sizeKB,
                })
                if (isSuccess) {
                  log(tClient, req.id, 'complete', 'client', 'client', req.key, true, `served by ${servedBy}`)
                } else {
                  log(tClient, req.id, 'request_failed', 'client', 'client', req.key, true, error ?? 'Request failed')
                }
              })
            })
          })
          return
        } else {
          // Fail-closed
          q.schedule(tArrive + config.rttMs.edge / 2, (tEdge) => {
            log(tEdge, req.id, 'request_failed', 'edge', `edge-${req.edgeIndex}`, req.key, measured, 'Edge offline (HTTP 502 Bad Gateway)')
            q.schedule(tEdge + config.rttMs.edge / 2, (tClient) => {
              if (!measured) return
              records.push({
                id: req.id,
                key: req.key,
                edgeIndex: req.edgeIndex,
                regionIndex: regionOf(req.edgeIndex, config.regionCount),
                arrivalTime: req.arrivalTime,
                completionTime: tClient,
                latencyMs: tClient - req.arrivalTime,
                servedBy: 'none',
                status: 'failed',
                error: 'Edge offline (HTTP 502 Bad Gateway)',
                collapsed: false,
                collapsedAt: null,
                sizeKB: req.sizeKB,
              })
              log(tClient, req.id, 'request_failed', 'client', 'client', req.key, true, 'Edge offline (HTTP 502 Bad Gateway)')
            })
          })
          return
        }
      }

      // Normal edge handling
      q.schedule(tArrive + config.rttMs.edge / 2, (tEdge) => {
        lookup(req, chain, 0, tEdge, state, (tDone, servedBy, error) => {
          q.schedule(tDone + config.rttMs.edge / 2, (tClient) => {
            if (!measured) return
            const isSuccess = servedBy !== 'none'
            records.push({
              id: req.id,
              key: req.key,
              edgeIndex: req.edgeIndex,
              regionIndex: regionOf(req.edgeIndex, config.regionCount),
              arrivalTime: req.arrivalTime,
              completionTime: tClient,
              latencyMs: tClient - req.arrivalTime,
              servedBy,
              status: isSuccess ? 'success' : 'failed',
              error: isSuccess ? undefined : (error ?? 'Request failed'),
              collapsed: state.collapsedAt !== null,
              collapsedAt: state.collapsedAt,
              sizeKB: req.sizeKB,
            })
            if (isSuccess) {
              log(tClient, req.id, 'complete', 'client', 'client', req.key, true, `served by ${servedBy}`)
            } else {
              log(tClient, req.id, 'request_failed', 'client', 'client', req.key, true, error ?? 'Request failed')
            }
          })
        })
      })
    })
  }

  q.runAll()

  // ---- Collect results ----
  const layers: Record<LayerName, LayerStats> = { edge: emptyStats(), shared: emptyStats(), shield: emptyStats() }
  const nodeStats: NodeStats[] = []
  for (const n of nodes.values()) {
    n.stats.evictions = n.cache.evictions
    nodeStats.push({ ...n.stats, nodeId: n.id, layer: n.layer, index: n.index })
    for (const k of Object.keys(n.stats) as (keyof LayerStats)[]) layers[n.layer][k] += n.stats[k]
  }
  records.sort((a, b) => a.id - b.id)
  const measuredRecords = records
  let startTime = measuredRecords.length ? Infinity : 0
  let endTime = 0
  for (const r of measuredRecords) {
    if (r.arrivalTime < startTime) startTime = r.arrivalTime
    if (r.completionTime > endTime) endTime = r.completionTime
  }

  return {
    config,
    records: measuredRecords,
    originFetches,
    layers,
    nodes: nodeStats,
    origin: originSummary,
    events,
    eventsTruncated,
    startTime,
    endTime,
  }
}
