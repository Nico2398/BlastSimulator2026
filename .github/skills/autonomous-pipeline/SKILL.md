---
name: autonomous-pipeline
description: >
  Guide for the fully autonomous AI development pipeline using GitHub Copilot: repository settings,
  automation workflows, code review strategy, issue management, budget, and troubleshooting.
  Use when setting up, debugging, or modifying the CI/CD automation pipeline.
---

## Architecture

```
YOU ──► Write issues (backlog) ──► Label "ready"
                                        │
        ┌───────────────────────────────┘
        ▼
  ┌─────────────────────┐
  │ AUTO-ASSIGN WORKFLOW │ (GitHub Actions on merge or on schedule)
  │ Picks next "ready"   │
  │ Assigns to @copilot  │
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐
  │ COPILOT CODING AGENT│ ◄── reads copilot-instructions.md
  │ Writes code          │ ◄── runs in copilot-setup-steps.yml env
  │ Runs tests           │ ◄── CI runs automatically
  │ Opens PR             │
  └──────────┬──────────┘
             ▼
  ┌─────────────────────┐
  │ COPILOT CODE REVIEW │ (automatic, independent context)
  │ Reviews PR quality   │
  │ Checks acceptance    │
  └──────┬─────────┬────┘
         │         │
      PASSES     FAILS
         │         │
         ▼         ▼
  ┌──────────┐  ┌──────────────────┐
  │AUTO-MERGE│  │ @copilot fix OR  │
  │ + close  │  │ tag @you         │
  │ issue    │  │ label "blocked"  │
  └────┬─────┘  └──────────────────┘
       │
       ▼
  AUTO-ASSIGN NEXT "ready" ISSUE ──► LOOP
```

## Repository Settings (One-Time Setup)

1. **Enable Copilot Coding Agent:** Settings → Copilot → Coding agent → Enable
2. **Disable CI Approval Requirement:** Settings → Copilot → Coding agent → Actions workflow approval → Disable "Require approval"
3. **Enable Auto-Merge:** Settings → General → Pull Requests → Allow auto-merge
4. **Enable Copilot Code Review:** Settings → Copilot → Code review → Enable + ruleset requiring Copilot review on `main`
5. **Workflow Permissions:** Settings → Actions → General → Read and write + Allow create/approve PRs
6. **PAT Token:** Fine-grained PAT with Issues, Pull requests, Contents permissions → store as `PAT_TOKEN` secret

## Automation Workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Auto-assign next | `auto-assign-next.yml` | PR closed (merged) | Close done issue, assign next `ready` issue to Copilot |
| Auto-merge | `auto-merge-copilot.yml` | PR review submitted / check suite completed | Auto-approve and squash-merge passing Copilot PRs |
| Handle failure | `handle-failure.yml` | Issue labeled `blocked` | Comment and notify maintainer |
| Scheduled kickstart | `scheduled-assign.yml` | Cron (3x daily) + manual | Pick up stalled pipeline |
| CI | `ci.yml` | Push / PR | Standard CI checks |
| Setup steps | `copilot-setup-steps.yml` | Agent session | Pre-install dependencies for agent |

## Labels

| Label | Color | Purpose |
|-------|-------|---------|
| `ready` | Green | Available for agent pickup |
| `in-progress` | Yellow | Agent working |
| `blocked` | Red | Needs human input |
| `done` | Purple | Merged and closed |
| `agent-task` | Blue | Identifies agent-processable issues |

## The Reviewer Agent

The Copilot code review agent creates a closed feedback loop:
1. Coding agent opens PR → requests review
2. Code review agent reviews → finds issue → comments `@copilot fix X`
3. Coding agent pushes fix → CI runs
4. Code review re-reviews → approves
5. Auto-merge merges → chain assigns next issue

## Writing Good Issues

As **Customer**: Write the "what" and "why"
As **Lead Developer**: Write the "how" and testing commands

The better the issues, the more autonomous the pipeline. Use the agent-task template.

## Budget (Copilot Pro $10/mo)

- ~100-150 tasks/month with 300 premium requests
- Public repos: unlimited Actions minutes
- Extra requests: $0.04 each

## Security Notes

- CI auto-approval means unreviewed code runs Actions. Scope secrets tightly.
- Auto-merge safety net = required Copilot code review
- Use fine-grained PAT scoped to this repo only
- Coding agent only pushes to `copilot/*` branches

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Agent doesn't pick up issue | Verify coding agent enabled, issue assigned to `copilot`, check quota |
| CI requires manual approval | Disable "Require approval" in Copilot settings |
| Auto-merge doesn't fire | Enable auto-merge in settings, verify PAT has `contents: write` |
| Pipeline stalls | scheduled-assign.yml cron catches this, or manual trigger |
| Agent keeps failing | Label `blocked`, review logs, add context, consider splitting task |
| PR doesn't reference issue | Ensure instructions stress "Closes #<number>" in PR body |
