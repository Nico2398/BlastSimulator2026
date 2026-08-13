---
name: agentic-autonomous-pipeline
description: >
  Agentic autonomous TDD development pipeline. Runs under Claude Code or OpenCode, from a CLI
  session or GitHub Actions. Use when setting up, debugging, or modifying the autonomous
  pipeline system.
---

# Autonomous Pipeline

One human input drives this system: a GitHub issue. Everything after it — picking the issue up, planning, the TDD cycle, review, verification, the pull request, and moving on to the next issue — happens with nobody in the loop.

## Execution Model

The pipeline runs as an **Orchestrator Agent** (`orchestrator`) invoked by a developer or by a GitHub Actions workflow. The orchestrator writes no code — it delegates to sub-agents in the correct TDD sequence, passing context forward between steps.

| Runtime | Entry point | Delegation mechanism |
|---------|-------------|---------------------|
| Claude Code, CLI | `/resolve-issue <issue>` — forks into the `orchestrator` agent | `Agent` tool, one sub-agent per pipeline step |
| Claude Code, GitHub Actions | `claude-runner.yml` → `/agentic-run <entity> <trigger context>` — forks into the `orchestrator` agent | `Agent` tool |
| OpenCode, CLI | `opencode run /resolve-issue` | `task` tool |
| OpenCode, GitHub Actions | `opencode-runner.yml` → `opencode github run` | `task` tool |

Both runners land in the orchestrator on their first action, and the configuration each depends on to do that differs — `references/runtime-parity.md` holds it.

The command's argument opens with a single-line entity reference (`issue 42`, `pr 17`) followed by the trigger context, so the fork knows what it is working on even if the multi-line remainder does not survive argument substitution. When the remainder is missing the orchestrator reads the thread with `gh`.

## ▶ A runner session gets exactly one turn

Both runners are single-shot: the harness sends one message, the agent works until it stops producing tool calls, and the process exits. **There is no second turn.** Anything the session was waiting for when it ended is never delivered, and the runner's disk — every `pipeline/*` branch not yet pushed — is discarded with the VM.

Two rules follow, and they hold under every runtime:

1. **Parallel means several delegations issued in one message and awaited together in that same turn.** Never work launched now and collected later, whatever background or notify-me-when-done mode the runtime offers.
2. **A turn ends on a pull request whose CI has reported green, an `ESCALATED:` line, or the `blocked` label** — never on outstanding work.

The single turn is also why the CI verdict has to be read inside it. The channels CI owns report minutes after the pull request opens, and a red one is announced to nobody: `agentic-auto-merge.yml` declines a failed CI run, and the watchdog skips any issue with a linked pull request. So the run waits for the report — `agentic-pipeline-finalization`'s `[await-ci]` step, which blocks in-turn and returns to the session that called it. Waiting on an event that returns to you is not the outstanding work rule 1 forbids; it is the last verification channel being read. `agentic-ci-failure.yml` covers the session that dies before it returns, and `references/github-loop.md` holds how.

The runtimes disagree on what delegation defaults to, so the same sentence produces opposite behaviour depending on where it is read. Each runtime's own configuration layer enforces the rule; `references/runtime-parity.md` records which layer, and the run that died proving it necessary.

## ▶ Branch namespace — solution-independent

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

## ▶ Branch isolation

Critical to unbiased implementation: test code and implementation code never mix during development.

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
7. **Resolve conflicts** if the cherry-pick fails — a conflict resolver agent merges both sides and stages the result; on resolution failure the implementer re-runs
8. **All subsequent quality gates** run on `pipeline/feature-<issue-number>`

## What the loop stops for

Autonomy is measured by what the pipeline can finish without a human, and every halt costs more than its own run: an issue holds `in-progress` until its run produces a merged PR or releases it, so a stopped run defers every later assignment behind it. A halt has to earn that. Which open questions are decisions to take and which five are genuine blockers: `agentic-decision-autonomy`.

## Where the rest lives

| Subject | Where |
|---------|-------|
| Issue in, pull request out — intake, assignment, single flight, rescue, watchdog, the tokens the loop depends on | `references/github-loop.md` |
| Runtime parity — the three config trees, per-runtime delegation defaults, Claude Code prerequisites | `references/runtime-parity.md` |
| Per-pipeline step sequences | `agentic-pipeline-full`, `agentic-pipeline-fix-bug`, `agentic-pipeline-multi`, `agentic-pipeline-review-pr`, `agentic-pipeline-ask`, `agentic-pipeline-executor`, `agentic-pipeline-ci-fix` |
| TDD cycle, finalization, PR status | `agentic-pipeline-tdd`, `agentic-pipeline-finalization`, `agentic-pipeline-pr-management` |
| Writing an issue the pipeline can consume | `agentic-issue-creation` |
| Editing any of these context files | `agentic-context-edition` |
| Editing the workflows, composite actions and decision modules that run all of this | `agentic-workflow-edition` — no timer, which token raises which event, fail closed and loud |
