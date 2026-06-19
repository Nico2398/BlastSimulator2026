---
name: agentic-pipeline-tdd
description: >
  Core TDD cycle: skeleton → tests → implementation → cherry-pick onto feature
  branch. Used by full, multi, and fix-bug pipelines that need isolated TDD
  with implementer branch blindness. Branch naming uses a <label> parameter.
---

## TDD Cycle

Branch isolation is critical. Implementer never sees test source.

### Branch naming

Caller provides a `<label>` and optionally `<base_branch>` (default: `main`). All TDD branches use it:

- `pipeline/tests-<label>` — skeleton + tests (forked from `<base_branch>`)
- `pipeline/impl-<label>` — implementation (forked from skeleton commit)
- `pipeline/feature-<label>` — deliverable (tests HEAD + cherry-picked impl)

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
| verify-commit | `git log --oneline -1` — auto-commit if dirty, use message `"<agent-name>: <step-context> (#<label>)"` |
| verify-skeleton-sha | Bash: `git cat-file -t <skeleton_commit_sha> 2>/dev/null` / PS: `git cat-file -t <skeleton_commit_sha> 2>$null`. If not a valid object → abort, retry @skeleton-writer |
| cherry-pick | `git cherry-pick pipeline/impl-<label>` — on feature branch; detect conflicts. If feature branch missing: `git checkout -b pipeline/feature-<label> pipeline/tests-<label>`, then cherry-pick |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
