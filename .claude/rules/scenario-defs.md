---
paths:
  - "scripts/scenario-defs/**/*.json"
  - "scripts/scenario-*.ts"
  - "scripts/run-all-scenarios.ts"
  - "scripts/shared/*.ts"
---

# Scenario Definitions

Scenario JSON drives two verification channels from one file: `scenario` (command mode, pure Node.js) and `visual` (interaction mode, real Puppeteer clicks). In command mode, a step whose command the console refuses (`success: false`) fails the scenario unless the step declares `commandOutcome`.

- Every step carries a `command`. Steps that also carry an `interaction` array run through the UI in interaction mode; steps without one fall back to the command.
- Both modes must pass. `npm run scenarios` covers command mode; `npm run scenarios:interaction` covers the browser path.
- Step shape is typed in `scripts/shared/scenario-types.ts`. `tests/unit/scenario-defs-validation/shape.test.ts` and its sibling files under `tests/unit/scenario-defs-validation/` validate every scenario file — a new scenario is not done until that suite passes.
- **Address tiles in tile space, never in pixels.** Use `pickTile` / `dragTiles`, which recompute the mapping from the live picker canvas. A baked `click x/y` drifts onto the wrong tile the moment the HUD is relaid out, and reports nothing worse than "the step did not complete" — the failure surfaces steps later, on an unrelated control.
- A step's `command` and its `interaction` must target the same place. Command mode reads the command, interaction mode reads the clicks; when they disagree the two channels silently test different things.
- Tutorial scenarios run under the tutorial's rails: off-target controls are inert and pickers reject tiles outside the step's region (`REGION` in `src/ui/tutorialStages.ts`). A scenario that clicks what the current step does not allow is asserting something no player could do.
- Screenshots are opt-in via `--screenshots`. State JSON is always written, one file per step.

## Step role (issue #479, extended by #515)

A step sets `role: 'player' | 'setup' | 'observe' | 'bootstrap' | 'guard'` (`ScenarioStepRole`, `scripts/shared/scenario-types.ts`). This is what makes interaction mode a second, UI-driven proof of a scenario instead of the console replayed in a browser — measured at 94% `command` actions before #479. Issue #515 turns `role` from a convention a step could skip into a structural lint (`tests/unit/lint/ScenarioStepsHaveRole.test.ts`): every step now carries one of these five, or is a documented, individually-tracked exception — untagged is no longer a valid resting state.

- `role: 'player'` — the step models something a player does. Its `interaction` array may **never** contain a `command` action; `checkStepActionAllowed` (`interaction-executor.ts`) throws, naming the step, before the command reaches the game. A step that cannot actually be clicked is a real finding, not license to type it instead — file it as an issue. Every action a skill gate requires must be obtainable in game: if a qualification, licence, or proficiency level has no button and no in-game path, say so — an unreachable gate is a dead end, not a difficulty setting.
- `role: 'setup'` — world bootstrapping and time control. Its `interaction` array may use `command`, but only for tokens `isAllowedSetupCommand` (`scripts/shared/interaction-types.ts`) admits. A setup step reaching for `employee assign_skill` or any other gameplay command to dodge a hard click is exactly the drift #479 fixed. Never widen `SETUP_COMMAND_ALLOWLIST`/`BOOTSTRAP_COMMAND_ALLOWLIST` just to get a step green — a step that needs a wider allowlist is a missing UI control, not an allowlist gap.
- `role: 'observe'` — read-only inspection: `state`, `scores`, `finances`, `vehicle list`, and the rest of `OBSERVATION_COMMANDS`/`OBSERVATION_SUBCOMMANDS` (`isObservationCommand`, `interaction-executor.ts`). This is how the harness records what happened; it has no UI equivalent by design, so it stays a command — but only one `isObservationCommand` actually admits, checked the same way `setup` is, never assumed from the step's own intent.
- `role: 'bootstrap'` — a mutating command with no UI equivalent and no business having one (e.g. `employee assign_skill`, which exists so a test doesn't have to grind XP for real — the player-facing path is `employee train`). Narrower than `setup`'s allowlist: only tokens `isAllowedBootstrapCommand` (`BOOTSTRAP_COMMAND_ALLOWLIST`, `interaction-executor.ts`) admits, an explicit, individually-commented list — reserved for legitimate test-only primitives, audited entry-by-entry rather than accepted on a step's own say-so.
- `role: 'guard'` — the step proves a specific control is unreachable, not that one was clicked: it requires `expect.blocked` naming the control. This is the rejection-path counterpart to `player` — a guard step with no `blocked` goal is not actually proving anything and fails validation.
- No `role` — no longer a valid steady state (see above). What used to rest here untagged is now either converted to one of the five roles or a documented permanent exception tracked individually; a step reaching for a gameplay command to dodge a hard click is exactly the drift #479 and #515 both close.
- A player step whose action cannot complete (a disabled/covered/absent control) fails the whole scenario — `scenario-interaction-runner.ts` stops at the first failed step and reports the blocking control the way `describeUnclickable` names it, instead of continuing past a step that never happened.

## Step goal (`expect`)

A step's `command` or clicks prove only that nothing threw, not that the game actually moved. `expect` (`ScenarioStepGoal`, `scripts/shared/scenario-types.ts`) states what must be true afterward, field-for-field mirrored from `InteractionGoal` (`scripts/shared/interaction-types.ts`) so both reuse one evaluator:

- `increased` / `decreased` — named numeric fields of the state dump must have grown / shrunk since just before the step's actions ran.
- `equals` — field/value pairs the state dump must match exactly afterward.
- `changedBy` — field/amount pairs: `after[field] - before[field]` must equal the given amount exactly (negative for a decrease). The step-local counterpart to `equals` — see below.
- `usable` / `blocked` — a control that must / must not be reachable afterward.
- `tutorialStep` — the tutorial card must show this step id afterward.
- `note` — free text shown in a failure report.

`increased`/`decreased`/`equals`/`changedBy` are checked in **both** modes (`checkGoalAgainstState`, `scripts/shared/scenario-goal.ts`, wired into command mode's `runSteps`). `usable`/`blocked`/`tutorialStep` need a live page and check only in interaction mode, reusing `interaction-driver.ts`'s own `checkGoal` — command mode has no DOM. A scenario with no `expect` anywhere only proves the sequence ran, not that it did anything.

**Default to a step-local assertion — `changedBy` for an exact figure, `increased`/`decreased` for direction only — over a chained `equals: {"cash": N}` for any field that accumulates across a scenario (cash, scores, counts).** Reserve `equals` for a field that genuinely describes a state rather than a running total — a checkpoint the scenario's own conclusion depends on, not an incidental balance along the way. A chained absolute couples every later step to everything before it: one upstream change (a new purchase inserted earlier, a duration that moved) forces every figure after it to be recomputed by hand across the whole file. This is most of what made #553's own scenario migration expensive — 51 files, most of the diff pure cash renumbering, and exactly the ripple issue #596 exists to close: `changedBy` proves what *this step's own actions* did (a hire costs exactly $1,000, a survey costs exactly $3,000) without pinning what every step before it left the field at, so inserting a step upstream — the #554-#557 "is real work" migrations, which insert queued-work time into scenarios that had none — means editing only the inserted step's own `expect`, never renumbering every checkpoint after it. `increased`/`decreased` still has its place when even the exact amount isn't worth pinning — it fails exactly when a step stops moving a field in the direction that step is actually testing, which is not a weaker check, just one that stays true under changes that have nothing to do with it. Never make a scenario's own subject directional or step-local when the number itself is the point: deathCount, ecology/safety/wellBeing/nuisance scores, `tickCount` at a shutdown, star rating, `activeContractCount`, `levelEnded`/`levelEndReason` stay `equals`, always re-verified against the real numbers, never loosened to "moved in the right direction" or "moved by roughly the right amount."

A staffed opening is `campaign start level:<id> staffed:true` or `new_game ... staffed:true` — the same opt-in composition (`STARTING_SITE_STAFFED_COMPOSITION`, `src/core/config/balance.ts`, issue #551), free, applied before any assertion. A scenario that only needs an ordinary staffed site should use it rather than hand-rolling hire/license/buy/assign for the same roster. The four vehicles it grants come unmanned — `vehicle driver <vid> <eid>` is still required before anything drives.

Both harnesses navigate with `?scenarioMode=1`, which sets `autoTickEnabled = false` in `main.ts` — interaction mode's real-time auto-tick loop never runs at all, so this is not a wall-clock-ticking problem and `time pause`/`time resume` is not a fix for it. The real divergence: a `role: 'player'` step runs its full `interaction` array in interaction mode, while command mode runs only the step's plain `command` string. When a step's `interaction` array includes extra `tick`/retry actions beyond what its `command` does — e.g. an event-resolution step that chains up to three extra `tick 15` rounds in interaction mode only, guaranteeing an in-progress action survives an event interruption, against command mode's single no-tick command — interaction mode's absolute `tickCount` runs ahead of command mode's for the rest of the scenario. In-game events are seeded by `Random(seed + tickCount)`, so once tick counts diverge, every later tick block draws different random outcomes between the two modes — one mode's event cuts a block short mid-way, the other's runs to completion — and this compounds into materially different cash/resource trajectories by the time a later cash-gated click happens, even though neither mode is doing anything wrong. Pausing changes nothing: the extra ticks already happened earlier in the step chain, well before any pause/resume bracket around a later click, and `tickCount` is identical entering and leaving a paused span either way. The actual remedy is a bigger resource cushion on the affected scenario (or keeping `interaction` and `command` step actions in lockstep tick-for-tick, when that's practical) — see `rock-fragmenter-breaking.json`'s `new_game` step, whose starting cash was bumped from $150,000 to $165,000 after the tick-divergence root cause was confirmed against a real interaction-mode run (issue #697; the file's own `new_game` step description has the full trace).

A wait for queued work to land (a drilled hole, and by issue #554 onward a loaded charge, a dug ramp segment, a built building) uses the `waitUntil` action (issue #590) — see the interaction-actions table above — rather than a hand-measured `tick N` pad: `field`/`equals` name what the step is actually waiting on, so a stall fails loudly and by name instead of a budget that merely happens to be long enough today. `tutorial-playthrough.json`/`blast-basic.json` predate it and still use hand-measured `tick N` steps; a new wait for queued work should use `waitUntil` instead of copying that pattern.

## Step outcome (`commandOutcome`)

Command mode has a `success: boolean` on every command result, and a step's own claim depends on which way that went — a step recorded as "ran" whether the console accepted or refused its command was silently proving nothing (issue #585 audited 412 such silently-refused commands across 63 files). `commandOutcome` (`ScenarioStepDef`, `scripts/shared/scenario-types.ts`, checked by `checkCommandOutcome` in `scripts/shared/scenario-goal.ts`) states which outcome the step expects, command-mode only:

- Absent (the default) — the command must succeed. `success: false` fails the step, naming the command and the console's own refusal text.
- `'refused'` — the command must be refused; the step fails if it unexpectedly succeeds (a guard step whose guard stopped guarding). Independent of `role: 'guard'` — a guard-role step still states this explicitly, and it composes with `expect.equals`/`expect.blocked` proving state didn't change.
- `'either'` — either outcome passes. Reserved for genuinely nondeterministic beats (e.g. `event choose 0` after a bare `tick`, where an event may or may not be pending that beat) — never a blanket silencer for a step whose own claim is actually broken.

A step whose command throws a real exception still fails regardless of `commandOutcome` — only a `success: false` return is a "refusal" this field can declare expected.

## Step repetition (`repeat`)

`repeat` (`ScenarioStepDef`, `scripts/shared/scenario-types.ts`) runs a step's command (command mode) or full `interaction` array (interaction mode) `N` times in immediate succession before `expect` is evaluated, instead of writing `N` byte-identical step objects. Absent, or `1`, is a no-op — no behavior change from a step that never used it. `0`, a negative number, or a non-integer is invalid and fails the step immediately, naming the step and the offending value.

Exactly one entry lands in the step's report/state-dump/screenshot regardless of `N` — the LAST iteration's command output and game state.

`expect`'s state-goal fields (`increased`/`decreased`/`equals`/`changedBy`) are **never** evaluated per iteration — always exactly ONCE per step, against the state captured immediately before the FIRST iteration and immediately after the LAST. `changedBy` describes the whole block's aggregate delta, not one iteration's: a `repeat: 24` block hiring one employee per iteration needs `changedBy: {employeeCount: 24}`, not `1`.

`commandOutcome` (command mode only) is the one thing that IS checked per iteration, independently each time — an outcome violation on iteration 5 of 24 is reported as iteration 5 failing (`repeat 5/24: ...`), not silently absorbed into the block.

`repeat` may not combine with a `waitUntil` interaction action on the same step — both are looping constructs, and combining them is rejected as invalid before either runs.

## Interaction actions

`InteractionStepAction` (`scripts/shared/scenario-types.ts`) covers standard Puppeteer primitives (`click`, `clickSelector`, `mousedown`/`mouseup`/`mousemove`, `keypress`/`keydown`/`keyup`, `scroll`, `wheel`, `wait`, `waitForSelector`, `type`, `assert`, `viewport`, `command`, `screenshot`) plus tile-space and game-specific actions. Each variant carries its own doc comment in source — read it before using an unfamiliar one; this table is a pointer, not the full spec:

| Action | For |
|---|---|
| `pickTile` / `dragTiles` | Tile-space clicks/drags — prefer over raw pixel coordinates whenever the target is a tile. |
| `cameraFocus` | Snap the camera onto a world point before a raw click/mousemove targets a scene entity. |
| `waitForTutorialStep` | Wait until the tutorial reaches a named step (or ends). Deterministic since issue #601: loops the console's own `tick 1` (not the page's real rAF clock) up to `maxTicks`, so queued work finishes the same way on any machine. |
| `set` | Set a form control's value the way typing or picking would. |
| `clickLabel` | Click the first usable control whose label matches, case-insensitively. |
| `awaitUsable` | Wait for a selector to exist and be genuinely usable, not merely present. |
| `zoomOut` | Scroll the wheel out N ticks to bring an off-screen tile into view. |
| `focusTile` | Re-aim the camera at a world tile before clicking it. |
| `clickEntity` | Click a live scene entity by kind + id rather than a baked coordinate. |
| `clickIfPresent` | Click a control only if it is on screen and usable; no-op otherwise — for genuinely nondeterministic beats (an `event choose` after a bare `tick`, where a dialog may or may not have fired). Not for a control that is merely hard to reach — use `clickSelector` there so a missing control fails loudly. |
| `resolveEventIfPending` | Like `clickIfPresent` but decides whether an event is pending from game state, not the DOM — a slow render frame (#475) can make a real pending event look absent to a quick DOM probe. |
| `loadingScreenDebug` | Drive the loading screen's debug preview bridge directly, bypassing a real level entry. |
| `waitUntil` | Advance time until a named state-dump field reaches a target value (`field`/`equals`), bounded by `maxTicks` (command mode) and `timeoutMs` (interaction mode) so a stall fails loudly instead of hanging. Replaces a hand-measured `tick N` pad with a wait that asserts it actually landed — see below. |
| `ensurePanel` | Open a `#bs-toolbar` panel (`blast`/`contracts`/`ops`/`build`/`vehicles`/`employees`/`survey`) only if it is not already open — reads `__uiState().panels[...].visible`, clicks only on a mismatch. Use instead of a bare `clickSelector` on a toolbar tab whenever a preceding step might already have it open: that control toggles, and a redundant click closes it instead of a no-op. |
| `ensureStep` | Select a Blast Workshop step tab (`step: 1-5`, Drill/Charge/Sequence/Preview/Fire) only if it is not already active — reads `__uiState().activeBlastStep`, clicks `[data-step="N"]` only on a mismatch. Use instead of assuming a step tab a preceding step left active is still active — `BlastWorkshop`'s own `autoAdvance` moves it on its own. |
| `waitForProperty` | Poll a DOM property until it equals a value, bounded by `timeoutMs`, failing with the last value seen. The condition-based counterpart to `assert` for anything the browser settles asynchronously — see the flat-delay rule below. |

### ▶ A flat delay is the last resort, never the first

**`wait` encodes one machine's timing.** It is the only action that passes or fails on a guess rather than on a condition, and the guess is made on the machine that authored it: too short somewhere else, wasted time everywhere. A scenario padded with fixed delays is slower *and* flakier than one that waits on the thing it actually needs.

Wait on the condition instead. Every one of these fails loudly, by name, when the thing never happens:

| Waiting for | Use |
|---|---|
| A DOM property to settle (scroll position, a value, a count) | `waitForProperty` |
| An element to exist | `waitForSelector` |
| A control to become genuinely clickable | `awaitUsable` |
| Queued game work to land (a hole drilled, a building built) | `waitUntil` |
| The tutorial to reach a step | `waitForTutorialStep` |

`wait` is legitimate only where no observable condition exists to poll — a purely visual transition with nothing queryable behind it. Where it is genuinely the only option, keep it bounded and **say why in the step's `description`**, naming what could not be polled. A `wait` with no such explanation is a defect in the scenario, not a passing test.

PR #888 is what the shortcut costs: a scroll asserted immediately after `page.mouse.wheel()` failed in CI because Chrome can commit a wheel-triggered scroll on the compositor thread after the CDP call returns. A flat delay was reached for first; it would have hidden the timing dependence behind a number that happened to work. `waitForProperty` polls for the real value, costs only the time the browser actually takes, and still fails when the scroll never lands — which is what that scenario's negative control depends on.

`set`/`clickLabel`/`awaitUsable`/`zoomOut`/`focusTile`/`clickEntity`/`clickIfPresent`/`resolveEventIfPending` were ported from the playability harness (issue #479) to close gaps in the click vocabulary — before them, some player steps had no click-equivalent at all and stayed console commands.

`waitForSelector` resolves on DOM presence, not CSS visibility (Puppeteer's default `visible: false`) — an element that stays mounted with only its `display` toggled resolves the wait immediately, before the toggle happens (#545). For a *visibility* change (a modal that arms before it opens, a panel that shows/hides an already-mounted node), wait on the condition instead: `awaitUsable` when usability is what's being probed, or `waitForProperty` on the property that actually flips. A fixed-duration `wait` is the last resort the rule above describes, not the default for this case.

`waitUntil` is the one action that drives command mode, not just interaction mode — every other action here has no meaning outside a live page. Put it in a step's own `interaction` array; `runSteps` (`command-runner.ts`) reads that same `field`/`equals`/`maxTicks` spec to loop `tick 1` instead of running the step's `command` string once, and `interaction-executor.ts` reads it to loop that same `tick 1` inside the live page instead (issue #601 — not the page's real rAF clock, deterministic on any machine), bounded by `timeoutMs` as an outer wall-clock safety net against a genuine hang rather than the loop's own pacing budget. Both budgets (`maxTicks`, `timeoutMs`) are required and independent, and a step's own outer `timeout` (seconds, defaults to 60s) races `timeoutMs` in the same step — `effectiveStepTimeoutMs` (`scenario-utils.ts`) now derives the value the interaction/bench runners actually race against as `max(declared timeout, slowest inner timeoutMs + margin)`, so a step whose `timeout` was never raised no longer degrades into a generic `Step N timed out after 60000ms` in place of `waitUntil`'s own, more useful error (PR #616 fixed 53 files' worth of this by hand and still missed 12). Still write a `timeout` that covers `timeoutMs` when you set one — `tests/unit/scenario-defs-validation/interaction-actions.test.ts`'s own regression check pins it, so a misleadingly low declared value fails loudly even though the runners no longer act on it alone. A step using it needs no meaningful `command` field of its own; give it a plain descriptive string (`"wait_until field:holeCount equals:25 max_ticks:400"`) rather than a real console command, since it is never executed as one. `equals` is a strict `===` match, for a field that settles on an exact value (a count, an id, a boolean) — not a score trending in a direction, which stays a hand-measured `tick N` followed by `increased`/`decreased` on `expect`.

Adding a scenario for a feature is how that feature gets end-to-end coverage without a unit test per interaction. Runner flags, batch mode, and output layout: `dev-visual-testing` skill. Scenario inventory: `dev-testing-strategy` skill.
