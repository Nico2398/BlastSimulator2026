---
name: agentic-pipeline-executor
description: >
  Executor pipeline for the TDD orchestrator. Runs imperative commands via
  @executor sub-agent using gh or shell. Use when the orchestrator classifies
  a task as an imperative command (label, assign, close, etc.).
---

## ▶ PROCEDURE — EXECUTE IN ORDER. DO NOT SKIP. DO NOT IMPROVISE.

Simple command-execution pipeline. No code changes, no branch isolation.

| Step | Who | Action |
|------|-----|--------|
| 1 | @executor | Execute imperative command via `gh` or shell |
| 2 | [post] | Post result as PR/issue comment via `gh pr comment` or `gh issue comment` |
| 3 | [release] | Return the assigned issue to a terminal state — the executed command is the deliverable |

### Rules

- `@executor` runs commands directly — do not delegate to `@implementer` or other agents
- **The executed command finishes the issue.** Assignment labels an issue `in-progress`, and the only things that take that label off are a merged pull request and the stall sweep that declares a run lost. A pipeline whose deliverable is a command rather than a diff therefore releases its own issue, or the queue keeps deferring behind a run that already succeeded and then reports it as a failure hours later.
- Release applies to the issue this run was assigned, and only once the command has run and its result is posted. A command issued on a pull request has no issue lifecycle to close.
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
| release | `gh issue edit <N> --add-label done --remove-label in-progress` then `gh issue close <N>` — after the result is posted, and only for an assigned issue |
