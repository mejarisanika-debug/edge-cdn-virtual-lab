/**
 * Request collapsing ("single-flight") table for ONE cache node.
 * Tracks in-flight upstream fetches per object key. Different keys never share an entry.
 */
export class InFlightTable<W> {
  private readonly m = new Map<string, W[]>()

  has(key: string): boolean {
    return this.m.has(key)
  }

  /**
   * Register a waiter for `key`.
   * @returns 'follower' if a fetch for this key was already in flight (waiter will reuse its result),
   *          'leader' if this waiter must send the upstream fetch itself.
   */
  join(key: string, waiter: W): 'leader' | 'follower' {
    const list = this.m.get(key)
    if (list) {
      list.push(waiter)
      return 'follower'
    }
    this.m.set(key, [waiter])
    return 'leader'
  }

  /** The fetch for `key` finished: return all waiters (leader first) and clear the entry. */
  complete(key: string): W[] {
    const list = this.m.get(key) ?? []
    this.m.delete(key)
    return list
  }

  get size(): number {
    return this.m.size
  }
}
