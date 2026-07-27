---
name: agentic-autonomous-pipeline
description: >
  Agentic autonomous TDD development pipeline. Runs under Claude Code or OpenCode, from a CLI
  session or GitHub Actions. Use when setting up, debugging, or modifying the autonomous
  pipeline system.
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

The pipeline runs as an **Orchestrator Agent** (`orchestrator` agent) invoked by the developer or by a GitHub Actions workflow. The orchestrator does NOT write code — it delegates to sub-agents in the correct TDD sequence, passing context forward between steps.

| Runtime | Entry point | Delegation mechanism |
|---------|-------------|---------------------|
| Claude Code, CLI | `/resolve-issue <issue>` — forks into the `orchestrator` agent | `Agent` tool, one sub-agent per pipeline step |
| Claude Code, GitHub Actions | `.github/workflows/claude-runner.yml` → `/agentic-run <entity> <trigger context>` — forks into the `orchestrator` agent | `Agent` tool |
| OpenCode, CLI | `opencode run /resolve-issue` | `task` tool |
| OpenCode, GitHub Actions | `.github/workflows/opencode-runner.yml` → `opencode github run` | `task` tool |

Both runners must land in the orchestrator on their first action, and they get there differently:

- **OpenCode** sets `default_agent: orchestrator` in `.opencode/opencode.json`, so the session *is* the orchestrator from turn one.
- **Claude Code** has no equivalent setting. `claude-runner.yml` prefixes the task with `/agentic-run`, a command whose `agent: orchestrator` + `context: fork` frontmatter forks the session into the orchestrator before the first tool call. No main-session hop, and no chance of the default agent starting the work itself.

The command's argument opens with a single-line entity reference (`issue 42`, `pr 17`) followed by the trigger context, so the fork knows what it is working on even if the multi-line remainder does not survive argument substitution. When the remainder is missing the orchestrator reads the thread with `gh`.

### Branch namespace — solution-independent

Every AI solution wants to name branches its own way, and several create one before the agent gets control. The pipeline owns the `pipeline/` namespace and ignores all of them.

| Branch | Owner | Role |
|--------|-------|------|
| `pipeline/tests-<N>`, `pipeline/impl-<N>`, `pipeline/feature-<N>` | The orchestrator, via plain git | The only branches the pipeline uses. `pipeline/feature-<N>` is always the PR head. |
| `pipeline/scratch-*` | `claude-code-action` (`branch_prefix`) | A harness branch, never the deliverable |
| `copilot/*` | GitHub Copilot coding agent | A harness branch, never the deliverable |
| anything else | Whatever runtime is in use | A harness branch, never the deliverable |

Three rules make this hold under any solution:

1. **Branch from `main` by name, never from `HEAD`.** `git checkout -b pipeline/tests-<N> main` is unaffected by whatever the harness checked out. Runners clone with `fetch-depth: 0` and materialise a local `main` first, because `git rev-parse main` fails when only `origin/main` exists — which is exactly what a PR-review-comment checkout leaves behind.
2. **`branch-sanity` before every agent step.** `git branch --show-current` must match the expected pipeline branch; if it does not, check it out before continuing. This catches a harness that switched branches underneath the run.
3. **The PR head is always `pipeline/feature-<N>`.** Never open a PR from a harness branch, even when the harness offers to.

Harness prefixes are also skipped by `claude-code-review.yml`, so a stray branch cannot trigger a review of itself.

**Model.** Claude runs on `claude-sonnet-5`, set through `claude_args` in `claude-runner.yml`. Every agent inherits it; no agent definition pins a model of its own.

### Claude Code prerequisites

Delegation depends on configuration that is off by default:

- **Nested spawning.** A subagent cannot spawn subagents unless `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is set in `.claude/settings.json`. Without it the orchestrator does every step itself, collapsing branch isolation and the whole TDD guarantee.
- **Tool budgets.** Each agent's `tools` / `disallowedTools` frontmatter is the enforcement layer. The orchestrator is denied `Edit` and `Write`; read-only reviewers get no write tools at all.
- **Preloaded skills.** Each specialist declares its domain skills in `skills:` frontmatter, so it starts with the spec already in context.

Verify all three with `npm run validate:context`.

## Choosing the autonomous agent

One repository variable decides which runtime answers the pipeline:

| Variable | Values | Effect |
|----------|--------|--------|
| `AGENTIC_AGENT` | `@claude` / `@opencode` (leading `@` and case optional; unset means `@opencode`) | The agent that assignment comments address, and therefore the runner workflow that starts |
| `AGENTIC_AUTO_ASSIGN_ENABLED` | `true` / anything else | Whether a finished issue chains to the next ready one |
| `AGENTIC_AUTO_MERGE_ENABLED` | `true` / anything else | Whether a `READY TO MERGE` PR gets GitHub native auto-merge |
| `AGENTIC_STALL_MINUTES` | minutes, default `240` | How long an issue may stay `in-progress` without a linked PR before the watchdog marks it `blocked` |

Switching agents is a one-value change: set `AGENTIC_AGENT` to `@claude` and every subsequent assignment comment mentions `@claude`, waking `claude-runner.yml` instead of `opencode-runner.yml`. Both runners stay enabled either way, so a human can still summon the other runtime by commenting its mention by hand. An unrecognised value fails the assignment step loudly rather than silently picking a default.

## The GitHub Actions autonomy loop

```
"Pipeline: run the configured agent…" (manual dispatch)
      │
      ▼
[agentic-assign] pick oldest unblocked `ready` issue
      │  ready → in-progress, then post the assignment comment
      ▼
"<mention> — autonomous pipeline assignment for issue #N …"
      │  the comment IS the trigger
      ▼
claude-runner.yml  ─or─  opencode-runner.yml   (whichever mention matched)
      │  orchestrator → pipeline skill → TDD → PR with `Closes #N` + `READY TO MERGE`
      ▼
auto-assign-next.yml
      │  enables auto-merge → CI → merge → close #N, label `done`
      └─ [agentic-assign] next `ready` issue → back to the top
```

Two rules keep the loop alive:

1. **Comments must be posted with `PAT_TOKEN_COPILOT_AUTOMATION`.** A comment created with `GITHUB_TOKEN` triggers no workflow, so the loop stops silently. The same applies to the PR: one opened with `GITHUB_TOKEN` raises no `pull_request` event, leaving `auto-assign-next.yml` dormant.
2. **The assignment comment carries the whole assignment.** It names the issue, mandates orchestrator-first delegation, states the branch names, the verification expectation, and the PR conventions. Its text is identical for every agent apart from the mention on the first line — the runtimes read the same instructions.

An issue the agent closes without opening a PR raises no `pull_request` event either, so each runner ends with its own chaining step for exactly that case.

### Single flight

Two agent sessions must never run at once — they would compete over the same `pipeline/*` branch names and the same working tree. Two independent mechanisms enforce it:

- **`agentic-assign` defers.** An issue keeps `in-progress` until its PR merges, so any *other* issue still carrying that label means a run is live. The action logs why and assigns nothing; merging the outstanding PR re-enters the step.
- **The runners share a `concurrency` group** named `agentic-runner`, declared identically in `claude-runner.yml` and `opencode-runner.yml`. Concurrency groups are repo-wide, so the two runners serialise against each other as well as themselves. `cancel-in-progress: false` — a queued run waits rather than killing the live one. GitHub keeps only one run pending per group; a third is dropped, which is correct here since a dropped assignment is re-derived from the labels on the next merge.

### Halt conditions

The loop stops deliberately when an issue is labelled `blocked`, when an issue is `in-progress` with no linked PR (a lost run), or when no unblocked `ready` issue remains. `handle-failure.yml` comments on `blocked` issues with the resume procedure.

A run that dies without labelling anything — OOM, a hung tool call, the job timeout, a revoked token — would otherwise leave its issue `in-progress` forever and halt the chain silently. `agentic-watchdog.yml` sweeps hourly: an issue `in-progress` past `AGENTIC_STALL_MINUTES` with no linked PR is commented on, labelled `blocked`, and stripped of `in-progress`. That labelling is what surfaces the failure, so the watchdog must use the PAT — a label applied with `GITHUB_TOKEN` raises no `issues: labeled` event and `handle-failure.yml` would never fire.

The shared composite actions live in `.github/actions/`: `agentic-prompt` builds the trigger context both runners hand to their agent, `agentic-assign` picks and assigns the next issue.

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
