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

A step may set `role: 'player' | 'setup'` (`scripts/shared/scenario-types.ts`). This is what makes interaction mode a second, UI-driven proof of a scenario instead of the console replayed in a browser — measured at 94% `command` actions before #479.

- `role: 'player'` — the step models something a player does. Its `interaction` array may **never** contain a `command` action; `interaction-executor.ts` throws, naming the step, before the command reaches the game. A step that cannot actually be clicked is a playability finding, not license to type it instead — file it (`.claude/rules/playability.md`).
- `role: 'setup'` — world bootstrapping or observation. Its `interaction` array may use `command`, but only for tokens `isAllowedSetupCommand` (`scripts/shared/playtest-types.ts`) admits — the same allowlist the playtest harness uses, reused rather than reinvented. A setup step reaching for `employee assign_skill` or any other gameplay command to dodge a hard click is exactly the drift #479 fixed.
- No `role` — unconstrained (legacy). True of every scenario except the pilot conversion, `tutorial-interactive.json`. Converting another scenario means marking every tutorial/flow-facing step `player` or `setup`, not leaving it untagged to skip the rule.
- A player step whose action cannot complete (a disabled/covered/absent control) fails the whole scenario — `scenario-interaction-runner.ts` stops at the first failed step and reports the blocking control the way `describeUnclickable` names it, instead of continuing past a step that never happened.
- A bootstrap command with no UI equivalent and no business having one (e.g. `employee assign_skill`, which exists so a test doesn't have to grind XP for real — the player-facing path is `employee train`) stays untagged rather than mislabeled `setup`. Tagging it `setup` would fail validation anyway, since it is not on the reused allowlist.

Adding a scenario for a feature is how that feature gets end-to-end coverage without a unit test per interaction. Runner flags, batch mode, and output layout: `dev-visual-testing` skill. Scenario inventory: `dev-testing-strategy` skill.
