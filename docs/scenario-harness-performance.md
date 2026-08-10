# Scenario harness performance — where interaction mode's 50 minutes go

Measured 2026-08-09/10 on the sandbox runner (4 cores, headless Chromium,
software rasterisation, Vite dev server on :5173). Both modes ran the same 127
scenario definitions / 2 950 steps.

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

| # | Change | Saving | Coverage impact | Risk |
|---|---|---|---|---|
| 1 | **Reuse one tab across scenarios**, reloading only where a scenario needs a fresh boot | ~950 s (28%) | None — 124/127 scenarios open with `new_game`, which already replaces state, hides the main menu and closes stale overlays | Cross-scenario leakage. Needs a `__resetForScenario()` bridge (stop tutorial, close panels, clear selection and event dialog, reset locale) plus a per-scenario `freshPage` opt-out for `main-menu-visual` and `loading-screen-visual`. Hedge: reload every N scenarios |
| 2 | **Replace the 300 ms sleep with a two-frame rAF wait** | ~646 s (19%) | None — and it is *more* correct: it waits for the `uiManager.update` the comment names, rather than guessing 300 ms | Low. Removes a wall-clock gamble that a slow CI runner can lose |
| 3 | **Let `campaign start` run without a prior `new_game`**, and drop the throwaway from the 62 scenario definitions | 262 s interaction (8%), 12 s command (17% of command mode) | None — the discarded world is never observed. Arguably a real fix: a player starts a campaign level from the main menu without creating a sandbox first | Touches a console command's contract plus 62 JSON files; both channels must stay green |
| 4 | **Shard the suite across workers** (`--shard i/n` + a CI matrix, or N pages in one browser) | Near-linear on whatever remains | None | Low. Composes with 1–3; the CI job's wall clock is what the `full-ci` label costs |
| 5 | **Collapse per-step state extraction into one evaluate** returning `{game, ui, output}`, and reuse that snapshot in `checkGoal` | ~130 s (4%) | None — same data, fewer round-trips. Today a step does 4 evaluates plus a `before`, and `checkGoal` re-reads state once per goal kind (164 steps read it 2–3×) | Low |
| 6 | **Drop the `waitForSelector` at the top of `clickSelector`** — the probe loop that follows already reports `absent` and honours the same deadline | ~15 s | None | Low |

Applied together, 1–3, 5 and 6 take the suite from **3 367 s to ~1 285 s (21
min)**; four-way sharding on top puts the CI job near **6 min**.

### Measured and rejected

- **Serve the built bundle instead of the dev server** — 0.4 s per scenario
  (~50 s), and nothing at all once optimisation 1 lands.
- **Skip `uiState` per step** — 26 s, and it is the only UI snapshot in the
  per-step JSON. Keep it for debuggability.
- **Suspend drawing** — already done and load-bearing: 0.7 ms per CDP call
  versus 4 450–9 630 ms with drawing on and terrain loaded.
- **The simulation itself** — `tick 10` is 5.4 ms in the browser. Ticking is not
  where the time is, in either mode.

## Unrelated finding: 6 scenarios fail in interaction mode on this runner

The profiling run reproduced these (each aborts its scenario at the failing
step, so a fully green suite would run slightly longer than 56 min):

| Scenario | Step | Failure |
|---|---|---|
| `building-destruction-visual` | 6 | `clickSelector "#bs-blast-panel [data-action="auto-sequence"]"` — element has zero size (0x0) |
| `economy-full-loop` | 12 | same control, same zero size |
| `nav-dynamic-updates-visual` | 3 | same control, same zero size |
| `level1-win-conservative` | 36 | `ecology should be 48.66 but is 49.8` |
| `money-surfaces-visual` | 5 | `#bs-contract-panel [data-contract-id="1"] [data-action="negotiate"]` never appeared (10 s) |
| `survey-then-blast-playthrough` | 45 | `#bs-contract-panel [data-contract-id="1"] .bs-contract-deliver` not in the DOM, so `blocked` proves nothing — stale selector |

Command mode is 127/127 green, which is the point of the interaction channel.
