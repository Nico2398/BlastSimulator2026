---
name: agentic-pipeline-executor
description: >
  Executor pipeline: the lead runs an imperative command with gh or shell,
  verifies it with a read, posts the result, and releases the assigned issue as
  a non-diff deliverable. Use when the task is a command (label, assign, close,
  file issues).
---

## ▶ PROCEDURE — EXECUTE IN ORDER

Command execution. No code changes, no branch, no sub-agent.

| Step | Action |
|------|--------|
| 1 | [execute] Run the command with `gh` or shell, then confirm it took with a read (`gh issue view`, `gh pr view`, `git log`) |
| 2 | [post] Post the result as a PR or issue comment |
| 3 | [release] Return the assigned issue to a terminal state — the executed command is the deliverable |

### Rules

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
- A command that puts `ready` on an issue holds it to the Definition of Ready (`agentic-issue-creation`): add `agent-task` and the issue's `scope:*` labels in the same `gh issue edit`, or `agentic-intake.yml` takes `ready` straight back off. A command that labels an issue `done` holds it to the Definition of Done.

### Non-Agentic Steps

| Step | Action |
|------|--------|
| post | `gh pr comment <pr-url> --body "<result>"` or `gh issue comment <issue-url> --body "<result>"` |
| release | `gh issue edit <N> --add-label done --remove-label in-progress` then `gh issue close <N> --reason completed` — after the result is posted, and only for an assigned issue. That is the Definition of Done for a deliverable that is not a diff (`agentic-autonomous-pipeline`) |
