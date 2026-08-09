---
paths:
  - "scripts/scenario-defs/**/*.json"
  - "scripts/scenario-*.ts"
  - "scripts/run-all-scenarios.ts"
  - "scripts/shared/*.ts"
---

# Scenario Definitions

Scenario JSON drives two verification channels from one file: `scenario` (command mode, pure Node.js) and `visual` (interaction mode, real Puppeteer clicks).

- Every step carries a `command`. Steps that also carry an `interaction` array run through the UI in interaction mode; steps without one fall back to the command.
- Both modes must pass. `npm run scenarios` covers command mode; `npm run scenarios:interaction` covers the browser path.
- Step shape is typed in `scripts/shared/scenario-types.ts`. `tests/unit/scenario-defs.test.ts` validates every file — a new scenario is not done until that suite passes.
- **Address tiles in tile space, never in pixels.** Use `pickTile` / `dragTiles`, which recompute the mapping from the live picker canvas. A baked `click x/y` drifts onto the wrong tile the moment the HUD is relaid out, and reports nothing worse than "the step did not complete" — the failure surfaces steps later, on an unrelated control.
- A step's `command` and its `interaction` must target the same place. Command mode reads the command, interaction mode reads the clicks; when they disagree the two channels silently test different things.
- Tutorial scenarios run under the tutorial's rails: off-target controls are inert and pickers reject tiles outside the step's region (`REGION` in `src/ui/tutorialStages.ts`). A scenario that clicks what the current step does not allow is asserting something no player could do.
- Screenshots are opt-in via `--screenshots`. State JSON is always written, one file per step.

## Step role (issue #479)

A step may set `role: 'player' | 'setup' | 'observe'` (`scripts/shared/scenario-types.ts`). This is what makes interaction mode a second, UI-driven proof of a scenario instead of the console replayed in a browser — measured at 94% `command` actions before #479.

- `role: 'player'` — the step models something a player does. Its `interaction` array may **never** contain a `command` action; `checkStepActionAllowed` (`interaction-executor.ts`) throws, naming the step, before the command reaches the game. A step that cannot actually be clicked is a playability finding, not license to type it instead — file it (`.claude/rules/playability.md`).
- `role: 'setup'` — world bootstrapping and time control. Its `interaction` array may use `command`, but only for tokens `isAllowedSetupCommand` (`scripts/shared/playtest-types.ts`) admits — the same allowlist the playtest harness uses, reused rather than reinvented. A setup step reaching for `employee assign_skill` or any other gameplay command to dodge a hard click is exactly the drift #479 fixed.
- `role: 'observe'` — read-only inspection: `state`, `scores`, `finances`, `vehicle list`, and the rest of `OBSERVATION_COMMANDS`/`OBSERVATION_SUBCOMMANDS` (`isObservationCommand`, `interaction-executor.ts`). This is how the harness records what happened; it has no UI equivalent by design, so it stays a command — but only one `isObservationCommand` actually admits, checked the same way `setup` is, never assumed from the step's own intent.
- No `role` — unconstrained (legacy). Every scenario file has at least one tagged step today; what remains untagged inside them is a small, shrinking, individually-tracked set — either a documented permanent exception (a command with no UI and no business having one, e.g. `employee assign_skill`) or an open gap tracked by issue #514. Converting a step means marking it `player`, `setup`, or `observe`, not leaving it untagged to skip the rule; issue #515 turns this from convention into a lint (see Forward, below).
- A player step whose action cannot complete (a disabled/covered/absent control) fails the whole scenario — `scenario-interaction-runner.ts` stops at the first failed step and reports the blocking control the way `describeUnclickable` names it, instead of continuing past a step that never happened.
- A bootstrap command with no UI equivalent and no business having one (e.g. `employee assign_skill`, which exists so a test doesn't have to grind XP for real — the player-facing path is `employee train`) stays untagged rather than mislabeled `setup`. Tagging it `setup` would fail validation anyway, since it is not on the reused allowlist.

## Step goal (`expect`)

A step's `command` or clicks prove only that nothing threw, not that the game actually moved. `expect` (`ScenarioStepGoal`, `scripts/shared/scenario-types.ts`) states what must be true afterward, field-for-field mirrored from the playtest harness's own goal type so both reuse one evaluator:

- `increased` / `decreased` — named numeric fields of the state dump must have grown / shrunk since just before the step's actions ran.
- `equals` — field/value pairs the state dump must match exactly afterward.
- `usable` / `blocked` — a control that must / must not be reachable afterward.
- `tutorialStep` — the tutorial card must show this step id afterward.
- `note` — free text shown in a failure report.

`increased`/`decreased`/`equals` are checked in **both** modes (`checkGoalAgainstState`, `scripts/shared/scenario-goal.ts`, wired into command mode's `runSteps`). `usable`/`blocked`/`tutorialStep` need a live page and check only in interaction mode, reusing the playtest driver's own `checkGoal` — command mode has no DOM. A scenario with no `expect` anywhere only proves the sequence ran, not that it did anything.

## Interaction actions

`InteractionStepAction` (`scripts/shared/scenario-types.ts`) covers standard Puppeteer primitives (`click`, `clickSelector`, `mousedown`/`mouseup`/`mousemove`, `keypress`/`keydown`/`keyup`, `scroll`, `wheel`, `wait`, `waitForSelector`, `type`, `assert`, `viewport`, `command`, `screenshot`) plus tile-space and game-specific actions. Each variant carries its own doc comment in source — read it before using an unfamiliar one; this table is a pointer, not the full spec:

| Action | For |
|---|---|
| `pickTile` / `dragTiles` | Tile-space clicks/drags — prefer over raw pixel coordinates whenever the target is a tile. |
| `cameraFocus` | Snap the camera onto a world point before a raw click/mousemove targets a scene entity. |
| `waitForTutorialStep` | Wait until the tutorial reaches a named step (or ends), driving the real auto-tick clock so queued work can finish. |
| `set` | Set a form control's value the way typing or picking would. |
| `clickLabel` | Click the first usable control whose label matches, case-insensitively. |
| `awaitUsable` | Wait for a selector to exist and be genuinely usable, not merely present. |
| `zoomOut` | Scroll the wheel out N ticks to bring an off-screen tile into view. |
| `focusTile` | Re-aim the camera at a world tile before clicking it. |
| `clickEntity` | Click a live scene entity by kind + id rather than a baked coordinate. |
| `clickIfPresent` | Click a control only if it is on screen and usable; no-op otherwise — for genuinely nondeterministic beats (an `event choose` after a bare `tick`, where a dialog may or may not have fired). Not for a control that is merely hard to reach — use `clickSelector` there so a missing control fails loudly. |
| `resolveEventIfPending` | Like `clickIfPresent` but decides whether an event is pending from game state, not the DOM — a slow render frame (#475) can make a real pending event look absent to a quick DOM probe. |
| `loadingScreenDebug` | Drive the loading screen's debug preview bridge directly, bypassing a real level entry. |

`set`/`clickLabel`/`awaitUsable`/`zoomOut`/`focusTile`/`clickEntity`/`clickIfPresent`/`resolveEventIfPending` were ported from the playability harness (issue #479) to close gaps in the click vocabulary — before them, some player steps had no click-equivalent at all and stayed console commands.

Adding a scenario for a feature is how that feature gets end-to-end coverage without a unit test per interaction. Runner flags, batch mode, and output layout: `dev-visual-testing` skill. Scenario inventory: `dev-testing-strategy` skill.

## Forward: replacing playtest (issue #515)

**2026-08-09 — target state, not current state.** THE MANDATE (`docs/plans/scenario-assertions-and-playtest-removal.md`) requires every non-cheat console command to have a real UI equivalent, and this suite — `role` plus `expect` together — to functionally replace `npm run playtest` (`scripts/playtest.ts`, `scripts/playtests/*.json`; documented in `.claude/rules/playability.md` and the `dev-playability-testing` skill), not merely duplicate it. Issue #515 is the remaining structural piece: today `role` is a convention a step can skip; #515 turns "every player-facing step is provably `player`/`setup`/`observe`" into a lint, closing the gap the "No `role`" bullet above still describes as open. Until #515 (and the smaller UI-gap issues #510-#514 it depends on) land and Phase 3 of the plan doc executes, playtest still exists, is still required for player-facing changes, and this file does not yet supersede it — do not delete playtest or its rule/skill on the strength of this section.
