---
name: agentic-pipeline-full
description: >
  Full pipeline for new features and visual/rendering changes. Runs planner,
  TDD cycle (via `agentic-pipeline-tdd`), visual feedback loop, qualimetry,
  and finalization (via `agentic-pipeline-finalization`).
---

## ▶ PROCEDURE — EXECUTE IN ORDER. DO NOT SKIP. DO NOT IMPROVISE.

```
[ ] = orchestrator-executed command  |  @agent = AI agent invocation

 1. @planner                  → Create implementation plan
 2. TDD cycle                 → Delegate to `agentic-pipeline-tdd` skill
                                label = <issue-number>-<run-id>   (see that skill's Branch naming:
                                the run id is what makes this run's branches its own)
 3. [switch-to-feature]       → switch to pipeline/feature-<label>
 4. [branch-sanity]           → verify on pipeline/feature-<label>
 5. [test-runner]             → run full test suite on feature branch
                                if fail → @fixer → re-run test-runner (tight loop, max 7 retries)
 6. [verify-commit]           → confirm fix commit; auto-commit if dirty
 7. [visual-feedback-loop]    → Visual feedback loop (visual-change ONLY).
                                 Skip for backend-only features.
                                 Loop on failure — see "Visual Feedback Loop" below.
                                 **CRITICAL:** If @visual-tester returns VISUAL: BLOCKED (cannot inspect),
                                 halt pipeline immediately. Do NOT proceed to qualimetry. Escalate.
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
| [visual-feedback-loop] VISUAL: BLOCKED | **HALT** — escalate, do not proceed to qualimetry |
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
  a. @visual-tester   → Run the named scenarios with --shots, inspect ALL screenshots.
                        Named: every scenario the issue's Verification section calls
                        for, every definition under scripts/scenario-defs/ the diff
                        touches, and any the orchestrator adds because the change
                        reaches it. Never the whole suite — the full interaction-mode
                        run is CI's, behind `full-ci`.
                        Must return VISUAL: PASS, VISUAL: FAIL, or VISUAL: BLOCKED.
                        If VISUAL: BLOCKED → halt pipeline immediately (escalate).
                        If no failures → exit loop (continue to step 9).
  b. @implementer     → Fix ALL reported visual issues.
                        Runs on feature branch (branch-sanity: pipeline/feature-<label>).
                        Does NOT switch to impl branch — this is not TDD, it's visual iteration.
  c. [test-runner]    → Verify no test regression.
                        if fail → @fixer → re-run [test-runner]
  d. goto (a)         → Next iteration, while fewer than 3 have run and the loop
                        budget is open (`agentic-autonomous-pipeline`).
```

**Key rules:**
- **Volumetric iterations fan out.** Five or more screenshots to capture and read
  back, or five or more scenario definitions to adapt, is a parallel batch wave —
  `agentic-pipeline-tdd`'s "Volumetric work goes out in parallel batches" holds the
  procedure. A browser harness is the most expensive thing this pipeline runs
  (~6.4 s/frame without a GPU), so this is where the job budget is won or lost.
- `@implementer` during visual loop: fix ALL reported visual issues, commit, hand back to visual-tester
- `@visual-tester` each iteration: re-run the same named scenarios, report remaining failures
- No qualimetry, code review, or refactorer inside the loop — those run once after loop exits
- Three iterations is the cap, and the loop budget closes the loop sooner. A failure still present after the last iteration goes on the PR the way any red channel does — `agentic-pipeline-pr-management` — never into another pass. The runner has no GPU, a frame costs ~6 s, and one iteration is the most expensive thing this pipeline runs: #956 finished its TDD cycle 28 minutes in and spent the next five and a half hours in this loop, ten probe runs of one ultrawide viewport in the last ninety minutes alone.

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
