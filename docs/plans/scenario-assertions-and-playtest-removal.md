# Scenario Assertions + Playtest Removal — Master Plan

**Read this file first after any context reset.** It is the durable source of
truth for this task. Update the status table and findings log as you go,
commit this file alongside the scenario changes it tracks.

Follow-on to `docs/plans/issue-479-interaction-conversion.md` (#479, merged:
all 124 scenario definitions convert their player-facing steps to real UI
clicks). That work proved the UI is *reachable*. This one proves the UI
*does the right thing* — and once it does, `npm run playtest` is redundant
with what scenarios now check, so it comes out.

Branch: `claude/unify-playtest-interactive-tests-kcjlwb`. PR #497.

## Goal (verbatim from the operative instruction)

1. **Scenarios should have assertions.** This was a real missing feature:
   a scenario step currently proves only "the command/click didn't throw" —
   never "the game state is what it should be." Every scenario operation
   needs its resulting state checked.
2. **Click-only enforcement should be near-total in interaction mode**, the
   same way it already is in playtest (5 allowed setup commands, everything
   else clicked). That is the whole point of interaction mode vs. command
   mode — right now only 23% of steps (`player`-role) are actually enforced;
   2143 command actions still sit inside `setup`/`observe`/unmarked steps
   across the suite, some legitimately, many not yet audited.
3. **This is compatible with, not opposed to, scenario testing.** A
   scenario proves a *sequence* reaches a *goal* — the goal is a final-state
   check after the last action, same shape as a playtest beat's `expect`,
   just scoped to a whole scenario instead of one beat. Per-operation
   checks (point 1) are the finer-grained version of the same idea.

**Then:** once scenarios cover what playtest covers, delete playtest.
**Test coverage must not drop, in any way, as a result of removing it** —
every one of playtest's 4 definitions' unique proofs needs a scenario
equivalent (or better) BEFORE playtest.ts/scripts/playtests/*.json are
deleted, not after.

## Ground rules (do not violate these)

1. **Never guess a state value.** `employee hire role:surveyor` costs
   exactly `HIRING_COSTS.surveyor` (`src/core/config/balance.ts`) — check
   the source, or run the file once in command mode first and read the
   real `screenshots/scenario-<name>-command/step-NN-*.json` dumps it
   already writes per step. A wrong asserted value fails a scenario that
   is behaving correctly, which is worse than no assertion at all. (Caught
   immediately on the very first file: guessed 46000, real value 48800 —
   see Findings Log #1.)
2. **`expect` is checked in BOTH modes, not just interaction mode.**
   `equals`/`increased` run in command mode too
   (`scripts/shared/scenario-goal.ts`'s `checkGoalAgainstState`, wired into
   `command-runner.ts`'s `runSteps`). Only `usable`/`blocked`/`tutorialStep`
   are interaction-mode-only (no DOM in command mode) — reuse
   `playtest-driver.ts`'s `checkGoal` there rather than re-implementing.
   This was an explicit correction mid-design: do not build something that
   only asserts under interaction mode.
3. **One commit per file (or a small logically-grouped batch of very
   similar files).** Message states what was added/converted and any
   finding.
4. **Verify locally, not on GitHub.** GitHub Actions is down for this whole
   task so far (infra outage, see PR #497's comment thread) — run
   `npx tsx scripts/run-all-scenarios.ts <name>` (command mode, fast) after
   every edit, and `npx tsx scripts/run-all-scenarios.ts --mode interaction
   <name>` (needs `npm run dev &`) before crossing a file off. Never run the
   whole interaction-mode suite locally except as a final full-sweep check
   — one file/small-batch at a time while iterating.
5. **A step whose click cannot complete a genuine game guard (disabled
   button) does not need to become an impossible click.** Attach
   `expect.blocked: <selector>` to the *existing* command/setup step
   instead — `checkGoal` inspects the page regardless of what the step's
   own interaction did, so this proves the guard is real without touching
   the underlying cash-guard game-logic gap (Findings #1/#16/#26 in the
   #479 plan doc, still out of scope — "wide blast radius", its own change).
6. **A genuinely UI-less step stays unmarked, but should still usually get
   an `expect`** proving what it bootstrapped, if a `setup`/observe-shaped
   assertion is cheap and meaningful (e.g. `employee assign_skill`'s effect
   on `qualificationCount`/proficiency is real and checkable even though the
   *command* itself has no button).
7. **`git fetch origin main && git merge origin/main`** every so often —
   GitHub being down doesn't change this once it's back; check at the start
   of each resumed session.
8. Dev server must be running for interaction-mode verification:
   `npm run dev &` once per session, leave it running. If a browser-driven
   run is in flight, touch no file until it finishes (CLAUDE.md's
   "Claude Code only" section).
9. **Don't touch a file's click sequence just to add assertions** unless the
   audit (goal 2) finds a real gap in that same file — keep "add expect"
   and "convert an unmarked step" as separable edits where possible, so a
   diff is readable as one thing at a time. In practice most files need
   both, and that's fine — just don't pad unrelated changes into a
   file you're only asserting.

## Mechanism (built, tested, proven — do not redesign)

- `ScenarioStepGoal` (`scripts/shared/scenario-types.ts`) — new type,
  field-for-field mirror of `PlaytestGoal`
  (`scripts/shared/playtest-types.ts`): `increased`, `equals`, `usable`,
  `blocked`, `tutorialStep`, `note`. `ScenarioStepDef.expect?:
  ScenarioStepGoal`.
- `checkGoalAgainstState(goal, before, after)` (new file,
  `scripts/shared/scenario-goal.ts`) — pure, no DOM. Checks
  `equals`/`increased` only; returns a violation message or `null`. Wired
  into `command-runner.ts`'s `runSteps`: `before` is captured via
  `serializeGameState(ctx)` right before `runCommand`, `after` right after.
  A violation throws `` `expect failed: ${violation}` ``, caught by the
  existing per-step try/catch — reported exactly like a thrown command
  error already was.
- Interaction mode reuses `playtest-driver.ts`'s `checkGoal(page, goal,
  before)` directly — same function playtest beats use, not a second
  implementation. Wired into **both** interaction-mode entry points (there
  are two, this was easy to miss):
  - `scenario-interaction-runner.ts` (single-scenario/CLI path,
    `runScenarioInteraction`) — `before` captured via `gameState(page)`
    right before `executeInteractionActions`.
  - `run-all-scenarios.ts`'s `runBatchInteraction` — **a separate inline
    loop that does not call `runScenarioInteraction`**, wired the same way
    independently. If you add a third interaction-mode entry point, wire it
    there too — there is no shared call site to patch once.
- `describeStepFailure` (`scenario-interaction-runner.ts`) now appends
  `PlaytestFailure.diagnosis` (the usable/blocked control inventory) when
  present, so an `expect` failure in interaction mode reports the same rich
  diagnosis a playtest beat failure does, not just a bare message.
- Tests: `tests/unit/scenario-goal.test.ts` (pure function, command-mode
  half), `tests/unit/goal-check.test.ts` (`checkGoal` via a faked `Page`,
  interaction-mode half — equals/increased/tutorialStep/blocked/usable-fast-
  path, deliberately skips the slow `usable`-timeout path, which real
  interaction-mode runs already exercise), `tests/integration/scenario-
  expect.integration.test.ts` (real game engine through `runSteps`, proves
  the *wiring* not just the pure function), plus schema tests in
  `tests/unit/scenario-defs.test.ts` (§15: `expect` shape validation across
  all 124 files, and "at least one checkable field" — stricter than
  playtest-defs.test.ts's equivalent rule, which allows a note-only
  `expect`; this one does not, deliberately).
- Proven against a real browser on `survey-panel-visual.json` (2 steps):
  added real `equals`/`increased` assertions, confirmed PASS in both modes,
  deliberately broke one value to confirm a real, correctly-attributed
  FAIL with full diagnosis in both modes, restored the correct value,
  re-confirmed PASS. This file is now done — see status table.

## Playtest → scenario parity audit (must close before deleting playtest)

Read all 4 playtest defs in full alongside their nearest scenario
counterpart. Findings so far — **do not delete playtest.ts /
scripts/playtests/*.json until every row below is CLOSED**:

| Playtest def | Nearest scenario | Gap | Status |
|---|---|---|---|
| `tutorial.json` (22 beats) | `tutorial-interactive.json` (29 steps) | Near-total overlap already — same click path, same `waitForTutorialStep` gating. Missing: (a) no `expect` blocks at all yet (needs `tutorialStep`/`increased` added per step, mirroring each beat); (b) the "grid tool refuses a rectangle that is not the one asked for" negative-test beat (`blocked: "#bs-tile-select-confirm"` after dragging a *wrong* rectangle) has no equivalent step at all; (c) the "leaving for the world map is blocked mid-tutorial" (`blocked: ".bs-return-map"`) check likewise. | ⬜ open |
| `research-center-gate.json` (7 beats) | none yet — closest is `building-research-visual.json`/`building-research-progression-visual.json`, not yet inspected for this specific rejection case | Need to confirm one of them (or a new addition) proves: Queue Research clicked with no Research Center on site is rejected on-screen (cash/buildingCount unchanged), the identical click succeeds once a Research Center exists, and the tier-2 unlock is real (`usable` on the tier-2 buy button, `set` on the tier selector). | ⬜ open, not yet inspected |
| `scene-picking.json` (5 beats) | `scene-picking-visual.json` | Was building-only (raw `click`/`mousemove` pixel coords, no employee coverage at all) — a real gap, not just missing assertions. **Closed**: extended the file with 4 new steps (hire driller, `clickEntity` employee id:1, click DETAIL, click close) using `expect.usable`/`expect.blocked`, plus `expect` added to all 4 pre-existing building-picking steps (`equals`/`increased` on the build, `usable`/`blocked` on the selection-bar Esc-deselect pair). Verified 1/1 in both modes with a real browser. | ✅ closed |
| `training.json` (7 beats) | `employee-training.json`, not yet inspected in full | Need to confirm it proves both licences no role hires with (`driving.excavator`) and a promotion (`driving.truck` above Rookie) via real clicks + `usable`/`equals`/`increased`, not console shortcuts. | ⬜ open, not yet inspected |

Do the parity audit for the remaining 3 rows once the main batch pass
(below) reaches those files' batches — no need to front-load all 4 before
starting; `tutorial.json`'s gap is already scoped and can be closed
alongside Batch 7 (tutorial-interactive.json's batch) or earlier as a
standalone fix, whichever comes first chronologically.

## Batch plan — same grouping as #479, now doing two things per file

For each file: (a) add `expect` to `player`/`setup`/`observe` steps where a
meaningful, verifiable state invariant exists (ground rule #1: read real
values, never guess); (b) audit every unmarked step's command — convert to
a real click if one exists and isn't blocked by a disabled control
(ground rule #5 covers the disabled case), leave genuinely UI-less hooks
unmarked (ground rule #6: still assert their effect where cheap). Verify
both modes per file before committing.

### Batch 0 — mechanism + pilot file — ✅ DONE
`survey-panel-visual.json`.

### Batch 1 — misc visual (14, same grouping as #479 Batch 1)
✅ ambient-life-visual · ✅ weather-popover-visual · ✅ wind-clouds-visual ·
✅ loading-screen-visual · ✅ scene-picking-visual (**playtest-parity
check closed**) · ✅ nav-cell-types-visual (**real command/click mismatch
found + fixed**) · ✅ nav-minimap-integration-visual (same fix) ·
⬜ blast-hole-picking-visual · ⬜ blast-drill-plan-ui ·
⬜ blast-drill-plan-visual · ⬜ i18n-live-locale-switch ·
⬜ crew-fleet-panels-visual · ⬜ money-surfaces-visual

### Batch 2 — blast-* (25)
⬜ blast-basic · ⬜ blast-charge-loading-ui · ⬜ blast-detonation-sequence-ui ·
⬜ blast-execution-effects · ⬜ blast-overcharge · ⬜ blast-undercharge ·
⬜ blast-report-metrics · ⬜ blast-voxel-fragmentation ·
⬜ blast-voxel-fragmentation-visual · ⬜ blast-preview-software-tiers ·
⬜ blast-report-visual · ⬜ blast-visual-full · ⬜ blast-charge-sequence-visual ·
⬜ blast-preview-tiers-visual · ⬜ blast-workshop-french-visual ·
⬜ blast-preview-step-visual · ⬜ blast-sequence-step-visual ·
⬜ blast-fire-step-visual · ⬜ multi-deck-blast · ⬜ presplit-wall ·
⬜ vibration-budget · ⬜ collapse-recovery · ⬜ rock-fragmenter-breaking ·
⬜ ramp-navigation · ⬜ blast-execution-visual

### Batch 3 — survey-* (12, survey-panel-visual done in Batch 0)
⬜ survey-confidence-display · ⬜ survey-confidence-overlay ·
⬜ survey-execution · ⬜ survey-method-selection ·
⬜ survey-ore-vein-visibility · ⬜ survey-overlay-lifecycle ·
⬜ survey-post-blast-ore-report · ⬜ survey-result-visualization ·
⬜ survey-seismic-side-effects · ⬜ survey-stale-handling ·
⬜ survey-then-blast · ⬜ survey-then-blast-playthrough · ⬜ skill-progression

### Batch 4 — building-* (12) — **+ research-center-gate parity check**
⬜ building-destruction-visual · ⬜ building-lifecycle ·
⬜ building-living-visual · ⬜ building-menu-visual ·
⬜ building-placement-visual · ⬜ building-ramp-visual ·
⬜ building-research-progression-visual (parity check here) ·
⬜ building-research-visual (parity check here) ·
⬜ building-tier-system-visual · ⬜ building-training-visual ·
⬜ building-vehicle-depot-visual · ⬜ building-warehouse-visual

### Batch 5 — vehicle-* / needs-* / nav-* (22)
⬜ vehicle-3d-rendering-visual · ⬜ vehicle-driver-assignment-visual ·
⬜ vehicle-purchase-tier-ui-visual · ⬜ vehicle-roles-panel-visual ·
⬜ vehicle-task-states-visual · ⬜ vehicle-traffic ·
⬜ vehicle-traffic-routing-visual · ⬜ needs-collapse-visual ·
⬜ needs-cost-visual · ⬜ needs-cycle · ⬜ needs-drain-visual ·
⬜ needs-gauges-visual · ⬜ needs-morale-visual ·
⬜ needs-proactive-queue-visual · ⬜ needs-replenishment-visual ·
⬜ needs-shift-cycle-visual · ⬜ nav-dynamic-updates-visual ·
⬜ nav-move-costs-visual · ⬜ nav-path-following-visual ·
⬜ nav-pathfinding-visual · ⬜ nav-ramp-routing-visual · ⬜ site-expansion

### Batch 6 — employee/economy/misc (18) — **+ training parity check**
⬜ employee-skill-progression-visual · ⬜ employee-skills-visual ·
⬜ employee-training (parity check here) · ⬜ contract-negotiation ·
⬜ economy-display-visual · ⬜ economy-full-loop · ⬜ hauling-gate ·
⬜ maintenance-cost-drain · ⬜ scores-display-visual ·
⬜ time-management-visual · ⬜ safety-projection-visual ·
⬜ core-loop-visual · ⬜ i18n-display-visual · ⬜ main-menu-visual ·
⬜ save-load-visual · ⬜ sandbox-mode · ⬜ weather-display-visual ·
⬜ weather-flood

### Batch 7 — big playthroughs + the 3 stragglers (19) — **+ tutorial parity check**
⬜ tutorial-interactive (parity check + close tutorial.json gap here) ·
⬜ tutorial-playthrough · ⬜ level1-lose-arrest · ⬜ level1-lose-bankruptcy ·
⬜ level1-lose-ecology · ⬜ level1-lose-revolt ·
⬜ level1-playthrough-revolt · ⬜ level1-playthrough-win ·
⬜ level1-win-conservative · ⬜ level1-win-efficient ·
⬜ level2-playthrough-bankruptcy · ⬜ level2-playthrough-win ·
⬜ level3-playthrough-ecology · ⬜ level3-playthrough-win ·
⬜ ambient-timescale-sync · ⬜ landscape-continuity-visual ·
⬜ tutorial-steps-visual · ⬜ vehicle-purchase-visual ·
⬜ contract-panel-visual · ⬜ event-dialog-visual

(123 remaining after Batch 0's 1; batches above sum to 122 — reconcile the
exact count against `ls scripts/scenario-defs/*.json | wc -l` at the start
of each session, in case main added/removed a file.)

### Phase 3 — playtest removal (only after every batch above + all 4 parity rows are closed)
1. Delete `scripts/playtest.ts`, `scripts/playtests/*.json`,
   `scripts/shared/playtest-utils.ts`.
2. `playtest-driver.ts`/`playtest-types.ts` **survive** — they are now the
   shared foundation `interaction-executor.ts` and both interaction-mode
   runners depend on. Rename them (`interaction-driver.ts`/
   `interaction-types.ts` or similar) so a file called "playtest-*" doesn't
   linger forever after playtest itself is gone — update every import site.
3. Remove the `playtest`/`Playtest (playability)` CI job from
   `.github/workflows/ci.yml`.
4. Remove `npm run playtest` from `package.json`.
5. Delete `.claude/rules/playability.md`; fold anything still true (the
   click-only invariant, the diagnosis-first debugging order) into
   `.claude/rules/scenario-defs.md`.
6. Retire the `dev-playability-testing` skill; fold its still-true content
   into `dev-visual-testing`/`dev-testing-strategy`.
7. Update CLAUDE.md's Verification Gate table: `playability` stops being a
   separate row — it's what interaction-mode scenarios with `expect` now
   prove, so it folds into `visual`'s row. Update the "Claude Code only"
   CI section (drop the Playtest job reference, keep Scenarios interaction
   mode).
8. Full local sweep (typecheck, tests, command scenarios, THE WHOLE
   interaction-mode suite once — this is the one time running it in full
   locally is correct, per ground rule #4's exception, since there's no
   playtest job left to catch a regression afterward), push, read CI once
   it's back (or report full local green if it's still down).

## Findings Log

1. **Guessed a hiring cost wrong on the very first file** (`survey-panel-
   visual.json`): assumed 4000, real `HIRING_COSTS.surveyor` is 1200 —
   caught immediately because command mode ran and reported `cash should be
   46000 but is 48800` before the file was even committed. Confirms ground
   rule #1 is load-bearing, not paranoia — write the ground truth into the
   rule text itself when a value like this needs checking (`src/core/
   config/balance.ts` for hiring/training costs, per-explosive costs in
   `ExplosiveCatalog.ts`, research task costs in whatever defines
   `RESEARCH_TASK_DEFS`, etc. — look each one up per file, don't reuse a
   number from memory across files without confirming it's the same
   constant).
2. **`serializeGameState` (command mode) was missing fields
   `window.__gameState()` (interaction mode) already had** —
   `worldSizeX/Z/minX/minZ` and `qualificationCount`/`proficiencyTotal`/
   `trainingCount`, all derivable from `ctx.state` alone, no browser
   dependency. Found auditing for real dual-mode parity (the user's explicit
   correction: assertions must be checked in both modes, not just
   interaction). **Fixed** — `src/console-api.ts`, with the field-list test
   in `tests/unit/console-api.test.ts` (which had drifted stale right along
   with the gap) updated and given real coverage. Committed separately from
   the batch work since it's a foundational fix, not a scenario-file change.
3. **A real, pre-existing scenario-file bug, exposed on the second batch
   file that touched a `drill_plan grid` click**: `nav-cell-types-visual.json`
   and `nav-minimap-integration-visual.json`'s `command` field
   (`rows:2 cols:2 spacing:5 depth:6 start:5,5`) never matched what the
   click actually produced. The click drags a (5,5)-(10,10) rectangle at
   the Drill panel's own default spacing (`DEFAULT_SPACING_M=3`, not the
   command's `spacing:5`), and the panel computes `cols`/`rows` as
   `round(size/spacing)+1` — 3×3 = 9 holes, not the command's literal 2×2=4.
   Command mode ran the literal params and got 4; the click always produced
   9; nothing ever compared them until `expect.equals.holeCount` did. This
   is exactly the class of bug `.claude/rules/scenario-defs.md` already
   warns about ("command and interaction must target the same place") —
   confirms that rule was aspirational for any file that never got an
   assertion proving it. **Fixed** — corrected the `command` field to
   `rows:3 cols:3 spacing:3` (what the click truly produces) rather than
   guess a click sequence that would reproduce the original 2×2. Both
   files' actual purpose (nav-cell-type rendering) doesn't depend on the
   specific grid dimensions, so this was the lower-risk fix. Re-verified in
   both modes with a real browser.

_(Add new findings here as you hit them. Number sequentially.)_

## Status table

Legend: ⬜ not started · 🔶 in progress · ✅ expect added + unmarked-step
audit done + both modes verified

### ✅ Done (8)
- survey-panel-visual (Batch 0 — mechanism pilot)
- scene-picking-visual (Batch 1 — playtest scene-picking.json parity closed)
- ambient-life-visual, weather-popover-visual, wind-clouds-visual,
  loading-screen-visual (Batch 1 — baseline `equals`/`increased` on
  setup steps; also exercised the new `worldSizeX/Z` fields for real —
  loading-screen-visual now asserts the exact 96×96 dusty_hollow terrain
  size, not just "some terrain exists")
- nav-cell-types-visual, nav-minimap-integration-visual (Batch 1 — Finding
  #3: real command/click mismatch found and fixed, not just assertions
  added)

115 remaining across Batches 1-7. Parity audits for research-center-gate/
training still open; tutorial.json's gap is scoped (2 missing negative-test
beats + no `expect` blocks yet in tutorial-interactive.json).

## Session log

Append a line each time you resume, so it's clear how far a given session
got, whether main was merged, and whether GitHub Actions is back up yet.

- 2026-08-06 — Plan created. Mechanism designed, implemented, tested
  (unit + integration + schema), and proven against a real browser on
  survey-panel-visual.json (Batch 0, now done — the suite's first scenario
  with real, verified `expect` assertions in both modes). Playtest→scenario
  parity audit started: read all 4 playtest defs in full, compared
  tutorial.json against tutorial-interactive.json in detail (near-total
  overlap, 2 missing negative-test beats + no `expect` yet); the other 3
  parity rows scoped but not yet inspected in detail (deferred to their
  batch). GitHub Actions still down for this whole session — all
  verification is local (`npm run typecheck`/`test`/command-mode scenarios/
  interaction-mode per-file), per the user's explicit instruction to work
  that way until GitHub recovers. Next: Batch 1 (misc visual, 14 files,
  including the scene-picking-visual parity check).
