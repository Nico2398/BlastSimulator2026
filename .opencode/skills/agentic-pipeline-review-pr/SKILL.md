---
name: agentic-pipeline-review-pr
description: >
  Review PR pipeline for the TDD orchestrator. Runs parallel code review by
  specialist reviewers, merges findings, then runtime validation via @reviewer.
  Use when the orchestrator classifies a task as PR review.
---

## Review PR Pipeline

```
1. Code review (parallel): @quality-reviewer + @security-reviewer + @i18n-reviewer + @duplication-reviewer
2. [merge-findings]  → Orchestrator merges sub-reviewer findings
3. @reviewer           → Runtime validation: run tests, fix any critical items, post review outcome
```

### Rules

- Reviewers run in parallel — orchestrator invokes all 4 simultaneously
- @reviewer runs after findings are merged, sees the consolidated output
- @reviewer runs full test suite to validate
- @reviewer posts pass/fail outcome as PR comment
- No branch creation, no commits (review is read-only)

### Non-Agentic Steps

| Step | Action |
|------|--------|
| merge-findings | Deduplicate and merge all 4 reviewer outputs → pass/fail |

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
