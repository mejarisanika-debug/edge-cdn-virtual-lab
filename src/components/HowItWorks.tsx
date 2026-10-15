export function HowItWorks() {
  return (
    <details className="panel howto">
      <summary><h2>Technical Architecture &amp; Fault Recovery Specification</h2></summary>
      <div className="howto-content">
        <section>
          <h3>Hierarchical Request Pipeline</h3>
          <p>
            <code>Client → Edge [i] → Regional Shared [region(i)] → Origin Shield → Central Origin</code>.
            Each tier performs deterministic cache lookup. A <strong>Cache Hit</strong> returns immediately without upstream traversal. A <strong>Cache Miss</strong> traverses upstream with tier-specific round-trip latency.
          </p>
        </section>

        <section>
          <h3>Core Mechanics</h3>
          <ul>
            <li><strong>Single-Flight Coalescing:</strong> Merges concurrent in-flight misses for identical keys at each tier, forwarding a single upstream fetch.</li>
            <li><strong>Tiered Cache Fill:</strong> Fills all visited caches on return path down the hierarchy with independent TTL timestamps.</li>
            <li><strong>Origin Queueing:</strong> FIFO service model with limited concurrency slots; excess fetches queue, introducing queueing delay.</li>
          </ul>
        </section>

        <section>
          <h3>Fault Injection &amp; Recovery Mechanics</h3>
          <ul>
            <li><strong>Origin Outage (HTTP 503):</strong> Valid cached objects at edge/shared/shield continue to serve as hits. Uncached misses reach the down origin and terminate as failed requests without corrupting cache state.</li>
            <li><strong>Edge Cache Failure:</strong> Local cache becomes unavailable. Under resilient failover, client requests bypass the dead edge to the regional shared cache. Under fail-closed mode, requests drop with HTTP 502.</li>
            <li><strong>Regional Tier Failure:</strong> Edge misses bypass the down regional tier directly to Origin Shield / Origin.</li>
            <li><strong>Network Partition:</strong> Isolates inter-tier links. Alternate upstream bypass routes around partition; un-routable requests terminate with HTTP 504.</li>
            <li><strong>Recovery:</strong> At recovery time, components re-enter online state and resume normal lookups and cache fills.</li>
          </ul>
        </section>

        <section>
          <h3>Mathematical Telemetry</h3>
          <ul>
            <li><strong>Availability (%):</strong> <code>(Successful Requests / Total Requests) × 100%</code>. Failed requests are never counted as served.</li>
            <li><strong>Origin Offload:</strong> <code>1 − (Origin Fetches / Total Requests)</code>.</li>
            <li><strong>Nearest-Rank P95:</strong> Smallest latency value where at least 95% of samples are less than or equal to it.</li>
          </ul>
        </section>
      </div>
    </details>
  )
}
