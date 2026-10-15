import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Metrics, SimConfig } from '../simulation'

export interface RunSnapshot { metrics: Metrics; config: SimConfig; label: string }

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`)
const ms = (v: number) => `${v.toFixed(0)} ms`
const kb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(1)} MB` : `${v.toFixed(0)} KB`)

function Kpi({
  title,
  value,
  sub,
  delta,
  status = 'neutral',
}: {
  title: string
  value: string
  sub: string
  delta?: string
  status?: 'ok' | 'bad' | 'neutral'
}) {
  return (
    <div className={`kpi ${status !== 'neutral' ? `kpi-${status}` : ''}`}>
      <span className="kpi-t">{title}</span>
      <strong>{value}</strong>
      {delta && <span className={`delta ${delta.startsWith('−') ? 'delta-neg' : 'delta-pos'}`}>{delta}</span>}
      <small>{sub}</small>
    </div>
  )
}

function interpret(m: Metrics, c: SimConfig): string[] {
  const out: string[] = []

  if (m.failedRequests > 0) {
    out.push(
      `Chaos Fault Impact: System achieved ${pct(m.availabilityPct / 100)} availability (${m.successfulRequests.toLocaleString()} succeeded, ${m.failedRequests.toLocaleString()} dropped). Failed requests averaged ${m.avgFailedLatencyMs ? ms(m.avgFailedLatencyMs) : '0 ms'} before termination.`
    )
  } else {
    out.push(`Steady State: 100% availability across ${m.totalRequests.toLocaleString()} requests without drops or upstream timeouts.`)
  }

  out.push(
    `Cache Offload: ${pct(m.cacheHitRatio)} answered from cache tiers (${pct(m.originOffloadRatio)} origin fetch avoidance). The origin served ${m.originFetches.toLocaleString()} fetches.`
  )

  if (c.collapsingEnabled) {
    out.push(
      m.collapsedRequests > 0
        ? `Single-Flight: Coalesced ${m.collapsedRequests.toLocaleString()} concurrent misses into active in-flight fetches.`
        : 'Single-Flight: Enabled; zero concurrent key overlaps detected during execution window.'
    )
  }

  if (c.fault.scenario !== 'none') {
    const f = c.fault
    if (f.scenario === 'origin_failure') {
      out.push(
        `Disaster Tolerance: Origin was offline from ${f.startMs}ms to ${f.endMs}ms. Cached objects remained available; uncached misses failed with HTTP 503.`
      )
    } else if (f.scenario === 'edge_failure') {
      out.push(
        `Edge Resilience: Target edge was offline from ${f.startMs}ms to ${f.endMs}ms (${f.fallbackPolicy === 'bypass' ? 'rerouted to regional tier' : 'failed-closed'}).`
      )
    } else if (f.scenario === 'shared_failure') {
      out.push(
        `Tier Bypass: Regional cache offline from ${f.startMs}ms to ${f.endMs}ms; traffic bypassed directly to Shield/Origin.`
      )
    } else if (f.scenario === 'network_partition') {
      out.push(
        `Partition Tolerance: Link [${f.partitionLink}] partitioned from ${f.startMs}ms to ${f.endMs}ms.`
      )
    }
  }

  return out
}

export function MetricsDashboard({
  current,
  baseline,
  fair,
}: {
  current: RunSnapshot
  baseline: RunSnapshot | null
  fair: boolean
}) {
  const m = current.metrics
  const b = baseline && baseline !== current ? baseline.metrics : null
  const d = (
    cur: number,
    base: number | undefined,
    f: (n: number) => string,
    unit = ''
  ) => {
    if (!b || base === undefined) return undefined
    const diff = cur - base
    const sign = diff >= 0 ? '+' : '−'
    return `${sign}${f(Math.abs(diff))}${unit} vs baseline`
  }

  const served = [
    { name: 'Edge', Current: m.servedBy.edge, ...(b ? { Baseline: b.servedBy.edge } : {}) },
    { name: 'Shared', Current: m.servedBy.shared, ...(b ? { Baseline: b.servedBy.shared } : {}) },
    { name: 'Shield', Current: m.servedBy.shield, ...(b ? { Baseline: b.servedBy.shield } : {}) },
    { name: 'Origin', Current: m.servedBy.origin, ...(b ? { Baseline: b.servedBy.origin } : {}) },
    { name: 'Failed', Current: m.failedRequests, ...(b ? { Baseline: b.failedRequests } : {}) },
  ]

  const lat = [
    {
      name: 'Average',
      Current: Math.round(m.avgLatencyMs),
      ...(b ? { Baseline: Math.round(b.avgLatencyMs) } : {}),
    },
    {
      name: 'P95',
      Current: Math.round(m.p95LatencyMs),
      ...(b ? { Baseline: Math.round(b.p95LatencyMs) } : {}),
    },
    {
      name: 'Max',
      Current: Math.round(m.maxLatencyMs),
      ...(b ? { Baseline: Math.round(b.maxLatencyMs) } : {}),
    },
  ]

  const L = m.layers
  const rows = [
    ['Edge Tier', L.edge, true],
    ['Regional Tier', L.shared, current.config.sharedTierEnabled],
    ['Origin Shield', L.shield, current.config.shieldEnabled],
  ] as const

  return (
    <section aria-label="System Metrics" className="dash">
      <div className="dash-header">
        <p className="badge">Deterministic Telemetry · Run “{current.label}”</p>
        {b && !fair && (
          <p className="warn" role="alert">
            Baseline used different workload settings (traffic generator seeds differ).
          </p>
        )}
      </div>

      <div className="kpis">
        <Kpi
          title="Availability"
          value={pct(m.availabilityPct / 100)}
          delta={d(m.availabilityPct, b?.availabilityPct, (n) => n.toFixed(1), ' pts')}
          sub={`${m.successfulRequests.toLocaleString()} succeeded · ${m.failedRequests.toLocaleString()} failed`}
          status={m.failedRequests > 0 ? 'bad' : 'ok'}
        />
        <Kpi
          title="Cache Hit Ratio"
          value={pct(m.cacheHitRatio)}
          delta={d(m.cacheHitRatio * 100, b ? b.cacheHitRatio * 100 : undefined, (n) => n.toFixed(1), ' pts')}
          sub="Requests served from Edge, Shared or Shield"
        />
        <Kpi
          title="Origin Fetches"
          value={m.originFetches.toLocaleString()}
          delta={d(m.originFetches, b?.originFetches, (n) => n.toLocaleString())}
          sub={`${pct(m.originOffloadRatio)} origin offload`}
        />
        <Kpi
          title="Mean Latency"
          value={ms(m.avgLatencyMs)}
          delta={d(m.avgLatencyMs, b?.avgLatencyMs, (n) => n.toFixed(0), ' ms')}
          sub={`P95: ${ms(m.p95LatencyMs)} · Max: ${ms(m.maxLatencyMs)}`}
        />
        <Kpi
          title="Throughput"
          value={`${m.throughputRps.toFixed(0)} req/s`}
          sub={`${m.totalRequests.toLocaleString()} reqs in ${(m.durationMs / 1000).toFixed(1)}s`}
        />
        <Kpi
          title="Bandwidth Saved"
          value={pct(m.bytes.savedRatio)}
          sub={`${kb(m.bytes.savedKB)} cached of ${kb(m.bytes.deliveredKB)} delivered`}
        />
        <Kpi
          title="Origin Concurrency"
          value={`${m.origin.peakConcurrency} slots`}
          sub={`Queue Depth: ${m.origin.maxQueueDepth} (Wait: ${ms(m.origin.avgQueueWaitMs)})`}
        />
      </div>

      <div className="charts">
        <figure>
          <figcaption>Request Resolution by Tier (including Drops)</figcaption>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={served}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip />
              <Legend />
              <Bar dataKey="Current" fill="#2563eb" />
              {b && <Bar dataKey="Baseline" fill="#94a3b8" />}
            </BarChart>
          </ResponsiveContainer>
        </figure>

        <figure>
          <figcaption>Latency Distribution Profile (ms)</figcaption>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={lat}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip />
              <Legend />
              <Bar dataKey="Current" fill="#0891b2" />
              {b && <Bar dataKey="Baseline" fill="#94a3b8" />}
            </BarChart>
          </ResponsiveContainer>
        </figure>
      </div>

      <table className="layers">
        <caption>Tier Telemetry Breakdown</caption>
        <thead>
          <tr>
            <th>Cache Tier</th>
            <th>Lookups</th>
            <th>Hits</th>
            <th>Misses</th>
            <th>Hit Ratio</th>
            <th>Coalesced</th>
            <th>Forwarded</th>
            <th>TTL Expired</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([n, s, on]) => (
            <tr key={n} className={on ? '' : 'disabled'}>
              <th>{n}{on ? '' : ' (Disabled)'}</th>
              <td>{s.lookups.toLocaleString()}</td>
              <td>{s.hits.toLocaleString()}</td>
              <td>{s.misses.toLocaleString()}</td>
              <td>{on ? pct(s.hitRatio) : '—'}</td>
              <td>{s.collapsed.toLocaleString()}</td>
              <td>{s.forwarded.toLocaleString()}</td>
              <td>{s.expiredMisses.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="explain">
        <h3>System Telemetry Insights</h3>
        <ul>
          {interpret(m, current.config).map((t, idx) => (
            <li key={idx}>{t}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
