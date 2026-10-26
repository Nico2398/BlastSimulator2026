# History — dev-testing-strategy

This file records why the rules in the `dev-testing-strategy` skill exist.

## Philosophy

Playability used to be a fifth, separate layer (`npm run playtest`); issue #515 folded it into `visual` once every scenario step carried a structurally-enforced `role` and interaction-mode `expect.usable`/`expect.blocked` checks proved what a playtest beat proved. The old playtest script and its JSON definitions are deleted.

## Validation Commands

The progression probe (`npm run probe:progression`) came from #1922; its `ladder` strategy from #1945.

## Quality gates (not verification channels)

Excluding `tests/unit/benchmarks/` and `tests/unit/lint/` from the coverage measurement took it from 48 minutes to ~6 with the thresholds unchanged and still passing. The lint directory used to also replay every scenario through the console (`ScenarioCommandOutcomes`, ~240 s, half of `npm run test`); that replay was retired because `npm run scenarios` already fails an undeclared refusal through `checkCommandOutcome` in `runSteps`, on every pull request, with the same message.

### Dead code

A 46-line table of typed i18n key constants lived in the tree, imported by nothing, until the dead-code check was written.

## Scenario Test Definitions

The step-local assertion rule (`expect.changedBy` over chained `expect.equals`) came from the #554-#557 "is real work" migrations, which converted instant actions into queued, worker-gated work and so inserted steps upstream of every absolute figure.

## CI Launch Strategy

The ~6 s/frame software-rasterisation cost was measured in #475 — which is why a scenario page now boots with drawing suspended (`?scenarioMode=1`, main.ts) instead of paying ~10 s of never-seen frames per tab. Before that, CI's 10-shard runs on 13–14 Sep 2026 took ~12 min for the shards and 15–19 min end to end, half of it the unit suite the shards waited on. Tier 3 used to wait on the unit suite; nothing does any more.

## Progression probe — provenance (merged from main)

- The probe came with #1922 and its ladder strategy with #1945; buried-pattern dropping, `decideLadderShotSide` g2 sizing and the ore-poor / building-adjacent skips with #2076.

## Progression probe ladder

- Holes no deeper than their charge breaks out of (a sealed grade-0 shot left an egg-crate floor no vehicle crosses): #2091.
- Living quarters raised beside a far crater (drivers spent a third of their time walking to rest): #2089.
- Served floors released once their ramp no longer reaches them (1,141 haul orders waited behind a ramp a deepening shot left short), holes buried under unhaulable rubble dropped (one held a deepening pattern re-ordered every 500 ticks), rubble contracts measured on the spoil heaps (four full heaps beside unread clearance offers): #2091.
- Deepening gated on a driveable crater floor instead of zero out-of-reach rubble: ledge rubble held every crater at 9.9 m, 0.1 m short of grade 2, from t4500 (#2091).
- A fragmenter per 100 breaking orders: one faced 463 boulders after grade 2 and broke one in 400 ticks while they buried every new hole; with the extra fragmenters grade 2 came at t7000 instead of t11000 and the pit reached 16.6 m (#2091).
