interface Scheduled {
  time: number
  seq: number
  run: (time: number) => void
}

/**
 * Min-heap priority queue of timed callbacks. Ties on time are broken by insertion order,
 * so runs are fully deterministic. One queue drives the whole simulation (no timer per request).
 */
export class EventQueue {
  private heap: Scheduled[] = []
  private counter = 0
  now = 0
  processed = 0

  get size(): number {
    return this.heap.length
  }

  schedule(time: number, run: (time: number) => void): void {
    this.heap.push({ time, seq: this.counter++, run })
    this.siftUp(this.heap.length - 1)
  }

  /** Process events in time order until empty. `maxEvents` is a safety valve against runaway loops. */
  runAll(maxEvents = 20_000_000): void {
    while (this.heap.length > 0) {
      if (this.processed >= maxEvents) throw new Error('Simulation exceeded max event budget')
      const ev = this.pop()
      this.now = ev.time
      this.processed++
      ev.run(ev.time)
    }
  }

  private less(a: Scheduled, b: Scheduled): boolean {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq)
  }

  private pop(): Scheduled {
    const top = this.heap[0]
    const last = this.heap.pop() as Scheduled
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.siftDown(0)
    }
    return top
  }

  private siftUp(i: number): void {
    const h = this.heap
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(h[i], h[p])) break
      ;[h[i], h[p]] = [h[p], h[i]]
      i = p
    }
  }

  private siftDown(i: number): void {
    const h = this.heap
    const n = h.length
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let s = i
      if (l < n && this.less(h[l], h[s])) s = l
      if (r < n && this.less(h[r], h[s])) s = r
      if (s === i) break
      ;[h[i], h[s]] = [h[s], h[i]]
      i = s
    }
  }
}
