# blast-swe-webhook — Cloudflare Worker

GitHub webhook relay that bridges the `blast-swe-bot` GitHub App to the `open-swe-agent.yml` workflow via `workflow_dispatch`.

## How it works

1. GitHub App (`blast-swe-bot`) receives events (issue assigned, issue comment, PR assigned/review requested).
2. GitHub delivers those events to this Worker via webhook.
3. Worker verifies the HMAC-SHA256 signature, filters for bot-targeted events, then calls `POST /repos/.../actions/workflows/open-swe-agent.yml/dispatches` with the issue number and triggering text as inputs.
4. The workflow runs as if it were triggered natively.

## Setup (no local machine required — everything runs in GitHub Actions)

### Prerequisites

- Cloudflare account with Workers enabled
- A `blast-swe-bot` GitHub App installed on `Nico2398/BlastSimulator2026`
- A fine-grained PAT with **Actions: Read & Write** on `BlastSimulator2026`

### One-time: add GitHub Actions secrets

Go to **GitHub → Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token with **Edit Workers** permission |
| `CF_ACCOUNT_ID` | Your Cloudflare account ID (visible on the Workers dashboard) |
| `CF_WEBHOOK_SECRET` | The GitHub App webhook secret you generated |
| `CF_GH_PAT` | Fine-grained PAT with Actions: Read & Write on this repo |

### Deploy

Push any change to `.cloudflare/blast-swe-webhook/` on `main` **or** trigger the workflow manually:

> **GitHub → Actions → Deploy Cloudflare Worker → Run workflow**

The workflow installs dependencies, deploys the Worker, and pushes `WEBHOOK_SECRET` and `GH_PAT` as Cloudflare secrets — all in the cloud.

Copy the deployed URL (`https://blast-swe-webhook.<your-account>.workers.dev`) and paste it into the GitHub App's **Webhook URL** field.

## Environment variables

| Name | Where | Description |
|------|-------|-------------|
| `WEBHOOK_SECRET` | Cloudflare secret | GitHub App webhook secret (HMAC key) |
| `GH_PAT` | Cloudflare secret | Fine-grained PAT, Actions:write |
| `REPO_OWNER` | `wrangler.toml` | `Nico2398` |
| `REPO_NAME` | `wrangler.toml` | `BlastSimulator2026` |
| `WORKFLOW_FILE` | `wrangler.toml` | `open-swe-agent.yml` |
| `BOT_LOGIN` | `wrangler.toml` | `blast-swe-bot[bot]` |
