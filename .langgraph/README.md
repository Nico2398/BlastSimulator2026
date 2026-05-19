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
| `implement-feature` | `agent-task` label, "implement", "add" | orchestrate → skeleton_writer → unit-tests → integration-tests → scenario-tests → implementer → cherry_pick → [conflict_resolver] → **test_runner** → [**fixer**] → qualimetry → **code_review** → refactorer → validator → open_pr |
| `fix-bug` | `bug` label, "fix", "broken", "error" | orchestrate → skeleton_writer → unit-tests → implementer → cherry_pick → **test_runner** → [**fixer**] → qualimetry → **code_review** → validator → open_pr |
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
            test_runner → [fixer → test_runner → ...]
                   ↓
            qualimetry → code_review → refactorer → validator → open_pr
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

## Quality gates (in order after cherry_pick)

Four sequential gates run after the implementation is merged onto the test branch. Deterministic gates run first; agentic gates run after.

### 1. `test_runner` — non-agentic test suite

Runs `npx vitest run --reporter verbose`. No LLM — pure pass/fail from exit code.

- **Pass** → qualimetry
- **Fail** → fixer (receives failure output only, not test source)

### 2. `fixer` — agentic independent fixer

An independent agent that receives only the Vitest failure output — not the test source code. This keeps the fix unbiased: the agent reads stack traces and error messages, then inspects only the implementation files mentioned.

- Role: `fixer` (separate prompt from `implementer`)
- Commits with `fix(impl): fix failing tests for #N`
- Loops back to `test_runner` after each fix (max `MAX_RETRIES` total)

### 3. `qualimetry` — non-agentic duplication check

Runs [`jscpd`](https://github.com/kucherenko/jscpd) on `src/`. Threshold: 5% duplicate lines (configurable via `QUALIMETRY_DUPLICATE_THRESHOLD`).

- **Pass** → code_review
- **Fail** → implementer (with duplication report as context)

### 4. `code_review` — agentic architecture audit

Reviews the implementation against the project's quality rules before the refactorer:

| Check | Rule |
|---|---|
| Architecture boundaries | `src/core/` must not import DOM/WebGL/window |
| Randomness | No `Math.random()` — only `src/core/math/Random.ts` |
| File size | 300-line limit per file (data/i18n exempt) |
| Exports | Named exports everywhere (except entry points) |
| i18n | All user-facing strings via `t('key')` |
| TypeScript | No `any` except in test fixtures |
| Config | No hardcoded balance numbers — use `src/core/config/` |

- **Pass** → refactorer (or validator for fix-bug)
- **Fail** → implementer (with review report as context)

Retry logic: any coding node failure → back to `implementer` (max 7×). After 7 failures: `interrupt()` posts a comment and pauses the run.

---

## Context model and isolation rules

The graph state stores global metadata (`issue_*`, branch names, SHAs, retry counters, gate outputs, PR number). Nodes can read that state directly.

Agent context is narrower than graph state:

| Agentic step | What it gets | What it does **not** get |
|---|---|---|
| `skeleton_writer` | issue metadata + skeleton-writing instructions in node context | no test commits yet |
| `unit_test_writer` / `integration_test_writer` / `scenario_test_writer` | issue metadata + test-writing scope | implementation branch contents |
| `implementer` | issue metadata, skeleton SHA/branch setup, safe retry feedback (`qualimetry_report`, `code_review_report`, `validator_report`, conflict file list, human feedback) | prior graph message history, test-writer message history, test branch commits |
| `conflict_resolver` | issue metadata + explicit conflicted file list | unrelated historical context |
| `fixer` | issue metadata + `test_output` from `test_runner` only | prior graph message history, test source/assertions |
| `code_review` | issue metadata + repository read access | write tools, fixer/test-writer history requirements |
| `refactorer` / `validator` / `reviewer` / `visual_tester` | full node-specific system context for their role | no hidden extra privileges beyond their tool set |

Two important details:

- `implementer` now starts from a **fresh message set** and re-checks out `impl_branch` on retries, so it never inherits test-writer chat history.
- `fixer` also starts from a **fresh message set** and works only from stored Vitest output.

## Role prompts

Each reusable agent role has its own prompt file in `.github/agents/`:

- `test-writer.agent.md`
- `implementer.agent.md`
- `refactorer.agent.md`
- `validator.agent.md`
- `reviewer.agent.md`
- `visual-tester.agent.md`
- `fixer.agent.md`
- `code-reviewer.agent.md`

Node-specific steps such as `skeleton_writer` and `conflict_resolver` currently reuse an existing role prompt plus extra node context assembled in Python.

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
   → cherry_pick → test_runner → [fixer] → qualimetry → code_review
   → refactorer → validator → open_pr
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

## GitHub Actions logs

Every pipeline run produces fully traceable logs in the **Run LangGraph pipeline** step.

### Collapsible groups per node

Each graph node emits a `::group::Node: <name>` / `::endgroup::` pair. In the GitHub Actions UI click any group to expand/collapse it:

```
▶ Node: orchestrate          pipeline: implement-feature  skill: navmesh  …
▶ Node: skeleton_writer      skeleton_writer_ok: ✅  sha: abc1234
▶ Node: unit_test_writer     → tool: write_file(…)  ← tool: write_file → ok  LLM: …
▶ Node: implementer          → tool: write_file(…)  ← tool: …  LLM: …
▶ Node: cherry_pick          cherry_pick_ok: ✅
▶ Node: test_runner          ✅ TESTS PASSED  (full Vitest output inside)
▶ Node: qualimetry           ✅ QUALIMETRY PASSED  0.3% duplicate lines
▶ Node: open_pr              PR #157 opened
```

### What each group contains

| Node type | Content |
|---|---|
| **Agentic** (implementer, fixer, reviewers …) | Every `tool_call` name + truncated input → output, then final LLM response (truncated to 600 chars) |
| **Non-agentic** (test_runner, qualimetry, cherry_pick, open_pr …) | Full structured output: status flag, report text, commit SHA, PR number, conflict list … |

This is implemented in `pipeline_logger.py` — no LangSmith account required.

### LangSmith (optional but richer)

Set `LANGSMITH_API_KEY` as a repo secret for deeper traces. All runs appear under the **`BlastSimulator2026-langgraph`** project. LangSmith adds:
- Per-token latency and cost breakdown
- Conditional edge decisions annotated on the graph visualisation
- Replay of any past run from its checkpoint

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
  pipeline_logger.py     ← astream_events processor: per-node groups, tool/LLM logs
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
    test_runner.py              ← non-agentic: run Vitest; record pass/fail + output
    fixer.py                    ← agentic (independent): fix impl from error output only
    qualimetry_node.py          ← non-agentic: jscpd duplication gate
    code_review.py              ← agentic: architecture / convention audit
    refactorer.py               ← TDD Refactor: clean up for clarity
    validator.py                ← run npm run validate, record validator_report on failure
    visual_tester.py            ← Puppeteer scenario tests
    reviewer.py                 ← PR audit + post APPROVED comment
    open_pr.py                  ← non-agentic: create PR via PyGithub
  tools/
    __init__.py
    agent_tools.py       ← list/get agents + skills (from .github/agents/ + .github/skills/)
    backlog_tools.py     ← backlog CRUD via GitHub API
    github_tools.py      ← GitHub read API (issues, PRs, comments)
    github_write.py      ← GitHub write API (post comment, add/remove label)
    pygithub_tools.py    ← PyGithub: create_pr (non-agentic open_pr only)
    git_tools.py         ← gitpython: all git operations (branch, commit, push, cherry-pick)
    fs_tools.py          ← read/write/delete files, list_dir, grep
    shell_tools.py       ← run_shell (delegates git ops to git_tools)
    qualimetry.py        ← jscpd wrapper: detect code duplication, return QualimetryReport
    todo_tools.py        ← per-session TODO list: todo_add / todo_list / todo_done / todo_clear

.github/workflows/
  langgraph-agent.yml    ← agent runner (replaces open-swe-agent.yml)
```

---

## Adding custom tools

1. Add a `.py` file in `tools/` with plain Python functions.
2. Import them in `nodes/_base.py` and add to the appropriate tool set.
3. No other files need updating — nodes pick up tools from `_base.py`.

---

## Tool sets per node

All tool sets are defined in `nodes/_base.py`. Git operations and PR creation are intentionally absent from every agent tool set — those are performed exclusively by non-agentic nodes (`skeleton_writer`, `cherry_pick`, `open_pr`).

| Tool set | Composed of | Used by |
|---|---|---|
| `READ_ONLY_TOOLS` | context tools + file reads + TODO | `code_review`, `implementer` (investigate mode) |
| `CODING_TOOLS` | context tools + file r/w + `run_shell` + TODO | all test writers, `implementer`, `fixer`, `refactorer` |
| `REVIEW_TOOLS` | `CODING_TOOLS` + GitHub write (post comment / label) | `reviewer` |

**Context tools** (read-only GitHub):
`list_agents`, `get_agent_context`, `list_skills`, `get_skill_context`,
`github_get_issue`, `github_list_issue_comments`,
`github_get_pr`, `github_get_pr_files`, `github_get_pr_reviews`, `github_get_pr_review_comments`

**Code tools** (filesystem + shell):
Read: `read_file`, `list_dir`, `grep`
Write: `write_file`, `delete_file`, `run_shell`

**Not exposed to agents:** `git_commit`, `git_push`, `git_checkout_branch`, `github_create_pr`.

---

## TODO list tool

Every agent has access to a lightweight task manager:

| Tool | Description |
|---|---|
| `todo_add(task)` | Add a sub-task to the list |
| `todo_list()` | Show all items with ☐/☑ status |
| `todo_done(index)` | Mark item N as complete |
| `todo_clear()` | Remove completed items |

State is keyed by issue number and lives in a module-level dict — zero overhead, no disk access, automatically cleaned up when the process exits.

Every agent system prompt includes this reminder:

```
## Task Management
Use the `todo_add`, `todo_list`, `todo_done` tools to manage your work:
1. Start: call `todo_list` to see pending items; then `todo_add` to record each sub-step.
2. Work: complete one item at a time, then call `todo_done` with its index.
3. Finish: call `todo_list` again to confirm all planned work is done before you stop.
```

---

## Human-in-the-loop

After `MAX_RETRIES = 7` failures at any coding node, the graph calls `interrupt()`. This:

- **In GitHub Actions:** pauses the run and posts a comment on the issue explaining what failed. Re-trigger the workflow after adding clarification to the issue.
- **In LangGraph Studio:** shows an input box inline. Enter guidance → click Resume → graph continues from the interrupted node.
