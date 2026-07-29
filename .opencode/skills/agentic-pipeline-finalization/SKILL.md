---
name: agentic-pipeline-finalization
description: >
  Standard finalization procedure for TDD pipelines. Runs parallel code review,
  merges findings, refactors, validates, and opens PR. Used as the final phase
  of full, fix-bug, and multi pipelines.
---

## ▶ PROCEDURE — EXECUTE IN ORDER. DO NOT SKIP. DO NOT IMPROVISE.

Runs after qualimetry passes. Branch: `pipeline/feature-<N>`.

**Parameters:**
- `skip_refactorer` (default: `false`) — set to `true` for bug-fix pipelines to skip refactoring phase.
- `visual_incomplete` (default: `false`) — set to `true` when visual feedback loop could NOT complete inspection (VISUAL: BLOCKED). When `true`, the PR MUST be created as draft (--draft) WITHOUT `READY TO MERGE`.

```
[ ] = orchestrator-executed command  |  @agent = AI agent invocation

 1. Code review (parallel):
        Delegate to `agentic-pipeline-review-pr` skill's code review step.
        All five delegations go out in ONE message and are awaited in that same
        turn — never backgrounded. See that skill's rules for why.
 2. [merge-findings]     → Orchestrator merges all sub-reviewer findings → pass/fail.
                            Pass/fail evaluated AFTER all reviewers complete.
                            if fail → @implementer (big loop)
 3. @refactorer          → If `skip_refactorer=true` → skip this step (jump to step 5).
                            Otherwise: clean up conventions, no behavior change,
                            then re-run [test-runner] to verify no regression.
                            [test-runner] results:
                              PASS → continue to step 5 (skip qualimetry + code review)
                              FAIL → @implementer (big loop: TDD → qualimetry → finalization from start)
 4. [verify-commit]      → confirm refactor commit exists; auto-commit if dirty
 5. @validator           → Full validation: typecheck → tests → build
                            if fail → @implementer (big loop)
 6. [verify-commit]      → final commit check before PR
 7. [open-pr]            → create PR from feature branch to main.
                             Evaluate draft/ready per `agentic-pipeline-pr-management` skill.
                             Carry every defaulted requirement into the body under
                             `## Decisions taken` per `agentic-decision-autonomy`.
                             **If `visual_incomplete=true` → MUST use --draft, NO `READY TO MERGE`.**
 8. [decision-followup]  → If any decision was material to gameplay, economy, or a player-facing
                             default: `gh issue create --label decision-review` carrying the
                             `## Decisions taken` block and the PR link. No `ready` label — it
                             stays out of the assignment queue and halts nothing.
                             No material decisions → skip.
 9. [git-verify]         → confirm clean state: git status, branch, last commits
```

**Retry counter:** resets at start of each finalization invocation.

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| [merge-findings] | @implementer (big loop) |
| @refactorer or [test-runner after refactorer] | @implementer (big loop) |
| @validator | @implementer (big loop) |
| [git-verify] | Diagnose and fix — never proceed with dirty state |
| Any × 7 | Human escalation: add PR/issue comment summarizing failure + history, then stop with `ESCALATED: human intervention required` |

When looping back to `@implementer` from any finalization step:
`@implementer on impl branch → cherry-pick → switch-to-feature → qualimetry → finalization`
Do NOT re-run skeleton-writer or test-writer — branches and tests already exist.

### Non-Agentic Steps

| Step | Action |
|------|--------|
| merge-findings | Deduplicate and merge all reviewer outputs → pass/fail (evaluate after ALL reviewers complete) |
| After refactorer | `npx vitest run` — PASS → @validator, FAIL → @implementer (big loop) |
| verify-commit | `git log --oneline -1` — auto-commit if dirty, use message `"<agent-name>: <step-context> (#<N>)"` |
| open-pr | `gh pr create --base main --head pipeline/feature-<N> --title "<type>: Resolve #<N>" --body "Closes #<N>\n\n<test_count> tests — all passing\n\n<decisions_block>\n\nREADY TO MERGE"`. Determine `<type>` from pipeline: `full → feat`, `fix-bug → fix`, `multi → feat`. Count test cases: `npx vitest list --reporter=json 2>$null | ConvertFrom-Json | ForEach-Object { $_.testModules } | Measure-Object`. `<decisions_block>` is the `## Decisions taken` section, omitted when the run defaulted nothing. For draft: add `--draft`, omit `READY TO MERGE` line. |
| decision-followup | `gh issue create --label decision-review --title "Decision review: <summary> (from #<N>)" --body "<decisions block + PR link>"`. Create the label first if the repo lacks it: `gh label create decision-review --description "A default the pipeline chose; revisit when convenient" --color ededed`. |
| git-verify | `git status --porcelain` (must be empty) → `git branch --show-current` → `git log --oneline -3` |
