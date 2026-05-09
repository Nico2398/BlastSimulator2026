# BlastSimulator2026 — Cloud SWE Agent

A fully autonomous cloud SWE agent for BlastSimulator2026. No local machine, no CLI, no manual deploys. Every component runs in the cloud.

The agent is powered by [open-swe](https://github.com/langchain-ai/open-swe) — LangChain's open-source software engineering agent — running inside GitHub Actions. It works with **any LLM**: OpenAI, Anthropic, DeepSeek, Together, Azure, or any OpenAI-compatible provider.

> **First time setup?** See [SETUP.md](./SETUP.md) for the full installation guide.

---

## How to trigger the agent

| Action | How | Who can use |
|---|---|---|
| **@mention** | Post `@openswe <instruction>` in a comment | Repo owner only |
| **Manual dispatch** | **Actions → Open SWE Agent → Run workflow** | Anyone with Actions access |

The agent replies with 👀, implements the task, and opens a PR.

---

## Architecture

```
GitHub events  (@openswe comment / manual dispatch)
    │
    ▼
[GitHub Actions: open-swe-agent.yml]
    │  1. checkout this repo
    │  2. checkout open-swe
    │  3. patch model.py for any OpenAI-compatible provider
    │  4. inject custom tools + context (AGENTS.md)
    │  5. start LangGraph server
    │  6. invoke agent via SDK
    ▼
[open-swe agent loop]
    │  planning agent → coding subagents → tool calls
    │  commits branch, opens PR
    ▼
[LangSmith]  ←  live trace of every LLM call and tool use
```

---

## GitHub Actions workflow (agent runner)

**Location:** `.github/workflows/open-swe-agent.yml`

**What it does, step by step:**

1. **Acknowledge** — Posts 👀 reaction or comment so the user knows the agent started.
2. **Checkout this repo** — Checks out BlastSimulator2026 to the workspace root so all `.openswe/` files are available.
3. **Checkout open-swe** — Clones `langchain-ai/open-swe` into `./open-swe`.
4. **Install Python + uv** — Python 3.12, `uv sync --all-extras`.
5. **Patch model.py** — Adds a guard so `OPENAI_BASE_URL` is respected for any OpenAI-compatible provider (DeepSeek, Together, etc.) without forking open-swe.
6. **Inject tools and context** — Copies `.openswe/tools/backlog_tools.py` into open-swe and patches `agent/server.py` to register the seven backlog functions. Also copies `.openswe/AGENTS.md` (the agent's system prompt) into open-swe so it is available at the path referenced by `DEFAULT_PROMPT_PATH`.
7. **Configure git** — Sets identity and rewrites `github.com` pushes to use `GITHUB_TOKEN`.
8. **Fetch issue** — Gets the issue/PR title and body via the GitHub API.
9. **Start LangGraph server + run agent** — Starts `langgraph dev` on port 2024, then invokes the agent via the LangGraph Python SDK. Polls until `success`, `error`, or `interrupted`.
10. **Debug on failure** — Dumps `/tmp/langgraph.log` if anything fails.

**LLM is fully configurable** via environment variables — see [SETUP.md § LLM configuration](./SETUP.md#llm-configuration).

---

## Agent context and tools

**`AGENTS.md`** — The agent's system prompt. Injected via `DEFAULT_PROMPT_PATH`. Contains project overview, architecture rules, skill table, validation commands, backlog rules, and PR conventions.

**`tools/`** — Custom Python tools patched into open-swe at runtime. Each file in this directory exposes functions that are registered as agent tools and injected into `agent/server.py` at startup. Add, remove, or replace tool files here to extend what the agent can do — no fork of open-swe needed.

---

## LangSmith — live tracing

Every agent run sends a live trace to LangSmith if `LANGSMITH_API_KEY` is set in GitHub Actions secrets. No code change needed — tracing enables automatically.

Each trace shows:
- Full LLM message history (prompts + completions)
- Every tool call with inputs and outputs
- Per-step and total latency and token usage
- Exact failure point when a run errors

All runs appear under the `BlastSimulator2026-openswe` LangSmith project.

---

## File map

```
.openswe/
  README.md              ← this file (workflow overview)
  SETUP.md               ← installation guide
  AGENTS.md              ← agent system prompt
  tools/
    *.py                 ← custom tools injected into open-swe at runtime

.github/
  workflows/
    open-swe-agent.yml   ← agent runner
```
