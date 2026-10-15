import { useCallback, useEffect, useRef, useState } from 'react'
import type { SimEvent } from '../simulation'

export interface NodeCounts { hit: number; miss: number; collapsed: number; forward: number; failures: number }
export interface ActiveFaultState {
  nodeId: string
  detail?: string
}

export interface ReplayView {
  idx: number
  counts: Record<string, NodeCounts>
  busy: number
  originDone: number
  completed: number
  failed: number
  arrived: number
  time: number
  activeFault: ActiveFaultState | null
}

export const SPEEDS = [1, 5, 25, 100, 500]
const blank = (): ReplayView => ({
  idx: 0,
  counts: {},
  busy: 0,
  originDone: 0,
  completed: 0,
  failed: 0,
  arrived: 0,
  time: 0,
  activeFault: null,
})

/** Fastest-first-fit default so a replay lasts roughly 12 real seconds or less. */
export function defaultSpeed(durationMs: number): number {
  return SPEEDS.find((m) => durationMs / m <= 12_000) ?? SPEEDS[SPEEDS.length - 1]
}

function upperBound(events: SimEvent[], t: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].t <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Replays recorded simulation events against a simulated clock using ONE requestAnimationFrame loop
 * (no timer per request). Counters and fault states are rebuilt deterministically from the events.
 */
export function useReplay(events: SimEvent[], durationMs: number) {
  const [view, setView] = useState<ReplayView>(blank)
  const [playing, setPlaying] = useState(events.length > 0)
  const [speed, setSpeed] = useState(() => defaultSpeed(durationMs))
  const work = useRef<ReplayView>(blank())
  const simTime = useRef(events[0]?.t ?? 0)
  const total = events.length

  const apply = useCallback(
    (target: number) => {
      let w = work.current
      if (target < w.idx) w = blank()
      for (let i = w.idx; i < target; i++) {
        const e = events[i]
        if (e.kind === 'hit' || e.kind === 'miss' || e.kind === 'collapsed' || e.kind === 'forward') {
          const c = (w.counts[e.nodeId] ??= { hit: 0, miss: 0, collapsed: 0, forward: 0, failures: 0 })
          c[e.kind]++
        } else if (e.kind === 'origin_start') {
          w.busy++
        } else if (e.kind === 'origin_done') {
          w.busy--
          w.originDone++
        } else if (e.kind === 'complete') {
          w.completed++
        } else if (e.kind === 'arrive') {
          w.arrived++
        } else if (e.kind === 'request_failed') {
          w.failed++
          if (e.nodeId) {
            const c = (w.counts[e.nodeId] ??= { hit: 0, miss: 0, collapsed: 0, forward: 0, failures: 0 })
            c.failures++
          }
        } else if (e.kind === 'fault_start') {
          w.activeFault = { nodeId: e.nodeId, detail: e.detail }
        } else if (e.kind === 'recovery') {
          w.activeFault = null
        }
      }
      w.idx = target
      w.time = target > 0 ? events[target - 1].t : 0
      work.current = w
      const counts: Record<string, NodeCounts> = {}
      for (const [k, v] of Object.entries(w.counts)) counts[k] = { ...v }
      setView({ ...w, counts })
    },
    [events],
  )

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      simTime.current += (now - last) * speed
      last = now
      const target = upperBound(events, simTime.current)
      if (target !== work.current.idx) apply(target)
      if (target >= events.length) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, events, apply])

  const seek = useCallback((k: number) => {
    const target = Math.max(0, Math.min(total, k))
    simTime.current = target > 0 ? events[target - 1].t : (events[0]?.t ?? 0)
    apply(target)
  }, [apply, events, total])

  return {
    view, total, playing, speed, setSpeed,
    toggle: () => {
      if (!playing && work.current.idx >= total) seek(0)
      setPlaying((p) => !p)
    },
    step: () => { setPlaying(false); seek(work.current.idx + 1) },
    restart: () => { seek(0); setPlaying(true) },
    end: () => { setPlaying(false); seek(total) },
    seek,
  }
}
