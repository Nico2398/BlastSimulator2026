---
name: agentic-pipeline-executor
description: >
  Executor pipeline for the TDD orchestrator. Runs imperative commands via
  @executor sub-agent using gh or shell. Use when the orchestrator classifies
  a task as an imperative command (label, assign, close, etc.).
---

## Executor Pipeline

Simple command-execution pipeline. No code changes, no branch isolation.

```
1. @executor   → Execute imperative command via `gh` or shell
2. [post]      → (non-agentic) post result as PR/issue comment via `gh pr comment` or `gh issue comment`
```

### Rules

- `@executor` runs commands directly — do not delegate to `@implementer` or other agents
- For destructive commands (close, delete, force-push), confirm with user before executing
- Post step includes command output (stdout/stderr)

### Non-Agentic Steps

| Step | Action |
|------|--------|
| post | `gh pr comment <pr-url> --body "<result>"` or `gh issue comment <issue-url> --body "<result>"` |
