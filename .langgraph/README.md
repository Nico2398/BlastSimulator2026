# BlastSimulator2026 — LangGraph Autonomous Pipeline

Purpose-built LangGraph graph replacing open-swe. Every pipeline path is a typed graph edge — no prompting needed to decide next step. Runs identically in GitHub Actions and locally.

---

## What changed from open-swe

| open-swe | LangGraph |
|---|---|
| Clone third-party repo at runtime | Self-contained in `.langgraph/` |
| AST-patch server.py to inject tools | Tools are plain Python in `tools/` |
| HTTP server + SDK polling loop | Direct Python invocation, no server |
| Pipeline routing by LLM reading AGENTS.md | Hard-coded conditional edges in `graph.py` |
| Opaque subagent spawning | Named nodes with typed state transitions |
| Retry logic in LLM prompt | `MAX_RETRIES` counter + `interrupt()` escalation |
| Subprocess git calls | gitpython (`tools/git_tools.py`) |
| urllib PR creation | PyGithub (`tools/pygithub_tools.py`, non-agentic `open_pr`) |

---

## Pipeline paths

| Name | Trigger | Nodes |
|---|---|---|
| `implement-feature` | `agent-task` label, "implement", "add" | orchestrate → skeleton_writer → unit-tests → integration-tests → scenario-tests → implementer → cherry_pick → [conflict_resolver] → qualimetry → refactorer → validator → open_pr |
| `fix-bug` | `bug` label, "fix", "broken", "error" | orchestrate → skeleton_writer → unit-tests → implementer → cherry_pick → qualimetry → validator → open_pr |
| `review-pr` | "review", "APPROVED", "LGTM" | orchestrate → reviewer → END |
| `visual-change` | "rendering", "UI", "canvas", "three.js" | same as implement-feature + visual_tester before open_pr |
| `investigate` | "why", "how", "explain", "analyze" | orchestrate → implementer (read-only) → END |

---

## Branch isolation strategy

Each coding pipeline uses two separate branches to keep test code and implementation code fully apart:

```
main
 └─ skeleton_writer creates langgraph/tests-<N>
      │ commit: chore(skeleton): empty stubs for #N   ← skeleton_commit_sha
      │
      ├─ unit_test_writer:      commit: test(unit): ...
      ├─ integration_test_writer: commit: test(integration): ...
      ├─ scenario_test_writer:  commit: test(scenario): ...
      │
      └─ langgraph/impl-<N>  (forked from skeleton_commit_sha)
           └─ implementer: commit: feat(impl): ...   ← impl_commit_sha
                  ↓
           cherry_pick → lands on langgraph/tests-<N>
           conflict_resolver (if needed)
                  ↓
           qualimetry → refactorer → validator → open_pr
```

**Why:** The implementer starts from the skeleton commit (empty stubs) and never sees the test commits. This prevents the LLM from reverse-engineering implementations from test assertions.

**Git operations:** all managed by gitpython (`tools/git_tools.py`). No subprocess git calls.

**PR creation:** non-agentic, uses PyGithub (`tools/pygithub_tools.py`). No LLM involved.

---

## Test writing — 3 focused agents, each skippable

| Node | Scope | Skipped when | Auto-commits to |
|---|---|---|---|
| `unit_test_writer` | Atomic unit tests (one function/class, zero I/O) | investigate, review-pr | `test_branch` |
| `integration_test_writer` | Feature-scale tests (multiple components) | fix-bug, investigate, review-pr | `test_branch` |
| `scenario_test_writer` | Full game flows (Puppeteer scenarios) | fix-bug, investigate, review-pr | `test_branch` |

Each node auto-commits its work after the agent finishes. Commit messages follow the pattern:
- `test(unit): unit tests for #N`
- `test(integration): integration tests for #N`
- `test(scenario): scenario tests for #N`

---

## Qualimetry — non-agentic quality gate after implementer

Runs [`jscpd`](https://github.com/kucherenko/jscpd) on `src/` to detect copy-paste duplication. No LLM involved — deterministic pass/fail. Threshold: 5% duplicate lines. On failure, returns to `implementer` with the duplication report as context. Skipped for `investigate` and `review-pr` pipelines.

Retry logic: any coding node failure → back to `implementer` (max 3×). After 3 failures: `interrupt()` posts a comment and pauses the run.

---

## Trigger via GitHub Actions

### Option A — comment on any issue

Post this comment on any issue (repo owner only):

```
@langgraph implement the navmesh ramp routing feature
```

The agent replies with 👀, runs the pipeline, and opens a PR.

### Option B — manual dispatch

1. Go to **Actions → LangGraph Agent → Run workflow**.
2. Enter the issue number and an optional instruction.
3. Click **Run workflow**.

### What happens

```
1. Workflow checks out the repo
2. Installs Python deps (uv sync)
3. Configures git credentials
4. Runs: uv run python runner.py
5. Graph executes:
   orchestrate → skeleton_writer → [test writers] → implementer
   → cherry_pick → qualimetry → refactorer → validator → open_pr
6. PR opened automatically with "Closes #<issue>" in body
```

No LangGraph server started. No HTTP polling. Direct Python execution.

---

## Local execution

### Prerequisites

```bash
cd .langgraph
cp .env.example .env
# Edit .env: add your DEEPSEEK_API_KEY (or other provider), GITHUB_TOKEN
uv sync
```

### Option A — CLI (fast, no UI)

```bash
uv run python runner.py --issue 42 --comment "implement the navmesh ramp routing feature"
```

Structured logs per node. Uses in-memory checkpointer (`MemorySaver`).

```bash
# Additional flags
uv run python runner.py --issue 42 --model openai:gpt-4o
uv run python runner.py --help
```

### Option B — LangGraph Studio (live graph UI)

```bash
uv run langgraph dev --port 2024
```

Open **http://localhost:2024** in your browser.

Studio gives you:
- Live graph visualization with node-by-node state inspection
- Replay from any checkpoint
- Manual state edits (inject `human_feedback` to resume after `interrupt()`)
- Full message history per node
- Token usage and latency per step

The `ISSUE_NUMBER` and `COMMENT_BODY` env vars (set in `.env`) configure which issue to work on.

---

## LLM configuration

Change `LLM_MODEL_ID` to switch providers. No other files need updating.

| Provider | `LLM_MODEL_ID` | Required secret |
|---|---|---|
| DeepSeek (default) | `deepseek:deepseek-v4-flash` | `DEEPSEEK_API_KEY` |
| OpenAI | `openai:gpt-4o` | `OPENAI_API_KEY` |
| Anthropic | `anthropic:claude-3-7-sonnet-20250219` | `ANTHROPIC_API_KEY` |

**GitHub Actions:** update `LLM_MODEL_ID` in `.github/workflows/langgraph-agent.yml` and add the corresponding API key as a repo secret.

**Locally:** set `LLM_MODEL_ID` in `.env` or pass `--model` to `runner.py`.

---

## LangSmith tracing

Set `LANGSMITH_API_KEY` (in repo secrets for CI, or in `.env` for local). Tracing auto-enables.

All runs appear under the **`BlastSimulator2026-langgraph`** project in LangSmith.

Each trace shows:
- Per-node spans with typed inputs/outputs
- Conditional edge decisions annotated on the trace
- Tool call inputs and outputs
- Retry count surfaced as metadata
- Exact failure point per node

---

## File map

```
.langgraph/
  README.md              ← this file
  pyproject.toml         ← Python deps (langgraph, langchain-*, gitpython, PyGithub)
  langgraph.json         ← graph entrypoint for `langgraph dev`
  .env.example           ← env template (copy to .env, never commit .env)
  .gitignore             ← excludes .env, caches, .venv
  graph.py               ← StateGraph: all nodes, conditional edges, retry logic
  runner.py              ← CLI/CI entrypoint (direct invocation, no HTTP server)
  llm.py                 ← LLM factory: parses LLM_MODEL_ID → ChatModel
  checkpointer.py        ← Checkpointer: MemorySaver (local) or PostgreSQL (CI)
  nodes/
    __init__.py
    _base.py                    ← shared tool sets + build_react_agent / extract_ok
    orchestrate.py              ← classify issue, set pipeline + skill + branch names
    skeleton_writer.py          ← create test_branch from main; write empty stubs
    unit_test_writer.py         ← TDD Red: atomic unit tests (one function/class)
    integration_test_writer.py  ← TDD Red: feature-scale integration tests
    scenario_test_writer.py     ← TDD Red: full game-flow scenario tests
    implementer.py              ← TDD Green: impl_branch from skeleton_commit_sha
    cherry_pick.py              ← non-agentic: cherry-pick impl onto test_branch
    conflict_resolver.py        ← agentic: resolve cherry-pick merge conflicts
    qualimetry_node.py          ← non-agentic: jscpd duplication gate
    refactorer.py               ← TDD Refactor: clean up for clarity
    validator.py                ← run npm run validate, increment retry_count on failure
    visual_tester.py            ← Puppeteer scenario tests
    reviewer.py                 ← PR audit + post APPROVED comment
    open_pr.py                  ← non-agentic: create PR via PyGithub
  tools/
    __init__.py
    agent_tools.py       ← list/get agents + skills (from .github/agents/ + .github/skills/)
    backlog_tools.py     ← backlog CRUD via GitHub API
    github_tools.py      ← GitHub read API (issues, PRs, comments)
    github_write.py      ← GitHub write API (legacy; open_pr now uses pygithub_tools)
    pygithub_tools.py    ← PyGithub: create_pr, add_label, remove_label
    git_tools.py         ← gitpython: all git operations (branch, commit, push, cherry-pick)
    fs_tools.py          ← read/write/delete files, list_dir, grep
    shell_tools.py       ← run_shell + git wrappers (delegates to git_tools)
    qualimetry.py        ← jscpd wrapper: detect code duplication, return QualimetryReport

.github/workflows/
  langgraph-agent.yml    ← agent runner (replaces open-swe-agent.yml)
```

---

## Adding custom tools

1. Add a `.py` file in `tools/` with plain Python functions.
2. Import them in `nodes/_base.py` and add to the appropriate tool set (`READ_ONLY_TOOLS`, `WRITE_TOOLS`, etc.).
3. No other files need updating — nodes pick up tools from `_base.py`.

---

## Human-in-the-loop

After `MAX_RETRIES = 3` failures at any coding node, the graph calls `interrupt()`. This:

- **In GitHub Actions:** pauses the run and posts a comment on the issue explaining what failed. Re-trigger the workflow after adding clarification to the issue.
- **In LangGraph Studio:** shows an input box inline. Enter guidance → click Resume → graph continues from the interrupted node.
