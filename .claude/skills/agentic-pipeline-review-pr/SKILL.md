---
name: agentic-pipeline-review-pr
description: >
  Review PR pipeline for the TDD orchestrator. Runs parallel code review by
  specialist reviewers, merges findings, then runtime validation via @reviewer.
  Use when the orchestrator classifies a task as PR review.
---

## ▶ PROCEDURE — EXECUTE IN ORDER. DO NOT SKIP. DO NOT IMPROVISE.

| Step | Who | Action |
|------|-----|--------|
| 1 | @security-reviewer + @quality-reviewer + @i18n-reviewer + @duplication-reviewer + @semantic-reviewer | Parallel code review |
| 2 | [merge-findings] | Orchestrator merges sub-reviewer findings → pass/fail |
| 3 | @reviewer | Runtime validation: run tests, post review outcome (report only — no fixes) |

### Rules

- Reviewers run in parallel — the orchestrator issues all five delegations **in a single message and awaits them all in that same turn**. Under Claude Code every `Agent` call carries `run_in_background: false`; the parameter defaults to `true`, and a backgrounded reviewer reports through a notification that arrives on a later turn the runner will never take. Launching the five and ending the turn loses the run: step 2 never happens, no PR is opened, and the unpushed branches die with the runner VM.
- @reviewer runs after findings are merged, sees the consolidated output
- @reviewer runs full test suite to validate
- @reviewer posts pass/fail outcome as PR comment
- No branch creation, no commits (review is read-only)

### Non-Agentic Steps

| Step | Action |
|------|--------|
| merge-findings | Deduplicate and merge all reviewer outputs → pass/fail |

### Review Output Format

After completion:
```
## Review Complete
- Quality: PASS/FAIL
- Security: PASS/FAIL
- i18n: PASS/FAIL
- Duplication: PASS/FAIL
- Tests: PASS/FAIL
- Verdict: APPROVE / REQUEST CHANGES
```
