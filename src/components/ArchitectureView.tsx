import { layerPath, nodeIdFor, regionOf, type SimConfig, type SimEvent } from '../simulation'
import type { ActiveFaultState, NodeCounts } from './useReplay'

interface Props {
  config: SimConfig
  counts: Record<string, NodeCounts>
  /** The most recent events already replayed; used only to highlight nodes and links. */
  recent: SimEvent[]
  busy: number
  /** Origin fetches completed so far in the replay. */
  originDone: number
  /** Active fault state during replay. */
  activeFault?: ActiveFaultState | null
}

const W = 1040
const H = 480
const COL = { users: 65, edge: 275, shared: 545, shield: 765, origin: 955 }
const ZERO: NodeCounts = { hit: 0, miss: 0, collapsed: 0, forward: 0, failures: 0 }

interface Box { id: string; x: number; y: number; w: number; h: number; title: string }

export function ArchitectureView({ config: c, counts, recent, busy, originDone, activeFault }: Props) {
  const top = 70
  const step = (H - top - 25) / c.edgeCount
  const ey = (i: number) => top + step * (i + 0.5)
  const eh = Math.min(60, step - 6)
  const mid = H / 2 + 20

  const boxes = new Map<string, Box>()
  boxes.set('client', { id: 'client', x: COL.users, y: mid, w: 105, h: 74, title: 'Clients / Users' })
  for (let i = 0; i < c.edgeCount; i++) {
    boxes.set(`edge-${i}`, { id: `edge-${i}`, x: COL.edge, y: ey(i), w: 205, h: eh, title: `Edge ${i + 1} (Region ${regionOf(i, c.regionCount) + 1})` })
  }
  if (c.sharedTierEnabled) {
    for (let r = 0; r < c.regionCount; r++) {
      const ys = Array.from({ length: c.edgeCount }, (_, i) => i).filter((i) => regionOf(i, c.regionCount) === r).map(ey)
      boxes.set(`shared-${r}`, { id: `shared-${r}`, x: COL.shared, y: ys.reduce((a, b) => a + b, 0) / ys.length, w: 205, h: 54, title: `Regional Shared Cache ${r + 1}` })
    }
  }
  if (c.shieldEnabled) {
    boxes.set('shield', { id: 'shield', x: COL.shield, y: mid, w: 135, h: 74, title: 'Origin Shield' })
  }
  boxes.set('origin', { id: 'origin', x: COL.origin, y: mid, w: 155, h: 94, title: 'Object Store (Origin)' })

  // Active fault matching
  const isNodeFailed = (id: string): boolean => {
    if (!activeFault) return false
    if (activeFault.nodeId === id) return true
    if (activeFault.nodeId === 'edge-all' && id.startsWith('edge-')) return true
    if (activeFault.nodeId === 'shared-all' && id.startsWith('shared-')) return true
    return false
  }

  const isLinkPartitioned = (source: string, target: string): boolean => {
    if (!activeFault) return false
    const link = activeFault.nodeId
    if (link === 'edge_to_shared' && source.startsWith('edge-') && target.startsWith('shared-')) return true
    if (link === 'shared_to_shield' && source.startsWith('shared-') && target === 'shield') return true
    if (link === 'shield_to_origin' && source === 'shield' && target === 'origin') return true
    return false
  }

  // Links come from the architecture topology
  const path = layerPath(c)
  const links = new Set<string>()
  for (let i = 0; i < c.edgeCount; i++) {
    const ids = ['client', ...path.map((l) => nodeIdFor(l, i, c)), 'origin']
    for (let k = 0; k + 1 < ids.length; k++) links.add(`${ids[k]}>${ids[k + 1]}`)
  }

  // Highlights derived only from replayed events
  const nodeKind = new Map<string, string>()
  const activeLinks = new Set<string>()
  for (const e of recent) {
    nodeKind.set(e.nodeId, e.kind.startsWith('origin') ? 'origin' : e.kind)
    if ((e.kind === 'forward' || e.kind === 'arrive' || e.kind === 'fallback') && e.target) {
      activeLinks.add(`${e.nodeId}>${e.target}`)
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" className="arch" aria-label="CDN topology: clients, edge locations, regional caches, shield, origin">
      {([['Clients', COL.users], ['Edge Locations', COL.edge], ['Regional Shared Tier', COL.shared], ['Origin Shield', COL.shield], ['Central Origin', COL.origin]] as const).map(([t, x]) => (
        <text key={t} x={x} y={26} textAnchor="middle" className="colhead">{t}</text>
      ))}

      {!c.sharedTierEnabled && <GhostBox x={COL.shared} y={mid} label="Shared Tier Disabled" sub="Bypassed by edges" />}
      {!c.shieldEnabled && <GhostBox x={COL.shield} y={mid} label="Shield Disabled" sub="Direct to origin" />}

      {[...links].map((k) => {
        const [a, b] = k.split('>')
        const A = boxes.get(a)
        const B = boxes.get(b)
        if (!A || !B) return null
        const x1 = A.x + A.w / 2
        const x2 = B.x - B.w / 2
        const partitioned = isLinkPartitioned(a, b)
        const active = activeLinks.has(k)
        return (
          <g key={k}>
            <line
              x1={x1} y1={A.y} x2={x2} y2={B.y}
              className={`link ${active ? 'active' : ''} ${partitioned ? 'partitioned' : ''}`}
            />
            {partitioned && (
              <text x={(x1 + x2) / 2} y={(A.y + B.y) / 2 - 6} textAnchor="middle" className="part-tag">PARTITIONED</text>
            )}
          </g>
        )
      })}

      {[...boxes.values()].map((b) => {
        const n = counts[b.id] ?? ZERO
        const kind = nodeKind.get(b.id)
        const failed = isNodeFailed(b.id)
        const isCache = b.id !== 'client' && b.id !== 'origin'
        const small = b.h < 44

        return (
          <g
            key={b.id}
            className={`node ${kind ?? ''} ${failed ? 'node-failed' : ''}`}
            transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`}
          >
            <rect width={b.w} height={b.h} rx={8} />
            {failed && (
              <rect width={b.w} height={b.h} rx={8} className="node-failed-pulse" />
            )}
            <text x={b.w / 2} y={small ? b.h / 2 + 4 : 18} textAnchor="middle" className="nt">
              {small ? `${b.title} ${n.hit}H/${n.miss}M` : b.title}
            </text>

            {failed && (
              <text x={b.w / 2} y={b.h / 2 + 5} textAnchor="middle" className="fail-badge">
                [OFFLINE / FAILED]
              </text>
            )}

            {!failed && !small && isCache && b.w >= 170 && (
              <text x={b.w / 2} y={b.h - 10} textAnchor="middle" className="ns">
                {`${n.hit} hits · ${n.miss} misses${n.collapsed ? ` · ${n.collapsed} merged` : ''}${n.failures ? ` · ${n.failures} err` : ''}`}
              </text>
            )}
            {!failed && !small && isCache && b.w < 170 && (
              <>
                <text x={b.w / 2} y={40} textAnchor="middle" className="ns">{`${n.hit} hits · ${n.miss} misses`}</text>
                <text x={b.w / 2} y={57} textAnchor="middle" className="ns">{`${n.collapsed} merged`}</text>
              </>
            )}
            {!failed && b.id === 'origin' && (
              <>
                <text x={b.w / 2} y={50} textAnchor="middle" className="ns">{`Concurrency: ${busy}/${c.originConcurrency}`}</text>
                <text x={b.w / 2} y={68} textAnchor="middle" className="ns">{`${originDone} fetches complete`}</text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function GhostBox({ x, y, label, sub }: { x: number; y: number; label: string; sub: string }) {
  return (
    <g className="ghost" transform={`translate(${x - 68},${y - 30})`}>
      <rect width={136} height={60} rx={8} />
      <text x={68} y={26} textAnchor="middle" className="nt">{label}</text>
      <text x={68} y={44} textAnchor="middle" className="ns">{sub}</text>
    </g>
  )
}
