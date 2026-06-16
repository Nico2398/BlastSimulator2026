---
name: agentic-autonomous-pipeline
description: >
  Agentic autonomous TDD development pipeline. Runs via OpenCode orchestrator (CLI or GitHub Actions).
  Use when setting up, debugging, or modifying the autonomous pipeline system.
---

## Overview

This skill describes a **generic agentic system** that works across all supported AI coding solutions. Every skill, agent definition, prompt, and configuration file is duplicated with **identical wording** in each solution's directory:

| Solution | Config directory | Format |
|----------|-----------------|--------|
| GitHub Copilot | `.github/agents/`, `.github/skills/` | Markdown `.agent.md`, `SKILL.md` |
| Claude Code | `.claude/agents/`, `.claude/skills/` | Markdown (same format) |
| OpenCode | `.opencode/agents/`, `.opencode/skills/` | Markdown (same format) |

Files across all directories must stay synchronized with exactly the same wording.

## Execution Model

The pipeline runs as an **Orchestrator Agent** (`pipeline` agent) invoked by the developer or by a GitHub Actions workflow. The orchestrator does NOT write code — it delegates to **hidden sub-agents** in the correct TDD sequence, passing context forward between steps.

When triggered from GitHub Actions (`.github/workflows/opencode-runner.yml`), the opencode action runs the orchestrator non-interactively. The same pipeline also runs locally via `opencode run /resolve-issue`.

## TDD Pipeline Steps

The pipeline classifies each issue into a path, then runs the appropriate TDD sequence:

| Path | Trigger | Description |
|------|---------|-------------|
| Full feature | feature, implement, add | Plan → Test (Red) → Implement (Green) → Quality gates → Code review → Refactor → Validate → PR |
| Bug fix | bug, fix, broken, regression | Plan → Unit test → Implement → Quality gates → Code review → Validate → PR |
| Visual change | rendering, UI, canvas | Full feature + visual verification before PR |
| PR review | review, LGTM | Audit PR → pass/fail report |
| Investigate | why, how, explain, analyze | Read-only exploration → END |

Each TDD step follows the standard Red-Green-Refactor cycle. The specific agents and their granularity may evolve — the pipeline is defined by the sequence, not the agent count.

## Git & GitHub Operations (Fixed)

Unlike agent granularity, the following git and GitHub operations are hard invariants of the pipeline and must be implemented by both execution models.

### Branch Isolation

Critical to unbiased implementation: test code and implementation code must never mix during development.

```
main
 └─ pipeline/tests-<issue-number>   (test branch — skeleton → tests)
 │    └─ pipeline/impl-<issue-number>  (impl branch — forked from skeleton commit)
 │
 └─ pipeline/feature-<issue-number> (deliverable branch — created from tests branch HEAD)
                                     ↓ cherry-pick impl → quality gates + PR → main
```

1. **Skeleton branch:** create `pipeline/tests-<issue-number>` from `main`, write empty stubs, record `skeleton_commit_sha`
2. **Fork impl branch:** create `pipeline/impl-<issue-number>` from that skeleton commit
3. **Write tests** on `pipeline/tests-<issue-number>` (test branch)
4. **Implement** on `pipeline/impl-<issue-number>` (impl branch) — agent never sees test commits
5. **Create feature branch:** create `pipeline/feature-<issue-number>` from `pipeline/tests-<issue-number>` HEAD
6. **Cherry-pick** the implementation commit onto `pipeline/feature-<issue-number>`
7. **Resolve conflicts** if cherry-pick fails
8. **All subsequent quality gates** run on `pipeline/feature-<issue-number>`

### Cherry-Pick + Conflict Resolution

The implementation commit is cherry-picked from the impl branch onto the feature branch. If conflicts arise, a conflict resolver agent reads the conflicted files, merges both sides, removes conflict markers, and stages the resolved files. On resolution failure, the implementer re-runs.

 ### Quality Gates (after cherry-pick)

After the code lands on the feature branch, these gates run in sequence:
1. **Test runner** (non-agentic) — run test suite, pass → continue, fail → fixer loop
2. **Visual feedback loop** (visual changes only) — iterative visual-test/implement cycle, runs before qualimetry. See `agentic-pipeline-full` skill.
3. **Duplication check** (non-agentic) — `jscpd --gitOnly` changed-file clone detection, fail → back to implementer
4. **Code review fan-out** (agentic, parallel) — specialized sub-reviewers by risk tier:
   - `security_reviewer` — exploitable vulnerabilities
   - `quality_reviewer` — architecture, naming intent, coding conventions, TypeScript strictness
   - `i18n_reviewer` — hardcoded strings, locale mismatches
   - `duplication_reviewer` — semantic duplication, non-atomic functions, generic code placement
   - `semantic_reviewer` — test names match logic, function names match behavior
5. **Merge findings** (orchestrator) — orchestrator merges sub-reviewer findings, final pass/fail
6. **Refactor** — clean up conventions, no behavior change
7. **Validator** — full suite: TypeScript → tests → build

### PR Creation

Create a pull request from `pipeline/feature-<issue-number>` to `main`. Delegate to `agentic-pipeline-finalization` skill's `[open-pr]` step which handles title prefix, body format, draft/ready logic, and test count.

Labels updated: `in-progress` removed, `in-review` added.

This operation is always non-agentic (no LLM involved).

### Auto-Merge

The agent includes `READY TO MERGE` in the PR body. The `auto-assign-next.yml` workflow (triggered on `pull_request: [opened, synchronize]`) detects this and enables GitHub native auto-merge via a PAT token. The merge is attributed to the PAT, so the downstream `pull_request: [closed]` event triggers `auto-assign-next.yml` to close the issue and dispatch the next task.

Skip `READY TO MERGE` when the issue requires human input or the orchestrator judges the pipeline hit significant churn (repeated failure loops, heavy review findings, multiple implementer do-overs). Post a PR comment with the reason.
