---
applyTo: "scripts/scenario-defs/**/*.json,scripts/scenario-*.ts,scripts/run-all-scenarios.ts,scripts/shared/*.ts"
---

# Scenario Definitions

Scenario JSON drives two verification channels from one file: `scenario` (command mode, pure Node.js) and `visual` (interaction mode, real Puppeteer clicks). In command mode, a step whose command the console refuses (`success: false`) fails the scenario unless the step declares `commandOutcome`.

- Every step carries a `command` and a `role`. Steps that also carry an `interaction` array run through the UI in interaction mode; steps without one fall back to the command.
- Both modes must pass. `npm run scenarios` covers command mode; `npm run scenarios:interaction` covers the browser path.
- **A `role: 'player'` step never executes a command.** `checkStepActionAllowed` throws before the command reaches the game. A control a player cannot click is a finding to file, not licence to type the command instead.
- **Address tiles in tile space, never in pixels.** Use `pickTile` / `dragTiles`, which recompute the mapping from the live picker canvas. A baked `click x/y` drifts onto the wrong tile the moment the HUD is relaid out, and reports nothing worse than "the step did not complete" — the failure surfaces steps later, on an unrelated control.
- **Wait on a condition, never on a flat delay.** `wait` passes or fails on a guess made on the machine that authored it. Every other waiting action fails loudly and by name when the thing never happens.
- A step's `command` and its `interaction` must target the same place. Command mode reads the command, interaction mode reads the clicks; when they disagree the two channels silently test different things.
- A step proves nothing until it states what must be true afterward. `expect` carries that claim, and a step-local assertion outlives an upstream insertion that a chained absolute does not.
- Tutorial scenarios run under the tutorial's rails: off-target controls are inert and pickers reject tiles outside the step's region (`REGION` in `src/ui/tutorialStages.ts`). A scenario that clicks what the current step does not allow is asserting something no player could do.
- Screenshots are opt-in via `--screenshots`. State JSON is always written, one file per step.
- Step shape is typed in `scripts/shared/scenario-types.ts`. `tests/unit/scenario-defs-validation/` validates every scenario file — a new scenario is not done until that suite passes.

Step roles, goals, outcomes, repetition, and the full interaction-action vocabulary: `dev-scenario-authoring` skill. Runner flags, batch mode, and output layout: `dev-visual-testing` skill. Scenario inventory: `dev-testing-strategy` skill.
