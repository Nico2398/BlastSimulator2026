# Setup Guide — BlastSimulator2026 Cloud SWE Agent

Two steps. No local machine. No external infrastructure.

> **Already set up?** See [README.md](./README.md) for a workflow overview.

---

## Prerequisites

- **GitHub** — repo owner access
- **An LLM provider** — DeepSeek (default), OpenAI, Anthropic, or any OpenAI-compatible API
- **LangSmith** *(optional)* — [smith.langchain.com](https://smith.langchain.com)

---

## Step 1 — Add your LLM API key as a GitHub Actions secret

1. Go to **GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret**.
2. Add:

| Secret name | Value |
|---|---|
| `DEEPSEEK_API_KEY` | Your DeepSeek API key (or see [LLM configuration](#llm-configuration) for other providers) |
| `LANGSMITH_API_KEY` | *(optional)* LangSmith API key — tracing auto-enables when present |

---

## Step 2 — Trigger the agent

The agent starts when you post `@openswe` in a comment on any issue or PR (repo owner only):

```
@openswe implement the navmesh ramp routing feature
```

The agent replies with 👀, implements the task, and opens a PR.

You can also trigger manually: **GitHub → Actions → "Open SWE Agent" → Run workflow** and enter the issue number.

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
| `DEEPSEEK_API_KEY` | Yes* | LLM API key (*or replace with your provider) |
| `LANGSMITH_API_KEY` | No | LangSmith tracing — auto-enables when present |

---

## Troubleshooting

### Workflow starts but agent fails immediately

1. Check the Actions run log.
2. Look at the "Dump LangGraph server log" step — it shows the raw LangGraph server output including import errors and model call failures.
3. Common causes: wrong `LLM_MODEL_ID` format, missing or expired API key, `OPENAI_BASE_URL` not set when using a third-party provider.

---

## File map

```
.openswe/
  README.md              ← workflow overview
  SETUP.md               ← this file
  AGENTS.md              ← agent system prompt (injected at runtime)
  tools/
    backlog_tools.py     ← custom tools injected into open-swe at runtime

.github/
  workflows/
    open-swe-agent.yml   ← agent runner workflow
```
