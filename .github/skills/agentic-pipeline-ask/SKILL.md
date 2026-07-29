---
name: agentic-pipeline-ask
description: >
  Ask pipeline for the TDD orchestrator. Answers questions via @ask sub-agent,
  posts result as PR/issue comment. Use when the orchestrator classifies a task
  as question or analysis.
---

## ▶ PROCEDURE — EXECUTE IN ORDER. DO NOT SKIP. DO NOT IMPROVISE.

Simple read-only analysis pipeline. No code changes. No exploration between steps.

| Step | Who | Action |
|------|-----|--------|
| 1 | @ask | Answer question directly (read-only analysis) |
| 2 | [post] | Post answer as PR/issue comment via `gh pr comment` or `gh issue comment` |
| 3 | [release] | Return the assigned issue to a terminal state — the posted answer is the deliverable |

### Rules

- `@ask` is read-only — no branch creation, no commits, no file writes
- Post step prepends the original question as context for readers. Format: `"**Question:** <original>\n\n**Answer:** <answer body>"`
- When posting as comment, reference the original question URL if available
- **The answer finishes the issue.** Assignment labels an issue `in-progress`, and the only things that take that label off are a merged pull request and the stall sweep that declares a run lost. A pipeline whose deliverable is a comment rather than a diff therefore releases its own issue, or the queue keeps deferring behind a run that already succeeded and then reports it as a failure hours later.
- Release applies to the issue this run was assigned. A question asked on a pull request has no issue lifecycle to close — post the answer and stop.

### Non-Agentic Steps

| Step | Action |
|------|--------|
| post | `gh pr comment <pr-url> --body "<answer>"` or `gh issue comment <issue-url> --body "<answer>"` |
| release | `gh issue edit <N> --add-label done --remove-label in-progress` then `gh issue close <N>` — after the answer is posted, and only for an assigned issue |
