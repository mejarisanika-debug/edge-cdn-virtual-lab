# PROJECT_STATUS

**Project:** Edge CDN Cache with Origin Shielding — Cloud Edge Locations, Central Object Store, Tiered edge caching hierarchy with request collapsing & origin.
**Stack:** React 19 + TypeScript + Vite 8, Vitest 5, oxlint. (Planned: plain CSS, Recharts, Lucide React, custom SVG diagram.)
**Last updated:** Milestone 4 (README + experiment guide; ready to deploy). Stack as built: plain CSS, Recharts, Lucide React, custom SVG diagram.

## Architecture (simulation model)
`client -> edge[i] -> shared[region(i)] -> shield -> origin`
- Edge i is in region `i % regionCount`; one shared (regional) cache per region; ONE central shield.
- Shared tier and shield are separate layers (teaching model) and can each be toggled off (removed from every path).
- Collapsing is per cache node, per key, only while a fetch is in flight. OFF => every miss forwards upstream.
- Fill policy: fill on return path at every layer traversed, each with its own TTL starting at fill time.
- Origin: FIFO server with `originConcurrency` slots and fixed `originServiceMs`. No errors/timeouts modeled.
- Workload: seeded (mulberry32), Poisson arrivals, Zipf popularity, unique-key ratio, hot-object share, edge skew. Independent of toggles => fair comparisons.
- Warm cache: same workload is run once unmeasured, then measured after `warmGapMs`.

## Completed (verified)
| Feature | Verification |
|---|---|
| Cache with TTL, LRU/FIFO, capacity | `cache.test.ts` (6 tests) |
| Per-key in-flight table | `requestCollapsing.test.ts` (3) |
| Event-driven engine (one heap, no timers) | `engine.test.ts`; 10,000 requests ≈ 150–300 ms |
| Collapsing ON/OFF, shield ON/OFF, shared tier, TTL, unique keys, origin queueing, warm cache, determinism | `engine.test.ts` (28) |
| Metrics (hit ratios, origin fetches, avg/P50/P95 nearest-rank, bytes saved, throughput, origin queue) + `compareRuns` | `metrics.test.ts` (3) + consistency tests |

| 6 experiment presets (baseline, warm, flash crowd, many unique, short TTL, origin pressure) | `presets.test.ts` (7): each preset's expected effect is asserted |
| UI: validated ControlPanel, Run, Reset, Pin/Clear baseline, MetricsDashboard (KPIs, 2 Recharts charts, per-layer table, plain-English interpretation, assumptions), unfair-comparison warning | `tsc -b`, lint, production build pass. **NOT yet checked by eye in a browser** |

| ArchitectureView (custom SVG: users, N edges, per-region shared caches, shield, origin; OFF layers shown as bypassed; live preview before first run) | `tsc`, build; **not yet checked by eye** |
| Replay (one rAF loop over recorded events): Play/Pause, Step, Restart, End, scrub slider, 5 speeds; diagram counters + highlights + EventLog derived only from replayed events | `events.test.ts` (5): event counts equal per-layer metrics, chronological, targets present, cap flagged; UI not yet checked by eye |
| How It Works / assumptions / limitations panel | written; content review pending |

| README with setup, experiment guide (7 experiments + origin pressure, real numbers from seed 42), model, limitations | numbers produced by running the engine; matches unit-tested behaviour |
| Diagram text-overflow fix (user screenshot showed counters spilling out of boxes) | tsc/lint/tests/build pass; user to confirm visually |

## Not started / pending
GitHub push (user), Vercel/Netlify deploy (user), URL verification, final browser smoke test of all presets.

## Deployment
Provider: GitHub Pages (via .github/workflows/deploy.yml). URL: add after first deploy. Status: **not yet verified**.

## Commands run & results (folder: `edge-cdn-virtual-lab/`)
- `npm install`, `npm install -D vitest` — OK
- `npm install recharts lucide-react` — OK
- `npm test` — 6 files, 52 tests passed (40 also confirmed passing on the student's Windows machine after M1)
- `npx tsc -b` — no errors
- `npm run lint` — 0 warnings, 0 errors
- `npm run build` — success (chunk-size warning from Recharts only)

## Known limitations / decisions
- Capacity counts objects, not bytes. Evictions stat includes the warm-up pass.
- Latency is RTT-based and fixed (no jitter, no bandwidth/size-dependent transfer time).
- No stale-while-revalidate, purge, range requests, or origin errors.
- Run is a single synchronous batch (~0.3 s for 10k). "Pause" will be a replay control over `SimResult.events` in M3.
- Pin/compare only valid when workload settings match (UI warns otherwise).

## Bug fixed this milestone
- Results column made the page scroll sideways (flex/grid min-width). Fixed with `.layout > *{min-width:0}`. (An earlier chat message claimed the build was checked for this fix before it actually was; it has now been run.)

## Next tasks
1. Browser smoke test: diagram with shared/shield OFF, 12 edges, mobile width; fix findings.
2. Push to GitHub (check no secrets/node_modules/dist) and deploy to Vercel or Netlify; verify the URL in a fresh browser.
3. Record the verified URL here.
4. Optional: "Compare all 4 toggle combinations" button; bundle code-splitting for the Recharts size warning.
