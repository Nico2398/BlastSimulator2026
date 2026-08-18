---
name: agentic-pipeline-tdd
description: >
  Core TDD cycle: skeleton → tests → implementation → cherry-pick onto feature
  branch. Used by full, multi, and fix-bug pipelines that need isolated TDD
  with implementer branch blindness. Branch naming uses a <label> parameter.
---

## ▶ PROCEDURE — EXECUTE IN ORDER. DO NOT SKIP. DO NOT IMPROVISE.

Branch isolation is critical. Implementer never sees test source.

### Branch naming

Caller provides a `<label>` and optionally `<base_branch>` (default: `main`). All TDD branches use it:

- `pipeline/tests-<label>` — skeleton + tests (forked from `<base_branch>`)
- `pipeline/impl-<label>` — implementation (forked from skeleton commit)
- `pipeline/feature-<label>` — deliverable (tests HEAD + cherry-picked impl)

**`<label>` is `<issue>-<runId>`, never the issue number alone.** The run id makes
every branch this run creates unique, so no run can inherit, collide with, or be
refused by a branch an earlier run left behind.

| Where the run is | `<runId>` |
|------------------|-----------|
| GitHub Actions | `$GITHUB_RUN_ID` — the runner also states the three branch names in the trigger prompt. Use exactly those |
| A CLI session | `local-$(openssl rand -hex 4)`, chosen once at the start of the run and used for all three branches |

Issue #554 is why. Run 160 timed out and its `pipeline/feature-554` was rescued
into PR #603, which was closed unmerged; the branch stayed on the remote. Run 166
built `pipeline/feature-554` again, from `main`, so the two histories diverged —
and six hours of finished work died on `! [rejected] (non-fast-forward)` because
the rescue push had nowhere to land. A unique name removes that class entirely:
nothing to force, nothing to reconcile, nothing to lose.

Rules that follow from it:

- **Never reuse a branch from an earlier run, and never force-push over one.** A
  branch that already exists under your `<label>` is your own, from an earlier
  step of this same run.
- Commit messages still cite the **issue**, not the label: `<agent>: <what> (#<issue>)`.
- Everything that matches a branch — assignment, watchdog, rescue, auto-merge —
  accepts `pipeline/feature-<issue>` and `pipeline/feature-<issue>-<anything>`
  alike, so a branch predating this convention is still found.

### Steps

```
[ ] = orchestrator-executed command  |  @agent = AI agent invocation

  1. [setup-test-branch]     → create pipeline/tests-<label> from <base_branch> (default: main)
  2. [branch-sanity]         → verify on pipeline/tests-<label>
  3. @skeleton-writer        → Write empty stubs on tests branch.
                             Parse output for `skeleton_commit_sha: <sha>` (expected format: `## RESULT: OK — skeleton_commit_sha: <sha>`).
                             If not found → retry skeleton-writer (max 3 times).
  4. [verify-skeleton-sha]   → confirm skeleton_commit_sha resolves: `git cat-file -t <sha>`. If invalid → retry @skeleton-writer.
  5. [verify-commit]         → confirm skeleton commit exists; auto-commit if dirty
  6. [setup-impl-branch]     → create pipeline/impl-<label> from skeleton_commit_sha
  7. [switch-to-test]        → switch back to pipeline/tests-<label>
  8. [branch-sanity]         → verify on pipeline/tests-<label>
  9. @test-writer            → Write failing tests on tests branch (unit + integration + scenario)
 10. [verify-commit]         → confirm test commit exists; auto-commit if dirty
 11. [switch-to-impl]        → switch to pipeline/impl-<label>
 12. [branch-sanity]         → verify on pipeline/impl-<label>
 13. @implementer            → Minimum code to pass on impl branch (never sees test commits)
 14. [verify-commit]         → confirm impl commit exists; auto-commit if dirty
 15. [cherry-pick]           → cherry-pick impl branch HEAD onto feature branch:
                               `git cherry-pick pipeline/impl-<label>` (branch ref, not SHA — picks all commits).
                               If pipeline/feature-<label> exists → cherry-pick onto it
                               If not → create pipeline/feature-<label> from tests HEAD, then cherry-pick
                               if conflicts → @conflict-resolver → retry cherry-pick (max 3 retries)
                               if still conflicts → human escalation
 16. [git-verify]            → confirm clean state: git status, branch, last commits
```

### ▶ Volumetric work goes out in parallel batches

A step is **volumetric** when it is the same transformation applied to N
independent files — scenario definitions to adapt to a new pacing, locale keys to
add, call sites to migrate, screenshots to read back. Volumetric work done one
file at a time is what spends a job budget: issue #554's run 166 edited 94 files
sequentially and was cancelled at 360 minutes with the work unpushed, and #553's
run before it ended the same way.

**At N ≥ 5 independent items, fan out. Do not iterate.**

1. **Split** the items into batches of 5–10, disjoint by file. A file appears in
   exactly one batch.
2. **Delegate every batch in a single message**, foreground, and await them all in
   that same turn — the same rule the reviewer fan-out in
   `agentic-pipeline-review-pr` already runs under, and for the same reason: a
   sub-agent whose result arrives after the turn ends is never delivered, and on a
   runner there is no later turn. At most 8 batches in flight; queue the rest and
   send the next message when they return.
3. **Each batch agent edits its own files and commits nothing.** Two agents
   committing in one worktree race over the index. The orchestrator commits once,
   after every batch of the wave has returned.
4. **Shared files are never batched.** `balance.ts`, `GameState.ts`, an i18n
   locale, anything every item touches — the orchestrator edits those itself,
   before the fan-out, and tells each batch what the new shape is.
5. **Verify once over the whole set, not per batch.** One `npm run test`, one
   scenario pass, after the wave — a batch that verifies itself pays the startup
   cost N times over.
6. **Report what each batch did**, so a failed batch is re-sent rather than the
   whole wave repeated.

Which agent runs a batch is the same choice as for the sequential step:
`@test-writer` for scenario definitions and tests, `@implementer` for call sites,
`@visual-tester` for screenshots to capture and read back.

**Sequential is still right for a dependent chain.** Skeleton → tests →
implementation is ordered by construction, and no fan-out changes that. It is the
inside of one of those steps that parallelises.

**Retry counter:** resets at start of each TDD cycle invocation. Nested pipeline skills each have their own counter.

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| @skeleton-writer | @skeleton-writer (self-retry) |
| @test-writer | @test-writer (self-retry) |
| @implementer | @implementer (self-retry) |
| [cherry-pick] / conflicts | @conflict-resolver → retry (max 3 tries) → escalate |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| Any × 7 | Human escalation: add PR/issue comment summarizing failure + history, then stop with `ESCALATED: human intervention required` |

### Branch isolation

| Agent | Branch | Sees test source? |
|-------|--------|-------------------|
| @skeleton-writer | tests_branch | No tests exist yet |
| @test-writer | tests_branch | Yes |
| @implementer | impl_branch | **No** — branch enforces this |

### Non-Agentic Steps

> Assumes `main` base branch. Override via `base_branch` parameter.

| Step | Action |
|------|--------|
| setup-test-branch | `git checkout -b pipeline/tests-<label> <base_branch>` (default: `main`) |
| setup-impl-branch | `git checkout -b pipeline/impl-<label> <skeleton_commit_sha>` |
| switch-to-test | `git checkout pipeline/tests-<label>` |
| switch-to-impl | `git checkout pipeline/impl-<label>` |
| branch-sanity | `git branch --show-current` |
| verify-commit | `git log --oneline -1` — auto-commit if dirty, use message `"<agent-name>: <step-context> (#<issue>)"` — the issue number, not the `<label>`: the run id belongs on branches, not in history |
| verify-skeleton-sha | Bash: `git cat-file -t <skeleton_commit_sha> 2>/dev/null` / PS: `git cat-file -t <skeleton_commit_sha> 2>$null`. If not a valid object → abort, retry @skeleton-writer |
| cherry-pick | `git cherry-pick pipeline/impl-<label>` — on feature branch; detect conflicts. If feature branch missing: `git checkout -b pipeline/feature-<label> pipeline/tests-<label>`, then cherry-pick |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
