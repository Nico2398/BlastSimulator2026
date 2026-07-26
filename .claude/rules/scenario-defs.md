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
- Screenshots are opt-in via `--screenshots`. State JSON is always written, one file per step.

Adding a scenario for a feature is how that feature gets end-to-end coverage without a unit test per interaction. Runner flags, batch mode, and output layout: `dev-visual-testing` skill. Scenario inventory: `dev-testing-strategy` skill.
