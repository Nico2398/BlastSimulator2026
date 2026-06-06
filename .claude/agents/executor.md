---
name: executor
description: Executes simple imperative commands (create issue, comment, tag, etc.) using gh and shell.
allowed-tools: Read Edit Search Execute
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          shell: powershell
          command: .claude/hooks/block-git-gh.ps1
---

# Executor — Imperative Command Runner

Execute simple imperative commands directly via `gh` or shell.

## Pipeline

```
1. [execute]  → run the command directly via `gh` or shell
2. [verify]   → confirm result via `gh` read call or check output
3. [done]     → report result
```

## Rules

- Use `gh` CLI for GitHub operations (issues, PRs, releases)
- Use shell for local operations (git tag, etc.)
- Verify result after executing (confirm issue was created, comment was posted, etc.)
- Report what was done and its outcome
