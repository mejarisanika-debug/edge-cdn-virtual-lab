import type { LayerName, SimConfig } from './types'

/**
 * Topology rules for the teaching model.
 *
 *   client -> edge[i] -> shared[region(i)] -> shield -> origin
 *
 * - Edge i belongs to region (i % regionCount). Each region has ONE shared (regional) cache,
 *   shared by all edges of that region.
 * - The origin shield is ONE central node in front of the origin, shared by all regions.
 * - Disabling the shared tier or the shield removes that layer from every request path.
 *
 * Why the shield matters here: with several regions, each regional cache would otherwise go to the
 * origin on its own. The shield sits above all regions, so a miss in region A can be answered by
 * (or share an in-flight fetch with) a miss from region B.
 */
export function regionOf(edgeIndex: number, regionCount: number): number {
  return edgeIndex % regionCount
}

export function layerPath(cfg: SimConfig): LayerName[] {
  const path: LayerName[] = ['edge']
  if (cfg.sharedTierEnabled) path.push('shared')
  if (cfg.shieldEnabled) path.push('shield')
  return path
}

export function nodeIdFor(layer: LayerName, edgeIndex: number, cfg: SimConfig): string {
  if (layer === 'edge') return `edge-${edgeIndex}`
  if (layer === 'shared') return `shared-${regionOf(edgeIndex, cfg.regionCount)}`
  return 'shield'
}
