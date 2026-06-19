---
name: agentic-pipeline-fix-bug
description: >
  Fix-bug pipeline. Uses `agentic-pipeline-tdd` for the TDD cycle and
  `agentic-pipeline-finalization` for code review through PR
  (refactorer skipped).
---

## Fix-Bug Pipeline

```
 1. @planner                  → Plan the fix
 2. TDD cycle                 → Delegate to `agentic-pipeline-tdd` skill
                                label = <issue-number>
 3. [switch-to-feature]       → (non-agentic) switch to pipeline/feature-<N>
 4. [branch-sanity]           → (non-agentic) verify on pipeline/feature-<N>
 5. [test-runner]             → run tests on feature branch; fail → @fixer loop
 6. [verify-commit]           → (non-agentic) confirm fix commit; auto-commit if dirty
  7. [qualimetry]              → jscpd check; fail → @implementer (big loop)
   8. [finalization]            → Delegate to `agentic-pipeline-finalization` skill.
                                  Set `skip_refactorer=true` (bug fix — no refactoring phase).
                                  Runs code review → validator → open-pr.
  9. @context-maintainer       → Context maintenance
                                  Update context files to reflect project changes.
                                  Do nothing if no project logic changed.
 10. [git-verify]              → (non-agentic) confirm clean state: git status, branch, last commits
```

**Retry counter:** resets at start of each fix-bug pipeline invocation. Nested pipeline skills each have their own counter.

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| @planner | @planner (self-retry) |
| [qualimetry] | @implementer (big loop) |
| finalization phase | See `agentic-pipeline-finalization` |
| @context-maintainer | Fix and commit, or do nothing — never blocks pipeline |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| Any × 7 | Human escalation: add PR/issue comment summarizing failure + history, then stop with `ESCALATED: human intervention required` |

### Non-Agentic Steps

> Assumes `main` base branch. Override via `base_branch` parameter.

| Step | Action |
|------|--------|
| switch-to-feature | `git checkout pipeline/feature-<N>` — verify branch exists first. If not → abort with TDD cycle failure |
| branch-sanity | `git branch --show-current` |
| test-runner | `npx vitest run` — route to @fixer on fail |
| verify-commit | `git log --oneline -1` — auto-commit if dirty, use message `"<agent-name>: <step-context> (#<N>)"` |
| qualimetry | Bash: `changed=$(git diff --name-only origin/main -- src/ tests/); if [ -n "$changed" ]; then npx jscpd $changed; fi` / PS: `$changed=git diff --name-only origin/main -- src/ tests/; if($changed){npx jscpd $changed}` (changed files only) — route to @implementer on fail |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
