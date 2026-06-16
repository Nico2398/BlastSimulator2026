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

Caller provides a `<label>`. All TDD branches use it:

- `pipeline/tests-<label>` — skeleton + tests
- `pipeline/impl-<label>` — implementation (forked from skeleton commit)
- `pipeline/feature-<label>` — deliverable (tests HEAD + cherry-picked impl)

### Steps

```
 1. [setup-test-branch]     → (non-agentic) create pipeline/tests-<label> from main
 2. [branch-sanity]         → (non-agentic) verify on pipeline/tests-<label>
 3. @skeleton-writer        → Write empty stubs on tests branch, record skeleton_commit_sha
 4. [verify-commit]         → (non-agentic) confirm skeleton commit exists; auto-commit if dirty
 5. [setup-impl-branch]     → (non-agentic) create pipeline/impl-<label> from skeleton_commit_sha
 6. [switch-to-test]        → (non-agentic) switch back to pipeline/tests-<label>
 7. [branch-sanity]         → (non-agentic) verify on pipeline/tests-<label>
 8. @test-writer            → Write failing tests on tests branch (unit + integration + scenario)
 9. [verify-commit]         → (non-agentic) confirm test commit exists; auto-commit if dirty
10. [switch-to-impl]        → (non-agentic) switch to pipeline/impl-<label>
11. [branch-sanity]         → (non-agentic) verify on pipeline/impl-<label>
12. @implementer            → Minimum code to pass on impl branch (never sees test commits)
13. [verify-commit]         → (non-agentic) confirm impl commit exists; auto-commit if dirty
14. [cherry-pick]           → (non-agentic) cherry-pick impl onto feature branch:
                             If pipeline/feature-<label> exists → cherry-pick onto it
                             If not → create pipeline/feature-<label> from tests HEAD, then cherry-pick
                             if conflicts → @conflict-resolver → retry cherry-pick
15. [git-verify]            → (non-agentic) confirm clean state: git status, branch, last commits
```

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| @skeleton-writer | @skeleton-writer (self-retry) |
| @test-writer | @test-writer (self-retry) |
| @implementer | @implementer (self-retry) |
| [cherry-pick] / conflicts | @conflict-resolver → retry |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| Any × 7 | Human escalation |

### Branch isolation

| Agent | Branch | Sees test source? |
|-------|--------|-------------------|
| @skeleton-writer | tests_branch | No tests exist yet |
| @test-writer | tests_branch | Yes |
| @implementer | impl_branch | **No** — branch enforces this |

### Non-Agentic Steps

| Step | Action |
|------|--------|
| setup-test-branch | `git checkout -b pipeline/tests-<label> main` |
| setup-impl-branch | `git checkout -b pipeline/impl-<label> <skeleton_commit_sha>` |
| switch-to-test | `git checkout pipeline/tests-<label>` |
| switch-to-impl | `git checkout pipeline/impl-<label>` |
| branch-sanity | `git branch --show-current` |
| verify-commit | `git log --oneline -1` — auto-commit if dirty |
| cherry-pick | `git cherry-pick <impl_commit_sha>` — on feature branch; detect conflicts. If feature branch missing: `git checkout -b pipeline/feature-<label> pipeline/tests-<label>`, then cherry-pick |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
