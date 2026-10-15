# Edge CDN Cache Virtual Lab

**Edge CDN Cache with Origin Shielding — Cloud Edge Locations, Central Object Store, Tiered edge caching hierarchy with request collapsing & origin.**

A browser-based, deterministic **simulation** that teaches how a CDN serves content from edge locations, uses a regional shared cache, collapses concurrent requests for the same missing object, and protects the origin with an origin shield. It is a teaching model, not a real CDN, and needs no backend or cloud account.

```
Users → Edge locations → Regional shared cache → Origin shield → Central object store (origin)
```
Production CDNs may merge the regional cache and the shield into one layer; the lab keeps them separate so each role is visible.

## Prerequisites
Node.js 20+ (LTS) and npm. Check with `node -v`.

## Run it (from the project folder that contains `package.json`)
```bash
npm install        # once
npm run dev        # open the printed http://localhost:5173
npm test           # 52 unit tests (Vitest)
npm run typecheck  # TypeScript
npm run lint       # oxlint
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

## Using the lab
1. Pick an **experiment preset** (or set the controls by hand) and press **Run simulation**.
2. Watch the **replay**: Play/Pause, Step, Restart, End, scrub, and choose a speed. The diagram and event log only show events that have been replayed.
3. Read the **dashboard**. Press **Pin as baseline**, change one setting, and run again to see the difference on *identical traffic* (same seed + workload). A warning appears if the workloads differ.
4. Open **How it works** at the bottom for the fill policy, metric definitions and limitations.

## Experiment guide
All numbers below are for the default seed (42) and are reproducible; "origin fetches" is the number of fetches the origin actually served. Use the matching preset, **Run**, **Pin as baseline**, change only what is listed, and **Run** again.

| # | Experiment | How | Observed result |
|---|---|---|---|
| 1 | Baseline | Preset **Baseline (cold cache)**: collapsing OFF, shield OFF, 1,000 requests | 402 origin fetches, avg 203 ms, P95 614 ms, up to 56 fetches queued at the origin. Turning collapsing + shield ON: 259 fetches, P95 300 ms. |
| 2 | Request collapsing | Preset **Flash crowd**; set shield OFF; collapsing OFF → ON | Origin fetches 894 → 303; P95 11,016 → 2,643 ms; 495 requests merged into in-flight fetches. |
| 3 | Origin shielding | Preset **Baseline**, collapsing ON; shield OFF → ON (2 regions) | Origin fetches 340 → 259; hit ratio 61.1% → 68.3%. With one region the shield adds little (the dashboard says so). |
| 4 | Warm cache | Preset **Warm cache**; untick / tick "Warm cache" | Cold: 259 fetches. Warm: 0 fetches, 100% hits. (The warm-up replays the *same* workload, including its "unique" keys, so this is an upper bound.) |
| 5 | Flash crowd | Preset **Flash crowd**; collapsing + shield OFF → both ON | Origin fetches 894 → 237 (−73%); origin queue peak 804 → 147; P95 11,016 → 1,817 ms. |
| 6 | Many unique objects | Preset **Many unique objects**; collapsing OFF → ON | 950 → 935 fetches only: different keys are never collapsed, and caches rarely hit (5% hit ratio). |
| 7 | TTL expiry | Preset **Short TTL** (1 s) vs TTL 600,000 ms | 390 vs 259 origin fetches; 120 edge "TTL-expired" misses vs 0. |
| + | Origin under pressure | Preset **Origin under pressure**; collapsing OFF → ON | Origin queue shrinks sharply (verified by a unit test). |

## Simulation model (summary)
- **Topology:** edge *i* belongs to region *i mod regions*; one shared cache per region; one central shield; one origin. The shared tier and shield can each be switched off (removed from every path).
- **Hit/miss:** each layer checks its own cache. A hit answers there; layers above are never contacted, so no origin fetch occurs.
- **Request collapsing:** per cache node and per object key, only while a fetch is in flight. Followers reuse the leader's result. Different keys never share a fetch. With collapsing OFF every miss goes upstream.
- **TTL:** each stored copy expires TTL ms after it was stored *at that layer*; an expired copy is a miss.
- **Cache-fill policy:** fill on the return path — every layer the response passes stores a copy. Eviction is LRU or FIFO by object count.
- **Origin:** fixed processing time and limited parallel fetches; extra fetches wait in a FIFO queue.
- **Workload:** seeded random generator (Poisson arrivals, Zipf popularity, unique-key ratio, hot-object share, edge skew). It does **not** depend on the feature toggles, which is what makes comparisons fair.
- **Engine:** one event queue (a heap), no timer per request. 10,000 requests run in a fraction of a second.
- **Metrics** are computed from the simulation results (and checked against the event log in tests). P95 uses the nearest-rank method.

## Limitations
Capacity counts objects, not bytes; latency is fixed round-trip times (no jitter or loss); no origin errors/timeouts, stale-while-revalidate, purging, cache-control headers, range requests or real geography. Results are modeled values, not measurements of any real CDN. The replay log is capped (150,000 events) for memory; metrics never depend on it.

## Project layout
```
src/simulation/   engine (types, config, workload, cache, requestCollapsing, originShield, eventQueue, engine, metrics, presets)
src/simulation/tests/   Vitest unit tests
src/components/   ControlPanel, MetricsDashboard, ArchitectureView, ReplayPanel, EventLog, HowItWorks, useReplay
src/App.tsx       page shell
PROJECT_STATUS.md current state, decisions and next steps
```

## Deploy (static site; no environment variables or secrets needed)
Build command `npm run build`, output directory `dist`. Both Vercel and Netlify detect Vite automatically. See `PROJECT_STATUS.md` for the verified deployment URL once deployed.
