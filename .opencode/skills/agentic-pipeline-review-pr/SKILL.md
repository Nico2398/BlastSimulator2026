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
| 2 | [merge-findings] | Orchestrator merges sub-reviewer findings → pass/fail, and gives each one a disposition |
| 3 | @reviewer | Runtime validation: run tests, post review outcome (report only — no fixes) |
| 4 | [followup] | Orchestrator files the findings dispositioned `file` per `agentic-issue-creation`, then comments on the PR listing them |

### Rules

- Reviewers run in parallel — the orchestrator issues all five delegations **in a single message and awaits them all in that same turn**. Never backgrounded, under any runtime: a reviewer whose result is delivered after the turn ends is never delivered at all, and the run dies between step 1 and step 2 — no findings merged, no PR opened, and the unpushed branches lost with the runner. `agentic-autonomous-pipeline` records how each runtime enforces this.
- @reviewer runs after findings are merged, sees the consolidated output
- @reviewer runs full test suite to validate
- @reviewer posts pass/fail outcome as PR comment
- No branch creation, no commits (review is read-only)
- **A reviewer reports a finding; it never files one.** Every runtime denies its read-only agents the commands that mutate GitHub, each by its own mechanism, so a reviewer that tries to file fails wherever it runs. Findings travel up in the reviewer's own output and the orchestrator files them — which is also what keeps five parallel reviewers from filing five issues for one finding.

### Finding disposition

Every merged finding gets exactly one disposition, decided at `merge-findings` once all five reviewer outputs are in — never per-reviewer, because the same problem is routinely reported by two of them under different names:

| Disposition | When | What happens |
|-------------|------|--------------|
| `fix` | The finding is inside what this PR changed or broke | Fixed on this branch, before the PR is marked |
| `file` | The finding is real but outside this PR's scope — pre-existing debt, a gap the diff merely revealed, a neighbouring inconsistency | Carried to `[followup]` and filed there |
| `drop` | Duplicate of another finding, or contradicted by the code | Nothing, beyond saying so in the merged output |

`file` is not a softer `fix`. A finding inside the diff is this run's work whatever it costs; a finding outside it stays outside, because widening a PR to chase debt is how a reviewed change becomes an unreviewable one.

### Non-Agentic Steps

| Step | Action |
|------|--------|
| merge-findings | Deduplicate and merge all reviewer outputs → pass/fail, and disposition each finding `fix` / `file` / `drop` per the table above |
| followup | File every `file` finding per `agentic-issue-creation` — duplicate check first, labels by its confidence table — then one `gh pr comment` listing what was filed, in the format `agentic-pipeline-finalization` gives. It runs after @reviewer for the same reason it runs last there: the numbers do not exist until the issues are filed, so no earlier comment can carry them. Nothing dispositioned `file` → skip both. |

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
- Filed as follow-ups: #N, #M (or `none`)
```
