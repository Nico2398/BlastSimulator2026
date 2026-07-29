---
name: agentic-pipeline-pr-management
description: >
  PR status, draft vs ready-to-merge logic, READY TO MERGE convention, and
  [skip ci] rules for pipeline-generated PRs. Referenced by the orchestrator
  before open-pr step.
---

## PR Status — Self-Evaluation

Before open-pr step, evaluate: **is this PR ready to merge or should it be a draft?**

**Verification decides, and nothing else.** A PR is `ready` when every verification channel the change owes reports PASS. Ask one question per channel the change touches — static, logic, scenario, visual, playability — and one question about the issue's own verification list. All PASS → `ready`.

A PR is `draft` in exactly three cases:

| Draft because | Shape |
|---------------|-------|
| A required channel could not run | `VISUAL: BLOCKED` — no browser, dev server unreachable, screenshots never written. The work may be right; nothing can prove it. |
| A required channel is red and stayed red | The pipeline exhausted its retries against a genuine failure |
| A genuine blocker was hit | One of the five in `agentic-decision-autonomy` — contradictory requirements, missing external dependency, capability gap, unrunnable channel, irreversible action |

| Evaluation | Behavior |
|------------|----------|
| `ready` (default) | PR created as normal, `READY TO MERGE` in body triggers auto-merge |
| `draft` | PR created with `--draft` flag, `READY TO MERGE` NOT included |

The open-pr step passes `--draft` to `gh pr create` when evaluation is `draft`.

**These never make a PR a draft:** iteration counts of any kind (visual loop rounds, implementer do-overs, review findings addressed, cherry-pick retries), a fix that reached beyond the issue's framing, or a requirement the run had to default. Churn measures how hard the problem was. The channels measure whether the answer is right — see `agentic-decision-autonomy`.

## READY TO MERGE

After creating the PR, the body must include `READY TO MERGE` on its own line. The `auto-assign-next.yml` workflow detects this and enables GitHub native auto-merge via a PAT token, ensuring downstream CI events trigger correctly.

This is the **default**, skipped only in the three draft cases above. When skipping, post a comment naming the channel or blocker and the remedy — never a summary of how much work the run took:

```
gh pr comment <pr-url> --body "READY TO MERGE skipped — <channel or blocker>: <what fails, what would unblock it>"
```

A run that defaulted an open requirement keeps `READY TO MERGE` and records the choice in the PR body under `## Decisions taken`, per `agentic-decision-autonomy`.

## Critical: NEVER use `[skip ci]` on PR branches

The `auto-assign-next.yml` workflow (triggered on `pull_request: [synchronize]`) detects `READY TO MERGE` and enables auto-merge. **Any commit with `[skip ci]` on a PR branch prevents this workflow from triggering**, leaving the PR without auto-merge.

Rules:
- **NEVER** include `[skip ci]` in any commit message on `pipeline/feature-*` branches
- The `verify-commit` auto-commit message must NOT contain `[skip ci]`
