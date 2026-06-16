---
name: agentic-pipeline-full
description: >
  Full pipeline for new features and visual/rendering changes. Runs planner,
  TDD cycle (via `agentic-pipeline-tdd`), visual feedback loop, qualimetry,
  and finalization (via `agentic-pipeline-finalization`).
---

## Full Pipeline

```
 1. @planner                  → Create implementation plan
 2. TDD cycle                 → Delegate to `agentic-pipeline-tdd` skill
                                label = <issue-number>
 3. [switch-to-feature]       → (non-agentic) switch to pipeline/feature-<N>
 4. [branch-sanity]           → (non-agentic) verify on pipeline/feature-<N>
 5. [test-runner]             → (non-agentic) run full test suite on feature branch
                                if fail → @fixer → re-run test-runner (tight loop, max 7 retries)
 6. [verify-commit]           → (non-agentic) confirm fix commit; auto-commit if dirty
 7. [visual-feedback-loop]    → Visual feedback loop (visual-change ONLY).
                                Skip for backend-only features.
                                Loop on failure — see "Visual Feedback Loop" below.
 8. [qualimetry]              → (non-agentic) jscpd syntactic duplication check
                                if fail → @implementer (big loop)
 9. [finalization]            → Delegate to `agentic-pipeline-finalization` skill
10. [git-verify]              → (non-agentic) confirm clean state: git status, branch, last commits
```

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| @planner | @planner (self-retry) |
| [visual-feedback-loop] | See loop below — self-iterating |
| [qualimetry] | @implementer (big loop) |
| finalization phase | See `agentic-pipeline-finalization` |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| Any × 7 | Human escalation |

When looping back to `@implementer` from qualimetry: `implementer → TDD cycle (steps 3-14) → switch-to-feature → test-runner → qualimetry → finalization`. Visual loop is NOT re-run — it is a one-time gate before qualimetry.

### Visual Feedback Loop

Runs after test-runner passes on feature branch, before qualimetry. Visual-change only — skip for backend-only features.

```
LOOP:
  a. @visual-tester   → Run scenario tests with --shots, inspect ALL screenshots.
                        Report ALL visual failures in one pass, ranked by severity.
                        If no failures → exit loop (continue to step 8).
  b. @implementer     → Fix ALL reported visual issues.
                        Runs on feature branch (branch-sanity: pipeline/feature-<N>).
                        Does NOT switch to impl branch — this is not TDD, it's visual iteration.
  c. [test-runner]    → Verify no test regression.
                        if fail → @fixer → re-run [test-runner]
  d. goto (a)         → Next iteration. No iteration cap.
```

**Key rules:**
- `@implementer` during visual loop: fix ALL reported visual issues, commit, hand back to visual-tester
- `@visual-tester` each iteration: re-run full scenario suite, report remaining failures
- No qualimetry, code review, or refactorer inside the loop — those run once after loop exits
- If loop makes no progress after 7 iterations → orchestrate escalation

### Non-Agentic Steps

| Step | Action |
|------|--------|
| switch-to-feature | `git checkout pipeline/feature-<N>` |
| branch-sanity | `git branch --show-current` |
| verify-commit | `git log --oneline -1` — auto-commit if dirty |
| test-runner | `npx vitest run` — route to @fixer on fail |
| qualimetry | `npx jscpd src/ tests/` — route to @implementer on fail |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
