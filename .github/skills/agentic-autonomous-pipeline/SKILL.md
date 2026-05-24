---
name: agentic-autonomous-pipeline
description: >
  Agentic autonomous TDD development pipeline. Generic for any AI coding solution:
  GitHub Copilot, Claude Code, OpenAI Codex, OpenCode, and LangGraph.
  Use when setting up, debugging, or modifying the autonomous pipeline system.
---

## Overview

This skill describes a **generic agentic system** that works across all supported AI coding solutions. Every skill, agent definition, prompt, and configuration file is duplicated with **identical wording** in each solution's directory:

| Solution | Config directory | Format |
|----------|-----------------|--------|
| GitHub Copilot | `.github/agents/`, `.github/skills/` | Markdown `.agent.md`, `SKILL.md` |
| Claude Code | `.claude/agents/`, `.claude/skills/` | Markdown (same format) |
| OpenAI Codex | `.agents/`, `.agents/skills/` | Markdown (same format) |
| OpenCode | `.opencode/agents/`, `.opencode/skills/` | Markdown (same format) |
| LangGraph | `.langgraph/` (reads `.github/` context files) | Python graph nodes |

Files across all directories must stay synchronized with exactly the same wording. LangGraph reuses the same `.github/` context files:
- `.github/agents/` for per-role system prompts (stripped of YAML frontmatter)
- `.github/skills/` for domain-specific skill specs (loaded on demand by agents)
- `.github/copilot-instructions.md` as the global instruction layer (injected as the first layer of every agent's prompt hierarchy)

## Execution Models

Two execution models run the same TDD pipeline:

### 1. Orchestrator Agent (Copilot / Claude Code / Codex / OpenCode)

A user-facing **orchestrator** agent (`pipeline` agent) that the developer invokes directly. The orchestrator does NOT write code — it delegates to **hidden sub-agents** (not invocable by the user, only by the orchestrator) in the correct TDD sequence, passing context forward between steps.

### 2. LangGraph (hard-coded graph)

The same TDD pipeline is encoded as a typed state graph in `.langgraph/graph.py`. All workflow routing is handled by conditional edge functions (`.langgraph/routing.py`) with `MAX_RETRIES = 7` and `interrupt()` escalation. No orchestrator prompt — steps are deterministic graph transitions.

LangGraph reads agent role prompts from `.github/agents/` (stripped of YAML frontmatter), skill context from `.github/skills/`, and global instructions from `.github/copilot-instructions.md` to construct per-node system prompts, but the workflow orchestration itself is Python code, not an LLM invocation.

## TDD Pipeline Steps

The pipeline classifies each issue into a path, then runs the appropriate TDD sequence:

| Path | Trigger | Description |
|------|---------|-------------|
| Full feature | feature, implement, add | Plan → Test (Red) → Implement (Green) → Quality gates → Code review → Refactor → Validate → PR |
| Bug fix | bug, fix, broken, regression | Plan → Unit test → Implement → Quality gates → Code review → Validate → PR |
| Visual change | rendering, UI, canvas | Full feature + visual verification before PR |
| PR review | review, APPROVED, LGTM | Audit PR → post APPROVED merge signal |
| Investigate | why, how, explain, analyze | Read-only exploration → END |

Each TDD step follows the standard Red-Green-Refactor cycle. The specific agents and their granularity may evolve — the pipeline is defined by the sequence, not the agent count.

## Git & GitHub Operations (Fixed)

Unlike agent granularity, the following git and GitHub operations are hard invariants of the pipeline and must be implemented by both execution models.

### Branch Isolation

Critical to unbiased implementation: test code and implementation code must never mix during development.

```
main
 └─ langgraph/tests-<N>   (test branch — skeleton → tests → final code)
      └─ langgraph/impl-<N>  (impl branch — forked from skeleton commit)
           └─ implementer works here, never sees tests
              ↓
         cherry-pick → lands on test branch
```

1. **Skeleton branch:** create `langgraph/tests-<N>` from `main`, write empty stubs, record `skeleton_commit_sha`
2. **Fork impl branch:** create `langgraph/impl-<N>` from that skeleton commit
3. **Write tests** on `langgraph/tests-<N>` (test branch)
4. **Implement** on `langgraph/impl-<N>` (impl branch) — agent never sees test commits
5. **Cherry-pick** the implementation commit onto `langgraph/tests-<N>`
6. **Resolve conflicts** if cherry-pick fails
7. **All subsequent quality gates** run on `langgraph/tests-<N>`

### Cherry-Pick + Conflict Resolution

The implementation commit is cherry-picked from the impl branch onto the test branch. If conflicts arise, a conflict resolver agent reads the conflicted files, merges both sides, removes conflict markers, and stages the resolved files. On resolution failure, the implementer re-runs.

### Quality Gates (after cherry-pick)

After the code lands on the test branch, these gates run in sequence:
1. **Test runner** (non-agentic) — run test suite, pass → continue, fail → fixer loop
2. **Duplication check** (non-agentic) — jscpd, fail → back to implementer
3. **Code review** (agentic) — architecture, convention audit, fail → back to implementer
4. **Refactor** — clean up conventions, no behavior change
5. **Validator** — full suite: TypeScript → tests → build
6. **Visual verification** (visual changes only) — screenshot comparison

### PR Creation

Create a pull request from `langgraph/tests-<N>` to `main` with:
- Title prefixed by pipeline type (`feat:`, `fix:`, `docs:`)
- Body includes `Closes #<issue_number>` and validation checklist
- Labels updated: `in-progress` removed, `in-review` added

This operation is always non-agentic (no LLM involved).
