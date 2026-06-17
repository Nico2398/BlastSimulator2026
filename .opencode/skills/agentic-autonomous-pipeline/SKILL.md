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

For detailed pipeline steps (quality gates, code review, refactoring, validation, PR creation), see the individual pipeline skills:
- `agentic-pipeline-full` — Full feature/visual-change pipeline
- `agentic-pipeline-fix-bug` — Bug fix pipeline
- `agentic-pipeline-finalization` — Final quality gates through PR

### Auto-Merge

The orchestrator includes `READY TO MERGE` in the PR body when PR status is `ready`. The `auto-assign-next.yml` workflow (triggered on `pull_request: [opened, synchronize]`) detects this and enables GitHub native auto-merge via a PAT token. See `agentic-pipeline-pr-management` for draft vs ready logic.
