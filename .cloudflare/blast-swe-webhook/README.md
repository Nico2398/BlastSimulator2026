# blast-swe-webhook — Cloudflare Worker

GitHub webhook relay that bridges the `blast-swe-bot` GitHub App to the `open-swe-agent.yml` workflow via `workflow_dispatch`.

## How it works

1. GitHub App (`blast-swe-bot`) receives events (issue assigned, issue comment, PR assigned/review requested).
2. GitHub delivers those events to this Worker via webhook.
3. Worker verifies the HMAC-SHA256 signature, filters for bot-targeted events, then calls `POST /repos/.../actions/workflows/open-swe-agent.yml/dispatches` with the issue number and triggering text as inputs.
4. The workflow runs as if it were triggered natively.

## Setup

### Prerequisites

- Cloudflare account with Workers enabled
- `wrangler` CLI installed (`npm i -g wrangler`) and authenticated (`wrangler login`)
- A `blast-swe-bot` GitHub App installed on `Nico2398/BlastSimulator2026`
- A fine-grained PAT with **Actions: Read & Write** on `BlastSimulator2026`

### Deploy

```bash
cd .cloudflare/blast-swe-webhook
npm install
wrangler secret put WEBHOOK_SECRET   # GitHub App webhook secret
wrangler secret put GH_PAT           # Fine-grained PAT
npm run deploy
# → https://blast-swe-webhook.<your-account>.workers.dev
```

Copy the deployed URL and paste it into the GitHub App's **Webhook URL** field.

### Local development

```bash
npm run dev   # starts a local tunnel via wrangler dev
```

## Environment variables

| Name | Where | Description |
|------|-------|-------------|
| `WEBHOOK_SECRET` | Cloudflare secret | GitHub App webhook secret (HMAC key) |
| `GH_PAT` | Cloudflare secret | Fine-grained PAT, Actions:write |
| `REPO_OWNER` | `wrangler.toml` | `Nico2398` |
| `REPO_NAME` | `wrangler.toml` | `BlastSimulator2026` |
| `WORKFLOW_FILE` | `wrangler.toml` | `open-swe-agent.yml` |
| `BOT_LOGIN` | `wrangler.toml` | `blast-swe-bot[bot]` |
