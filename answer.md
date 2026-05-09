# GitHub App — Is It Still Needed?

## Short answer: No. Drop it.

---

## Why it was introduced

The GitHub App (`blast-swe-bot`) was added because the original plan was to **assign issues/PRs to the bot**, and GitHub Apps can receive webhook events when they are assigned. The Cloudflare Worker was then needed to relay those webhooks into a `workflow_dispatch` call, because GitHub Apps cannot directly trigger workflow dispatches.

The README itself acknowledges the problem: GitHub App bot accounts (type `Bot`, not `User`) cannot be found in the assignee picker. You have to manually add the bot as a collaborator, it doesn't appear by default, and the whole flow is fragile and painful to set up.

---

## What actually works today

The workflow (`open-swe-agent.yml`) **already listens to native GitHub Actions events directly**, with no App or Worker involved:

```yaml
on:
  workflow_dispatch:          # manual trigger from Actions tab
  issue_comment:
    types: [created]          # @openswe and /openswe comments
  issues:
    types: [assigned]         # assignment to openswe or blast-swe-bot[bot]
  pull_request:
    types: [assigned, review_requested]
```

The `if:` condition on the job gates which of these actually runs the agent. **The three triggers below work with zero App/Worker setup:**

---

## The three trigger standards

| Trigger | How | Who can use |
|---|---|---|
| **Label** | Add the `openswe` label to any issue or PR | Anyone with triage access |
| **Slash command** | Post `/openswe <instruction>` as the **first line** of a comment | Anyone with write access |
| **@mention** | Post `@openswe <instruction>` anywhere in a comment body | Repo owner only |

All three are standard ChatOps patterns used widely across the GitHub ecosystem.

---

## What you can remove

If you drop the App + Worker, you can delete:

- The GitHub App itself (`blast-swe-bot`) — deinstall from repo, delete from Developer Settings
- The entire `.cloudflare/` directory
- `.github/workflows/deploy-worker.yml`
- GitHub Actions secrets: `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_WEBHOOK_SECRET`, `CF_GH_PAT`
- All of SETUP.md Steps 1–6 (App creation, Cloudflare credentials, PAT for Worker, secrets, Worker deploy, webhook config)

---

## What you keep

- `.github/workflows/open-swe-agent.yml` — unchanged, it already works natively
- `.openswe/AGENTS.md`, `.openswe/tools/` — agent context and custom tools, unchanged
- Secrets: `DEEPSEEK_API_KEY` (or your LLM key), `LANGSMITH_API_KEY` (optional), `PAT_TOKEN_COPILOT_AUTOMATION` (for the pipeline automation)
- The `openswe` label in the repo (create it once if it doesn't exist)

---

## Net result

Setup goes from **7 steps** (create App → configure permissions → deploy Worker → wire 4 secrets → set webhook URL → verify delivery → test) to **2 steps** (add LLM API key secret, create `openswe` label). Same capabilities, zero external infrastructure.
