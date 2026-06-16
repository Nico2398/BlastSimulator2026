---
name: agentic-pipeline-finalization
description: >
  Standard finalization procedure for TDD pipelines. Runs parallel code review,
  merges findings, refactors, validates, and opens PR. Used as the final phase
  of full, fix-bug, and multi pipelines.
---

## Finalization Procedure

Runs after qualimetry passes. Branch: `pipeline/feature-<N>`.

```
 1. Code review (parallel):
       @security-reviewer      → exploitable vulnerabilities
       @quality-reviewer       → architecture, conventions, TypeScript strictness
       @i18n-reviewer          → hardcoded strings, locale mismatches
       @duplication-reviewer   → semantic duplication, non-atomic functions
       @semantic-reviewer      → test names match logic, function names match behavior
 2. [merge-findings]     → Orchestrator merges all sub-reviewer findings → pass/fail
                           if fail → @implementer (big loop)
 3. @refactorer          → Clean up conventions, no behavior change
                           then re-run [test-runner] to verify no regression
 4. [verify-commit]      → (non-agentic) confirm refactor commit exists; auto-commit if dirty
 5. @validator           → Full validation: typecheck → tests → build
                           if fail → @implementer (big loop)
 6. [verify-commit]      → (non-agentic) final commit check before PR
 7. [open-pr]            → (non-agentic) create PR from feature branch to main + READY TO MERGE.
                           Use `--draft` when pr_status=draft.
 8. [git-verify]         → (non-agentic) confirm clean state: git status, branch, last commits
```

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| [merge-findings] | @implementer (big loop) |
| @semantic-reviewer | @implementer (big loop) |
| @refactorer | @implementer (big loop) |
| @validator | @implementer (big loop) |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| Any × 7 | Human escalation |

When looping back to `@implementer` from any finalization step:
`implementer → TDD cycle → qualimetry → finalization`

**Exception:** after `@refactorer` succeeds, re-run of `[test-runner]` routes to `@validator` — qualimetry and code review are NOT repeated.

### Non-Agentic Steps

| Step | Action |
|------|--------|
| merge-findings | Deduplicate and merge all 5 reviewer outputs → pass/fail |
| After refactorer | Re-run `npx vitest run` (skip qualimetry + code-review) |
| verify-commit | `git log --oneline -1` — auto-commit if dirty |
| open-pr | `gh pr create --base main --head pipeline/feature-<N> --body "Closes #<N>\n\n<N> new tests — all passing\n\nREADY TO MERGE"` — add `--draft` when pr_status=draft (omit READY TO MERGE from body) |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
