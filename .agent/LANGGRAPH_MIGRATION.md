# LangGraph Migration Plan — BlastSimulator2026 Autonomous Pipeline

Replace the open-swe black-box agent with a purpose-built LangGraph graph that encodes every pipeline path explicitly, runs identically in GitHub Actions and locally, and exposes full LangSmith visibility.

---

## 1. Current Architecture

```
GitHub event (issue comment / workflow_dispatch)
    │
    ▼
open-swe-agent.yml
  1. checkout open-swe (langchain-ai/open-swe)
  2. inject .openswe/tools/*.py into open-swe's tool package
  3. patch server.py to register custom tools
  4. patch auth.py, model.py, sitecustomize.py
  5. langgraph dev --port 2024 (background)
  6. LangGraph SDK invocation → open-swe graph runs
    │  orchestrator LLM reads AGENTS.md → picks pipeline
    │  spawns subagents via open-swe "task" tool
    │  each subagent loads .github/agents/<role>.agent.md
    │  subagents call file/shell/git tools
    ▼
  PR opened on success
```

**Friction points with open-swe:**
- Pipeline routing is implicit in the LLM's reading of AGENTS.md — no hard graph edges.
- Tool injection requires AST-patching a third-party repo at runtime.
- Subagent spawning is opaque; logs mix orchestrator + subagent output.
- Local execution requires starting a full HTTP server.
- No direct control over retry logic, conditional edges, or human-in-the-loop placement.

---

## 2. Target Architecture

One self-contained LangGraph `StateGraph` defined in `.langgraph/graph.py`. Each pipeline stage is a graph node. Routing is expressed as typed conditional edges — no prompting needed to decide next step.

```
GitHub event (or local CLI)
    │
    ▼
langgraph_runner.py          ← thin entrypoint (Actions or local)
    │
    ▼
BlastSimulatorGraph (StateGraph)
  ┌─ [orchestrate] ──────── classify issue, set pipeline route
  │       │
  │  route: implement-feature ──► [test-writer] → [implementer] → [refactorer] → [validator]
  │  route: fix-bug           ──► [implementer] → [validator]
  │  route: review-pr         ──► [reviewer]
  │  route: visual-change     ──► [test-writer] → [implementer] → [refactorer] → [validator] → [visual-tester]
  │  route: investigate       ──► [implementer] (read-only mode)
  │
  └─ [open-pr]  ── called from all non-investigate routes on success
```

Each node is a Python function that:
1. Receives `AgentState` (typed `TypedDict`).
2. Calls an LLM with the matching `.github/agents/<role>.agent.md` as system prompt.
3. Executes tool calls in a ReAct loop.
4. Returns state updates.

---

## 3. Shared State Schema

```python
class AgentState(TypedDict):
    # Inputs (set by orchestrate node)
    issue_number: int
    issue_title: str
    issue_body: str
    issue_labels: list[str]
    comment_body: str
    pipeline: str          # 'implement-feature' | 'fix-bug' | 'review-pr' | 'visual-change' | 'investigate'
    skill: str             # optional domain skill name to load (e.g. 'blast-system')

    # Execution state
    messages: Annotated[list[BaseMessage], add_messages]  # full message history
    current_role: str      # which node is active
    branch_name: str       # git branch being worked on
    pr_number: int | None  # set after open-pr node

    # Results per node (for conditional routing)
    test_writer_ok: bool
    implementer_ok: bool
    refactorer_ok: bool
    validator_ok: bool
    visual_tester_ok: bool
    reviewer_ok: bool

    # Retry counter (per node)
    retry_count: int

    # Human-in-the-loop
    human_feedback: str | None
    awaiting_human: bool
```

State is fully serializable. LangGraph's checkpointer (PostgreSQL in CI, `MemorySaver` locally) persists it for resume-on-failure.

---

## 4. Pipeline Paths

### 4.1 `implement-feature`

**Trigger labels:** `agent-task`, or keywords "implement", "add", "feature" in issue body.

```
orchestrate → test-writer → implementer → refactorer → validator → open-pr
```

Conditional edges:
- `test-writer` fails (LLM error or validation timeout) → retry up to 2× → escalate (label `blocked`)
- `validator` fails → route back to `implementer` with failure context appended to state (max 3 retries)
- `validator` passes → `open-pr`

### 4.2 `fix-bug`

**Trigger labels:** `bug`, or keywords "fix", "broken", "regression", "error".

```
orchestrate → implementer → validator → open-pr
```

Conditional edges:
- `validator` fails → retry `implementer` with error context (max 3×)
- `validator` passes → `open-pr`

### 4.3 `review-pr`

**Trigger labels:** "review", or keywords "APPROVED", "LGTM", comment body starts with "review".

```
orchestrate → reviewer → (post APPROVED comment or push fixes) → END
```

The `reviewer` node:
1. Fetches PR diff, reviews, checks architecture/i18n/style.
2. If fixes needed: writes files, commits, pushes, verifies CI pass.
3. Posts `APPROVED` comment as final action (triggers auto-merge in `auto-merge-copilot.yml`).

No `open-pr` node — PR already exists.

### 4.4 `visual-change`

**Trigger labels:** rendering, UI, canvas, Three.js keywords.

```
orchestrate → test-writer → implementer → refactorer → validator → visual-tester → open-pr
```

The `visual-tester` node:
1. Starts `npm run dev` (background).
2. Runs `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/scenario-test.ts`.
3. Captures screenshots, compares against reference images.
4. Returns pass/fail + screenshot artifacts attached to state.

Conditional edges:
- `visual-tester` fails → route back to `implementer` with screenshot diff context
- `visual-tester` passes → `open-pr`

### 4.5 `investigate`

**Trigger:** keywords "why", "how", "explain", "analyze", no code-change expected.

```
orchestrate → implementer (read-only mode) → END
```

The `implementer` node receives `investigate=True` in its tool config — file-write and git tools are disabled. Output is a markdown investigation report posted as an issue comment.

---

## 5. Node Implementations

Each node follows the same pattern:

```python
def make_node(role: str, tools: list[BaseTool], model: BaseChatModel):
    """Factory: returns a LangGraph node function for a given agent role."""
    system_prompt = Path(f".github/agents/{role}.agent.md").read_text()

    async def node(state: AgentState) -> dict:
        agent = create_react_agent(model, tools, prompt=system_prompt)
        result = await agent.ainvoke({
            "messages": state["messages"],
            "issue_number": state["issue_number"],
            ...
        })
        return {
            "messages": result["messages"],
            f"{role.replace('-','_')}_ok": _extract_ok(result),
            "current_role": role,
        }
    return node
```

The `orchestrate` node is different — it calls the LLM with a short classification prompt (not AGENTS.md), reads issue labels + body, and sets `pipeline` + `skill` in state. No tool calls needed here.

---

## 6. Tool Sets

Tools are grouped by access level and assigned per node.

### 6.1 Read-only tools (all nodes)

| Tool | Source | Purpose |
|------|--------|---------|
| `read_file(path)` | filesystem | Read any repo file |
| `list_dir(path)` | filesystem | List directory contents |
| `grep(pattern, path)` | subprocess | Search code |
| `get_agent_context(name)` | `agent_tools.py` | Load agent role instructions |
| `get_skill_context(name)` | `agent_tools.py` | Load domain skill spec |
| `list_agents()` | `agent_tools.py` | List available roles |
| `list_skills()` | `agent_tools.py` | List available skills |
| `github_get_issue(n)` | `github_tools.py` | Fetch issue details |
| `github_list_issue_comments(n)` | `github_tools.py` | Fetch issue comments |
| `github_get_pr(n)` | `github_tools.py` | Fetch PR details |
| `github_get_pr_files(n)` | `github_tools.py` | Fetch PR changed files |
| `github_get_pr_reviews(n)` | `github_tools.py` | Fetch PR reviews |
| `github_get_pr_review_comments(n)` | `github_tools.py` | Fetch inline PR comments |

### 6.2 Write tools (implementer, refactorer, reviewer, test-writer)

| Tool | Purpose |
|------|---------|
| `write_file(path, content)` | Write or overwrite a file |
| `delete_file(path)` | Remove a file |
| `run_shell(cmd, cwd)` | Execute any shell command (npm, npx, tsc, vitest) |
| `git_commit(message)` | Stage all + commit |
| `git_push(branch)` | Push to remote |

### 6.3 Backlog tools (orchestrate node only)

All functions from `backlog_tools.py`, unchanged:
`backlog_list`, `backlog_next`, `backlog_start`, `backlog_done`, `backlog_block`, `backlog_reset`, `backlog_stats`.

### 6.4 GitHub write tools (open-pr node only)

| Tool | Purpose |
|------|---------|
| `github_create_pr(branch, title, body)` | Open PR with `Closes #N` in body |
| `github_post_comment(issue_n, body)` | Post comment on issue |
| `github_add_label(issue_n, label)` | Add label to issue |
| `github_remove_label(issue_n, label)` | Remove label from issue |

---

## 7. Execution Modes

### 7.1 GitHub Actions

Replace `open-swe-agent.yml` with a leaner workflow:

```yaml
name: LangGraph Agent

on:
  workflow_dispatch:
    inputs:
      issue_number: { required: true }
      comment_body:  { required: false }
  issue_comment:
    types: [created]

jobs:
  run-agent:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install uv && uv sync
        working-directory: .langgraph
      - name: Configure git
        run: |
          git config --global user.email "langgraph-bot@github.com"
          git config --global user.name "LangGraph Bot"
          git config --global url."https://x-access-token:${{ secrets.GITHUB_TOKEN }}@github.com/".insteadOf "https://github.com/"
      - name: Run LangGraph pipeline
        run: uv run python .langgraph/runner.py
        env:
          ISSUE_NUMBER: ${{ steps.issue.outputs.number }}
          COMMENT_BODY: ${{ github.event.comment.body || github.event.inputs.comment_body }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_WORKSPACE: ${{ github.workspace }}
          DEFAULT_REPO_OWNER: ${{ github.repository_owner }}
          DEFAULT_REPO_NAME: ${{ github.event.repository.name }}
          LLM_MODEL_ID: "deepseek:deepseek-v4-flash"
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LANGCHAIN_TRACING_V2: ${{ secrets.LANGSMITH_API_KEY != '' && 'true' || 'false' }}
          LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}
          LANGCHAIN_PROJECT: "BlastSimulator2026-langgraph"
```

No `langgraph dev` server. The runner imports and invokes the graph directly:

```python
# .langgraph/runner.py
import asyncio, os
from graph import build_graph

async def main():
    graph = build_graph()
    config = {"configurable": {"thread_id": os.environ["ISSUE_NUMBER"]}}
    await graph.ainvoke({
        "issue_number": int(os.environ["ISSUE_NUMBER"]),
        "comment_body": os.environ.get("COMMENT_BODY", ""),
    }, config=config)

asyncio.run(main())
```

No HTTP server. No SDK polling loop. Direct Python invocation.

### 7.2 Local execution with LangGraph Studio

```bash
cd .langgraph
uv sync
ISSUE_NUMBER=42 COMMENT_BODY="fix the navmesh ramp bug" \
  GITHUB_TOKEN=ghp_... DEFAULT_REPO_OWNER=Nico2398 DEFAULT_REPO_NAME=BlastSimulator2026 \
  DEEPSEEK_API_KEY=... LANGSMITH_API_KEY=... \
  langgraph dev --port 2024
```

Open `http://localhost:2024` for the LangGraph Studio UI:
- Live graph visualization with node-by-node state inspection.
- Replay from any checkpoint.
- Manual state edits (human-in-the-loop injection).
- Full message history per node.

The same `graph.py` runs in both modes — no code change needed.

### 7.3 Local execution without Studio (fast iteration)

```bash
cd .langgraph
uv run python runner.py --issue 42 --comment "fix navmesh ramp"
```

Outputs structured logs per node. Uses `MemorySaver` checkpointer (in-memory). No server needed.

---

## 8. Human-in-the-Loop Paths

LangGraph's `interrupt()` primitive replaces the current "label `blocked`, notify human" pattern.

### 8.1 Pre-coding approval (optional)

After `orchestrate`, before the first coding node, add an `interrupt` if the issue requires creative direction input (new names, game-feel decisions):

```python
if state.get("needs_creative_input"):
    interrupt("Awaiting creative director input on: " + state["pending_question"])
```

In GitHub Actions this posts a comment and pauses the run. The human replies → workflow re-triggers → graph resumes from checkpoint.

Locally, LangGraph Studio shows the interrupt inline with an input box.

### 8.2 Validation failure escalation

After 3 failed `validator` retries:

```python
interrupt(f"Validation failed {retry_count}× — please review and provide guidance.")
```

Same mechanism. In CI the run suspends and re-starts on next trigger. Locally the Studio pauses for input.

---

## 9. Project Layout

```
.langgraph/
  pyproject.toml         ← dependencies: langgraph, langchain-*, anthropic, etc.
  langgraph.json         ← graph entrypoint for `langgraph dev`
  graph.py               ← StateGraph definition + node factories
  runner.py              ← entrypoint for CI (direct invocation, no HTTP server)
  nodes/
    orchestrate.py       ← classify issue, set pipeline + skill
    test_writer.py       ← test-writer node
    implementer.py       ← implementer node
    refactorer.py        ← refactorer node
    validator.py         ← validator node
    visual_tester.py     ← visual-tester node
    reviewer.py          ← reviewer node
    open_pr.py           ← create PR + post comment
  tools/
    agent_tools.py       ← list/get agents + skills (unchanged from .openswe/tools/)
    backlog_tools.py     ← backlog CRUD (unchanged from .openswe/tools/)
    github_tools.py      ← GitHub read API (unchanged from .openswe/tools/)
    github_write.py      ← GitHub write API: create PR, post comment, manage labels
    fs_tools.py          ← read/write/delete files, list_dir
    shell_tools.py       ← run_shell, git_commit, git_push
  checkpointer.py        ← PostgreSQL in CI, MemorySaver locally
  llm.py                 ← model factory: parse LLM_MODEL_ID → LangChain ChatModel

.github/workflows/
  langgraph-agent.yml    ← replaces open-swe-agent.yml
  auto-assign-next.yml   ← unchanged
  generate-issues.yml    ← unchanged
  handle-failure.yml     ← unchanged (still handles `blocked` label + CI failure)
  ci.yml                 ← unchanged
```

The `.openswe/` directory and `open-swe-agent.yml` are removed once migration is complete.

---

## 10. LLM Configuration

Same env-var pattern as open-swe. `llm.py` parses `LLM_MODEL_ID`:

```python
def build_llm(model_id: str) -> BaseChatModel:
    provider, model = model_id.split(":", 1)
    match provider:
        case "deepseek":   return ChatDeepSeek(model=model)
        case "openai":     return ChatOpenAI(model=model)
        case "anthropic":  return ChatAnthropic(model=model)
        case _:            raise ValueError(f"Unknown provider: {provider}")
```

The `patch_langchain_reasoning.py` fix for DeepSeek `reasoning_content` can be imported directly in `llm.py` instead of injected as `sitecustomize.py` — cleaner, no patching required.

---

## 11. Observability

LangSmith tracing is identical to the current setup. Set `LANGCHAIN_TRACING_V2=true` and `LANGSMITH_API_KEY`. All node calls, tool inputs/outputs, and token usage appear under the `BlastSimulator2026-langgraph` project.

Additional gains vs open-swe:
- **Per-node trace spans** with typed inputs/outputs (not a flat message list).
- **Conditional edge decisions** visible as annotations on the trace.
- **Retry counts** surfaced as metadata.
- **Checkpoint replay** in LangGraph Studio — resume any failed run from any node.

---

## 12. Migration Steps

1. Create `.langgraph/` directory. Copy tool files from `.openswe/tools/`.
2. Implement `graph.py` with `StateGraph`, nodes, and conditional edges.
3. Write `runner.py` for direct CI invocation.
4. Write `langgraph.json` for local Studio mode.
5. Write `langgraph-agent.yml` workflow.
6. Smoke-test locally with `langgraph dev` against a real issue number.
7. Run one end-to-end `implement-feature` cycle in CI against a test issue.
8. Delete `open-swe-agent.yml` and `.openswe/` on confirmed success.

Steps 1–4 are independent and can be done in parallel. Step 5 depends on 2–4. Steps 6–8 are sequential.

---

## 13. What Stays Unchanged

- `.github/agents/*.agent.md` — agent role prompts are used as node system prompts verbatim.
- `.github/skills/*/SKILL.md` — loaded by `get_skill_context()` tool, no change.
- `auto-assign-next.yml`, `generate-issues.yml`, `handle-failure.yml`, `ci.yml` — untouched.
- `backlog.json` schema and all backlog rules.
- The `Closes #<number>` PR body requirement.
- All TypeScript project code, tests, and build tooling.
