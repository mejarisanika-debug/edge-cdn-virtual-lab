import { Activity, Eraser, Pin, Play, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ControlPanel } from './components/ControlPanel'
import { MetricsDashboard, type RunSnapshot } from './components/MetricsDashboard'
import { ArchitectureView } from './components/ArchitectureView'
import { HowItWorks } from './components/HowItWorks'
import { ReplayPanel } from './components/ReplayPanel'
import {
  DEFAULT_CONFIG,
  PRESETS,
  computeMetrics,
  presetConfig,
  runSimulation,
  sameWorkload,
  validateConfig,
  type SimConfig,
  type SimEvent,
} from './simulation'

interface ReplayData {
  events: SimEvent[]
  truncated: boolean
  durationMs: number
  key: number
}

export default function App() {
  const [config, setConfig] = useState<SimConfig>(DEFAULT_CONFIG)
  const [presetId, setPresetId] = useState<string | null>(null)
  const [current, setCurrent] = useState<RunSnapshot | null>(null)
  const [baseline, setBaseline] = useState<RunSnapshot | null>(null)
  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const errors = useMemo(() => validateConfig(config), [config])
  const preset = PRESETS.find((p) => p.id === presetId)

  const edit = (c: SimConfig) => {
    setConfig(c)
    setPresetId(null)
  }

  const pick = (id: string) => {
    setConfig(presetConfig(id))
    setPresetId(id)
  }

  const run = () => {
    setBusy(true)
    setFailure(null)
    // Yield to the browser so the "Running…" state paints before the synchronous simulation.
    setTimeout(() => {
      try {
        const result = runSimulation(config, { maxLoggedEvents: 150_000 })
        const metrics = computeMetrics(result)
        setReplay((p) => ({
          events: result.events,
          truncated: result.eventsTruncated,
          durationMs: result.endTime - result.startTime,
          key: (p?.key ?? 0) + 1,
        }))
        const label = preset?.name ?? 'Custom Configuration'
        const chaosNote = config.fault.scenario !== 'none' ? ` · chaos: ${config.fault.scenario}` : ''
        setCurrent({
          metrics,
          config,
          label: `${label} · collapsing ${config.collapsingEnabled ? 'ON' : 'OFF'}, shield ${config.shieldEnabled ? 'ON' : 'OFF'}${chaosNote}`,
        })
      } catch (e) {
        setFailure(e instanceof Error ? e.message : String(e))
      }
      setBusy(false)
    }, 20)
  }

  const reset = () => {
    setConfig(DEFAULT_CONFIG)
    setPresetId(null)
    setCurrent(null)
    setBaseline(null)
    setReplay(null)
    setFailure(null)
  }

  const standardPresets = PRESETS.filter((p) => !p.id.startsWith('fault_'))
  const chaosPresets = PRESETS.filter((p) => p.id.startsWith('fault_'))

  return (
    <>
      <header className="top">
        <div className="brand-title">
          <Activity size={22} color="#38bdf8" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1>Edge CDN Cache Virtual Lab</h1>
              <span className="brand-badge">SYSTEM DESIGN LAB</span>
            </div>
            <p>
              Deterministic simulation of multi-tier edge caching, request collapsing, origin shielding, and chaos fault recovery.
            </p>
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={run} disabled={busy || errors.length > 0}>
            <Play size={15} aria-hidden /> {busy ? 'Simulating…' : 'Run Simulation'}
          </button>
          <button
            onClick={() => current && setBaseline(current)}
            disabled={!current}
            title="Pin this run as baseline for comparison"
          >
            <Pin size={15} aria-hidden /> Pin Baseline
          </button>
          <button onClick={() => setBaseline(null)} disabled={!baseline}>
            <Eraser size={15} aria-hidden /> Clear Baseline
          </button>
          <button onClick={reset}>
            <RotateCcw size={15} aria-hidden /> Reset
          </button>
        </div>
      </header>

      <main className="layout">
        <aside aria-label="Configuration">
          <div className="sidebar-head">
            <h2>Experiment Presets</h2>
          </div>
          <div className="presets-container">
            <span className="presets-category-title">Standard Workloads</span>
            <div className="presets">
              {standardPresets.map((p) => (
                <button
                  key={p.id}
                  className={p.id === presetId ? 'active' : ''}
                  aria-pressed={p.id === presetId}
                  onClick={() => pick(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>

            <span className="presets-category-title">Chaos &amp; Recovery Labs</span>
            <div className="presets">
              {chaosPresets.map((p) => (
                <button
                  key={p.id}
                  className={`preset-chaos ${p.id === presetId ? 'active' : ''}`}
                  aria-pressed={p.id === presetId}
                  onClick={() => pick(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {preset && (
            <div className="preset-note">
              <p><strong>Scenario:</strong> {preset.summary}</p>
              <p><strong>System Design Takeaway:</strong> {preset.expectation}</p>
            </div>
          )}

          <ControlPanel config={config} onChange={edit} errors={errors} />
        </aside>

        <div className="results">
          {failure && <p className="warn" role="alert">{failure}</p>}

          {current && replay ? (
            <ReplayPanel
              key={replay.key}
              config={current.config}
              events={replay.events}
              truncated={replay.truncated}
              durationMs={replay.durationMs}
              totalRequests={current.metrics.totalRequests}
            />
          ) : (
            <section className="panel hero-panel" aria-label="Architecture preview">
              <div className="panel-header">
                <div>
                  <h2>Architecture Topology Live Preview</h2>
                  <p className="muted">
                    Configure caching tiers, origin parameters, or inject simulated faults in the left panel. Press <strong>Run Simulation</strong> to execute request flow.
                  </p>
                </div>
              </div>
              <ArchitectureView config={config} counts={{}} recent={[]} busy={0} originDone={0} />
            </section>
          )}

          {current ? (
            <MetricsDashboard
              current={current}
              baseline={baseline}
              fair={baseline ? sameWorkload(baseline.config, current.config) : true}
            />
          ) : (
            <div className="empty">
              <h2>Simulation Ready</h2>
              <p>
                Select an experiment preset or configure custom parameters, then click <strong>Run Simulation</strong>. Pin a healthy run as baseline, inject chaos faults, and evaluate system availability and latency impact.
              </p>
            </div>
          )}

          <HowItWorks />
        </div>
      </main>
    </>
  )
}
