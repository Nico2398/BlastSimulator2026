---
name: agentic-pipeline-fix-bug
description: >
  Fix-bug pipeline. Uses `agentic-pipeline-tdd` for the TDD cycle and
  `agentic-pipeline-finalization` for code review through PR (refactorer skipped).
---

## Fix-Bug Pipeline

```
 1. @planner                  → Plan the fix
 2. TDD cycle                 → Delegate to `agentic-pipeline-tdd` skill
                                label = <issue-number>
 3. [switch-to-feature]       → switch to pipeline/feature-<N>
 4. [branch-sanity]           → verify on pipeline/feature-<N>
 5. [test-runner]             → run tests on feature branch
                                if fail → @fixer → re-run test-runner (tight loop, max 7 retries)
 6. [verify-commit]           → confirm fix commit; auto-commit if dirty
 7. [qualimetry]              → jscpd syntactic duplication check
                                if fail → @implementer (big loop)
 8. [finalization]            → Delegate to `agentic-pipeline-finalization` skill
                                skip_refactorer=true
 9. [git-verify]              → confirm clean state: git status, branch, last commits
```

**Retry counter:** resets at start of each fix-bug invocation. Nested pipeline skills each have their own counter.

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| @planner | @planner (self-retry) |
| [qualimetry] | @implementer (big loop) |
| finalization phase | See `agentic-pipeline-finalization` |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| Any × 7 | Human escalation: add PR/issue comment summarizing failure + history, then stop with `ESCALATED: human intervention required` |

When looping back to `@implementer` from qualimetry: `@implementer on impl branch → cherry-pick → switch-to-feature → [test-runner] → qualimetry → finalization`. Do NOT re-run skeleton-writer or test-writer.

### Non-Agentic Steps

> Assumes `main` base branch. Override via `base_branch` parameter.

| Step | Action |
|------|--------|
| switch-to-feature | `git checkout pipeline/feature-<N>` |
| branch-sanity | `git branch --show-current` |
| test-runner | `npx vitest run` — route to @fixer on fail |
| qualimetry | Bash: `changed=$(git diff --name-only origin/main -- src/ tests/); if [ -n "$changed" ]; then npx jscpd $changed; fi` / PS: `$changed=git diff --name-only origin/main -- src/ tests/; if($changed){npx jscpd $changed}` (changed files only) — route to @implementer on fail |
| verify-commit | `git log --oneline -1` — auto-commit if dirty, use message `"<agent-name>: <step-context> (#<N>)"` |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
