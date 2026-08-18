---
name: agentic-pipeline-finalization
description: >
  Standard finalization procedure for TDD pipelines. Runs parallel code review,
  merges findings, refactors, validates, and opens PR. Used as the final phase
  of full, fix-bug, and multi pipelines.
---

## ▶ PROCEDURE — EXECUTE IN ORDER. DO NOT SKIP. DO NOT IMPROVISE.

Runs after qualimetry passes. Branch: `pipeline/feature-<label>` — `<label>` is `<issue>-<runId>`, per `agentic-pipeline-tdd`'s Branch naming.

**Parameters:**
- `skip_refactorer` (default: `false`) — set to `true` for bug-fix pipelines to skip refactoring phase.
- `visual_incomplete` (default: `false`) — set to `true` when visual feedback loop could NOT complete inspection (VISUAL: BLOCKED). When `true`, the PR MUST be created as draft (--draft) WITHOUT `READY TO MERGE`.

```
[ ] = orchestrator-executed command  |  @agent = AI agent invocation

 1. Code review (parallel):
        Delegate to `agentic-pipeline-review-pr` skill's code review step.
        All five delegations go out in ONE message and are awaited in that same
        turn — never backgrounded. See that skill's rules for why.
 2. [merge-findings]     → Orchestrator merges all sub-reviewer findings → pass/fail.
                            Pass/fail evaluated AFTER all reviewers complete.
                            if fail → @implementer (big loop)
 3. @refactorer          → If `skip_refactorer=true` → skip this step (jump to step 5).
                            Otherwise: clean up conventions, no behavior change,
                            then re-run [test-runner] to verify no regression.
                            [test-runner] results:
                              PASS → continue to step 5 (skip qualimetry + code review)
                              FAIL → @implementer (big loop: TDD → qualimetry → finalization from start)
 4. [verify-commit]      → confirm refactor commit exists; auto-commit if dirty
 5. @validator           → Full validation: typecheck → tests → build
                            if fail → @implementer (big loop)
 6. [verify-commit]      → final commit check before PR
 7. [open-pr]            → create PR from feature branch to main.
                             Evaluate draft/ready per `agentic-pipeline-pr-management` skill,
                             and decide the `full-ci` label by the same skill's test.
                             Carry every defaulted requirement into the body under
                             `## Decisions taken` per `agentic-decision-autonomy`.
                             **If `visual_incomplete=true` → MUST use --draft, NO `READY TO MERGE`.**
                             **The PR leaves this step marked or --draft. Never both absent:
                             a channel CI runs is covered by the marker, not a reason to defer it.**
 8. [decision-followup]  → If any decision was material to gameplay, economy, or a player-facing
                             default: `gh issue create --label decision-review` carrying the
                             `## Decisions taken` block and the PR link. No `ready` label — it
                             stays out of the assignment queue and halts nothing.
                             No material decisions → skip.
 9. [git-verify]         → confirm clean state: git status, branch, last commits
10. [await-ci]           → `npm run ci:await -- --pr <number>`. Blocks until every workflow
                             run on the PR head reports — no deadline, because any deadline
                             would be a guess about CI that reports "still running" as an
                             outcome. **The run does not end before this step does.**
                             Exit 0 (GREEN) → the run is finished. Exit 1 (RED) → the CI-fix
                             loop below. Exit 3/4 → say so in a PR comment naming what never
                             reported, then stop. Never pass `--timeout-minutes` in a
                             pipeline run: the bound is the job's own timeout, and reaching
                             it hands the PR to `agentic-ci-failure.yml` intact.
                             Skip only when the PR was created `--draft`: a draft already
                             names a channel that stayed red, and its issue is `blocked`.
```

**Retry counter:** resets at start of each finalization invocation.

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| [merge-findings] | @implementer (big loop) |
| @refactorer or [test-runner after refactorer] | @implementer (big loop) |
| @validator | @implementer (big loop) |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| [await-ci] | The CI-fix loop below — never a big loop: the PR exists and its branch is the deliverable |
| Any × 7 | Human escalation: add PR/issue comment summarizing failure + history, then stop with `ESCALATED: human intervention required` |

### The CI-fix loop — a red channel this run handed to CI is still this run's

`static`, `logic` and command-mode `scenario` are runnable in the session. Interaction-mode `visual`, the production `build`, and every channel on a machine with a GPU are CI's — and CI reports minutes *after* the step that opened the PR. Ending there is what PR #581 did: green on every channel its session ran, marked `READY TO MERGE`, two interaction shards red in CI, and `agentic-auto-merge.yml` skips a failed CI run by design. Nothing merged it, nothing chained, and issue #552 held `in-progress` with the whole queue behind it.

So `[await-ci]` is not a courtesy wait. It is the step that reads the channels this run deferred.

On RED, bounded at **3 rounds**, counted per finalization invocation:

1. Read the failing jobs the script named. Fetch the log; for an interaction-mode failure read the FAIL screenshots in the run's artifacts. Never re-run the whole suite locally to "confirm" it — a sandbox without a GPU cannot reproduce that channel, and #581's session already proved a local run of those exact files times out on load contention.
2. Decide which side is wrong, the change or the expectation, then delegate: `@fixer` for a test/expectation disagreement, `@implementer` for a defect in the change, `@visual-tester` when the failure is a rendering or click-reachability claim.
3. Commit and push to `pipeline/feature-<label>`. Never `[skip ci]` — `agentic-pipeline-pr-management` holds why.
4. Run `[await-ci]` again. The script reads one run per workflow, newest first, so the run CI cancelled on the previous head does not count against you.

After 3 rounds still red: convert the PR to a draft, comment naming the channel, what fails and what would unblock it, label the issue `blocked`, and stop with `ESCALATED: CI red after 3 fix rounds`. That is a terminal state — `handle-failure.yml` chains the queue past it.

**If the session dies before `[await-ci]` returns**, `agentic-ci-failure.yml` posts the failure back as a fresh task on the same PR, bounded by `AGENTIC_CI_FIX_ATTEMPT_LIMIT`. That is the fail-safe, not the plan: a nudged session pays the whole startup cost again to read a verdict this one was already holding.

When looping back to `@implementer` from any finalization step:
`@implementer on impl branch → cherry-pick → switch-to-feature → qualimetry → finalization`
Do NOT re-run skeleton-writer or test-writer — branches and tests already exist.

### Non-Agentic Steps

| Step | Action |
|------|--------|
| merge-findings | Deduplicate and merge all reviewer outputs → pass/fail (evaluate after ALL reviewers complete) |
| After refactorer | `npx vitest run` — PASS → @validator, FAIL → @implementer (big loop) |
| verify-commit | `git log --oneline -1` — auto-commit if dirty, use message `"<agent-name>: <step-context> (#<N>)"` |
| open-pr | `gh pr create --base main --head pipeline/feature-<label> --title "<type>: Resolve #<N>" --body "Closes #<N>\n\n<test_count> tests — all passing\n\n<decisions_block>\n\nREADY TO MERGE"`. Determine `<type>` from pipeline: `full → feat`, `fix-bug → fix`, `multi → feat`. Count test cases: `npx vitest list --reporter=json 2>$null | ConvertFrom-Json | ForEach-Object { $_.testModules } | Measure-Object`. `<decisions_block>` is the `## Decisions taken` section, omitted when the run defaulted nothing. For draft: add `--draft`, omit `READY TO MERGE` line. Then apply the `full-ci` label if and only if `agentic-pipeline-pr-management`'s test says so: `gh pr edit <number> --add-label "full-ci"`. |
| await-ci | `npm run ci:await -- --pr <number>` (or `--head pipeline/feature-<label>` before the number is known). Exit codes: `0` GREEN, `1` RED with the failing jobs and their log URLs printed, `2` TIMEOUT (only reachable if you pass `--timeout-minutes`, which a pipeline run never does), `3` the PR is gone, `4` bad arguments or `gh` could not answer. It listens to the workflow runs on the PR head; it never re-runs a channel, and no verdict it reports depends on a duration. |
| decision-followup | `gh label create decision-review --description "A default the pipeline chose; revisit when convenient" --color ededed --force` then `gh issue create --label decision-review --title "Decision review: <summary> (from #<N>)" --body "<decisions block + PR link>"`. `--force` makes the label step idempotent — it updates an existing label instead of failing the run on every issue after the first. |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
