# History — agentic-pipeline-full

This file records why the rules in the `agentic-pipeline-full` skill exist.

## Visual feedback loop

Volumetric iterations fan out because a browser harness is the most expensive thing this pipeline runs (~6.4 s/frame without a GPU), so this is where the job budget is won or lost.

The three-iteration cap and the loop-budget exit: #956 finished its TDD cycle 28 minutes in and spent the next five and a half hours in this loop.

## Visual feedback loop — the frames that show the change (Nov 2026)

The loop ran "the named scenarios with --shots", which the visual-tester read as whole interaction-mode runs with a capture at every step and every camera angle: 46–190 minutes on the longest calls, re-proving scenarios CI's interaction shards play on every pull request. The brief now names, per check, the steps to capture. The trigger is spelled out as `OWED visual` or a Verification section that asks for a screen, so a run with neither (issue 2116's merged diff touched no player-facing file, and its visual-tester still ran for 74 minutes) skips the loop. Measurements: `docs/context-history/agent-visual-tester.md`.
