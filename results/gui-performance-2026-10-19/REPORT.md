# GUI performance improvement (2026-10-19)

## Scope

Windows GUI copy only. No changes to robot strategies, scoring, observations, cargo limits, physics, the 0.05-second step, or the 180-second match. The preceding qualification-flip fix is preserved. At implementation completion no commit/push or WSL work had been performed; the subsequent user-requested publication packages both changes and their primary evidence. Git history and Pages deployment must be checked separately.

### Implementation

- `sim/engine.js`: bounded shared terrain grid (up to 16 entries; 60,500 bytes of typed arrays per entry). Keys include body size, team, role, L1 entry status, and field regions/zones/walls. Both grid footprint validity and directed neighbor transitions are memoized. Objects, source/transfer blocks, and moving robots remain checked on every graph rebuild; ramp weights still read current configuration. Custom footprint/terrain functions bypass the shared grid. `clearTerrainCache()` clears it, and `terrainCacheInfo()` exposes its entry/typed-array counts.
- `findPath`: sort nearby nodes by the same stable distance order before testing reachability, then stop at the first valid node. This returns exactly the node previously selected by validating every candidate first. No candidate distances, path weights, tie order, or safety checks are approximated.
- `sim/view.js`: retain unchanged robot tiles, pending work, stock/source/tower/evidence DOM. Build the event log only while its tab is active; build procedure history only while its tab is active. Replay/live transitions refresh the correct log. Reset clears terrain/planner/DOM caches. Simulation batches yield after an 8 ms budget instead of 30/35/60 ms; intermediate batch painting is limited to about 20 Hz. This is a budget between atomic steps, not a hard 8 ms maximum pause.
- `sim/sequence-ui.js`: visible timing history is rebuilt only when the displayed timing records change, not whenever the simulation clock changes. The current-action clock still updates.
- `tools/measure-performance.cjs`: two full matches with step/decision timings and compressed complete exports, with optional exact comparison against a previous run. Existing output directories are rejected.
- `sim/tests/terrain-cache.test.cjs`: five regression tests for original path equivalence, all grid cells at multiple body sizes/roles/sides, dynamic obstacles/weights, custom functions, field changes, and bounded/resettable caches.
- `sim/tests/performance-browser.cjs`: unchanged-DOM/state checks, 2D/3D timings, hidden-panel opening, replay/log round trip, and visible-history reuse.

## Measurements

Node v24.19.0 on this Windows machine. These are single-run measurements, not cross-device guarantees. Both before and final primary runs use CPU profiling; profiling overhead and machine variability apply. Both supply modes use the same GUI-default strategies and configuration with action recording.

| Full 180-second match | Before | Final | Reduction |
|---|---:|---:|---:|
| Normal supply | 11.480 s | 7.303 s | 36.4% |
| Ideal supply | 7.735 s | 5.473 s | 29.2% |

The full serialized export (configuration, assumptions, events, all saved frames, final state) is identical in both modes. Normal score is red 370 / blue 475; ideal is red 390 / blue 600. No shorter time step, lost log records, reduced planner horizon, or skipped candidates are used.

- Normal export SHA-256: `0d8db275995e3e2dfd2999cadea0fe961ec231812d97bfb1aca4f3b5424f9cee`
- Ideal export SHA-256: `92a5eab168ab6f6be9a25f77efd43287f11c674a1e8fb5f0940ea400958bd0ab`
- Primary before: `../gui-performance-before-2026-10-19/measurement.json`
- Primary final: `../gui-performance-profiled-final-2026-10-19/measurement.json`
- Profiles: `../gui-perf-before-valid.cpuprofile` and `../gui-perf-final-valid.cpuprofile`
- An unprofiled final run took 6.651 s / 4.862 s; do not use it alone as an identical-instrumentation speed comparison.

Edge repeated redraw of an unchanged initial scene (50 renders, single trial):

| Render | Before median / p95 | Final median / p95 |
|---|---:|---:|
| 2D | 1.5 / 2.2 ms | 1.2 / 1.7 ms |
| 3D | 3.4 / 8.4 ms | 2.6 / 3.7 ms |

Tower/robot child-list updates fell from 50 each to 0 during the 50 unchanged redraws. These render measurements do not include the heavy strategy decisions and are not an FPS guarantee during a live match. Before and final measurements: `../gui-render-before-2026-10-19/measurement.json` and `../gui-render-complete-2026-10-19/measurement.json`.

## Verification

- Node: all 329 tests passed, 0 failed/skipped/cancelled, 159.27 s with concurrency 2. This includes the previous qualification tests and the five new terrain/path tests. Compared with the earlier 324-test run, extra tests and machine load differ; the suite runtime is not the primary benchmark.
- `gui-defaults-browser.cjs`: 2D/3D defaults, strategy/supply switching, reset/reload, 1440/390/320 px, normal-supply 180 seconds, and every event/score/final-state equality against headless execution. Evidence: `../normal-blue-baseline-gui-1792398105942/verification.json`.
- `workspace-browser.cjs`: desktop/mobile panels, score changes, timeline/replay, post-match editing/undo/reset, drafts, no state changes from layout. Evidence: `../workspace-qa-1792398161455/verification.json`. Mobile screenshot inspected.
- `field-3d-browser.cjs`: real canvas pixels (1,214 sampled colors), camera interaction, moving actors, desktop/mobile, complete match, normal supply, and headless parity. Evidence: `../field-3d-qa-1792398283576/verification.json`.
- `action-plan-browser.cjs`: editor/import/export, 3.5-second pause boundary, custom receive times .35 s, placements 5.5/3 s, 16 steps completed, narrow layouts, replay and analysis. Final evidence: `../action-plan-qa-1792398489606/verification.json`.
- `performance-browser.cjs`: DOM reuse and immutable redraw, current tab contents after hidden updates, replay/live log restoration, visible history retained when no timing event changed, zero JS errors. Final evidence: `../gui-render-complete-2026-10-19/measurement.json`.
- Final GUI tests reported zero JavaScript errors. Git whitespace checks passed. WSL, public Pages, actual smartphones, and all strategy pairings are untested in this change.

### Diagnostic Corrections

The first benchmark script had a syntax error, fixed before capturing the baseline. A later comparison erroneously compared the live JS export (including undefined-valued properties) to parsed JSON. Comparison now uses the same serialized representation on both sides; no simulation rules were changed to satisfy it. Earlier unsuccessful output/profile files are preserved.

The first action-plan GUI run stopped at template step 4 because it inherited the newer normal-supply default, although the template test assumes prepared boxes. The pre-optimization HEAD engine, loaded read-only in memory with the same current controllers and normal configuration, also stopped at step 4. The test now explicitly selects ideal supply, matching its intended fixture. Production defaults and delivery rules are unchanged.

## Remaining Limit

There are still synchronous planning calls. In the primary final run the longest atomic simulation steps were about 499 ms (normal) / 465 ms (ideal), versus 620 / 609 ms before. An 8 ms batch budget cannot interrupt one of these calls. The app is lighter but is not guaranteed to be stutter-free, particularly at high replay speed or on phones. Further responsiveness work should consider time-sliced or background planning with exact observation snapshots and deterministic commit order; preserve direct local-HTML startup and test browser worker restrictions before changing architecture. Do not silently reduce search quality or observations as a performance fix.

## Reproduction

From the project root, using new output folders:

```sh
node tools/measure-performance.cjs --out results/performance-next
node tools/measure-performance.cjs --out results/performance-verify --against results/performance-next
node --test sim/tests/terrain-cache.test.cjs
node sim/tests/performance-browser.cjs
```

Browser commands require a resolvable Playwright installation and Edge (`ROBO_BROWSER_CHANNEL` can select another installed browser for the new measurement test). They do not require a web server. Use the same runtime/instrumentation and quiet machine for performance comparisons. Logs from different source revisions must not be merged/resumed as one exploration.
