---
name: agentic-pipeline-pr-management
description: >
  PR status, draft vs ready-to-merge logic, READY TO MERGE convention, and
  [skip ci] rules for pipeline-generated PRs. Referenced by the orchestrator
  before open-pr step.
---

## PR Status — Self-Evaluation

Before open-pr step, evaluate: **is this PR ready to merge or should it be a draft?**

Ask yourself:
1. Does this change affect visuals or rendering? → draft (needs human sign-off)
2. Did the pipeline hit retry loops or heavy review findings? → draft (needs human review)
3. Does the issue explicitly request human input? → draft
4. Is this a simple fix or feature with full test coverage, no visual changes, and clean pipeline run? → ready

| Evaluation | Behavior | When |
|------------|----------|------|
| `ready` (default) | PR created as normal, `READY TO MERGE` in body triggers auto-merge | Simple fixes, features with full coverage, no human-dependency |
| `draft` | PR created with `--draft` flag, `READY TO MERGE` NOT included | Visual-change tasks needing human sign-off, pipeline hit retry loops, explicit request |

The open-pr step passes `--draft` to `gh pr create` when evaluation is `draft`.

## READY TO MERGE

After creating the PR, the body must include `READY TO MERGE` on its own line. The `auto-assign-next.yml` workflow detects this and enables GitHub native auto-merge via a PAT token, ensuring downstream CI events trigger correctly.

This is the **default**. Skip `READY TO MERGE` when:
1. The issue requires human input (artistic direction, critical design decision).
2. The pipeline hit significant churn (repeated failure loops, heavy review findings, multiple implementer do-overs).

When skipping, post a comment explaining why:

```
gh pr comment <pr-url> --body "READY TO MERGE skipped — human input needed: <reason>"
```

Include churn details in the reason so the reviewer understands the risk.

## Critical: NEVER use `[skip ci]` on PR branches

The `auto-assign-next.yml` workflow (triggered on `pull_request: [synchronize]`) detects `READY TO MERGE` and enables auto-merge. **Any commit with `[skip ci]` on a PR branch prevents this workflow from triggering**, leaving the PR without auto-merge.

Rules:
- **NEVER** include `[skip ci]` in any commit message on `pipeline/feature-*` branches
- The `verify-commit` auto-commit message must NOT contain `[skip ci]`
