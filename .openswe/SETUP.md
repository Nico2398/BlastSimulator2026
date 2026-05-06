# Setup Guide — BlastSimulator2026 Cloud SWE Agent

Full step-by-step installation for the Cloudflare + open-swe + LangSmith pipeline.
No local machine required after initial setup.

> **Already set up?** See [README.md](./README.md) for a workflow overview.

---

## Prerequisites

You need accounts on:
- **GitHub** — repo owner access
- **Cloudflare** — free plan is enough
- **An LLM provider** — DeepSeek (default), OpenAI, Anthropic, or any OpenAI-compatible API
- **LangSmith** *(optional)* — [smith.langchain.com](https://smith.langchain.com)

---

## Step 1 — Create the GitHub App

The GitHub App is the identity of the bot. It receives GitHub events (assignments, comments, review requests) and sends them as signed webhooks to the Cloudflare Worker.

### 1a. Create the app

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
   (or: `https://github.com/settings/apps/new`)
2. Fill in:
   - **GitHub App name:** `blast-swe-bot` (or any name you prefer)
   - **Homepage URL:** your repo URL (`https://github.com/Nico2398/BlastSimulator2026`)
   - **Webhook URL:** *(leave blank for now — you'll fill this in after deploying the Worker in Step 3)*
   - **Webhook secret:** generate a random string (e.g. `openssl rand -hex 32` in any shell, or use a password manager). **Save this value** — you will need it in Steps 2 and 4.

3. Under **Permissions → Repository permissions**, set:
   - **Issues:** Read & Write
   - **Pull requests:** Read & Write
   - **Contents:** Read & Write
   - **Metadata:** Read-only *(required by GitHub)*

4. Under **Subscribe to events**, check:
   - **Issues**
   - **Issue comment**
   - **Pull request**

5. Under **Where can this GitHub App be installed?** — select **Only on this account**.

6. Click **Create GitHub App**.

### 1b. Note down the App ID

After creation, you land on the app settings page. Copy the **App ID** — you may need it if you later switch to per-user identity commits. For now, it's informational.

### 1c. Install the app on your repository

1. On the app settings page, click **Install App** in the left sidebar.
2. Select your account, then choose **Only select repositories** → pick `BlastSimulator2026`.
3. Click **Install**.

After installation, GitHub will show the app's bot account as `blast-swe-bot[bot]`. This is the login the Worker checks against (`BOT_LOGIN` in `wrangler.toml`).

---

## Step 2 — Collect Cloudflare credentials

You need two values from Cloudflare before deploying the Worker.

### 2a. Cloudflare Account ID

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com).
2. Click **Workers & Pages** in the left sidebar.
3. Your **Account ID** is shown in the right sidebar under "Account ID". Copy it.

### 2b. Cloudflare API Token

1. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).
2. Click **Create Token**.
3. Use the **"Edit Cloudflare Workers"** template.
4. Under **Account Resources** — select your account.
5. Under **Zone Resources** — leave as "All zones" or set to "None" (Workers don't need zone access).
6. Click **Continue to summary → Create Token**.
7. Copy the token. **You cannot view it again after leaving the page.**

---

## Step 3 — Create a Fine-Grained PAT for the Worker

The Worker calls the GitHub Actions API to dispatch workflows. It needs a token with Actions write access.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Set:
   - **Token name:** `blast-swe-worker-pat`
   - **Expiration:** set to your preference (1 year recommended)
   - **Repository access:** Only select repositories → `BlastSimulator2026`
   - **Permissions → Repository permissions → Actions:** Read & Write
3. Click **Generate token**. Copy it — you cannot view it again.

---

## Step 4 — Add GitHub Actions secrets

All secrets are stored in **GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret**.

Add these six secrets:

| Secret name | Value |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token from Step 2b |
| `CF_ACCOUNT_ID` | Cloudflare Account ID from Step 2a |
| `CF_WEBHOOK_SECRET` | The random string you generated in Step 1a |
| `CF_GH_PAT` | Fine-grained PAT from Step 3 |
| `DEEPSEEK_API_KEY` | Your DeepSeek API key (or see [LLM configuration](#llm-configuration) to use a different provider) |
| `LANGSMITH_API_KEY` | *(optional)* LangSmith API key — tracing auto-enables when present |

---

## Step 5 — Deploy the Cloudflare Worker

The Worker is deployed automatically by CI. No local tools needed.

1. Go to **GitHub → your repo → Actions → "Deploy Cloudflare Worker"**.
2. Click **Run workflow → Run workflow**.
3. Wait ~60 seconds for the job to complete.

The workflow:
- Checks out `.cloudflare/blast-swe-webhook/`
- Runs `npm ci`
- Uses `cloudflare/wrangler-action` to deploy the Worker and push `WEBHOOK_SECRET` + `GH_PAT` as Cloudflare secrets

**Future deploys happen automatically** on every push to `main` that touches the Worker files.

### Find the Worker URL

After the first deploy:
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**.
2. Click **blast-swe-webhook**.
3. The Worker URL is shown at the top: `https://blast-swe-webhook.<YOUR_SUBDOMAIN>.workers.dev`

> The `<YOUR_SUBDOMAIN>` part is your Cloudflare workers subdomain, visible on the Worker detail page. It looks like `blast-swe-webhook.abc123.workers.dev`.

**Copy this URL** — you need it in the next step.

---

## Step 6 — Configure the GitHub App webhook

Now that the Worker is deployed and you have its URL:

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → blast-swe-bot → Edit**.
2. Under **Webhook**:
   - **Webhook URL:** paste the Worker URL from Step 5 (`https://blast-swe-webhook.<YOUR_SUBDOMAIN>.workers.dev`)
   - **Webhook secret:** paste the same random string you used in Step 1a and stored as `CF_WEBHOOK_SECRET`
   - **SSL verification:** Enable
3. Click **Save changes**.

GitHub will now send all subscribed events to your Worker, signed with that secret.

### Verify the webhook

1. Still on the app edit page, click **Advanced** in the left sidebar.
2. Click **Redeliver** next to any recent delivery, or trigger a test event by assigning an issue to `blast-swe-bot`.
3. You should see a `202` response. If you see `401`, the webhook secret doesn't match — double-check `CF_WEBHOOK_SECRET` in GitHub Actions secrets and the value entered in the app settings.

---

## Step 7 — Test the full pipeline

1. Open any issue in the repository.
2. Assign the issue to `blast-swe-bot[bot]`.
3. Within a few seconds, the bot should post a comment: `👀 Open SWE Agent picking this up…`
4. Go to **GitHub → Actions** to see the `open-swe-agent.yml` run in progress.
5. The agent will implement the task and open a PR with `Closes #<issue-number>` in the body.

You can also trigger via comment:
```
@openswe please implement this feature
```
(Only repo owners can trigger via comment — this is enforced by the workflow.)

---

## LLM configuration

The agent is LLM-agnostic. Change the model by updating three environment variables in `.github/workflows/open-swe-agent.yml` and adding the corresponding secret.

### Current default — DeepSeek

```yaml
OPENAI_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
OPENAI_BASE_URL: "https://api.deepseek.com/v1"
LLM_MODEL_ID: "openai:deepseek-v4-flash"
```

The `openai:` prefix tells open-swe to use `langchain-openai` as the provider. `OPENAI_BASE_URL` redirects it to DeepSeek's endpoint. The workflow patches `model.py` at runtime so the custom base URL is respected — no fork of open-swe needed.

### Switching providers

| Provider | `LLM_MODEL_ID` | `OPENAI_BASE_URL` | Secret name |
|---|---|---|---|
| OpenAI | `openai:gpt-4o` | *(omit)* | `OPENAI_API_KEY` |
| DeepSeek | `openai:deepseek-v4-flash` | `https://api.deepseek.com/v1` | Use as `OPENAI_API_KEY` |
| Together AI | `openai:meta-llama/Llama-3-70b-chat-hf` | `https://api.together.xyz/v1` | Use as `OPENAI_API_KEY` |
| Anthropic | `anthropic:claude-opus-4-5` | *(omit)* | `ANTHROPIC_API_KEY` |
| Azure OpenAI | `azure_openai:gpt-4o` | Your Azure endpoint | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` |

Steps to switch:
1. Add the new API key as a GitHub Actions secret.
2. Edit `.github/workflows/open-swe-agent.yml` → update the three env vars in the "Run Open SWE Agent" step.
3. Push to `main`. The next agent run uses the new model.

---

## LangSmith setup (optional)

LangSmith gives live visibility into every agent run: prompts, completions, tool calls, latency, token usage.

1. Create an account at [smith.langchain.com](https://smith.langchain.com).
2. Go to **Settings → API Keys → Create API Key**. Copy it.
3. Add it to GitHub Actions secrets: name `LANGSMITH_API_KEY`, value: your key.

Tracing enables automatically on the next run. All traces appear under the `BlastSimulator2026-openswe` project in LangSmith.

### What you see per run

- **Full message history** — every prompt sent to the LLM, every response
- **Tool call trace** — which tools ran, with inputs and outputs (shell commands, file reads, backlog tools)
- **Multi-agent breakdown** — separate traces for the planning agent and each coding subagent
- **Latency and token usage** — per step and total
- **Exact failure point** — when a run errors you can see which step threw and what the model produced before the failure

### Advanced: isolated cloud sandboxes

By default (`SANDBOX_TYPE=local`), all subagents run on the same GitHub Actions runner. For true parallelism with isolated containers per subagent, switch to `SANDBOX_TYPE=langsmith` and add:

| Secret | Description |
|---|---|
| `LANGSMITH_API_KEY_PROD` | LangSmith production API key |
| `LANGSMITH_TENANT_ID_PROD` | Your LangSmith tenant UUID (Settings → Account) |
| `DEFAULT_SANDBOX_SNAPSHOT_ID` | Snapshot UUID of a pre-configured runner environment |

This is an advanced mode. The `local` sandbox is sufficient for most tasks.

---

## Adding custom tools

The injection mechanism in the workflow works for any Python tool file:

1. Create a `.py` file in `.openswe/tools/` with standard Python functions.
2. Extend the "Inject backlog tools" step in `open-swe-agent.yml` to:
   - Copy your file into `open-swe/agent/tools/`
   - Patch `agent/server.py` to import and register your functions

The agent will have access to those tools on the next run. No fork of open-swe required.

---

## Secrets reference

All secrets go in **GitHub → repo → Settings → Secrets and variables → Actions**.

| Secret | Required | Purpose |
|---|---|---|
| `CF_API_TOKEN` | Yes | Cloudflare API token — deploys the Worker |
| `CF_ACCOUNT_ID` | Yes | Cloudflare account ID — deploys the Worker |
| `CF_WEBHOOK_SECRET` | Yes | HMAC key — must match the GitHub App webhook secret |
| `CF_GH_PAT` | Yes | Fine-grained PAT — Worker calls `workflow_dispatch` |
| `DEEPSEEK_API_KEY` | Yes* | LLM API key (*or replace with your provider) |
| `LANGSMITH_API_KEY` | No | LangSmith tracing — auto-enables when present |

---

## Troubleshooting

### Bot doesn't respond to assignment

1. Check **GitHub → Settings → Developer settings → GitHub Apps → blast-swe-bot → Advanced** — look at recent webhook deliveries.
2. If the delivery shows `401` → the `CF_WEBHOOK_SECRET` in GitHub Actions secrets doesn't match the secret in the app settings.
3. If the delivery shows `ignored` → the bot login in `wrangler.toml` (`BOT_LOGIN`) doesn't match the actual bot login. Check the bot's username in the issue assignees.
4. If there's no delivery at all → the app may not be installed on the repo, or the event type isn't subscribed.

### Workflow starts but agent fails immediately

1. Check the Actions run log.
2. Look at the "Dump LangGraph server log" step — it shows the raw LangGraph server output including import errors and model call failures.
3. Common causes: wrong `LLM_MODEL_ID` format, missing or expired API key, `OPENAI_BASE_URL` not set when using a third-party provider.

### Webhook delivers but workflow_dispatch fails

The `GH_PAT` may have expired or the repo access may have been revoked. Generate a new token (Step 3) and update the `CF_GH_PAT` secret.

### Worker not updating after code changes

The deploy workflow triggers automatically on push to `main` that touches `.cloudflare/blast-swe-webhook/**`. You can also trigger it manually: **Actions → Deploy Cloudflare Worker → Run workflow**.

---

## File map

```
.openswe/
  README.md              ← workflow overview
  SETUP.md               ← this file
  AGENTS.md              ← agent system prompt (injected at runtime)
  tools/
    backlog_tools.py     ← custom tools injected into open-swe at runtime

.cloudflare/
  blast-swe-webhook/
    src/index.ts         ← Worker: HMAC verify + workflow_dispatch relay
    wrangler.toml        ← non-secret config (repo owner, workflow file, bot login)
    package.json
    package-lock.json

.github/
  workflows/
    open-swe-agent.yml   ← agent runner workflow
    deploy-worker.yml    ← auto-deploys Worker on push to main
```
