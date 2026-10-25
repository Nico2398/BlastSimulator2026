# History — agentic-issue-creation

This file records why the rules in the `agentic-issue-creation` skill exist.

## ▶ Labels — `ready` is a confidence statement

The one-hold-or-go-marker rule: #1305 is the worked case: a defect reproduced down to its geometry and tick counts, `Blocked by: None`, no open question, filed with `agent-task` and its scopes alone, and stranded until a human noticed.

## Rules

Rule 3 (dependency as relationship and section): a section with no relationship is legacy, honoured only because issues written before relationships existed carry their dependencies there.

Rule 13 (label transfer on `gh pr create`): a follow-up `gh pr edit --add-label` raises no `pull_request` event of its own — learned in #615.

## ▶ Sizing — one issue is one run, and a run has a ceiling

Issue #553 is the case to remember: its `## Test` section listed 64 scenario definitions to update **one at a time**, the run spent the entire budget, and it was cut off with 11 of them still red.

## ▶ Splitting a change that breaks a whole suite

Split the enablers off first: #553 carried three — `campaign start` had no `staffed:` option (#551 gave one to `new_game` and `sandbox` only), every file needed its own sandbox-measured tick pad before its holes landed, and contract ids drifted under the added ticks so each file had to be renumbered by hand. Land a `staffed:` for campaign starts, a `tick_until <field>:<value>` step, and a stable way to name a contract, and most of the 64 files become a two-line edit that fits in one run.
