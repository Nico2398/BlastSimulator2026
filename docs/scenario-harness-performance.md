# Scenario harness performance — where interaction mode's 50 minutes go

Measured 2026-08-09/10 on the sandbox runner (4 cores, headless Chromium,
software rasterisation, Vite dev server on :5173). Both modes ran the same 127
scenario definitions / 2 950 steps.

## Implemented (2026-08-10)

Optimisations 2, 3, 5, 6 below are shipped. Optimisation 1 (tab reuse) was
implemented, found to have deeper problems than scoped, and reverted — see
its own section. 4 (sharding) is shipped as CI config; its wall-clock benefit
needs a real CI run to confirm, not reproducible in this sandbox.

| | Before | After | Change |
|---|---|---|---|
| Interaction suite, full 127 scenarios | 3 367 s (56 min) | **2 347–2 362 s (~39 min)** | **−30%** |
| Command suite, full 127 scenarios | 70.2 s | 54–56 s | −22% (side effect of optimisation 3) |
| Pass/fail split | 121 / 6 | **127 / 0** | Zero regressions; the 6 pre-existing failures are separately fixed on `main` (#532) |

Verified via `npm run typecheck`, the full unit suite (299 files / 8 662
tests), `npm run scenarios` (127/127), and three independent full
`run-all-scenarios.ts --mode interaction` runs: the first two (immediately
after implementation, and again once this document's numbers were drafted)
landed on an identical 121-passed/6-failed split — the same 6 scenario names
this document already listed as pre-existing failures before any of this
work started (kept below for the record). Between the second and third run,
`main` merged an independent fix for exactly those 6 (#532) plus an
unrelated rename (`playtest-driver.ts` → `interaction-driver.ts`, #516) that
directly touched the files this work also modified; merging `main` into this
branch needed manual conflict resolution in three files (all successfully
reconciled — the rename's side and this work's side touched the same
functions for unrelated reasons). The third run, on the merged result, is
**127/127 passed** at 2 347 s — confirming both that `main`'s fix holds
together with these optimisations and that the merge itself introduced
nothing new.

Sharding is now confirmed in real CI, not just projected: PR #530's own
`full-ci` run completed all four `Scenarios (interaction mode)` shards in
**~12 minutes wall clock** (11:12:00–11:24:12 UTC, all four started
together and finished within 3 minutes of each other), against this same
branch's ~39 minute unsharded, single-process time — close to the
near-linear 4× this document projected, the gap being the fixed per-shard
setup cost (checkout, `npm ci`, Puppeteer install, build, dev server start)
that sharding doesn't divide.

### Tab reuse (optimisation 1) — implemented, reverted

Building `window.__resetForScenario()` and switching
`run-all-scenarios.ts`'s batch loop to one page, reset between scenarios
instead of a fresh tab, surfaced two distinct bugs during full-suite
verification — not the hand-picked two-scenario check run first, which
passed clean and gave false confidence:

1. **Real bug, fixed.** The reset bridge called `window.__setRenderEnabled(true)`
   to defensively undo a scenario that might have left drawing on. No
   interaction action ever touches render-enabled state, so this was
   undoing the harness's *own* `suspendDrawing()` call every single time —
   after the first reset, every scenario for the rest of the run paid the
   ~6.4 s/frame software-rasterisation cost on every CDP call again (#475),
   the exact cost `suspendDrawing` exists to avoid. This alone explained a
   127-scenario run degrading to 24 of the first 51 scenarios failing on
   step timeouts. Fixed by deleting the line — nothing needed re-enabling
   drawing in the first place.

2. **Real bug, not fixed — this is why optimisation 1 is reverted.** After
   fixing (1), a full run still showed a new failure
   (`blast-drill-plan-ui`, `holeCount` 6 instead of 12) that reproduced
   only after another scenario ran first, never on a fresh page. Root
   cause: `DrillStep.gridSpacing` (`src/ui/panels/blastSteps/Drill.ts`) is
   a plain instance field, initialised to `DEFAULT_SPACING_M` once at
   construction and never reset — incremented/decremented by its stepper
   button for the lifetime of the `DrillStep` object. On a fresh page that
   object is constructed fresh per scenario, so the field is always at its
   default. On a reused page it is the *same* object for the entire batch,
   so a value one scenario's stepper clicks left behind silently carries
   into the next scenario's own stepper clicks. `BuildMenu.rampDepth` is
   the same pattern. Both are two instances of a class of bug the reset
   bridge cannot close by construction: it resets panel *visibility* and a
   short, explicitly-enumerated list of cross-cutting state (tutorial,
   camera, locale, selection), but has no way to discover or reset every
   panel's own internal form defaults without reading every panel's source
   individually — an open-ended, easy-to-under-scope audit, not a fix with
   a knowable size. Getting it wrong produces exactly the failure mode a
   test suite can least afford: a scenario's result silently depending on
   which scenario happened to run before it.

Given that, tab reuse is reverted rather than shipped partially fixed. The
render-enabled bug's fix is a one-line deletion and is easy to redo; the
sticky-instance-field class of bug is the real blocker, and the honest
scope of fixing it is auditing every panel component for non-GameState-backed
mutable fields, or redesigning the reset to reconstruct the UI component
tree instead of resetting it field-by-field. Neither is a quick follow-up.

Reproduce with:

```bash
npm run dev &
npx tsx scripts/bench-scenarios.ts --mode command        # ~70 s
npx tsx scripts/bench-scenarios.ts --mode interaction    # ~56 min
npx tsx scripts/bench-scenarios.ts --mode micro          # CDP + bridge unit costs
npx tsx scripts/bench-hotspots.ts                        # boot, level entry, click, settle
```

The profiler mirrors the two runners rather than wrapping them. Cross-checked
against the real batch runner on four scenarios: 16.4 / 13.0 / 15.8 / 13.2 s
real versus 16.8 / 12.6 / 15.0 / 13.1 s profiled — within 4%.

Everything below this point, including the "Reproduce with" timings just
above, is the **original, pre-optimisation measurement** that motivated the
work — kept as-is since it is what the ranked list at the bottom is
evaluated against. `bench-scenarios.ts`/`bench-hotspots.ts` import the same
shared modules the real harness does, so re-running either one today
measures the *post*-optimisation code and will not reproduce these numbers;
see "Implemented" above for what changed and the current numbers.

## Headline

| | command | interaction | ratio |
|---|---|---|---|
| Suite wall clock | **70.2 s** | **3 367 s (56 min)** | **48×** |
| Mean per scenario | 0.55 s | 26.5 s | 48× |
| Median per step | 24 ms | 1 517 ms | 63× |
| Fixed cost before step 0 of a scenario | 0 ms | 8 080 ms | — |

## Where the time goes

Every row is measured, not modelled. Percentages are of each mode's own total.

| Operation | Interaction | % | n | mean | Command | % | Notes |
|---|---|---|---|---|---|---|---|
| **Browser page boot** (`newPage` + `goto` + canvas wait + first evaluate + `close`) | **1 026.2 s** | **30.5** | 127 | 8 080 ms | 0 s | — | One fresh tab per scenario. 6.5 s of the 8.1 s is app init *after* `DOMContentLoaded` |
| **Console commands through the page** | **847.9 s** | **25.2** | 1 699 | 499 ms | 47.2 s | 64.8 | 190 level entries account for ~840 s of it; the other ~1 500 commands cost ~9 s total |
| **Fixed 300 ms post-action settle** | **727.8 s** | **21.6** | 2 421 | 301 ms | 0 s | — | `INTERACTION_SETTLE_MS`, a wall-clock guess at "one `uiManager.update`" |
| **UI input** (`clickSelector`, `click`, `pickTile`, `dragTiles`, `set`, `keypress`) | **260.4 s** | **7.7** | 2 450 | 106 ms | 0 s | — | `page.click` alone is ~33 ms (5 CDP round-trips) |
| **Per-step state extraction** (4 evaluates + `before` snapshot) | **189.2 s** | **5.6** | 2 889 steps | 65 ms/step | 24.5 s | 33.7 | Command mode serializes twice per step in-process |
| **Scene-space actions** (`cameraFocus`, `mousemove`, `clickEntity`) | **160.6 s** | **4.8** | 44 | 3 650 ms | 0 s | — | The only actions that still force a real frame |
| **Explicit waits** (`waitForSelector`, `wait`, `awaitUsable`, `waitForTutorialStep`, `resolveEventIfPending`) | **116.5 s** | **3.5** | 1 196 | 97 ms | 0 s | — | Scenario-authored waits |
| **`expect` goal checks** | **32.2 s** | **1.0** | 1 822 | 18 ms | 0.03 s | 0.0 | Interaction also checks `usable`/`blocked`/`tutorialStep` |
| **`assert` actions** | 3.9 s | 0.1 | 181 | 22 ms | 0 s | — | |
| **State JSON writes** | 1.2 s | 0.0 | 2 887 | 0.4 ms | 1.05 s | 1.4 | Not a factor in either mode |
| **Harness start/stop** | 0.7 s | 0.0 | 2 | 366 ms | 0.0003 s | 0.0 | Browser launch vs `createRunner()` |
| **Total** | **3 366.7 s** | 100 | | | **72.9 s** | 100 | Command mode instrumented; unin­strumented run is 70.2 s |

### CDP round-trips underneath those operations

Nested inside the table above, not additional to it.

| Primitive | Total | Calls | Mean |
|---|---|---|---|
| `page.evaluate` | 1 165.7 s | 20 727 | 56.2 ms |
| `page.waitForSelector` | 917.9 s | 3 021 | 303.8 ms (846 s of it is the 127 canvas waits) |
| `page.click` | 164.9 s | 2 236 | 73.7 ms |
| `page.goto` | 102.8 s | 127 | 809 ms |
| `page.mouse.*` | 157.0 s | 24 | 6 542 ms |
| everything else | 8.1 s | 461 | 17.6 ms |

## Unit cost of one operation, mode against mode

| Single operation | Command | Interaction | ratio |
|---|---|---|---|
| `new_game seed:42` | 197 ms | 4 230 ms | 21× |
| `campaign start level:dusty_hollow` | 312 ms | 4 800 ms | 15× |
| `tick 10` | 0.4 ms | 5.4 ms | 13× |
| `state full` (7.2 KB output) | 0.4 ms | 5.8 ms | 14× |
| `scores` | 0.02 ms | 4.6 ms | 230× |
| Read whole game state | 4.1 ms | 5.5–8.1 ms isolated, 15.5 ms in-suite | 2–4× |
| Click a button | n/a | 106 ms | — |
| Scenario start-up | 0 ms | 8 080 ms | — |

## The four things that actually cost the 50 minutes

### 1. One fresh tab per scenario — 1 026 s (30%)

`runBatchInteraction` opens a new page, navigates, and waits for the canvas for
each of the 127 scenarios. The breakdown per boot: `goto` 0.67 s, canvas wait
**6.5 s**, first evaluate 0.52 s.

The canvas is static in `index.html`, so the 6.5 s is not the selector arriving
— it is the main thread being busy with app init and refusing to run the probe.
Serving a production bundle does not help: `vite preview` on `dist/` cuts `goto`
from 0.67 s to 0.33 s and leaves the canvas wait at 6.4 s (7.3 s total boot vs
7.7 s). The dev server is not the problem; booting the app 127 times is.

### 2. Level loading inside the browser — ~840 s (25%)

190 level entries (126 `new_game`, 62 `campaign start level:*`, 2 `sandbox
start`). In-browser they cost 4.2 s and 4.8 s; the same commands against the
Node engine cost 197 ms and 312 ms. The ~4 s delta is `gameRenderer
.syncFromContext` — mesh construction, not rasterisation, since drawing is
suspended throughout.

Worth recording: `CLAUDE.md` puts a campaign start at ~16 s. Measured here it is
4.8 s.

**All 62 campaign scenarios run `new_game` immediately followed by `campaign
start level:X`.** `campaign start` refuses to run without a loaded game
("No game loaded. Use new_game first."), so every one of them builds and meshes
a 64³ sandbox world and throws it away one command later, unobserved. That is
**262 s of interaction time and 12 s of command time** spent on worlds no step
ever looks at.

### 3. The fixed 300 ms settle — 728 s (22%)

`SETTLE_AFTER` sleeps 300 ms after every click, tile pick, drag and type — 2 421
times. Its own comment says what it is waiting for: the next frame's
`uiManager.update`. That update runs in the rAF callback, which keeps running
with drawing suspended (`SceneManager.start`), and rAF is still 60 Hz: a
measured one-frame wait is **18.9 ms**, two frames **33.3 ms**.

### 4. Forced frames on scene-space actions — 161 s (5%)

`cameraFocus`, `clickEntity`, `focusTile` and `zoomOut` call `__renderFrame()`
so the raycast has a current `matrixWorld`. A real frame with terrain costs
4.5–9.6 s under software rasterisation (a suspended-draw CDP call costs 0.7 ms —
the #475 mitigation is working, and these are the only places still paying it).
44 actions across 7 scenarios; `vehicle-traffic` (66.5 s) and
`vehicle-traffic-routing-visual` (78.5 s) are the two slowest non-playthrough
scenarios purely because of it.

## Optimisations, ranked — none of them removes coverage

| # | Change | Projected saving | Measured | Status |
|---|---|---|---|---|
| 1 | **Reuse one tab across scenarios**, reloading only where a scenario needs a fresh boot | ~950 s (28%) | — | **Reverted.** Implemented, found two bugs during verification (one fixed, one — sticky per-panel instance state — an open-ended audit, not a quick fix). See its own section above |
| 2 | **Replace the 300 ms sleep with a two-frame rAF wait** | ~646 s (19%) | Included in the −1 005 s measured below | **Shipped.** Surfaced a real, separate race while landing it — `PlacementController.confirm()` holds `isArmed()` true for a fixed 220 ms flash via `setTimeout`, not a frame callback, so two rAF frames could lose that race where the old, generous 300 ms sleep happened to win it. Fixed by exposing `currentPhase()` and polling it, not by lengthening the wait |
| 3 | **Let `campaign start` run without a prior `new_game`**, and drop the throwaway from the scenario definitions | 262 s interaction (8%), 12 s command (17% of command mode) | Included in the −1 005 s measured below | **Shipped**, scoped down from all 62 to 38 of the 62 campaign scenarios — the other 24 either deliberately exercise `campaign start` as a rejection path that continues on the discarded sandbox world instead of replacing it (locked tier-2/3 levels — removing their `new_game` would leave them no world at all), or assert `worldSizeX` actually grew from the sandbox default (a real regression check for "campaign start's regenerateGrid call ran," which a world that was never created can't prove) |
| 4 | **Shard the suite across workers** (`--shard i/n` CI matrix) | Near-linear on whatever remains | **Confirmed in real CI**: PR #530's `full-ci` run, all 4 shards, ~12 min wall clock | **Shipped** as a 4-way GitHub Actions matrix + `--shard` flag, round-robin partitioned |
| 5 | **Collapse per-step state extraction into one evaluate**, and reuse that snapshot in `checkGoal` instead of re-fetching | ~130 s (4%) | Included in the −1 005 s measured below | **Shipped** |
| 6 | **Drop the `waitForSelector` at the top of `clickSelector`** — the probe loop that follows already reports `absent` and honours the same deadline | ~15 s | Included in the −1 005 s measured below | **Shipped** |

2, 3, 5, 6 together measure **3 367 s → 2 347–2 362 s (~−30%)** on a full
127-scenario run, verified three times (see "Implemented" above). Four-way
sharding on top, confirmed in real CI on PR #530, brought the
`full-ci` job's `Scenarios (interaction mode)` step to **~12 minutes**
wall clock.

### Why 4 shards, not 2, 6, or 8 — and why it's now a variable, not a constant

4 was a reasonable starting default, not the output of cost modelling — the
real per-shard breakdown only exists now, pulled from PR #530's own job logs
(`get_job_logs`, shard 1/4, plus the four shards' `started_at`/`completed_at`):

| Cost | Size | Scales with shard count? |
|---|---|---|
| Fixed CI setup: checkout, Node + npm cache hit (~3.7 s), Puppeteer Chrome install (~4.6 s), `npm run build` (~4.1 s), dev server boot + `sleep 5` + curl (~10 s) | ~30 s | No — paid once per shard regardless of how many scenarios it runs |
| Per-shard cold start: navigate + wait for `#game-canvas` | ~8.5 s | No — same reasoning, one page boot per shard |
| Harness batch time: run this shard's slice of the 127 scenarios | ~646–694 s (shard 1 logged "BATCH COMPLETE — 646.1s" for its 32 scenarios) | Yes — roughly proportional to scenario count per shard |

Total per-shard job wall time in that run: 680–726 s (~11–12 min) across
the four shards, matching the ~12 minute figure above. The ~646 s batch
portion is what shrinks as shard count grows; the ~38.5 s fixed portion is
paid again by every additional shard. Doubling to 8 shards would roughly
halve the variable portion to ~320 s while still paying ~38.5 s fixed,
landing near ~360 s (~6 min) per shard — a real additional win, with
diminishing returns as fixed cost becomes a larger fraction of a shorter
job. Going the other way, 2 shards would land near ~1 331 s (~22 min) per
shard — worse than today for no benefit.

Rather than pick a new fixed number, the shard count is now the repo
variable `SCENARIO_INTERACTION_SHARDS` (`.github/workflows/ci.yml`,
`strategy.matrix.shard: ${{ fromJson(vars.SCENARIO_INTERACTION_SHARDS || '[1,2,3,4]') }}`).
This adds no real complexity: `run-all-scenarios.ts`'s `--shard i/N` parsing
already accepts any `N` (`parseShardArg`/`selectShard`), and the CI step
already passes `${{ strategy.job-total }}` instead of a hardcoded `4`, so
the harness's own shard-total argument stays correct for whatever the
variable holds. Changing shard count is a Settings → Variables edit, not a
workflow change.

### Measured and rejected

- **Serve the built bundle instead of the dev server** — 0.4 s per scenario
  (~50 s), and nothing at all once optimisation 1 lands.
- **Skip `uiState` per step** — 26 s, and it is the only UI snapshot in the
  per-step JSON. Keep it for debuggability.
- **Suspend drawing** — already done and load-bearing: 0.7 ms per CDP call
  versus 4 450–9 630 ms with drawing on and terrain loaded.
- **The simulation itself** — `tick 10` is 5.4 ms in the browser. Ticking is not
  where the time is, in either mode.

## Unrelated finding: 6 scenarios fail in interaction mode on this runner — fixed on `main`, #532

The profiling run reproduced these (each aborted its scenario at the failing
step, so a fully green suite ran slightly longer than 56 min at the time):

| Scenario | Step | Failure |
|---|---|---|
| `building-destruction-visual` | 6 | `clickSelector "#bs-blast-panel [data-action="auto-sequence"]"` — element has zero size (0x0) |
| `economy-full-loop` | 12 | same control, same zero size |
| `nav-dynamic-updates-visual` | 3 | same control, same zero size |
| `level1-win-conservative` | 36 | `ecology should be 48.66 but is 49.8` |
| `money-surfaces-visual` | 5 | `#bs-contract-panel [data-contract-id="1"] [data-action="negotiate"]` never appeared (10 s) |
| `survey-then-blast-playthrough` | 45 | `#bs-contract-panel [data-contract-id="1"] .bs-contract-deliver` not in the DOM, so `blocked` proves nothing — stale selector |

Command mode was 127/127 green throughout, which is the point of the
interaction channel — it caught three distinct real bugs (`BlastWorkshop`
autoAdvance not switching tabs before a click; `ContractsPanel` only
refreshing while visible; a stale hardcoded contract id) that command mode's
console-only path never exercises. All three, and the two scenario-def
corrections they needed, landed on `main` independently (#532) while this
branch was in flight. Merging `main` in and re-running the full interaction
suite confirms it: **127/127 passed**, per the "Implemented" section above.
