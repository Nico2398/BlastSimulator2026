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
[ ] = orchestrator-executed command  |  @agent = AI agent invocation

1. @executor   → Execute imperative command via `gh` or shell
2. [post]      → post result as PR/issue comment via `gh pr comment` or `gh issue comment`
```

### Rules

- `@executor` runs commands directly — do not delegate to `@implementer` or other agents
- For destructive actions, prefer non-destructive alternatives:
  | Destructive | Preferred alternative |
  |-------------|----------------------|
  | `git reset --hard` | `git revert <commit>` (reversible) |
  | `git clean -fd` | `git checkout -- .` reverts tracked files; refuse untracked cleanup in non-interactive mode (`git clean -fd` has no safe non-destructive equivalent) |
  | `gh issue close` | `gh issue comment "Closing..." && gh issue close` (traceable) |
  | `git branch -D` | `git branch -m <old> <backup>` (recoverable) |
- When non-destructive alternative unavailable, confirm with invoker before executing. In non-interactive (GitHub Actions) mode, refuse with: "Destructive command blocked — requires human."
- Post step includes command output (stdout/stderr)

### Non-Agentic Steps

| Step | Action |
|------|--------|
| post | `gh pr comment <pr-url> --body "<result>"` or `gh issue comment <issue-url> --body "<result>"` |
