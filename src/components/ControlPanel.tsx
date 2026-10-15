import { AlertTriangle, ChevronDown, Flame, Layers, Network, Server } from 'lucide-react'
import type { CachePolicy, FallbackPolicy, FaultScenario, PartitionLink, SimConfig } from '../simulation'

interface Props {
  config: SimConfig
  onChange: (c: SimConfig) => void
  errors: string[]
}

function Num({
  label,
  value,
  onChange,
  min,
  step = 1,
  unit,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  step?: number
  unit?: string
}) {
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      <div className="field-input-wrap">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          step={step}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        />
        {unit && <span className="unit-label">{unit}</span>}
      </div>
    </label>
  )
}

function Switch({
  label,
  checked,
  onChange,
  sub,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  sub?: string
}) {
  return (
    <label className="switch-row">
      <div className="switch-meta">
        <strong>{label}</strong>
        {sub && <span className="sub-tag">{sub}</span>}
      </div>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

export function ControlPanel({ config: c, onChange, errors }: Props) {
  const set = <K extends keyof SimConfig>(k: K, v: SimConfig[K]) => onChange({ ...c, [k]: v })
  const setFault = (f: Partial<SimConfig['fault']>) =>
    onChange({ ...c, fault: { ...c.fault, ...f } })

  const isFaultActive = c.fault.scenario !== 'none'

  return (
    <div className="controls">
      {/* Essential Quick Controls */}
      <div className="control-block">
        <div className="section-head">
          <span>Traffic Volume</span>
        </div>
        <div className="seg" role="radiogroup" aria-label="Request Volume">
          {[100, 1000, 10000].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={c.requestCount === n}
              className={c.requestCount === n ? 'active' : ''}
              onClick={() => set('requestCount', n)}
            >
              {n.toLocaleString()} reqs
            </button>
          ))}
        </div>
      </div>

      <div className="control-block">
        <div className="section-head">
          <Layers size={14} />
          <span>Core Architecture Features</span>
        </div>
        <div className="switches-grid">
          <Switch
            label="Single-Flight Coalescing"
            sub="Merge in-flight misses"
            checked={c.collapsingEnabled}
            onChange={(v) => set('collapsingEnabled', v)}
          />
          <Switch
            label="Origin Shield Tier"
            sub="Central miss consolidation"
            checked={c.shieldEnabled}
            onChange={(v) => set('shieldEnabled', v)}
          />
          <Switch
            label="Regional Shared Tier"
            sub="Cross-edge regional cache"
            checked={c.sharedTierEnabled}
            onChange={(v) => set('sharedTierEnabled', v)}
          />
          <Switch
            label="Warm Cache Pass"
            sub="Execute pre-fill phase"
            checked={c.warmCache}
            onChange={(v) => set('warmCache', v)}
          />
        </div>
      </div>

      {/* Fault Injection Section */}
      <div className={`control-block fault-block ${isFaultActive ? 'active-fault' : ''}`}>
        <div className="section-head">
          <Flame size={14} className={isFaultActive ? 'icon-chaos' : ''} />
          <span>Fault Injection &amp; Recovery</span>
          {isFaultActive && <span className="chaos-tag">CHAOS ACTIVE</span>}
        </div>

        <label className="field-row">
          <span className="field-label">Fault Scenario</span>
          <select
            value={c.fault.scenario}
            onChange={(e) => setFault({ scenario: e.target.value as FaultScenario })}
          >
            <option value="none">Normal Operation (Healthy)</option>
            <option value="origin_failure">Origin Failure (503 Outage)</option>
            <option value="edge_failure">Edge Cache Failure (PoP Outage)</option>
            <option value="shared_failure">Regional Shared Cache Failure</option>
            <option value="network_partition">Network Partition Between Tiers</option>
          </select>
        </label>

        {isFaultActive && (
          <div className="fault-options">
            <div className="grid-2col">
              <Num
                label="Failure Start"
                value={c.fault.startMs}
                min={0}
                unit="ms"
                onChange={(v) => setFault({ startMs: v })}
              />
              <Num
                label="Recovery Time"
                value={c.fault.endMs}
                min={c.fault.startMs}
                unit="ms"
                onChange={(v) => setFault({ endMs: v })}
              />
            </div>

            {c.fault.scenario === 'edge_failure' && (
              <label className="field-row">
                <span className="field-label">Target Edge</span>
                <select
                  value={c.fault.targetEdgeIndex}
                  onChange={(e) => setFault({ targetEdgeIndex: Number(e.target.value) })}
                >
                  <option value={-1}>All Edge Nodes</option>
                  {Array.from({ length: c.edgeCount }, (_, i) => (
                    <option key={i} value={i}>
                      Edge {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {c.fault.scenario === 'shared_failure' && (
              <label className="field-row">
                <span className="field-label">Target Regional Cache</span>
                <select
                  value={c.fault.targetRegionIndex}
                  onChange={(e) => setFault({ targetRegionIndex: Number(e.target.value) })}
                >
                  <option value={-1}>All Regional Caches</option>
                  {Array.from({ length: c.regionCount }, (_, i) => (
                    <option key={i} value={i}>
                      Region {i + 1} Shared Cache
                    </option>
                  ))}
                </select>
              </label>
            )}

            {c.fault.scenario === 'network_partition' && (
              <label className="field-row">
                <span className="field-label">Partition Link</span>
                <select
                  value={c.fault.partitionLink}
                  onChange={(e) => setFault({ partitionLink: e.target.value as PartitionLink })}
                >
                  <option value="edge_to_shared">Edge ↔ Regional Shared Tier</option>
                  <option value="shared_to_shield">Regional Tier ↔ Origin Shield</option>
                  <option value="shield_to_origin">Shield ↔ Central Origin Store</option>
                </select>
              </label>
            )}

            <label className="field-row">
              <span className="field-label">Fallback Routing</span>
              <select
                value={c.fault.fallbackPolicy}
                onChange={(e) => setFault({ fallbackPolicy: e.target.value as FallbackPolicy })}
              >
                <option value="bypass">Resilient Failover (Bypass to Upstream Tier)</option>
                <option value="fail">Fail-Closed (Drop requests at failure boundary)</option>
              </select>
            </label>

            <div className="fault-explainer">
              <small>
                {c.fault.scenario === 'origin_failure' &&
                  'Valid cached objects at edge/shared/shield serve 100% as hits. Uncached misses fail with HTTP 503.'}
                {c.fault.scenario === 'edge_failure' &&
                  (c.fault.fallbackPolicy === 'bypass'
                    ? 'Target edge cache offline. Requests failover to regional shared cache with latency penalty.'
                    : 'Target edge offline. Requests targeting this edge fail with HTTP 502 Bad Gateway.')}
                {c.fault.scenario === 'shared_failure' &&
                  'Regional shared cache offline. Edges bypass directly to Shield / Origin.'}
                {c.fault.scenario === 'network_partition' &&
                  'Partition isolates tiers. With failover, traffic routes around partition; otherwise uncached requests timeout.'}
              </small>
            </div>
          </div>
        )}
      </div>

      {/* Collapsible Advanced Technical Sections */}
      <details className="accordion-block">
        <summary className="accordion-summary">
          <Server size={14} />
          <span>Topology &amp; Cache Sizing</span>
          <ChevronDown size={14} className="chev" />
        </summary>
        <div className="accordion-content">
          <Num
            label="Edge Locations"
            min={3}
            value={c.edgeCount}
            onChange={(v) =>
              onChange({
                ...c,
                edgeCount: v,
                regionCount: Math.min(c.regionCount, v || 1),
                fault: {
                  ...c.fault,
                  targetEdgeIndex: Math.min(c.fault.targetEdgeIndex, (v || 1) - 1),
                },
              })
            }
          />
          <Num
            label="Regions"
            min={1}
            value={c.regionCount}
            onChange={(v) =>
              onChange({
                ...c,
                regionCount: v,
                fault: {
                  ...c.fault,
                  targetRegionIndex: Math.min(c.fault.targetRegionIndex, (v || 1) - 1),
                },
              })
            }
          />
          <label className="field-row">
            <span className="field-label">Eviction Policy</span>
            <select
              value={c.cachePolicy}
              onChange={(e) => set('cachePolicy', e.target.value as CachePolicy)}
            >
              <option value="LRU">LRU (Least Recently Used)</option>
              <option value="FIFO">FIFO (First In First Out)</option>
            </select>
          </label>
          <Num label="Edge Node Capacity" min={1} unit="objs" value={c.edgeCapacity} onChange={(v) => set('edgeCapacity', v)} />
          <Num label="Shared Cache Capacity" min={1} unit="objs" value={c.sharedCapacity} onChange={(v) => set('sharedCapacity', v)} />
          <Num label="Shield Capacity" min={1} unit="objs" value={c.shieldCapacity} onChange={(v) => set('shieldCapacity', v)} />
          <Num label="Object TTL" min={1} unit="ms" value={c.ttlMs} onChange={(v) => set('ttlMs', v)} />
        </div>
      </details>

      <details className="accordion-block">
        <summary className="accordion-summary">
          <Network size={14} />
          <span>Workload &amp; Network Telemetry</span>
          <ChevronDown size={14} className="chev" />
        </summary>
        <div className="accordion-content">
          <Num label="Arrival Rate" min={1} unit="req/s" value={c.arrivalRatePerSec} onChange={(v) => set('arrivalRatePerSec', v)} />
          <Num label="Catalog Size" min={1} unit="objs" value={c.catalogSize} onChange={(v) => set('catalogSize', v)} />
          <Num label="Zipf Popularity Skew" min={0} step={0.1} value={c.zipfSkew} onChange={(v) => set('zipfSkew', v)} />
          <Num label="Unique Key Ratio" min={0} step={0.05} value={c.uniqueKeyRatio} onChange={(v) => set('uniqueKeyRatio', v)} />
          <Num label="Hot Object Share" min={0} step={0.05} value={c.hotObjectShare} onChange={(v) => set('hotObjectShare', v)} />
          <Num label="Edge Traffic Skew" min={0} step={0.1} value={c.edgeSkew} onChange={(v) => set('edgeSkew', v)} />
          <Num label="Random Seed" value={c.seed} onChange={(v) => set('seed', v)} />
          <div className="divider" />
          <Num label="Origin Service Latency" min={0} unit="ms" value={c.originServiceMs} onChange={(v) => set('originServiceMs', v)} />
          <Num label="Origin Concurrency Slots" min={1} unit="slots" value={c.originConcurrency} onChange={(v) => set('originConcurrency', v)} />
          <Num label="Edge RTT" min={0} unit="ms" value={c.rttMs.edge} onChange={(v) => onChange({ ...c, rttMs: { ...c.rttMs, edge: v } })} />
          <Num label="Shared Tier RTT" min={0} unit="ms" value={c.rttMs.shared} onChange={(v) => onChange({ ...c, rttMs: { ...c.rttMs, shared: v } })} />
          <Num label="Shield RTT" min={0} unit="ms" value={c.rttMs.shield} onChange={(v) => onChange({ ...c, rttMs: { ...c.rttMs, shield: v } })} />
          <Num label="Origin RTT" min={0} unit="ms" value={c.rttMs.origin} onChange={(v) => onChange({ ...c, rttMs: { ...c.rttMs, origin: v } })} />
        </div>
      </details>

      {errors.length > 0 && (
        <div className="errors" role="alert">
          <div className="error-title">
            <AlertTriangle size={14} />
            <strong>Invalid Configuration:</strong>
          </div>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
