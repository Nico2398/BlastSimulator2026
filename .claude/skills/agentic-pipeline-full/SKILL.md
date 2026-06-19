---
name: agentic-pipeline-full
description: >
  Full pipeline for new features and visual/rendering changes. Runs planner,
  TDD cycle (via `agentic-pipeline-tdd`), visual feedback loop, qualimetry,
  and finalization (via `agentic-pipeline-finalization`).
---

## Full Pipeline

```
[ ] = orchestrator-executed command  |  @agent = AI agent invocation

 1. @planner                  → Create implementation plan
 2. TDD cycle                 → Delegate to `agentic-pipeline-tdd` skill
                                label = <issue-number>
 3. [switch-to-feature]       → switch to pipeline/feature-<N>
 4. [branch-sanity]           → verify on pipeline/feature-<N>
 5. [test-runner]             → run full test suite on feature branch
                                if fail → @fixer → re-run test-runner (tight loop, max 7 retries)
 6. [verify-commit]           → confirm fix commit; auto-commit if dirty
 7. [visual-feedback-loop]    → Visual feedback loop (visual-change ONLY).
                                Skip for backend-only features.
                                Loop on failure — see "Visual Feedback Loop" below.
  8. [qualimetry]              → jscpd syntactic duplication check
                                if fail → @implementer (big loop)
  9. [finalization]            → Delegate to `agentic-pipeline-finalization` skill
 10. @context-maintainer       → Context maintenance
                                Update context files to reflect project changes.
                                Do nothing if no project logic changed.
 11. [git-verify]              → confirm clean state: git status, branch, last commits
```

**Retry counter:** resets at start of each full pipeline invocation. Nested pipeline skills each have their own counter.

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| @planner | @planner (self-retry) |
| [visual-feedback-loop] | See loop below — self-iterating |
| [qualimetry] | @implementer (big loop) |
| finalization phase | See `agentic-pipeline-finalization` |
| @context-maintainer | Fix and commit, or do nothing — never blocks pipeline |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| Any × 7 | Human escalation: add PR/issue comment summarizing failure + history, then stop with `ESCALATED: human intervention required` |

When looping back to `@implementer` from qualimetry: `@implementer on impl branch → cherry-pick → switch-to-feature → [test-runner] → qualimetry`. Do NOT re-run skeleton-writer or test-writer — branches and tests already exist. Visual loop is NOT re-run — it is a one-time gate before qualimetry.

### Visual Feedback Loop

Runs after test-runner passes on feature branch, before qualimetry. Visual-change only — skip for backend-only features.

```
LOOP:
  a. @visual-tester   → Run scenario tests with --shots, inspect ALL screenshots.
                        Report ALL visual failures in one pass, ranked by severity.
                        If no failures → exit loop (continue to step 9).
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
- If the SAME visual failure persists across 3 consecutive iterations → loop makes no progress → orchestrate escalation (7 total iteration cap before hard escalation)

### Non-Agentic Steps

> Assumes `main` base branch. Override via `base_branch` parameter.

| Step | Action |
|------|--------|
| switch-to-feature | `git checkout pipeline/feature-<N>` — verify branch exists first. If not → abort with TDD cycle failure |
| branch-sanity | `git branch --show-current` |
| verify-commit | `git log --oneline -1` — auto-commit if dirty, use message `"<agent-name>: <step-context> (#<N>)"` |
| test-runner | `npx vitest run` — route to @fixer on fail |
| qualimetry | Bash: `changed=$(git diff --name-only origin/main -- src/ tests/); if [ -n "$changed" ]; then npx jscpd $changed; fi` / PS: `$changed=git diff --name-only origin/main -- src/ tests/; if($changed){npx jscpd $changed}` (changed files only, skip pre-existing duplicates) — route to @implementer on fail |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
