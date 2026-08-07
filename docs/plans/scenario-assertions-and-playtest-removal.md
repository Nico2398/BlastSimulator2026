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
10. **Every `drill_plan grid` step gets an `expect.equals.holeCount` check,
    no exceptions, and check it BEFORE trusting the file's declared
    `command`.** Finding #4: the click's actual grid shape depends on the
    placement strip's *current* spacing value (persists across grid
    operations, only changes via `data-field="spacing"
    .bsx-stepper-btn:first-child`/`:last-child` clicks — default
    `DEFAULT_SPACING_M=3`, Drill.ts), not the command field's declared
    `spacing:N`. Compute `cols = round((x2-x1)/spacing)+1`, `rows =
    round((z2-z1)/spacing)+1` by hand against whatever spacing the strip is
    *actually* at for that step (carrying over the previous grid step's
    final value in the same file, not resetting to 3), or just run it and
    read the real dump — then either add stepper clicks to reach the
    declared spacing (preserves the file's original intent — prefer this)
    or correct the command field to match reality (only when the exact
    grid shape doesn't matter for that file's purpose, e.g. pure rendering
    checks). Never leave a `drill_plan grid` step without this check on the
    theory that the original #479 interaction-mode pass already proved it
    — that pass never compared hole counts either.
11. **`cash` does not move across drill → charge → sequence → blast**,
    confirmed against real dumps in both `money-surfaces-visual.json` and
    `blast-basic.json` — explosive/drilling cost is not reflected in the
    `cash`/`finances.cash` field in this build. Don't keep re-discovering
    this per file: assert `holeCount`/`chargedCount`/`sequencedCount`
    through the pipeline, not `cash`, for these steps. `cash` assertions
    belong on `build`/`vehicle buy`/`employee hire` steps, where it
    genuinely does move.
12. **`new_game` leaves `isPaused: false` by default** — a real browser's
    game loop keeps advancing the sim on real wall-clock time throughout
    interaction mode, stacking on top of whatever `tick N` a scenario issues
    explicitly; command mode has no such drift (a headless run only
    advances on an explicit command). Never assert an exact `equals` on
    `cash` or any other continuously-draining field (salary, maintenance,
    need decay) on a step that follows a `tick N` or a slow
    `waitForSelector`/animation gap — use `decreased`/`increased` there
    instead. Exact `equals` stays fine for two actions back-to-back with no
    tick/wait gap between them (Finding #12, `rock-fragmenter-breaking.json`
    — a `cash` check placed right after `tick 30` failed in a real browser,
    32748 expected vs 32769 actual, purely from the click round-trip's real
    elapsed time). Expect every `tick N`-heavy playthrough file in Batches
    5-7 to need this same treatment.
14. **`survey <method> x:X z:Z` queues an arrival-gated `PendingAction`
    (#437) — it does not complete on the same tick it's issued.** The
    surveyor must walk to the site first; `surveyCount` (added this batch)
    stays at its pre-survey value through the click/command itself, and only
    grows once enough `tick`s pass for the walk + the method's own duration.
    Cash for the survey's `SURVEY_COSTS` entry deducts immediately at
    queue-time, though — `decreased: ["cash"]` is the right check on the
    survey step itself; `increased`/`equals` on `surveyCount` belongs on a
    later `tick N` step, and per ground rule #12, prefer `increased` mid-
    pipeline and save an exact `equals` for a checkpoint where the count has
    hit a natural ceiling (e.g. "4 surveys were queued, so `surveyCount: 4`
    is safe once enough ticks have definitely passed for all of them" —
    extra real-time ticks in interaction mode can only get there sooner,
    never overshoot a value nothing can exceed).

    **Don't assume the file's own first `tick N` after a survey is enough
    to complete it — verify against a real dump.** `survey-execution.json`
    uses `tick 23` as the first post-survey tick (vs. `tick 53` in the
    other 2 survey files so far); 23 ticks alone was not enough for even
    one survey to finish in a real run (`surveyCount` stayed 0), so an
    `increased` check placed there failed in command mode outright — not
    an interaction-mode-only drift issue, a genuinely wrong assumption
    about timing. Dropped that mid-round check; kept only the ceiling-safe
    `equals` at each round's final `survey show`, after all of that round's
    padding ticks. When a file's tick budget per round isn't obviously
    "generous", dump the real sequence before asserting mid-pipeline.

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
| `research-center-gate.json` (7 beats) | `building-research-visual.json`/`building-research-progression-visual.json` now both fully inspected and given real assertions (Finding #20) | Both files now prove the tier-2/tier-3 unlock is real (`building-research-visual.json`'s Tier 2/3 builds succeed for real, asserted). Still open: neither file tests beat 3's specific case — clicking Queue Research on an ALREADY-PLACED building (e.g. `living_quarters`) with **zero Research Centers built at all** (#442's prerequisite gate). Both building-research-*.json files build a `research_center` as their very first step, so this specific "no Research Center anywhere" rejection is not covered by either. Needs a new step (or a small new scenario) added before Phase 3 closes this row — not blocking Batch 4's remaining files. | 🔶 partially closed — tier-unlock proven, prerequisite-gate case still open |
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
✅ blast-hole-picking-visual · ✅ blast-drill-plan-ui (**Finding #4: real
spacing-stepper gap found + fixed at the root, ParamStrip.ts**) ·
✅ blast-drill-plan-visual (same fix) · ✅ i18n-live-locale-switch ·
✅ crew-fleet-panels-visual · ✅ money-surfaces-visual

### Batch 1 — ✅ COMPLETE (14 files, see Done list below)

### Batch 2 — blast-* (25)
✅ blast-basic (Finding #4 grid mismatch) · ✅ blast-charge-loading-ui
(same) · ✅ blast-detonation-sequence-ui (same) ·
✅ blast-execution-effects (same) · ✅ blast-overcharge (**Finding #5: the
Charge panel's amount/stemming steppers had no selector either, and
stemming:0 turned out to be unreachable by any click — fixed at the root,
corrected to the true UI-reachable extreme, verified against the real
chargesByHole dump**) · ✅ blast-undercharge (same fix, amount only) ·
✅ blast-report-metrics (Finding #4 grid fix) · ✅ blast-voxel-fragmentation
(same) · ✅ blast-voxel-fragmentation-visual (same) ·
✅ blast-preview-software-tiers (same + real tier costs 500/2000/5000/12000
verified) · ✅ blast-report-visual (same) · ✅ blast-visual-full (same +
same tier costs) · ✅ blast-charge-sequence-visual (Finding #4 grid fix) ·
✅ blast-preview-tiers-visual (Finding #4 grid fix + tier costs) ·
✅ blast-workshop-french-visual (grid already matched default spacing;
usable/blocked across every French-rendered panel view) ·
✅ blast-preview-step-visual · ✅ blast-sequence-step-visual
(**command/interaction mismatch found + fixed: step declared `command:
"state"` — a no-op — while its click issued `sequence set` through the
console bridge; aligned the command field to the click's real effect**) ·
✅ blast-fire-step-visual (both fixed via the same bundled-multi-command-step
split as blast-preview-step-visual) · ✅ multi-deck-blast (**Finding #7:
hole:N bare-numeric ids never matched, every per-hole charge silently failed
for the file's whole history**) · ✅ presplit-wall (**Finding #8:
drill_plan grid replaces the whole plan, so the file's 2 grids could never
coexist; restructured to drill_plan grid + drill_plan add, first scenario to
use the add-hole-tool UI; also found explosive:presplit doesn't exist,
substituted pop_rock**) · ✅ vibration-budget (**Finding #9: fabricated
"$5,000 fine" premise + amount exceeds boomite's max, switched to rumblox;
motivated adding `decreased` to the goal mechanism, and exposing the 4
ScoreState fields. Finding #10: Charge All uses the panel's own explosive
selection, never clicked — silently charged panel defaults for the file's
whole history**) · ✅ collapse-recovery (**Finding #11: the file's own
"rest restores them" claim doesn't hold within its 350-tick budget — a real
run shows collapse is genuine but recovery isn't, ending in bankruptcy +
worker_revolt when extended; assertions now check only what's verified,
exposed collapsedCount/minFatigue fields**) · ✅ rock-fragmenter-breaking
(Finding #4 grid fix + exposed storedMassKg, finally giving the file's own
long-standing "must have grown" TODO a real check; **Finding #12: cash
equals checks after a tick N gap are cross-mode-fragile — isPaused:false by
default lets interaction mode's real wall-clock keep ticking the sim
during clicks, drifting past command mode's exact tick count — switched to
decreased/increased there**) · ✅ ramp-navigation (**Finding #13: a real
production bug — buildRampCommand deducted cash but never called
addExpense, so finances.cash silently diverged from the real cash field
after any ramp build; fixed at the root, new unit test added**) ·
✅ blast-execution-visual (Finding #4 grid fixes across 2 of its 4 grids +
Finding #5 stemming-floor fix across 2 of its 4 charge steps, all 4
grid/charge/sequence/blast cycles now asserted end to end)

### Batch 2 — ✅ COMPLETE (25/25 files, 5 real production bugs found and
fixed this batch: #4-class grid mismatches, #5-class stemming-floor gaps,
#7 bare-numeric hole ids, #8 drill_plan grid replacing the whole plan, #9
fabricated fine premise + amount-exceeds-max, #10 explosive selection never
clicked, #11 collapse-recovery's claim not holding at its own tick budget,
#12 cash-after-tick-gap cross-mode drift, #13 buildRampCommand's finance
sync bug — plus 2 mechanism extensions: `decreased` goal field, and 3 new
state fields (wellBeing/safety/ecology/nuisance, collapsedCount/minFatigue,
storedMassKg))

### Batch 3 — survey-* (12, survey-panel-visual done in Batch 0)
✅ survey-confidence-display (exposed surveyCount, first file to establish
the arrival-gated survey timing pattern — see ground rule #14) ·
✅ survey-confidence-overlay (**Finding #15: assign_skill used positional
args instead of named, silently failed on every run, proficiencyTotal
never moved off the Rookie baseline — fixed**) ·
✅ survey-execution (single-method rounds; tick 23 alone isn't always
enough for a survey to complete — dropped the fragile mid-round `increased`
check, kept only the ceiling-safe `equals` at each round's `survey show`) ·
✅ survey-method-selection (3 rounds, no per-round `survey show` — verified
each round's 47-tick padding is enough via a real dump, so later rounds'
survey steps assert `surveyCount` at the prior rounds' ceiling directly) ·
✅ survey-ore-vein-visibility (**Finding #16: a likely real engine bug —
4 survey PendingActions queued for one employee, only 3 ever complete, the
4th silently vanishes from the queue rather than executing; deterministic
in both modes, root cause not chased down, filed as a follow-up; assertions
use the real ceiling (3, not 4)**) ·
✅ survey-overlay-lifecycle (**Finding #15 class: same positional-args
assign_skill bug, fixed**; 2 surveyors split round-1's 2 surveys cleanly —
no Finding #16 drop with 2 employees vs. 1 — plus Finding #4 grid check) ·
✅ survey-post-blast-ore-report (2 survey rounds pre-blast, then a real
drill/charge/sequence/blast pipeline; Finding #4 grid-spacing-stepper fix
needed (default 3 → declared 5, 2 increment clicks); `survey ore_report`'s
rich-text yield comparison left unmarked — no scalar field exists for it in
`SerializableGameState`, matches precedent for `fragments`/`inspect`) ·
✅ survey-result-visualization (3 clean sequential rounds — seismic,
core_sample, aerial — each a full 47-tick round before the next is queued,
so no Finding #16 concurrent-queue risk; surveyCount ceiling 0→1→2→3) ·
✅ survey-seismic-side-effects (2 employees + a living_quarters build before
the survey; traced pendingActions/employees directly to confirm the
surveyor's walk to (20,20) from spawn is long enough that this file's
first `survey show` checkpoint (31 ticks) genuinely predates completion —
completes at tick ~43, not a Finding-#16-class drop; score fields
wellBeing/safety/ecology/nuisance move during the run too, but from
generic per-tick decay/build-effects, not specifically the survey, so left
unmarked per the no-uncaused-assertions discipline from Findings #9/#11) ·
✅ survey-stale-handling (seismic survey completes by 55 ticks, a 40-tick
staleness-wait round follows with the ceiling asserted unchanged at 1 since
nothing new is queued, then a core_sample at the same position brings it
to 2 — no overlay-colour/staleness field exists to check directly, so the
proof stays at the surveyCount/cash level) ·
✅ survey-then-blast (**Finding #15 class: `employee assign_skill 1 geology
3` used bare positional args, silently failed — fixed to `skill:geology
level:3`**; 2 survey rounds then a real drill/charge/sequence/blast
pipeline, Finding #4 grid-spacing-stepper fix needed again) ·
✅ survey-then-blast-playthrough (**Finding #15 class fix again**, 3
employees hired; seismic + core_sample queued back to back for the same
surveyor with zero ticks between — direct engine trace confirmed both
complete cleanly by round 1, no Finding #16 drop at only 2 queued; full
drill/charge/sequence/blast pipeline with the Finding #4 fix; `contract
accept`/`contract deliver` left unmarked — no contract-count field exists,
and `contract deliver`'s own step already carries a legacy note about
command-runner.ts's success-handling gap) ·
✅ skill-progression (**Finding #15 class: `assign_skill id:1 ...` used
`id:` as a named arg, but the id is positional — fixed to bare `1`.
Finding #18: the file's whole premise was untestable as written — it
ticked 700 times with no work ever assigned to the driller, so the
excavator skill could never gain XP (XP only accrues via
`tickTaskProgress` while a task is actively in progress, per
GameLoop.ts) — fixed for real by queuing 40 `employee dispatch` calls
(a test-only console helper built for exactly this) up front so the
driller has continuous work through the full budget. Finding #19: a
single `tick 700` step silently under-ran in real (non-scratch) execution
— `runCommand`'s action-count increment can trigger a random event
mid-batch, and `tick` both stops advancing the instant an event fires
and refuses to advance at all while one is pending, so the un-chunked
step delivered far fewer than 700 real ticks and the skill never
reached level 5. Fixed by chunking into 14× (tick 50, event choose 0),
matching this file's own sibling scenarios' established pattern — reaches
proficiencyTotal:6 (level 5 excavator) as the original scenario name
promised**)

Batch 3 done: 12/12, Findings #14-#19.

### Batch 4 — building-* (12) — **+ research-center-gate parity check**
✅ building-destruction-visual (no `campaign start` — sandbox `new_game`
defaults to a 64×64 world; builds 2 warehouses then drills/charges/
sequences/blasts near them, Finding #4 grid-spacing fix needed; the
file's own stated purpose — both warehouses destroyed by the blast —
confirmed via a real dump, blast rating CATASTROPHIC) ·
✅ building-lifecycle (despite the file's description — "place, upgrade
to T2, move, then demolish" — the upgrade/move/destroy steps are all
genuine rejections by design (T2 not researched, target id #2 never
existed since only building #1 was ever placed); `buildingCount`/`cash`
asserted unchanged at each to confirm these are real no-ops, not silent
successes) ·
✅ building-living-visual (`new_game ... cash:200000` custom starting
cash; research_center + 3 living_quarters tiers with research queued
between each, 3 employees hired, tick 5 + needs check — `decreased`
used instead of `equals` for any cash/minFatigue check following a
`tick N` step, per Finding #12's wall-clock-drift caution; confirmed
minFatigue drops from 100 after just 5 idle ticks, no work assigned;
`decreased` scopes to the step's OWN before/after — a `decreased` on the
`needs` step right after `tick 5` fails since nothing changes fatigue
between them, it has to sit on the `tick 5` step itself) ·
✅ building-menu-visual (4 clean builds then 2 already-known-broken ones —
the file's own pre-existing description flags a real bug generalizing
Finding #1's class: plain `build` has no funds guard, so it drives cash
negative in command mode at points where the UI's buy button would
already be disabled; asserted the exact negative cash values for real,
confirming the overdraw rather than just describing it) ·
✅ building-placement-visual (4 straightforward builds at different grid
positions, cash/buildingCount asserted exactly at each — no findings) ·
✅ building-ramp-visual (2 ramps at $100/m — 10m south then 8m east —
cash asserted exactly at each; confirms Finding #13's buildRampCommand
finance-sync fix still holds for real) ·
✅ building-research-progression-visual (**Finding #20: the file's whole
back-half narrative was false** — "Tier 3 progresses over ticks and
becomes buildable" never happens; the Tier 2 build's $60,000 cost
overdraws this file's $50,000 starting cash to -$40,015 (Finding #1's
class), which cascades into the Tier 3 research queue attempt being
rejected for `insufficient_funds` instead of the "Now succeeds" its own
step description claimed. Every misleading description in the back half
corrected to match the real, verified behavior; `buildingCount` never
exceeds 2 in this file) ·
✅ building-research-visual (parity check: the sibling file, with a
higher $230,000 starting cash, genuinely completes the full T1→T2→T3
progression — confirmed via a real dump and fully asserted, closing the
research-center-gate.json parity row's tier-unlock requirement) ·
✅ building-tier-system-visual (real Build-panel clicks throughout —
Queue Research, Upgrade, Demolish, no console shortcuts; confirmed
`build upgrade` REPLACES the building with a new id rather than adding
one, buildingCount stays flat across both T1→T2 and T2→T3 upgrades) ·
✅ building-training-visual (4 training buildings, 2 hires, real
`employee train` via clicking `.bs-train-btn` — not `assign_skill`, this
one has a genuine UI path; confirmed `trainingCount` 0→1 during the
20-tick course, back to 0 with `proficiencyTotal` 2→3 once it completes
at 35 ticks; not the `employee-training.json`/`training.json` parity
target — that pairing is a separate, later Batch 6 file) ·
✅ building-vehicle-depot-visual (T1 build succeeds, T2/T3 direct
attempts both genuinely rejected — not researched, no findings) ·
✅ building-warehouse-visual (2 T1 warehouses succeed, T2 direct
attempts on both genuinely rejected — not researched, no findings)

Batch 4 done: 12/12, Finding #20 (building-research-progression-visual's
false narrative, cascading from Finding #1's class). research-center-gate
parity row partially closed (tier-unlock proven both files; #442
prerequisite-gate case still open for Phase 3).

### Batch 5 — vehicle-* / needs-* / nav-* (22)
✅ vehicle-3d-rendering-visual (5 vehicle purchases, only the first
affordable — `campaign start` wipes the file's cash:200000 bump back to
dusty_hollow's own $50,000 default, already correctly documented in the
file's own step descriptions; confirmed the remaining 4 overdraw exactly
as described, vehicleCount reaching 5 regardless) ·
✅ vehicle-driver-assignment-visual (confirmed driver assignment is
arrival-gated like surveys — `vehicle list` shows driver:none right
after the assign click, driver:#1 only after the driver walks there
over the following ticks; unqualified assignment attempt genuinely
rejected, licence check confirmed real) ·
✅ vehicle-purchase-tier-ui-visual (4 purchases across T1/T2/T3, all
affordable within the file's $300,000 bump — cash/vehicleCount asserted
exactly at each, no overdraw here unlike vehicle-3d-rendering-visual) ·
✅ vehicle-roles-panel-visual (same 5-vehicle-purchase sequence as
vehicle-3d-rendering-visual — identical cash/vehicleCount values reused) ·
✅ vehicle-task-states-visual (idle→moving→transport state chain
confirmed via `vehicle list`'s rich text — no scalar field exists for
vehicle task state; cash/vehicleCount asserted at each actionable step) ·
✅ vehicle-traffic (**Finding #21: the file's stated purpose — verify
TrafficJamEvent triggers — never actually happens**, at any tick budget;
root cause traced two levels deep (lockstep timing, then a structural
vehicle-count shortfall against TRAFFIC_JAM_MIN_VEHICLES); test corrected
to state this plainly rather than silently pass on unrelated fields) ·
✅ vehicle-traffic-routing-visual (**Finding #22: unlike its sibling
vehicle-traffic.json (Finding #21), this file's traffic-jam premise IS
reachable** — it converges all 4 vehicles, the exact configuration
Finding #21 showed is structurally required; a direct trace found the
jam fires at tick 25, 3 ticks past the file's existing 22-tick budget —
extended to 32 total, re-verified the event fires for real) ·
✅ needs-collapse-visual (**Finding #23: missing `event choose 0` after
5 of 6 tick steps, Finding #19's class — a real random event silently
froze the whole back half of the file every run**; fixed, then a full
re-trace confirmed the file's actual premise holds for real: genuine
collapse at 50 ticks, genuine recovery by 250, staying recovered through
to the end — unlike Findings #20/#21's false narratives, this one just
needed the event-handling fix) ·
✅ needs-cost-visual (confirmed the file's own claim for real: by 170
total ticks a genuine "needs" expense category appears in `finances`
output — Rest: hunger, $50 each — as minFatigue crashes toward the
collapse threshold; added missing `event choose 0` after every tick
step, matching Finding #23's fix) ·
✅ needs-cycle (the file's title promise — "verify canteen auto-queue" —
is categorically unreachable, "canteen" isn't a real building type and
"hauler" isn't a real hire role; both already correctly documented as
no-ops by the file's own pre-existing step descriptions, now given real
`equals` confirmation instead of just prose; the 2 real hires and idle
need-decay over 40 ticks are what this file actually tests) ·
✅ needs-drain-visual (confirmed the file's own claim for real: over 160
idle ticks fatigue drains steadily to ~30, breakNeed stays flat at 100
the whole time per `needs`'s own output, and hunger/fatigue diverge by
the end — added missing `event choose 0` after every tick step) ·
✅ needs-gauges-visual (3 hires, 100 idle ticks total; cash doesn't move
within the first 5 ticks since no payroll cycle has hit yet, so
minFatigue alone anchors that step — added missing `event choose 0`
after every tick step) ·
✅ needs-morale-visual (**Finding #24: a scratch trace missing the
file's own `needs`/`employee list`/`scores` calls reported wrong
values** — rebuilt to replay the exact command sequence; confirmed a
real well-rested morale/wellBeing bonus at tick 100, a real penalty by
tick 250, and a real event — `union_pet_day` — that fires mid-batch on
the final tick step and genuinely boosts wellBeing back up on
resolution rather than leaving it at its drained low) ·
✅ needs-proactive-queue-visual (**Finding #25: added `pendingActionCount`
to `SerializableGameState`** — no field existed to prove a PendingAction
was ever queued; confirmed via direct trace that it genuinely drops to 0
once the dispatched work is claimed, then jumps back to 1 with no player
action in between once fatigue crashes near collapse — the auto-inserted
rest task this file was written to demonstrate, now actually proven) ·
✅ needs-replenishment-visual (**Finding #26: same root cause as Finding
#11's collapse-recovery.json, recurring in a second file** — the file's
claim that replenishment "restores gauge values over time" doesn't hold;
a direct trace shows rest cycles genuinely fire but each completion
burst is mostly offset by drain accrued during the rest itself, leaving
fatigue oscillating near the collapse floor indefinitely. Test corrected
to describe the real, verified behavior) ·
✅ needs-shift-cycle-visual (**Finding #27: third recurrence of the
Findings #20/#21/#26 pattern** — "employees work 6 ticks then auto-enter
8-tick sleep rest" is structurally unreachable since `processShiftCycle`
requires a Tier-2 bunkhouse, but this file's own `build upgrade 1` step
is genuinely rejected (T2 not researched), already correctly documented
by its own pre-existing description; confirmed via direct trace that
`ticksWorked`/`restTicksRemaining` never move through the whole budget)

Batch 5 needs-* group (9/9) done. Continuing with nav-*.
✅ nav-dynamic-updates-visual (1×1 grid blast then a vehicle move —
holeCount/chargedCount/sequencedCount and cash asserted through the
whole drill/charge/sequence/blast/vehicle pipeline, no findings) ·
✅ nav-move-costs-visual (1×3 grid, Finding #4 spacing-stepper fix
needed; a vehicle then crosses the drill_hole row's different NavGrid
cost — cash/holeCount/buildingCount/vehicleCount asserted throughout) ·
✅ nav-path-following-visual (**Finding #28: added `stuckEmployeeCount`
to `SerializableGameState`** — no field existed to prove `isMoveStuck`
ever flipped true/false; the file's own premise checked out for real —
boxing in the (0,0) corner with 3 management offices genuinely flips
employee #1 to stuck after `STUCK_THRESHOLD` consecutive pathfinding
failures, and demolishing all three genuinely un-sticks it; added
missing `event choose 0` after tick 19/tick 5/tick 10) ·
✅ nav-pathfinding-visual (3 management offices placed so a driller must
route *around* them, not through — `stuckEmployeeCount` stays 0 for
real across the full tick budget, confirming the file's sibling
contrast with nav-path-following-visual.json's deliberate box-in; no
findings) ·
✅ nav-ramp-routing-visual (vehicle + employee both route across a
`build_ramp`-cleared span toward the same destination; `buildingCount`
confirms a ramp doesn't register as a building, `stuckEmployeeCount`
stays 0 throughout confirming the ramp route works for both movers; no
findings) ·
✅ site-expansion (drilling/ramping/building past the original 32×32
bounds genuinely grows `worldSizeX`/`worldMinX` live — asserted through
the full drill→ramp→build→charge→sequence→blast→save→load pipeline;
the save/load round-trip step is the one that matters most here, since
it proves the expanded site bounds — not just cash/buildings — survive
a save/load, not only a live session; no findings)

Batch 5 complete: 22/22 (vehicle-* 7/7, needs-* 9/9, nav-*/site-
expansion 6/6).

### Batch 6 — employee/economy/misc (18) — **+ training parity check**
✅ employee-skill-progression-visual (**Finding #29** surfaced here —
see the findings log; cash/employeeCount/qualificationCount/
proficiencyTotal/pendingActionCount asserted throughout, including a
`note` on the final step documenting that no scalar exists for a
single employee's XP/level, only the roster-wide sum) ·
✅ employee-skills-visual (6 employees hired with distinct assign_skill
levels — qualificationCount/proficiencyTotal traced and asserted
exactly per assignment, including the one same-level no-op call
(driver's own starting driving.truck); 6 dispatches to one employee
assert pendingActionCount climbing 1→6, the task-queue-overflow this
file is named for; no findings) ·
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

4. **Finding #3 generalizes: the drill grid tool's spacing/depth steppers had
   no selector at all, not just a mismatched default.** `blast-drill-plan-
   ui.json` and `blast-drill-plan-visual.json` both declare an explicit
   `spacing:5`/`spacing:8` that the click could never reach — the only way
   to change spacing before dragging is the placement strip's own +/-
   stepper (`ParamStrip.ts`), which had no `data-field`/id distinguishing
   "the spacing stepper" from "the depth stepper," only bare
   `.bsx-stepper-btn` buttons in document order. **Fixed at the root**:
   added `data-field="<key>"` to each field's wrapper in `ParamStrip.ts`
   (one line, no behavior change, costs nothing) — a real, contained gap
   in scriptability, not a workaround. `#bs-param-strip [data-field="spacing"]
   .bsx-stepper-btn:last-child` now reaches it. Both files' grid steps now
   click the stepper the right number of times to reach their declared
   spacing before dragging (2 clicks 3→5; blast-drill-plan-ui's *second*
   grid needed 3 more clicks 5→8, since the panel's spacing value persists
   across grid operations within a session — nothing resets it, so the
   second grid's stepper count is relative to the first grid's ending
   value, not the 3m default). Verified in both modes with a real browser:
   `expect.equals.holeCount` now matches each command's declared rows×cols
   exactly, not merely "some holes exist."

   **This is very likely NOT limited to these 2 files.** Any scenario using
   `drill_plan grid` with `spacing` ≠ 3 (the panel default) via a bare
   `dragTiles` — with no stepper clicks — was silently drilling a
   different-shaped grid than its `command` field claims, invisibly, since
   nothing ever compared declared vs. actual hole count before `expect`
   existed. `blast-basic.json` (Batch 2, `spacing:4`) is a near-certain hit
   by the same hand computation; check **every** `drill_plan grid` step in
   Batches 2-7 for this exact class of bug — don't assume "it already
   passed the original #479 interaction-mode verification" means the grid
   shape was ever actually correct, since that verification never checked
   hole count either.

5. **Finding #4 generalizes past the Drill panel: the Charge panel's
   amount/stemming steppers had the identical no-selector gap, and worse —
   one of the two values in `blast-overcharge.json` was not reachable by
   *any* click at all.** `Charge.ts`'s `adjustStemming()` floors at
   `Math.max(0.5, ...)` — a hole can never be left truly unstemmed (0m) via
   the UI, only down to 0.5m, while the console's `charge ... stemming:0`
   has no such floor. `blast-overcharge.json`'s entire premise ("Stemming
   is what keeps a big charge working on the rock instead of throwing it,
   so an overcharge only turns dangerous once the holes are left
   unstemmed") depended on exactly the value a player can never produce.
   Before this fix, its Charge All click (never touching the amount/
   stemming steppers, because they had no selector) silently applied the
   panel's plain defaults (5kg/2m — identical to `blast-basic.json`'s
   ordinary charge) instead of anything resembling an overcharge, in every
   interaction-mode run since the file existed. Not a hypothetical: this
   scenario has never once exercised overcharge/flyrock behavior through a
   real click.

   **Fixed at the root** (same pattern as Finding #4): added
   `data-field="amount"`/`data-field="stemming"` to `Charge.ts`'s field
   wrappers. For the unreachable-floor case, rather than leave the file
   silently wrong or drop the click entirely, corrected the *declared*
   value to the true UI-reachable extreme (`stemming:0.5`, not `0`) and
   drove the steppers to it for real (3 amount clicks 5→8kg, 8 stemming
   clicks 2.0→0.5m) — the strongest overcharge a real player can actually
   create, verified against the real `chargesByHole` dump in interaction
   mode (`amountKg: 8, stemmingM: 0.5` on every hole), not assumed from the
   click count alone. `blast-undercharge.json` only needed the amount
   stepper (its `stemming:2` already matched the panel default) — also
   verified against the real dump.

   **A UI floor that makes a documented game mechanic ("stemming 0 = no
   confinement") literally unreachable by any player is itself worth a
   follow-up issue** (should `adjustStemming`'s floor be 0, matching the
   console? or is 0.5m intentional and the console should share the same
   floor?) — out of scope to decide here, filed as a note rather than
   silently working around it.

6. **`blast-preview-step-visual.json`/`blast-sequence-step-visual.json`/
   `blast-fire-step-visual.json` all bundled 2-3 console commands inside one
   step's `interaction` array** (e.g. `drill_plan grid` + `charge` +
   `sequence set` all under one bootstrap step) — same class as the original
   #479 Finding #5: `command-runner.ts`'s `runSteps` only ever executes the
   single top-level `step.command`, never the full `interaction` array, so
   command mode silently ran just the first command and skipped the rest.
   **Fixed** by splitting each into one step per command (established
   pattern, not a new one).

   Past that fix, `blast-sequence-step-visual.json` still failed: its
   delay-inc-click step declared `command: "state"` (a pure no-op read) while
   its `interaction` clicked `[data-action="delay-inc"]`, which
   (`Sequence.ts`'s `adjustHoleDelay`) issues `sequence set hole:H1
   delay:25ms` through the console bridge live. Command mode's `state`
   command never touches `sequenceDelays`, so `expect.equals.sequencedCount:
   1` failed in command mode even though the click legitimately works in
   interaction mode — a direct instance of the rule `scenario-defs.md`
   already states ("command and interaction must target the same place").
   **Fixed** by changing the step's `command` field to `sequence set
   hole:H1 delay:25ms` — the literal, verified effect of the click (`25` is
   `DEFAULT_DELAY_STEP_MS`, `Sequence.ts`) — rather than weakening the
   assertion. Re-verified 3/3 in both command and real-browser interaction
   mode.

7. **`multi-deck-blast.json` and `presplit-wall.json` both used the bare-numeric `hole:1`..`hole:5` form on their per-hole `charge` commands, instead of the real `H1`..`H5` ids `drill_plan grid`/`drill_plan add` actually assign.** `chargeCommand` (`mining.ts`) resolves a hole spec that doesn't match an exact id to the legacy `hole_${spec}` scheme ("Resolve holeId: accept either the exact ID (H1) or the legacy hole_N format") — `hole:1` becomes `hole_1`, which has never existed on any hole this game drills, so `ctx.state!.drillHoles.find(...)` always misses and the command returns `{success:false, output:'Hole "hole_1" not found'}`, never thrown. Every one of these charges silently failed, in every run of either file, for the file's entire history — `chargedCount` stayed 0 through the whole charge phase, and the subsequent `blast` command was rejected by `validateBlastPlan` ("Missing charge" on every hole) — also never thrown, so command mode's old assertion-free pass proved nothing. **Fixed** by using the real ids in both files.

8. **`drill_plan grid` unconditionally replaces the whole plan** (`ctx.state!.drillHoles = planned` plus `resetHoleIds()`, `mining.ts`/`DrillPlan.ts`) — it does not append. `presplit-wall.json` called it twice (a presplit row, then a production grid), and the second call silently discarded the first grid's 5 holes entirely and restarted hole numbering at H1, so the file's entire premise ("presplit row plus production holes, one blast") never actually existed as a single plan in any run, even before Finding #7's hole-id bug is considered. **Fixed** by restructuring: the production grid now drills first (`drill_plan grid`, H1-H9), then the 5 presplit holes are added individually via `drill_plan add` (H10-H14), which appends rather than replacing. This is also the first scenario file to exercise the Drill panel's single-hole placement UI (`data-action="add-hole-tool"`, a real `PlacementController` point-mode tool, `Drill.ts`) — previously used by no scenario at all — confirmed working via a real browser run and a screenshot showing all 13 (then 14) planned holes in the panel's list and on the minimap, in the presplit-row-plus-block layout the file's description always claimed.

   Also found while re-verifying: `explosive:presplit`, the id both files charged their wall holes with, **does not exist** — `ExplosiveCatalog.ts` defines exactly 8 fictional products (`pop_rock`, `boomite`, `krackle`, `big_bada_boom`, `shatternite`, `rumblox`, `obliviax`, `dynatomics`), none named or aliased `presplit`. `createCharge` returns `{error: 'Unknown explosive: "presplit"'}` for it — a *second*, independent reason every one of these charges would have failed even after Finding #7's hole-id fix. **Fixed** by substituting `pop_rock` — the catalog's lowest-energy (200 vs boomite's 340), lowest-projection-risk (0.5 vs 0.8), lowest-vibration product, i.e. the real product that actually matches a presplit line's job (a small controlled charge, not a production blast), rather than inventing a new explosive type (out of scope — a game-content decision, not a test fix).

9. **`vibration-budget.json`'s entire premise ("exceed vibration budget 3 times... verify $5,000 fine is applied") has no implementation anywhere in the codebase.** `recordVibration` (`ScoreManager.ts`) only moves `nuisance`/`ecology` — no budget counter, no cash deduction, no event or campaign rule ties a fine to blast count. Worse, the file's own declared charge (`explosive:boomite amount:15`) exceeds boomite's `maxChargeKg` of 8, so `batchCharge` rejected the whole charge every time (`success:false`, never thrown) — `chargedCount` stayed 0 through the file's entire history, meaning it never charged a single hole, let alone blasted one, let alone approached whatever a "vibration budget" was supposed to mean. **Fixed** in two parts: switched to `rumblox` (`ExplosiveCatalog.ts`'s own "defining trait: high vibration" product, `maxChargeKg` 20, `vibrationMod` 1.6 — the honest real product for this file's intent) so `amount:15` charges validly; and rewrote the file's description to test the real, checkable effect (nuisance/ecology cratering from repeated catastrophic overcharge blasts) instead of the fabricated fine. Whether the game should grow a real vibration-budget fine mechanic is a design question, filed as a follow-up rather than invented here.

   This also motivated a real mechanism extension: `ScenarioStepGoal`/`PlaytestGoal` had `increased` but no symmetric `decreased`, so a scenario had no way to assert a score dropped. Added `decreased?: string[]` to both types (`scenario-types.ts`/`playtest-types.ts`) and the matching check to both evaluators (`checkGoalAgainstState` in `scenario-goal.ts`, `checkGoal` in `playtest-driver.ts`), plus unit coverage in `scenario-goal.test.ts`/`goal-check.test.ts` and a real-engine integration test — mirrors `increased`'s exact shape, not a new pattern.

   Discovering this also surfaced that neither `window.__gameState()` nor `serializeGameState()` exposed the 4 `ScoreState` fields (`wellBeing`/`safety`/`ecology`/`nuisance`) at all — added to both in lockstep (Finding #2's pattern), committed separately as a foundational fix before this file's own commit, since it unblocks assertions in any future file touching morale/safety/ecology/nuisance, not just this one.

10. **Generalizes Finding #4/#5 to explosive selection itself.** `Charge.ts`'s `chargeAll()` issues `` `charge hole:* explosive:${this.selectedExplosiveId} amount:${this.amountKg}kg stemming:${this.stemmingM}m` `` from the panel's *own* selection state — `selectedExplosiveId` defaults to `boomite` (`DEFAULT_EXPLOSIVE`) and only changes when a product card is clicked (`data-action="select-explosive"`, `data-explosive="<id>"`). Every earlier scenario needing a non-default explosive got away with it by coincidence — `boomite` being the default meant `blast-basic.json` and friends never needed to click a card. `vibration-budget.json` declared `rumblox`, and its Charge All click never selected it: a real browser run confirmed the resulting blast used the panel's boomite/5kg/2m defaults instead, producing a normal blast (nuisance moved 50→49.975, essentially nothing) instead of the declared catastrophic overcharge — silently testing nothing like what the file claimed for its entire history. **Fixed** by clicking the `rumblox` product card before driving the amount/stemming steppers, verified against the real `chargesByHole` dump (`rumblox, amountKg: 15, stemmingM: 1` on every hole) and the resulting nuisance/ecology crater (50→19.47→0, 50→37.79→19.42→0, real browser numbers). Any future scenario charging a non-default explosive needs this same card click — check for it, don't assume Charge All alone is enough.

11. **`collapse-recovery.json`'s claim ("verify rest restores them to resume original task") does not hold at the file's own tick budget.** A direct engine run (hire a driller, build `living_quarters`, `tick 250` then `tick 100`) confirms collapse is genuine — `collapsedCount` 0→1, `wellBeing` craters — but the employee is **still collapsing at tick 350**, not recovered. Extending the run to 2350 ticks shows why: the hire spawns far from the build site (real distance ~82 tiles on this seed), and while individual rest cycles for a single need (fatigue alone) do complete and recover, the employee — fully idle, no drill plan, nothing to do between collapses — cycles through hunger/fatigue/breakNeed collapses repeatedly, each charging `NEED_REST_COSTS` (`GameLoop.ts`), draining cash steadily; morale/wellBeing crater alongside it, and the run ends in bankruptcy + `worker_revolt` (a level loss), never a clean single collapse→recover arc. Root cause not fully chased down — `tickNeedGauges` (`events.ts`) drains at the *idle* rate even while a rest action is in progress (`isWorking` requires `restTicksRemaining === null`), so a short or weak rest may net-lose ground against continued idle drain; whether that is a bug (rest should pause need drain) or intended difficulty (a company that hires someone and gives them no work should struggle) is a design question, not resolved here. **Fixed the test, not the game**: assertions now check only what a real run verifies — collapse is real (`collapsedCount`, `decreased: minFatigue/wellBeing`), recovery within 350 ticks is not claimed. Filed as a follow-up: either the needs/rest balance, or this scenario's own tick budget/setup, needs a second look before its original claim can be truthfully restored.

    This also motivated exposing 2 more previously-invisible fields, same pattern as Findings #2/#9: `collapsedCount` (employees with `Employee.collapsing === true`) and `minFatigue` (the roster's lowest `fatigue`, i.e. the employee closest to collapse — fatigue is inverted, 100 = fully rested, so *minimum* is the number that matters, not maximum). Added to `window.__gameState()`/`serializeGameState()` in lockstep, with real coverage in `console-api.test.ts`.

12. **`new_game` leaves `isPaused: false` by default** (`GameState.ts`) — with no explicit pause, a real browser's game loop keeps advancing the simulation on real wall-clock time throughout interaction mode, on top of whatever `tick N` commands a scenario issues explicitly. Command mode has no such thing — a headless Node.js run only advances when a `tick N`/`blast`/etc. command is literally executed, never on its own. `rock-fragmenter-breaking.json` exposed this: a `cash` `equals` check placed after a `tick 30` step (and the `waitForSelector`-heavy clicks around it) failed in a real browser — `cash should be 32748 but is 32769` — because the click round-trip's real elapsed time let the live sim tick further than the explicit `tick 30` alone would. Two back-to-back actions with no `tick`/heavy-wait gap between them (e.g. hire immediately followed by a buy, both in this same file) stayed exactly reproducible; it's specifically a step *following* a `tick N` or a slow `waitForSelector` where the drift shows up.

    **New ground rule (#12): don't assert an exact `equals` value on `cash` (or any field a running simulation keeps moving — salary drain, maintenance, need decay) on a step that follows a `tick N` command or a real wait/animation gap.** Use `decreased`/`increased` there instead — direction is reproducible across modes even when the exact magnitude isn't. Exact `equals` on such fields stays fine for steps with no tick/wait gap since the previous checkpoint (a hire immediately followed by a buy, nothing in between). This generalizes past `rock-fragmenter-breaking.json` — expect every playthrough-style file in Batches 5-7 with `tick N` steps to need the same treatment; check for it rather than assuming an exact economy value survives a tick gap in interaction mode.

13. **`buildRampCommand` deducted `ctx.state!.cash` directly but never called `addExpense` on `ctx.state!.finances`** (`mining.ts`) — a real, previously-invisible production bug, not a scenario-file issue. Every other cash-spending command (`employee hire`, `build`, `employee train`, `entities.ts`'s demolish/upgrade/relocate) pairs the flat `cash` mutation with `addExpense(state.finances, ...)`, keeping `finances.cash` in sync — `console-api.test.ts` already asserts this invariant ("mirrors cash in both the flat field and the finances object"), but only against a fresh game, so it never caught a command that skips one side. `build_ramp` was that command: the moment a ramp was built, `finances.cash` silently froze at its pre-ramp value while the real, player-visible `cash` field (what `FinancesPanel.ts` actually reads) kept moving correctly — a low-severity but genuine divergence, caught only because writing this file's assertions meant dumping both fields side by side for the first time. **Fixed at the root**: added the missing `addExpense(ctx.state!.finances, result.cost, 'construction', 'Build ramp', ctx.state!.tickCount)` call, matching the exact pattern every other construction-cost command already uses. New unit test in `mining-commands.test.ts` proving `finances.cash` and the flat `cash` field move together — would have caught this on its own.

    Also: ramps carve the voxel grid directly rather than creating a tracked entity (no `rampCount` field, or any state field at all, records that a ramp exists) — `cash` decreasing by the exact `RAMP_COST_PER_METER × length` amount is the strongest available state-level proof a `build_ramp` call actually landed, since there is nothing else to check it against.

14. Exposed `surveyCount` (`state.surveyResults.length`) on both `window.__gameState()` and `serializeGameState()`, same pattern as Findings #2/#9/#11/#13 — no field previously let a scenario prove a survey actually completed, only that the command didn't throw. Discovered while writing `survey-confidence-display.json`'s assertions that `survey <method>` queues an arrival-gated `PendingAction` (#437) rather than completing instantly — see ground rule #14 in the ground-rules section above (kept there rather than duplicated here, since it governs every survey-touching file in this batch).

15. **`survey-confidence-overlay.json`'s two `employee assign_skill` calls used positional arguments (`employee assign_skill 1 geology 5`)** instead of the named form (`skill:geology level:5`) `assignSkillCommand` actually requires — every call returned `{success:false, output:'Usage: employee assign_skill <id> skill:<category> level:1-5'}`, silently, never thrown. `proficiencyTotal` never moved off the two employees' starting Rookie-level qualifications (a flat 2) in any run of this file's history, undermining its own "two surveyors at different skill levels" premise — the sibling file `survey-confidence-display.json` had the correct syntax the whole time, making this an isolated typo in this one file, not a systemic gap. **Fixed** by correcting the syntax; verified `proficiencyTotal` reaches 6 (5+1) against a real engine run.

16. **A single employee holding several queued survey `PendingAction`s at once can silently lose one — a likely real engine bug, not chased to a root cause.** `survey-ore-vein-visibility.json` queues 4 `survey seismic` calls back to back (one surveyor, no ticks in between) and gives the surveyor a generous 77-tick budget (`tick 53` + 3× `tick 8`) to finish all 4. A direct engine trace — sampling `state.pendingActions`/`state.surveyResults` every 5 ticks — shows only 3 of the 4 ever complete: the action targeting (15, 25) disappears from `pendingActions` between two consecutive samples without ever producing a matching `SurveyResult`. `survey show`/`surveyCount` give no hint anything went wrong — the queue is genuinely empty (`"No pending surveys."`), so this reads as "everything finished" unless the actual count is checked against what was queued. Confirmed deterministic (reproduces identically in both command mode and a real browser run, same seed). Root cause not chased down — would need tracing `tickEmployees`'/the `PendingAction` claim-and-dispatch order for one employee holding multiple same-type actions, a bigger investigation than this pass scopes to. **Fixed the test, not the game**: this file's assertions use the real, verified ceiling (3, not the naively-expected 4) after round 1, carrying through to a 4-survey total at the end (3 + the round-2 `core_sample`, not 5). Filed as a follow-up — worth a dedicated investigation into the employee-dispatch/PendingAction-claim path, since silently dropping a queued player-paid-for action is a real gameplay defect if it holds up under scrutiny.

17. **A regression test locked in a stale literal after Finding #5's own fix.** `tests/unit/scenario-defs-blast-visual-coverage.test.ts` (issue #404 coverage) hardcoded `charge hole:* explosive:boomite amount:8 stemming:0` as the expected max-charge command string in `blast-execution-visual.json`. But `Charge.ts`'s `adjustStemming` floors at `Math.max(0.5, ...)` — the stemming stepper can never reach 0 by clicking — so when Finding #5 fixed that file's charge steps to match what interaction mode can actually click, the command field correctly became `stemming:0.5`, not `stemming:0`. The coverage test was never updated to match, so it sat red until this session's full local sweep caught it (full-sweep discipline working as intended — a channel red before arrival, per ground rule/CLAUDE.md's channel-6 rule, not something to skip past). **Fixed**: updated the test's literal and comment to `0.5`, noting why (the achievable floor, not a literal zero) instead of reverting the scenario file.

18. **`skill-progression.json`'s whole premise was untestable as written.** The file's own name and description promise "verify Level 5 after 700 ticks of work," but the file only ever hired a driller, assigned a `driving.excavator` qualification, and ticked 700 times — no task was ever dispatched to that employee. `gainXp` (`EmployeeGainXp.ts`) is only ever called from `tickTaskProgress` (`GameLoop.ts`), gated on `emp.taskTicksRemaining !== null` — i.e. XP only accrues while a task is actively in progress. An idle employee, no matter how many ticks pass, never gains a single point of XP. Confirmed via a real dump: after the original sequence, `driving.excavator` stayed at proficiencyLevel 1, xp 0, for the full 700 ticks. **Fixed for real, not just re-scoped to the broken behavior**: `employee dispatch <id> x:<X> z:<Z> skill:<category>` is a console-only helper that already exists in `employees.ts` specifically so "console/scenario driving can put an employee to genuine, ticksWorked-incrementing work without a full drill/haul pipeline" (its own doc comment). Queuing 40 of these up front (before any tick) gives the driller continuous excavator work through the full 700-tick budget — verified via a real dump this reaches proficiencyLevel 5 (xp 1266), matching the file's original, previously-unverified claim.
19. **A single large `tick N` step can silently deliver far fewer than N real ticks — a gap in test-writing method, not a game bug — discovered while verifying Finding #18's fix.** Every scratch check up to this point had called `runner.run(cmd)` directly, which does not increment `state.events`'s action counter and so never triggers a random event. The real scenario runner instead calls `runCommand(engine, cmd)` (`command-runner.ts`), which wraps every non-meta command with `incrementActionCount` — meaning random events can fire mid-command in the real path even though they never did in any of this session's scratch scripts. `tick` (`console/commands/events.ts:89`) refuses to advance a single tick while `state.events.pendingEvent` is set, and separately, an event firing mid-batch stops that batch right there (`tick 700` returned `"...(Advanced 135 of 700 requested ticks)"` when a random event fired at relative tick 135) — the unconsumed remainder is not queued for later, it is simply lost. A single `tick 700` step with no `event choose 0` therefore silently delivered only 135 real ticks in Finding #18's fix, leaving the skill stuck below level 5 and the new `expect` failing. **Fixed** by chunking into 14× (`tick 50`, `event choose 0`) — the same pattern every other file in this batch already uses for exactly this reason, just not yet applied to this file's original, pre-existing `tick 700` step. Worth remembering for any future large bare `tick N` step: verify it against the real `runCommand` path, not a bare `runner.run` scratch script, before trusting the tick count it reports actually landed.

20. **`building-research-progression-visual.json`'s whole back half narrative was false — a cascading consequence of the already-known "build has no funds guard" bug (Finding #1's class), never previously noticed.** The file's description promised "Tier 3 progresses over ticks and becomes buildable once its own Tier 2 research has completed." A real dump shows this never happens: this file starts with only $50,000 cash, and the Tier 2 `research_center` build (which does genuinely succeed once Tier 2 is researched) costs $60,000 — driving cash to -$40,015. The following `research queue type:research_center tier:3` step, which the file's own step description claimed "Now succeeds," is instead rejected with `insufficient_funds` (Tier 3 research costs $12,000, and cash is deeply negative). Tier 3 research is therefore never queued at all — the two `research status` steps that follow, whose descriptions claimed "still in progress" and "has now completed," both actually show "No research queued" throughout, and the closing Tier 3 build attempt is rejected for the ordinary "not researched" reason (not "the target id doesn't exist," which one reused boilerplate description implied). **Fixed the test to describe reality, not the intended-but-broken narrative** — every misleading step description in the second half of this file corrected, and `expect` blocks added confirming: the Tier 2 overdraw is real, the Tier 3 queue attempt is genuinely rejected, both tick rounds are no-ops, and `buildingCount` never exceeds 2. Root cause (Finding #1's class) not fixed here — already an accepted, filed, out-of-scope bug. `building-research-visual.json` is the sibling file (higher $230,000 starting cash) where the identical T1→T2→T3 progression genuinely completes; confirmed via a real dump and given full assertions of its own, closing the research-center-gate parity row's "Tier 2/3 unlock is real" requirement for that half.

21. **`vehicle-traffic.json`'s stated purpose — "verify TrafficJamEvent triggers" — never actually happens, at any tick budget.** A direct engine trace (sampling `state.vehicles.vehicles`/`state.events.pendingEvent` tick by tick) found two independent reasons: (1) the file redirects 3 vehicles toward 3 separate staging tiles, then re-redirects all 3 onto one shared tile only 5 ticks later — nowhere near enough travel time from the shared vehicle spawn point to actually reach the staging tiles first, so all 3 vehicles travel in perfect lockstep the whole way and arrive together with no contention at all (confirmed: identical x/z every tick, `state: moving` the whole time, never `waiting`); (2) even after fixing the timing in an isolated trace (50 real staging ticks, so the 3 vehicles do reach genuinely separate tiles before redirecting), `detectTrafficJam` (`EventEngine.ts`) requires `TRAFFIC_JAM_MIN_VEHICLES=3` vehicles *simultaneously* in the `waiting` state on the same target — but converging only 3 vehicles onto one tile means at most 1 occupies it and 2 can ever be blocked waiting, one short of the threshold structurally, regardless of timing. A real jam needs a 4th vehicle also converging on the same point (tested directly: even that configuration didn't reliably produce 3 simultaneous waiters, since vehicles approaching along the same axis queue through without blocking each other) — chasing an exact working configuration went past what's reasonable for one file's coverage. **Fixed the test to describe reality, not the intended-but-unreachable narrative**: the file's own description and this section's assertions now state plainly that TrafficJamEvent does not fire here, with the root cause explained, rather than silently passing 21 steps that only exercise vehicle pathing/redirection.

22. **`vehicle-traffic-routing-visual.json`'s traffic-jam timing was off by a few ticks — unlike Finding #21's sibling file, this one's premise is genuinely reachable and just needed the fix.** This file converges all 4 purchased vehicles (not 3, like `vehicle-traffic.json`) onto one tile — exactly the configuration Finding #21 identified as structurally necessary for `TRAFFIC_JAM_MIN_VEHICLES=3` to be satisfiable (1 vehicle occupies the tile, the other 3 can all end up simultaneously `waiting`). But a direct engine trace (sampling `state.events.pendingEvent` tick by tick) showed the jam actually fires at absolute tick 25, not tick 20 as the file's own prior step description assumed — its existing 6+16=22 total tick budget was 3 ticks short and left the event unfired every single run, despite the file's confident inline commentary about the timing having already been worked out. **Fixed**: extended the second tick step from `tick 16` to `tick 26` (6+26=32 total, real margin past the confirmed tick-25 fire point), re-verified via a fresh direct trace that the event does fire by then. No scalar field exists in `SerializableGameState` for `pendingEvent`, so the `expect` anchors on `vehicleCount` staying at 4 with a `note` documenting the trace-confirmed trigger, matching the precedent set by `vehicle-traffic.json` (Finding #21) for the same missing-field situation.

23. **`needs-collapse-visual.json` was missing `event choose 0` after several of its tick steps, class-matching Finding #19 — but this file's core claim (real collapse then real recovery) turned out to be TRUE once fixed, unlike Findings #20/#21.** The file had `event choose 0` after only one of its six tick steps (`tick 200`); a direct engine trace confirmed a real random event (`union_pet_day`) fires around tick 255 in this exact run, and since `tick` refuses to advance at all while an event is pending, every step after that point was silently frozen — cash, fatigue, and employee status all stopped changing entirely for the rest of the scenario, even though the file's own narrative depended on ticks after that point (the living_quarters build and its recovery-effect checks). **Fixed** by adding `event choose 0` after every tick step, matching the codebase-wide convention this file had only partially applied. Once fixed, a full re-trace confirmed the file's actual premise holds: the dispatched employee genuinely collapses at 50 ticks (`collapsedCount` 0→1), genuinely recovers by 250 ticks (`collapsedCount` back to 0) with no rest building present yet, and stays recovered through to the end after `living_quarters` is built — real collapse and real recovery, not a Finding #11-class false claim.

24. **A scratch trace that omits the file's own read-only observe commands (`needs`/`employee list`/`scores`) can report the wrong values — an addendum to Finding #19, discovered writing `needs-morale-visual.json`.** Every non-meta command through `runCommand` increments the action counter that drives random-event timing, including purely observational commands with no state effect of their own. A scratch script that ticks-and-resolves without also replaying the file's interleaved `needs`/`employee list`/`scores` calls advances the RNG on a different schedule than the real scenario, so an event can fire at a different relative tick — in this file, first-draft values (from a scratch trace missing those calls) claimed `wellBeing` bottoms out at 0 by the final tick step; the real scenario run left `cash` frozen mid-batch instead (`expect failed: cash should have decreased but went 35150 → 35150`), because a real event (`union_pet_day`, verified via a corrected trace that replays every command in file order) fires only ~5 ticks into that batch and blocks the rest before a payroll cycle can hit. Resolving it doesn't leave `wellBeing` at its drained low either — the event's own outcome genuinely raises it back up (30.17→38.17). **Fixed** by rebuilding the trace to replay the file's exact command sequence (including every observe step) and re-deriving the assertions from that, then adding `increased: ["wellBeing"]` on the `event choose 0` step itself to lock in the real, verified effect rather than assuming the drain just continues unchecked. Lesson for future files: a scratch trace must mirror every command a scenario file issues, not just the ones that visibly mutate state, whenever an assertion sits anywhere near a tick large enough to risk crossing a random-event boundary.

25. **Added `pendingActionCount` (state.pendingActions.length) to `SerializableGameState`** while writing `needs-proactive-queue-visual.json` — no field existed to prove a `PendingAction` was ever queued at all, which this file's whole premise depends on (an auto-inserted rest task appearing in the queue once fatigue crashes near collapse). Added in lockstep across `console-api.ts`/`main.ts`/`validate-state-schema.ts`, with real tests in `console-api.test.ts` (zero on a fresh game; 1 right after a survey is queued, before it's claimed — reuses the existing arrival-gated survey pattern as a ready-made non-trivial case). Confirmed via a direct trace (replaying the file's exact command sequence, per Finding #24's lesson) that `pendingActionCount` genuinely drops to 0 once the dispatched work task is claimed, then jumps back to 1 with no player action in between once fatigue crashes near collapse — the auto-insertion this file was written to demonstrate, now actually proven rather than just screenshotted.

26. **`needs-replenishment-visual.json`'s claim — "verify need replenishment... restores gauge values over time" — does not hold, the same root cause Finding #11 already documented in `collapse-recovery.json` recurring in a second file.** A direct engine trace (sampling `employees.employees[0].fatigue`/`restTicksRemaining`/`pendingActions` tick by tick) confirms `autoInsertNeedTasks` genuinely queues and claims rest tasks once fatigue crosses its warning threshold, and each rest completion does give a real burst (~+7.6), but `tickNeedGauges` keeps draining fatigue at the idle rate *throughout* the rest cycle itself — so the completion burst is mostly offset by the drain accrued during that same rest, and by 210 total ticks the employee is oscillating in a narrow band (0-8) near the collapse floor indefinitely, never climbing back to a healthy baseline. **Fixed the test to describe this real, verified behavior** rather than the original claim — same treatment as Finding #11, not a re-investigation of the root cause (already correctly left as an open design question there: "a possible bug OR intended difficulty").

27. **`needs-shift-cycle-visual.json`'s claim — "employees work 6 ticks then auto-enter 8-tick sleep rest" — is structurally unreachable, a third recurrence of the Findings #20/#21/#26 pattern.** `processShiftCycle` (`GameLoop.ts`) requires a `living_quarters` with `tier >= 2` and returns `{active: false}` (does nothing at all) otherwise — but this file's own very next step, `build upgrade 1`, is genuinely rejected (`Tier 2 living_quarters is not researched`), already correctly documented as a real no-op by its own pre-existing description. That leaves the built living_quarters at Tier 1 for the whole scenario, so the shift-cycle mechanic this file is named for never activates. Confirmed via a direct trace: `ticksWorked` stays 0 and `restTicksRemaining` stays `null` through the entire 20-tick budget, no matter how long the employee stays dispatched. **Fixed the test to describe this real, verified behavior** (ordinary idle/work need-drain, no shift cycle) rather than the originally-intended claim — same treatment as Findings #20/#21/#26, not a root-cause fix (the T2-research gate is a real, intentional game mechanic, not a bug).
28. **Added `stuckEmployeeCount` (`state.employees.employees.filter(e => e.isMoveStuck).length`) to `SerializableGameState`** while writing `nav-path-following-visual.json` — no field existed to prove the `isMoveStuck` state (`Employee.ts`) ever actually flipped, which this file's whole premise depends on (boxing an employee in with buildings, then freeing it again). Added in lockstep across `console-api.ts`/`main.ts`/`validate-state-schema.ts`, with real tests in `console-api.test.ts` (zero on a fresh game with no employees; a full box-in/demolish sequence proving 0→1→0). Confirmed via a direct trace (`runCommand`, replaying the file's exact command sequence including its interleaved `event choose 0` steps, per Finding #19/#24's lesson) that the file's own premise holds for real: employee #1 genuinely flips to stuck after 3 management offices seal the (0,0) corner and `STUCK_THRESHOLD` consecutive pathfinding failures accrue (`tick 5`, `stuckEmployeeCount: 1`), stays stuck through a further `tick 10` (still 1, `moveConsecutiveFailures` climbing 5→15), and genuinely resumes once all three buildings are demolished (`tick 15`, back to 0). Also added the file's two missing `event choose 0` steps (after `tick 19` and `tick 5`, matching the Finding #23 pattern) that this file had never had.

29. **Two real, previously-hidden cash-tracking bugs, both found while tracing `employee-skill-progression-visual.json` for Batch 6 — one a severe gameplay bug, the other exposed only once the first was fixed.** (a) `event choose`'s handler (`console/commands/events.ts`) called `resolveEvent`, which applies a `cashDelta` consequence via `addIncome`/`addExpense` on `state.finances` only — it never touched the flat top-level `state.cash` field, which is what `FinancesPanel.ts` (the player's actual cash display), the bankruptcy threshold check (`state.cash < BANKRUPTCY_THRESHOLD`, `Bankruptcy.ts`), and `serializeGameState()`'s flat `cash` field all read. Every event with a `cashDelta` — dozens across the whole catalog (Weather/Union/Politics/Mafia/Lawsuit/OreReport/TrafficJam/Tutorial/UnqualifiedTask events) — was silently a no-op on the player's real balance and could never trigger bankruptcy, in both command mode and a real browser (`EventModal.ts` routes through the identical `event choose` command). **Fixed** by mirroring `result.cashChange` onto `state.cash` in the command handler, the same dual-write (`state.cash -=/+= amount; addExpense/addIncome(state.finances, amount, ...)`) every other cash-moving command in that file already uses. New integration test (`events.integration.test.ts`) proving `state.cash` and `state.finances.cash` move together after `event choose`. (b) Fixing (a) let `state.cash` go genuinely negative for the first time in `needs-proactive-queue-visual.json`'s own trace (a `politics_mining_ban_vote` event, -$80,000) — which exposed `deductRestCost` (`GameLoop.ts`): `state.cash = Math.max(0, state.cash - cost)` doesn't just floor the *deduction* at 0 (the documented intent), it resets any *pre-existing* negative cash back up to exactly 0 on the very next need-rest visit, silently erasing real debt — confirmed via direct trace (a `-48870` balance snapped to `-586` net across one `tick 30` step, ~$50k of unearned "debt forgiveness" from ordinary need-servicing). None of the function's 6 existing unit tests caught this since none started from a negative `state.cash`. **Fixed** by clamping the deduction itself to `[0, cash]` (`Math.max(0, Math.min(state.cash, cost))`) and subtracting only that, leaving already-negative cash untouched — preserves all 6 existing tests' expected values (only the never-before-tested negative-starting-cash path changes), with a new 7th test locking in the fix. Both fixed at the root, not the test; the batch's own `needs-proactive-queue-visual.json` (Finding #25's file, no longer being actively edited but re-verified as part of the full sweep) needed zero assertion changes after the second fix — its pre-existing `decreased: ["cash", ...]` check on that same step is what caught the regression in the first place.

_(Add new findings here as you hit them. Number sequentially.)_

## Status table

Legend: ⬜ not started · 🔶 in progress · ✅ expect added + unmarked-step
audit done + both modes verified

### ✅ Done (14) — Batch 1 complete
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
- blast-hole-picking-visual, blast-drill-plan-ui, blast-drill-plan-visual
  (Batch 1 — Finding #4: the drill grid spacing stepper had no selector at
  all; fixed at the root in `ParamStrip.ts`, both files' grids now reach
  their declared exact spacing before dragging)
- i18n-live-locale-switch (baseline + `usable`/`blocked` on the locale
  switch's panel-still-alive and mutual-exclusion checks; no text-content
  assertion field exists, screenshots remain the real proof of "is it
  French")
- crew-fleet-panels-visual (real hiring/purchase costs verified against
  `HIRING_COSTS`/the actual state dump; the drill_rig cash-guard finding
  from #479 now has a real `expect.blocked` proof instead of just a
  documented note)
- money-surfaces-visual (holeCount/chargedCount/sequencedCount through a
  full drill→charge→sequence→blast→reset cycle, all against real dumps;
  `blocked` used for presence-proof on the accepted contract's disabled
  Deliver row — a deliberate, explained stretch of its usual "must not be
  reachable" meaning)

Batch 1 done: 14/14, 4 findings (2 real production/content bugs fixed —
#3 command/click grid mismatch, #4 missing stepper selector — plus the 2
foundational mechanism fixes: state-parity #2, the mechanism itself #1).
108 remaining across Batches 2-7. Parity audits for research-center-gate/
training still open; tutorial.json's gap is scoped (2 missing negative-test
beats + no `expect` blocks yet in tutorial-interactive.json). **Ground rule
#10 (new): every remaining `drill_plan grid` step in Batches 2-7 needs a
hand-check against the real panel spacing state, not just an `expect` bolt-
on — Finding #4 is very likely not limited to the 2 files found so far.**

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
- 2026-08-07 — **Batch 1 complete (14 files).** playtest scene-picking.json
  parity closed (scene-picking-visual.json was building-only; extended with
  4 employee-picking steps). Two real, previously-invisible bugs found and
  fixed via the new assertions, not just assertions added: Finding #3
  (nav-cell-types-visual/nav-minimap-integration-visual's `drill_plan grid`
  command field never matched what the click actually produced — the
  panel's spacing state, not the command's declared spacing, decides the
  real grid) and Finding #4, which generalizes it (the spacing/depth
  stepper had no selector at all until `ParamStrip.ts` got `data-field`
  attributes — a root fix, not a per-file workaround). Also fixed a real
  command/interaction state-parity gap before starting the batch (Finding
  #2: `serializeGameState` was missing fields `window.__gameState()`
  already had, silently breaking command-mode assertions on them).
  **Ground rule #10 added**: every remaining `drill_plan grid` step across
  Batches 2-7 needs a hand-check against the real panel spacing state — the
  original #479 interaction-mode pass never compared hole counts, so
  "it already passed" proves nothing about whether the grid shape was ever
  right. Full local sweep green after every commit (typecheck, 8284 tests,
  124/124 command-mode scenarios, each batch's files individually verified
  in interaction mode with a real browser). GitHub Actions still down this
  whole session — all verification remains local. Next: Batch 2 (blast-*,
  25 files) — expect several more Finding-#4-class grid mismatches there,
  per the note left in that finding.
- 2026-08-07 — Batch 2 (blast-*, 25 files) completed 25/25 since the prior
  log line (not itemized here per-file — see Findings #7-#13 for the real
  bugs it turned up: hole-id syntax, `drill_plan grid` replace-not-append,
  nonexistent `presplit` explosive, charge-amount-over-max silently
  rejected, Charge-All using whatever explosive was last selected, tick-
  drift on `equals` after a wall-clock gap, `buildRampCommand`'s finance
  desync). Batch 3 (survey-*, 12 files) reached 7/12: survey-confidence-
  display, survey-confidence-overlay, survey-execution, survey-method-
  selection, survey-ore-vein-visibility, survey-overlay-lifecycle (all
  carried over from before this log entry — see Findings #14-#16), plus
  survey-post-blast-ore-report finished this session (2 survey rounds,
  Finding #4 grid-spacing fix, full drill/charge/sequence/blast pipeline,
  `survey ore_report`'s rich-text output left unmarked). Full local sweep
  green after the file: typecheck clean, 124/124 command-mode scenarios,
  8300/8300 unit+integration tests. One pre-existing red found and fixed
  during the sweep, unrelated to this file's edits — Finding #17: `tests/
  unit/scenario-defs-blast-visual-coverage.test.ts` hardcoded a stale
  `stemming:0` literal that Finding #5's own fix (during Batch 2) had
  already moved to `stemming:0.5` in the scenario file itself; updated the
  test to match, per CLAUDE.md's rule that a channel red before arrival is
  a finding to fix, not a precondition to shrug past. GitHub Actions still
  not re-checked this session — all verification remains local. Next: the
  5 remaining Batch 3 files (survey-result-visualization, survey-seismic-
  side-effects, survey-stale-handling, survey-then-blast, survey-then-
  blast-playthrough, skill-progression).
- 2026-08-07 (cont.) — Finished Batch 3: survey-result-visualization,
  survey-seismic-side-effects, survey-stale-handling, survey-then-blast,
  survey-then-blast-playthrough, skill-progression — 12/12, committed and
  pushed individually. Two more Finding-#15-class positional-arg bugs
  found and fixed (survey-then-blast, survey-then-blast-playthrough).
  skill-progression.json needed real repair, not just assertions bolted
  on: Finding #18 (its whole premise — XP after idle ticks — was
  untestable, fixed by giving the employee real dispatched work) and
  Finding #19 (a single `tick 700` step silently under-runs against the
  real `runCommand` path once a random event fires mid-batch; fixed by
  chunking into the same tick/event-choose pattern already used
  everywhere else). Full local sweep green after every file: typecheck,
  124/124 command-mode scenarios, 8300/8300 unit+integration tests.
  GitHub Actions still not re-checked this session — all verification
  remains local. Batch 3 complete. Next: Batch 4 — building-* (12 files)
  plus the research-center-gate parity check.
- 2026-08-07 (cont.) — Batch 4 complete: 12/12 building-* files,
  committed and pushed individually. Notable: Finding #20 —
  building-research-progression-visual.json's back-half narrative was
  entirely false (Tier 3 was claimed to unlock over ticks but never
  does, a cascading consequence of the already-known Finding #1 funds-
  guard gap); every misleading step description in that file corrected
  to match verified reality, not the intended-but-broken story. Its
  sibling building-research-visual.json (higher starting cash) does
  complete the real T1→T2→T3 progression and is now fully asserted,
  closing the research-center-gate.json parity row's tier-unlock half —
  the #442 prerequisite-gate half (Queue Research with zero Research
  Centers built at all) is still open, deferred to Phase 3, not
  blocking. Full local sweep green after every file: typecheck,
  124/124 command-mode scenarios, 8300/8300 unit+integration tests.
  GitHub Actions still not re-checked this session — all verification
  remains local. Next: Batch 5 — vehicle-*/needs-*/nav-* (22 files).
- 2026-08-07 (cont.) — Batch 5's vehicle-* (7/7) and needs-* (9/9) groups
  complete, committed and pushed individually per file. Findings #21/#22
  (traffic-jam timing, one file's premise structurally unreachable, its
  sibling fixed by extending the tick budget), #23/#24 (missing
  `event choose 0` steps freezing back-halves of files, plus the
  scratch-trace-must-replay-every-command lesson), #25 (added
  `pendingActionCount` field), #26/#27 (two more recurrences of Finding
  #11's rest-vs-drain-offset pattern, tests corrected to real behavior,
  root cause not re-chased). Continued into nav-*: nav-dynamic-updates-
  visual and nav-move-costs-visual done with no new findings beyond
  Finding #4's spacing-stepper class. Then nav-path-following-visual:
  Finding #28 — added `stuckEmployeeCount` to `SerializableGameState`
  (lockstep across console-api.ts/main.ts/validate-state-schema.ts, two
  new console-api.test.ts tests), added its two missing `event choose 0`
  steps, and confirmed via direct trace that the file's own premise
  (boxing an employee in with 3 buildings genuinely triggers the stuck
  state; demolishing them genuinely clears it) holds for real. Verified
  in both command mode and a real browser (interaction mode) before the
  full sweep. Full local sweep green: typecheck clean, 124/124 command-
  mode scenarios, 8304/8304 unit+integration tests (up from 8302 with
  the two new stuckEmployeeCount tests). GitHub Actions still not
  re-checked this session — all verification remains local. Batch 5:
  19/22 done (vehicle-* 7/7, needs-* 9/9, nav-*/site-expansion 3/6).
  Next: nav-pathfinding-visual, nav-ramp-routing-visual, site-expansion.
- 2026-08-07 (cont.) — Batch 5 complete: nav-pathfinding-visual,
  nav-ramp-routing-visual, site-expansion — 3/3, committed together with
  the plan doc update. No new findings in any of the three — each
  file's own premise checked out for real against a direct engine
  trace before assertions were written. nav-pathfinding-visual proves
  the sibling contrast with nav-path-following-visual.json's box-in
  (obstacles placed so routing succeeds around them, stuckEmployeeCount
  stays 0). nav-ramp-routing-visual proves a built ramp doesn't count
  as a building and both a vehicle and an employee route across it
  without going stuck. site-expansion is the most consequential of the
  three: verified worldSizeX/worldMinX genuinely grow live as
  drill/ramp/build commands land outside the original 32×32 bounds,
  and — the point the save/load steps exist to prove — that the
  expanded bounds survive a real save/load round-trip, not just a live
  session. All three verified in both command mode and a real browser.
  Full local sweep green: typecheck clean, 124/124 command-mode
  scenarios, 8304/8304 unit+integration tests. GitHub Actions still not
  re-checked this session — all verification remains local. Batch 5:
  22/22 done. Next: Batch 6 — employee/economy/misc (18 files) plus the
  training parity check (employee-training.json vs training.json).
- 2026-08-07 (cont.) — Started Batch 6. First file
  (employee-skill-progression-visual.json) led to Finding #29: two real
  cash-tracking bugs, committed separately before returning to scenario
  work — see the findings log for the full writeup. (a) `event choose`
  applied a resolved event's cashDelta to state.finances.cash only,
  never to the flat state.cash field FinancesPanel/bankruptcy/
  serializeGameState all actually read — every event with a cashDelta
  was silently a no-op on the player's real balance, in both command
  mode and a real browser. (b) fixing (a) let cash go genuinely
  negative for the first time in needs-proactive-queue-visual.json's
  own trace, which exposed deductRestCost silently resetting any
  pre-existing negative cash back up to exactly 0 on the next
  need-rest visit. Both fixed at the root with regression tests;
  needs-proactive-queue-visual.json itself needed zero assertion
  changes — its pre-existing decreased-cash check on that step is what
  caught the regression. Then finished employee-skill-progression-
  visual.json's own assertions (re-traced with both fixes applied) and
  employee-skills-visual.json (6 employees, distinct assign_skill
  levels, task-queue-overflow via 6 dispatches to one employee) — 2/18
  done, no further findings in either. Full local sweep green after
  every commit: typecheck, 124/124 scenarios, 8306/8306 tests. GitHub
  Actions still not re-checked this session — all verification remains
  local. Next: employee-training.json (+ its parity check against
  training.json), then the rest of Batch 6.
