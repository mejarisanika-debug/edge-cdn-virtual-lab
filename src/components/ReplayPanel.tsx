import { Pause, Play, RotateCcw, SkipBack, SkipForward, StepForward } from 'lucide-react'
import type { SimConfig, SimEvent } from '../simulation'
import { ArchitectureView } from './ArchitectureView'
import { EventLog } from './EventLog'
import { SPEEDS, useReplay } from './useReplay'

interface Props {
  config: SimConfig
  events: SimEvent[]
  truncated: boolean
  durationMs: number
  totalRequests: number
}

/** Replays the recorded events of the last run. Mount with a new `key` per run to reset it. */
export function ReplayPanel({ config, events, truncated, durationMs, totalRequests }: Props) {
  const r = useReplay(events, durationMs)
  const recent = events.slice(Math.max(0, r.view.idx - 40), r.view.idx)
  const log = events.slice(Math.max(0, r.view.idx - 16), r.view.idx)
  const done = r.view.idx >= r.total

  return (
    <section className="panel hero-panel" aria-label="Architecture and request replay">
      <div className="panel-header">
        <div>
          <h2>Architecture Topology &amp; Request Flow</h2>
          <p className="muted">
            Live deterministic replay: <span className="legend-tag hit">Hit</span>, <span className="legend-tag miss">Miss</span>, <span className="legend-tag collapsed">Single-Flight</span>, <span className="legend-tag origin">Origin Fetch</span>, <span className="legend-tag fault">Fault / Drop</span>.
          </p>
        </div>
        <div className="replaybar">
          <button className="primary" onClick={r.toggle}>
            {r.playing ? <><Pause size={15} aria-hidden /> Pause</> : <><Play size={15} aria-hidden /> {done ? 'Replay' : 'Play'}</>}
          </button>
          <button onClick={r.step} disabled={done} title="Advance one event"><StepForward size={15} aria-hidden /> Step</button>
          <button onClick={r.restart} title="Restart replay"><RotateCcw size={15} aria-hidden /> Restart</button>
          <button onClick={r.end} disabled={done} title="Jump to end"><SkipForward size={15} aria-hidden /> End</button>
          <label className="speed">
            <span>Speed</span>
            <select value={r.speed} onChange={(e) => r.setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="scrub-container">
        <label className="scrub">
          <SkipBack size={13} aria-hidden />
          <input
            type="range"
            min={0}
            max={r.total}
            value={r.view.idx}
            onChange={(e) => r.seek(Number(e.target.value))}
            aria-label="Replay position"
          />
          <span className="mono-time">{r.view.time.toFixed(0)} ms</span>
        </label>
        <div className="replay-stats">
          <span>Inflight: <strong>{r.view.arrived.toLocaleString()} / {totalRequests.toLocaleString()}</strong></span>
          <span>Completed: <strong className="text-ok">{r.view.completed.toLocaleString()}</strong></span>
          {r.view.failed > 0 && <span>Failed: <strong className="text-bad">{r.view.failed.toLocaleString()}</strong></span>}
          <span>Events: <strong>{r.view.idx.toLocaleString()} / {r.total.toLocaleString()}</strong></span>
        </div>
      </div>

      <ArchitectureView
        config={config}
        counts={r.view.counts}
        recent={recent}
        busy={r.view.busy}
        originDone={r.view.originDone}
        activeFault={r.view.activeFault}
      />

      <EventLog events={log} total={r.total} truncated={truncated} />
    </section>
  )
}
