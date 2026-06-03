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
 └─ pipeline/tests-<issue-number>   (test branch — skeleton → tests → final code)
      └─ pipeline/impl-<issue-number>  (impl branch — forked from skeleton commit)
           └─ implementer works here, never sees tests
              ↓
         cherry-pick → lands on test branch
```

1. **Skeleton branch:** create `pipeline/tests-<issue-number>` from `main`, write empty stubs, record `skeleton_commit_sha`
2. **Fork impl branch:** create `pipeline/impl-<issue-number>` from that skeleton commit
3. **Write tests** on `pipeline/tests-<issue-number>` (test branch)
4. **Implement** on `pipeline/impl-<issue-number>` (impl branch) — agent never sees test commits
5. **Cherry-pick** the implementation commit onto `pipeline/tests-<issue-number>`
6. **Resolve conflicts** if cherry-pick fails
7. **All subsequent quality gates** run on `pipeline/tests-<issue-number>`

### Cherry-Pick + Conflict Resolution

The implementation commit is cherry-picked from the impl branch onto the test branch. If conflicts arise, a conflict resolver agent reads the conflicted files, merges both sides, removes conflict markers, and stages the resolved files. On resolution failure, the implementer re-runs.

### Quality Gates (after cherry-pick)

After the code lands on the test branch, these gates run in sequence:
1. **Test runner** (non-agentic) — run test suite, pass → continue, fail → fixer loop
2. **Duplication check** (non-agentic) — jscpd syntactic clone detection, fail → back to implementer
3. **Code review fan-out** (agentic, parallel) — specialized sub-reviewers by risk tier:
   - `security_reviewer` — exploitable vulnerabilities (full tier)
   - `quality_reviewer` — architecture, naming intent, coding conventions, TypeScript strictness (all tiers)
   - `i18n_reviewer` — hardcoded strings, locale mismatches (lite + full tiers)
   - `duplication_reviewer` — semantic duplication, non-atomic functions, generic code placement (lite + full tiers)
4. **Review coordinator** (agentic) — merges sub-reviewer findings, final pass/fail
5. **Refactor** — clean up conventions, no behavior change
6. **Validator** — full suite: TypeScript → tests → build
7. **Visual verification** (visual changes only) — screenshot comparison

### PR Creation

Create a pull request from `pipeline/tests-<issue-number>` to `main` with:
- Title prefixed by pipeline type (`feat:`, `fix:`, `docs:`)
- Body includes `Closes #<issue_number>` and validation checklist
- Labels updated: `in-progress` removed, `in-review` added

This operation is always non-agentic (no LLM involved).

### Auto-Merge

Default: **enable GitHub native auto-merge** on every PR — via `gh pr merge --auto --squash`.

Only skip auto-merge when the pipeline has explicitly flagged that human input is needed (artistic direction, critical architecture design decision). In that case, post a PR comment with the reason from the pipeline state instead. This is always non-agentic (no LLM involved).
