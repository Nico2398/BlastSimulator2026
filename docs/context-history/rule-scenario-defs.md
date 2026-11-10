# History — `scenario-defs` rule

This file records why the rules in the `scenario-defs` rule (`.claude/rules/scenario-defs.md`) exist.

## Scenario Definitions

**A stepper is set, never counted.** A run of `.bsx-stepper-btn` clicks encoded `N` as "the default plus the count" and went wrong the moment the default or its persistence across steps changed (PR #1070's first red shard).

## Screenshots opt-in — per step (Nov 2026)

`--screenshot-steps` joined `--screenshots`, so a check renders the frames it looks at rather than every step (`docs/context-history/agent-visual-tester.md`).
