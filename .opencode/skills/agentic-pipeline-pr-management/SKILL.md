---
name: agentic-pipeline-pr-management
description: >
  PR status, draft vs ready-to-merge logic, READY TO MERGE convention, and
  [skip ci] rules for pipeline-generated PRs. Referenced by the orchestrator
  before open-pr step.
---

## PR Status

Set `pr_status` before open-pr step. Controls whether PR is created as draft or ready-to-merge.

| Status | Behavior | When to use |
|--------|----------|-------------|
| `ready` (default) | PR created as normal, `READY TO MERGE` in body triggers auto-merge | Simple fixes, features with full coverage, no human-dependency |
| `draft` | PR created with `--draft` flag, `READY TO MERGE` NOT included | Visual-change tasks needing human sign-off, pipeline hit retry loops, explicit request |

The open-pr step passes `--draft` to `gh pr create` when `pr_status=draft`.

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
