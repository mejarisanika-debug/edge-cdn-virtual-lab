import type { SimEvent } from '../simulation'

function describe(e: SimEvent): string {
  switch (e.kind) {
    case 'arrive': return `enters CDN at ${e.detail}`
    case 'hit': return `HIT at ${e.nodeId}: served from cache`
    case 'miss': return `MISS at ${e.nodeId}${e.detail ? ` (${e.detail})` : ''}`
    case 'collapsed': return `waits on in-flight fetch at ${e.nodeId} (single-flight merged)`
    case 'forward': return `${e.nodeId} forwards ${e.detail}`
    case 'fill': return `cached in ${e.nodeId}`
    case 'origin_queued': return `origin queue depth ${e.detail}`
    case 'origin_start': return `origin fetch started (${e.detail})`
    case 'origin_done': return 'origin finished object'
    case 'complete': return `delivered to client (${e.detail})`
    case 'fault_start': return `FAULT INJECTED: ${e.detail}`
    case 'recovery': return `RECOVERY: ${e.detail}`
    case 'request_failed': return `REQUEST FAILED: ${e.detail}`
    case 'fallback': return `FAILOVER: ${e.detail}`
  }
}

export function EventLog({ events, total, truncated }: { events: SimEvent[]; total: number; truncated: boolean }) {
  const shown = [...events].reverse()
  return (
    <div className="eventlog">
      <h3>Event Stream <small>(newest first · showing {shown.length} of {total.toLocaleString()} events)</small></h3>
      {truncated && <p className="warn">Event buffer capped for memory efficiency; metrics remain mathematically exact across all requests.</p>}
      <ol aria-label="Recent simulation events">
        {shown.length === 0 && <li className="muted">Simulation paused / pending events. Press Play or Step.</li>}
        {shown.map((e) => (
          <li key={e.seq} className={e.kind === 'fault_start' || e.kind === 'request_failed' ? 'event-error' : e.kind === 'recovery' ? 'event-recovery' : ''}>
            <span className="t">{e.t.toFixed(0)} ms</span>
            <span className={`pill ${e.kind.startsWith('origin') ? 'origin' : e.kind}`}>{e.kind.replace('_', ' ')}</span>
            <span>
              {e.requestId > 0 && <strong>#{e.requestId} </strong>}
              {e.key && <code>{e.key}</code>} {describe(e)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
