---
name: autonomous-pipeline
description: >
  Guide for the fully autonomous AI development pipeline using LangGraph: repository settings,
  automation workflows, code review strategy, issue management, and troubleshooting.
  Use when setting up, debugging, or modifying the CI/CD automation pipeline.
---

## Pipeline Flow

`ready` label → **scheduled-assign.yml** (manual) or **auto-assign-next.yml** (PR merge) dispatches **langgraph-agent.yml** → LangGraph agent runs TDD pipeline (plan → tests → implement → review → PR) → PR merged → next `ready` issue auto-assigned.

## Repository Settings (One-Time Setup)

1. **Workflow Permissions:** Settings → Actions → General → Read and write + Allow create/approve PRs
2. **Enable Auto-Merge:** Settings → General → Pull Requests → Allow auto-merge

## Automation Workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Auto-assign next | `auto-assign-next.yml` | PR closed (merged) | Close done issue, dispatch LangGraph for next `ready` issue |
| Handle failure | `handle-failure.yml` | Issue labeled `blocked` | Comment + notify maintainer |
| Manual kickstart | `scheduled-assign.yml` | Manual dispatch only | Kick off LangGraph pipeline manually |
| LangGraph agent | `langgraph-agent.yml` | Issue comment (`@langgraph`) or workflow dispatch | Run the autonomous TDD pipeline |
| CI | `ci.yml` | Push / PR | Standard CI checks |
| Setup steps | `agentic-setup-steps.yml` | Agent session | Pre-install dependencies for agent |

## Labels

| Label | Color | Purpose |
|-------|-------|---------|
| `ready` | Green | Available for agent pickup |
| `in-progress` | Yellow | Agent working |
| `blocked` | Red | Needs human input |
| `done` | Purple | Merged and closed |
| `agent-task` | Blue | Identifies agent-processable issues |

## Reviewer Agent

Separate from the TDD pipeline. Invoke to audit a PR and post `APPROVED` as the auto-merge trigger.

Review flow:
1. Run all checks (architecture, i18n, 300-line limit, no Math.random(), tests via `npm run validate`)
2. If issues found: push fixes, wait for CI to start on new commit
3. Post `APPROVED` comment **as very last action** — after all commits pushed, no further changes needed
4. Exit immediately after posting approval comment — no additional file ops, pushes, or API calls after this point

`APPROVED` comment is session termination signal. Nothing must follow it.

## Writing Good Issues

As **Customer**: Write "what" + "why"
As **Lead Developer**: Write "how" + testing commands

Better issues → more autonomous pipeline. Use agent-task template.

## Security Notes

- CI auto-approval means unreviewed code runs Actions. Scope secrets tightly.
- Use fine-grained PAT scoped to this repo only

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Pipeline stalls | Manually trigger scheduled-assign.yml from Actions tab |
| Agent keeps failing | Label `blocked`, review logs, add context, consider splitting task |
| PR doesn't reference issue | Ensure instructions stress "Closes #<number>" in PR body |
