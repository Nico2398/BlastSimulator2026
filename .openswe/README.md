# BlastSimulator2026 — Full Cloud SWE Agent

This document describes the complete automated software engineering pipeline for BlastSimulator2026. No local machine, no CLI setup, no manual deploys. Every part runs in the cloud.

---

## Intent

The goal is a **fully autonomous cloud SWE agent** that can be triggered by any team member via a GitHub issue comment, assignment, or review request — and will implement, test, and open a PR without human intervention.

The agent is powered by [open-swe](https://github.com/langchain-ai/open-swe) (LangChain's open-source software engineering agent), which runs inside GitHub Actions. It can be configured to use **any LLM** — cloud proprietary, self-hosted, or OpenAI-compatible. The current default is DeepSeek via its OpenAI-compatible API.

---

## Architecture

Three independent layers work together:

```
GitHub events
    │
    ▼
[blast-swe-bot GitHub App]
    │  webhook POST (HMAC-signed)
    ▼
[Cloudflare Worker: blast-swe-webhook]
    │  GitHub API: workflow_dispatch
    ▼
[GitHub Actions: open-swe-agent.yml]
    │  checkout open-swe
    │  inject tools + AGENTS.md
    │  start LangGraph server
    │  invoke agent via SDK
    ▼
[open-swe agent loop]
    │  reads repo, writes code, runs tests
    │  commits branch, opens PR
    ▼
[LangSmith]  ← live traces of every agent step
```

---

## Layer 1 — Cloudflare Worker (webhook relay)

**Location:** `.cloudflare/blast-swe-webhook/`

**Purpose:** Bridge between GitHub webhook events and GitHub Actions `workflow_dispatch`. GitHub Apps can't directly trigger `workflow_dispatch`; the Worker translates events into API calls.

### What it does

1. Receives a signed `POST` from the GitHub App webhook.
2. Verifies the `x-hub-signature-256` header using **HMAC-SHA256** via the Web Crypto API (constant-time comparison — no timing attack surface).
3. Inspects the event type and filters for exactly three cases:

   | GitHub event | Condition | Result |
   |---|---|---|
   | `issues.assigned` | `assignee.login == BOT_LOGIN` | dispatch with `issue_number` |
   | `issue_comment.created` | body contains `@openswe`, sender is a User | dispatch with `issue_number` + `comment_body` |
   | `pull_request.assigned` or `review_requested` | `assignee/reviewer == BOT_LOGIN` | dispatch with PR number |

4. Calls `POST /repos/Nico2398/BlastSimulator2026/actions/workflows/open-swe-agent.yml/dispatches` with `{ ref: "main", inputs: { issue_number, comment_body } }`.
5. Returns `202 Dispatched` or `401 invalid signature`.

### Non-secret configuration

Set in `wrangler.toml` `[vars]` — committed to the repo, safe to read:

| Variable | Value |
|---|---|
| `REPO_OWNER` | `Nico2398` |
| `REPO_NAME` | `BlastSimulator2026` |
| `WORKFLOW_FILE` | `open-swe-agent.yml` |
| `BOT_LOGIN` | `blast-swe-bot[bot]` |

### Runtime secrets

Stored in Cloudflare (never in source), injected at runtime:

| Secret | Description |
|---|---|
| `WEBHOOK_SECRET` | GitHub App webhook secret — HMAC key for signature verification |
| `GH_PAT` | Fine-grained PAT with `Actions: Read & Write` on this repo — used to call `workflow_dispatch` |

### Deployment — no local machine required

The Worker is **deployed automatically by GitHub Actions**. The workflow `.github/workflows/deploy-worker.yml` triggers on:
- Any push to `main` that touches `.cloudflare/blast-swe-webhook/**`
- Manual `workflow_dispatch` from the Actions tab

Steps:
1. `actions/checkout` — checks out the repo
2. `actions/setup-node` + `npm ci` — builds the Worker TypeScript
3. `cloudflare/wrangler-action@v3` — deploys to Cloudflare Workers and pushes `WEBHOOK_SECRET` and `GH_PAT` as Cloudflare secrets (sourced from GitHub Actions secrets)

**Required GitHub Actions secrets** (set once in GitHub → Settings → Secrets and variables → Actions):

| Secret | How to get |
|---|---|
| `CF_API_TOKEN` | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token → "Edit Cloudflare Workers" template |
| `CF_ACCOUNT_ID` | Right sidebar on the Cloudflare Workers dashboard |
| `CF_WEBHOOK_SECRET` | Generate any random string when creating the GitHub App; paste the same value here |
| `CF_GH_PAT` | GitHub → Settings → Developer settings → Fine-grained tokens → New token → Actions: Read & Write on this repo |

To (re)deploy: **GitHub → Actions → Deploy Cloudflare Worker → Run workflow**.

---

## Layer 2 — GitHub Actions Workflow (agent runner)

**Location:** `.github/workflows/open-swe-agent.yml`

**Purpose:** Checkout, configure, and run the open-swe agent in response to any trigger.

### Triggers

| Trigger | Condition |
|---|---|
| `workflow_dispatch` | Called by the Cloudflare Worker with `issue_number` + `comment_body` inputs |
| `issue_comment.created` | Comment contains `@openswe`, author is repo OWNER |
| `issues.assigned` | Assignee is `openswe` or `blast-swe-bot[bot]` |
| `pull_request.assigned` | Assignee is `openswe` or `blast-swe-bot[bot]` |
| `pull_request.review_requested` | Requested reviewer is `openswe` or `blast-swe-bot[bot]` |

### Permissions granted

- `issues: write` — post the 👀 acknowledgement reaction/comment
- `contents: write` — push the agent's feature branch
- `pull-requests: write` — open the PR

### Step-by-step

#### Step 1 — Acknowledge

Posts a 👀 reaction to the triggering comment (if triggered via comment) or a `👀 Open SWE Agent picking this up…` comment on the issue/PR. Runs before any heavy work so the user knows the agent started.

#### Step 2 — Checkout open-swe

Clones `langchain-ai/open-swe` into `./open-swe`. This is the agent framework: a LangGraph-based multi-agent system with a planning agent, coding agent, and tool set.

#### Step 3 — Install Python + uv

Python 3.12 (matching open-swe's `langgraph.json`), then `uv sync --all-extras` to install all agent dependencies.

#### Step 4 — Patch model.py

open-swe's `make_model()` unconditionally rewrites `base_url` to OpenAI's WebSocket endpoint when the model ID has the `openai:` prefix. This breaks any OpenAI-compatible third-party provider (DeepSeek, Together, etc.).

The patch adds a guard: the override is skipped when `OPENAI_BASE_URL` is set. This makes it possible to point the agent at any OpenAI-compatible endpoint without forking open-swe.

#### Step 5 — Inject backlog tools

This is how **custom tools are deployed to the agent** without forking open-swe:

1. `.openswe/tools/backlog_tools.py` is copied into `open-swe/agent/tools/backlog_tools.py`.
2. A Python script patches `open-swe/agent/server.py` at runtime to:
   - Import the seven backlog functions (`backlog_list`, `backlog_next`, `backlog_start`, `backlog_done`, `backlog_block`, `backlog_reset`, `backlog_stats`)
   - Append them to the tools list that LangGraph registers with the agent

This mechanism works for **any custom tool**: add a `.py` file to `.openswe/tools/`, then extend the patch script in step 5.

#### Step 6 — Configure git identity

Sets `user.email` / `user.name` and rewrites `https://github.com/` pushes to use `GITHUB_TOKEN` for authentication. This enables the agent to commit and push branches without storing credentials.

#### Step 7 — Fetch issue details

Uses `actions/github-script` to fetch the issue/PR title and body from the GitHub API. These are passed to the agent as context so it understands what to implement.

#### Step 8 — Start LangGraph server + run agent

1. `uv run langgraph dev --port 2024` starts the in-process LangGraph API server in the background.
2. The workflow waits up to 90 seconds for the `/ok` health endpoint to respond.
3. A Python inline script uses the LangGraph SDK (`langgraph_sdk.get_client`) to:
   - Build the task string from issue number, title, body, and comment
   - Use a deterministic `thread_id` (`github-{owner}-{repo}-{issue_number}`) so follow-up comments resume the same conversation thread
   - Create (or resume) a run with `if_not_exists="create"`
   - Poll `client.runs.get()` every 10 seconds until the run reaches `success`, `error`, or `interrupted`
   - Exit 1 if the run did not succeed (fails the workflow, shows in the PR/issue)

#### Step 9 — Debug on failure

On any failure, dumps `/tmp/langgraph.log` (the LangGraph server output) to the Actions log. This includes model call errors, tool failures, and import errors.

---

## Layer 3 — Agent context and tools

### AGENTS.md — agent instructions

**Location:** `.openswe/AGENTS.md`

Injected via `DEFAULT_PROMPT_PATH=$GITHUB_WORKSPACE/.openswe/AGENTS.md`. open-swe reads this file and uses it as the system-level context for every run.

Contains:
- Project overview and coding conventions
- Architecture rules (module boundaries, state flow)
- Table of skills → read before touching each system
- Validation commands (`npm run validate`, etc.)
- Backlog tool usage rules
- PR rules (`Closes #<number>` requirement)
- Tone guide

The agent reads `.github/skills/*/SKILL.md` files from the repo during its run for deep per-system specs.

### backlog_tools.py — custom agent tools

**Location:** `.openswe/tools/backlog_tools.py`

Seven LangGraph-compatible tool functions that the agent calls during its run to manage the task backlog:

| Tool | What it does |
|---|---|
| `backlog_stats()` | Returns done/in-progress/pending/blocked counts |
| `backlog_list(status?, chapter?)` | Lists tasks, filtered by status or chapter |
| `backlog_next()` | Returns the next unblocked pending task |
| `backlog_start(task_id)` | Marks a task in-progress (enforces one active task at a time) |
| `backlog_done(task_id, pr_number?)` | Marks a task done, records PR number |
| `backlog_block(task_id)` | Marks a task blocked |
| `backlog_reset(task_id)` | Resets a task to pending |

All tools operate by reading and writing `.github/skills/backlog/backlog.json` via the GitHub REST API, using `GITHUB_TOKEN` for authentication. Changes are committed directly to the default branch.

---

## LangSmith — live feedback and tracing

**Purpose:** Every agent run is traced in LangSmith in real time. This gives live visibility into what the agent is thinking, which tools it calls, what the LLM produces at each step, and where failures happen.

### How it works

The workflow sets two environment variables before starting the LangGraph server:

```yaml
LANGCHAIN_TRACING_V2: ${{ secrets.LANGSMITH_API_KEY != '' && 'true' || 'false' }}
LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}
LANGCHAIN_PROJECT: "BlastSimulator2026-openswe"
```

- If `LANGSMITH_API_KEY` is set in GitHub Actions secrets, tracing is **automatically enabled** — no code change needed.
- If the secret is absent, tracing is disabled and the agent runs normally without it.
- All runs are grouped under the LangSmith project `BlastSimulator2026-openswe`.

### What you see in LangSmith

For each agent run you get:
- **Full message history** — every prompt sent to the LLM, every response received
- **Tool call trace** — which tools the agent invoked, with inputs and outputs (including backlog tools, shell commands, file reads/writes)
- **Multi-agent breakdown** — separate traces for the planning agent and each coding subagent
- **Latency and token usage** — per-step and total
- **Error pinpointing** — if the run fails, you can see exactly which step threw and what the model said before it

### Enabling LangSmith

1. Create an account at [smith.langchain.com](https://smith.langchain.com).
2. Create an API key in LangSmith → Settings → API Keys.
3. Add it to GitHub: **Settings → Secrets and variables → Actions → New repository secret** → name: `LANGSMITH_API_KEY`, value: your key.
4. The next agent run will automatically send traces to the `BlastSimulator2026-openswe` project.

### LangSmith sandbox (optional advanced mode)

For true multi-agent parallelism with isolated sandboxes per subagent, set `SANDBOX_TYPE=langsmith` and provide:

| Secret | Description |
|---|---|
| `LANGSMITH_API_KEY_PROD` | LangSmith production API key |
| `LANGSMITH_TENANT_ID_PROD` | LangSmith tenant UUID |
| `DEFAULT_SANDBOX_SNAPSHOT_ID` | Snapshot UUID of the pre-configured sandbox environment |

In this mode, each subagent spawned by the planning agent gets its own isolated cloud container. The default `local` sandbox runs all subagents on the same GitHub Actions runner, which is simpler and sufficient for most tasks.

---

## LLM configuration

The agent is LLM-agnostic. The model is configured entirely through environment variables in the workflow.

### Current default — DeepSeek

```yaml
OPENAI_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
OPENAI_BASE_URL: "https://api.deepseek.com/v1"
LLM_MODEL_ID: "openai:deepseek-v4-flash"
```

The `openai:` prefix tells open-swe to use `langchain-openai` (ChatOpenAI) as the provider. `OPENAI_BASE_URL` redirects it to DeepSeek's endpoint. The model.py patch (step 4) ensures the base URL is respected.

### Switching to another provider

| Provider | `LLM_MODEL_ID` | `OPENAI_BASE_URL` | Secret |
|---|---|---|---|
| OpenAI | `openai:gpt-4o` | *(omit)* | `OPENAI_API_KEY` |
| DeepSeek | `openai:deepseek-v4-flash` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` → `OPENAI_API_KEY` |
| Together AI | `openai:meta-llama/...` | `https://api.together.xyz/v1` | set as `OPENAI_API_KEY` |
| Anthropic | `anthropic:claude-opus-4-5` | *(omit)* | `ANTHROPIC_API_KEY` |
| Azure OpenAI | `azure_openai:gpt-4o` | Azure endpoint | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` |

Add the relevant secret to GitHub Actions secrets, then update the three env vars in the workflow.

---

## End-to-end flow summary

```
1. User assigns issue #42 to blast-swe-bot
   OR comments "@openswe please implement feature X" on an issue
   OR requests blast-swe-bot as a reviewer on a PR

2. GitHub sends a signed webhook POST to the Cloudflare Worker URL
   (configured in the GitHub App settings)

3. Worker verifies HMAC-SHA256 signature
   Worker reads event type, extracts issue_number + comment_body
   Worker calls GitHub API: workflow_dispatch on open-swe-agent.yml

4. GitHub Actions: open-swe-agent.yml starts
   Step 1: Posts 👀 acknowledgement on the issue

5. open-swe is checked out from langchain-ai/open-swe
   Python 3.12 + uv installed, dependencies synced
   model.py patched for OpenAI-compatible base URL
   backlog_tools.py copied and patched into open-swe

6. LangGraph server starts on localhost:2024
   Agent is invoked with:
     - task = "Resolve GitHub issue #42 in Nico2398/BlastSimulator2026\nTitle:...\nBody:...\nComment:..."
     - repo config (owner, name)
     - AGENTS.md as system prompt

7. Agent loop runs (open-swe multi-agent):
   - Planning agent reads the issue, decomposes into sub-tasks
   - Coding agent: reads skills, edits files, runs `npm run validate`
   - Backlog tools: start task, track progress, mark done
   - Commits changes, pushes branch, opens PR with "Closes #42"

8. LangSmith receives live trace for every LLM call and tool use
   (if LANGSMITH_API_KEY is set)

9. Workflow exits success → run shows green in GitHub Actions
   Workflow exits failure → run shows red, LangGraph log is dumped
```

---

## Required secrets — full list

Set all of these in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Required for | Description |
|---|---|---|
| `CF_API_TOKEN` | Worker deploy | Cloudflare API token with Edit Workers permission |
| `CF_ACCOUNT_ID` | Worker deploy | Your Cloudflare account ID |
| `CF_WEBHOOK_SECRET` | Worker runtime | GitHub App webhook secret (HMAC key) |
| `CF_GH_PAT` | Worker runtime | Fine-grained PAT: Actions Read & Write on this repo |
| `DEEPSEEK_API_KEY` | Agent LLM | DeepSeek API key (or replace with your provider's key) |
| `LANGSMITH_API_KEY` | Tracing (optional) | LangSmith API key — tracing auto-enables when present |

---

## File map

```
.openswe/
  README.md                  ← this file
  AGENTS.md                  ← agent system prompt, injected at run time
  tools/
    backlog_tools.py          ← custom tools, patched into open-swe at run time

.cloudflare/
  blast-swe-webhook/
    src/index.ts              ← Worker source (HMAC verify + workflow_dispatch)
    wrangler.toml             ← non-secret config (repo, workflow file, bot login)
    package.json              ← Worker build deps
    package-lock.json         ← locked deps for reproducible CI builds

.github/
  workflows/
    open-swe-agent.yml        ← agent runner (triggered by Worker or directly)
    deploy-worker.yml         ← deploys the Cloudflare Worker from CI
```
