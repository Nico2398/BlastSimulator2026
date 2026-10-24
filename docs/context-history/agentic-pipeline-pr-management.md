# History — agentic-pipeline-pr-management

This file records why the rules in the `agentic-pipeline-pr-management` skill exist: the pull requests, issues and measurements behind them.

## READY TO MERGE

### Marked is not finished — the run stays until CI reports

PR #581 is what that cost. Every channel its session ran was green, the body was marked, and two interaction-mode shards were red in CI. Nothing merged, nothing chained, and issue #552 held `in-progress` with every assignment behind it, until a human looked.

### There is no third state

PRs #507 and #508 both ended exactly there, both promising the marker "will follow once those jobs report". Nothing came back to add it. `agentic-auto-merge` was changed afterwards to fail its step on a non-draft `pipeline/feature-*` PR with no marker.

## Every CI job runs on every pull request

A job optional on pull requests first ran on a change at the merge commit, which is where `main` went red (ten pushes in sixty, Sep 2026). A one-line `src/core/` threshold change broke three interaction scenarios (#1068). Sharded and cost-balanced, the job costs a few minutes wall clock and runs alongside the unit suite rather than after it.

Without a GPU the terrain material costs ~6.4 s/frame (#475), which is why the interaction suite is CI's and never a session's.

A shard that never ran while the run reported `success` was PR #615's shape.
