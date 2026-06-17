---
name: agentic-pipeline-ask
description: >
  Ask pipeline for the TDD orchestrator. Answers questions via @ask sub-agent,
  posts result as PR/issue comment. Use when the orchestrator classifies a task
  as question or analysis.
---

## Ask Pipeline

Simple read-only analysis pipeline. No code changes.

```
[ ] = orchestrator-executed command  |  @agent = AI agent invocation

1. @ask        → Answer question directly (read-only analysis)
2. [post]      → post @ask's answer as PR/issue comment via `gh pr comment` or `gh issue comment`
```

### Rules

- `@ask` is read-only — no branch creation, no commits, no file writes
- Post step prepends the original question as context for readers. Format: `"**Question:** <original>\n\n**Answer:** <answer body>"`
- When posting as comment, reference the original question URL if available

### Non-Agentic Steps

| Step | Action |
|------|--------|
| post | `gh pr comment <pr-url> --body "<answer>"` or `gh issue comment <issue-url> --body "<answer>"` |
