---
name: agentic-pipeline-ci-fix
description: >
  CI-fix pipeline. Turns a red CI on an existing open pipeline pull request green
  again, or resolves its conflict with main, working on the branch that PR is
  already built on. Use when the orchestrator classifies a task as a CI failure
  or a conflict handed back by agentic-ci-failure.yml, or when a run's own
  [await-ci] step reports RED.
---

## ▶ PROCEDURE — EXECUTE IN ORDER. DO NOT SKIP. DO NOT IMPROVISE.

The pull request already exists, its branch already carries the work, and its issue is already `in-progress`. **Nothing here is rebuilt.** No planner, no skeleton, no TDD cycle, no new branch, no second PR.

```
[ ] = orchestrator-executed command  |  @agent = AI agent invocation

 1. [scope]        → Read the trigger comment for the PR number, and whether it names
                       failing jobs or a conflict with `main` (the conflict variant, below).
                       `gh pr view <number> --json headRefName,isDraft,body,state`
                       Head must be in the issue's family — `pipeline/feature-<N>` or
                       `pipeline/feature-<N>-<runId>`. Not that → wrong pipeline, stop.
                       Read `<head>` off the PR; it is the branch the run that opened it built.
                       Draft or closed → already escalated, comment saying so and stop.
 2. [checkout]     → `git fetch origin && git checkout <head> &&
                       git reset --hard origin/<head>`
                       Never create the branch, never branch from `main`, never cherry-pick.
 3. [read-failure] → Conflict handback → the conflict variant below, then step 6.
                       `gh run view <run-id> --log-failed` for each failing job the comment named.
                       Interaction-mode failure → download the run's artifacts and open the FAIL
                       screenshots with vision. A CI-only channel is read, never re-run blind.
 4. [reproduce]    → Only where the channel is runnable in this session: `static`, `logic`,
                       command-mode `scenario`. One named definition, never the whole suite.
                       A channel that needs a GPU is not reproducible here — say so and work
                       from the log. Failure to reproduce is not evidence the failure is not real.
 5. @fixer         → A test or a baked expectation disagreeing with the change.
    @implementer   → A defect in the change itself.
    @visual-tester → A rendering or click-reachability claim.
                       Pick by what the log says, not by which is cheapest.
 6. [verify]       → Every channel the fix touches, per the Verification Gate. Then commit.
                       Never `[skip ci]` — `agentic-pipeline-pr-management`.
 7. [push]         → `git pull --no-rebase origin <head> && git push origin <head>`
                       The merge gate may have merged `main` into the branch since the
                       checkout. Never rebase, never force-push.
 8. [await-ci]     → `npm run ci:await -- --pr <number>`. RED → back to step 3.
                       GREEN → done: the merge gate takes the PR from here.
```

**Three rounds**, counted per session, and the loop budget (`agentic-autonomous-pipeline`) closes them sooner. This session exists for the red and starts with a whole budget, which is why it gets more rounds than the one `agentic-pipeline-finalization` allows a run that already spent its budget building the branch. Still red after the last round → convert the PR to a draft, comment naming the channel and what fails, label the issue `blocked`, stop with `ESCALATED: CI red after 3 fix rounds`.

### The conflict variant

The merge gate merges a pull request only on a head that contains `main`'s tip, and brings a green head that is behind up to date on its own. It cannot do that for a head that conflicts with `main` — only an agent can — so the fail-safe hands it back with the base tip named. Replace steps 3 to 5 with:

1. `git fetch origin main && git merge origin/main`. Nothing to merge, or it merges cleanly → someone resolved it first: skip to step 8.
2. Delegate the conflicted files to `@conflict-resolver`. Both sides' intent survives: this branch's change applied on top of what landed on `main`, never one side dropped. Lockfiles and generated files are regenerated with their tooling, never hand-merged. A mirrored context file is resolved once and the result copied to all three runtime directories.
3. Commit the merge, then continue at step 6 — `typecheck`, `test`, and `validate:context` when a context file conflicted, plus any channel the other side's change touches in files this branch changes.

A conflict that can only be resolved by choosing between two behaviours is a decision, not a merge: comment what the two sides want, convert the PR to a draft, label the issue `blocked`, stop with `ESCALATED: conflict with main needs a decision`.

## What this pipeline must not do

| Never | Why |
|-------|-----|
| Open a second PR | The existing one closes the issue. A second PR from a second branch makes the issue unassignable and merges nothing |
| Recreate the PR's head branch under a new name | Its commits are the deliverable and exist on `origin`. Rebuilding drops the reviewed work |
| Remove or re-add `READY TO MERGE` | It is already there and it is already correct — the marker was never a claim about CI. The merge gate merges the PR once CI is green on a head containing `main` |
| Rebase the branch or force-push it | The gate may have pushed a merge commit onto it, and a session reading this PR may hold it checked out. History on a pipeline branch only grows |
| Touch the issue's labels on success | The merge releases the issue. Labelling it here would fight the chain |
| Widen the fix beyond the failure | A red channel is the task. Anything else belongs in its own issue |
| Post a comment containing `@claude` or `@opencode` | It would wake another session on this PR. The handback comment is the only one allowed to carry a mention |

## The failure is a finding, whoever caused it

A CI failure on a pipeline PR is one of three things, and the log says which:

1. **The change is wrong.** The ordinary case. Fix the change.
2. **The expectation is wrong** — a baked scenario value, a snapshot, a count that the change legitimately moved. Update it *and say in the commit message why the new value is correct*. An expectation edited to match broken behaviour is a silent regression, and this is the step where one gets in.
3. **The failure predates the change** and reproduces on `main`. Then it is still this run's finding: say so in a PR comment naming the check, and fix it here if it is small. Never report the PR ready while the channel is red — the Verification Gate's rule about a channel already red when you arrived applies unchanged.

Flakiness is a claim, not a diagnosis. A step that fails on load contention or a timeout has a cause; name it before calling it flaky, and if it genuinely is, the fix is the scenario's own robustness, not a re-run.
