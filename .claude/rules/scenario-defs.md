---
paths:
  - "scripts/scenario-defs/**/*.json"
  - "scripts/scenario-*.ts"
  - "scripts/run-all-scenarios.ts"
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

Adding a scenario for a feature is how that feature gets end-to-end coverage without a unit test per interaction. Runner flags, batch mode, and output layout: `dev-visual-testing` skill. Scenario inventory: `dev-testing-strategy` skill.
