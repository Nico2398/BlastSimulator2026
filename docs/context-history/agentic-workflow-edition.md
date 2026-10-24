# History — agentic-workflow-edition

This file records why the rules in the `agentic-workflow-edition` skill exist: the runs, pull requests and measurements behind them.

## Workflow Edition

The Actions layer runs when nobody is watching, its failures are silent by default, and every mechanism in it exists because a specific run was lost.

## ▶ Rule 1 — No timer

Every interval that was ever tuned in this repository was tuned to the CI of that week, and each one broke the moment a shard count, a scenario suite or a runner queue moved:

| What was timed | What it did instead of working |
|----------------|-------------------------------|
| `agentic-auto-merge`'s 10-minute settle poll | Reported PR #499 stuck while its browser shards had 35 minutes left to run, and was never swept again |
| A 45-minute wait budget in `await-pr-ci` | Would report "still running" as an outcome — the exact ending that left PR #581's red CI unread |
| A 60-minute per-commit cooldown in `agentic-ci-failure` | Long enough to stall once CI slows, short enough to double-ask when it speeds up |

`workflow_run` on CI completing is what made auto-merge work.

## ▶ Rule 2 — The token decides whether anything happens next

Half of this layer's failures are one wrong token.

## ▶ Rule 5 — Idempotency by identity, and never on the wording of an error

`agentic-auto-merge` re-reads the PR and decides from `mergeable_state` plus the runs because a refusal string it did not recognise once fell through to a warning and a green step — and PR #434 sat unmerged while both arming paths reported success.

## ▶ Rule 6 — Nothing here removes a line but you

### What dead looks like in this layer

Each row of the table is a real finding from the August 2026 sweep. None of them broke anything, and none of them would ever have failed a test.

### The comment budget

At the time of writing, incident comments were 26% of the workflow and action lines in this tree and 44% of the decision modules.

One incident, one place: #554's unique-branch-suffix story was told in `agentic-prompt`, `agentic-auto-merge`, `agentic-watchdog` and `agentic-ci-failure`.

## How a change here is proven

Pinning each copy's own content is not enough: #614 happened because both liveness copies (`agentic-recover-blocked`, `agentic-ci-failure.yml`) were individually pinned and still drifted, one polling the full set of non-terminal Actions run statuses and the other only two of them, with nothing ever comparing them.

## Write the incident into the file

Every non-obvious mechanism here carries a comment naming the run that made it necessary — #404, #430, #434, #499, #507, #552, #581. Each one was added after a queue stalled for a day.
