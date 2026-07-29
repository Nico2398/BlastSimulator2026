# The GitHub Actions autonomy loop

How a filed issue becomes a merged pull request with nobody watching, and every mechanism that keeps the chain from going quiet.

```
issue filed / reopened / labelled `ready`        merged PR        hourly sweep        manual dispatch
      │                                               │                 │                    │
      ▼                                               ▼                 ▼                    ▼
agentic-intake.yml                          auto-assign-next.yml  agentic-watchdog.yml  agentic-trigger.yml
      └──────────────────────────────┬────────────────┴─────────────────┴────────────────────┘
                                     ▼
                        [agentic-assign] oldest unblocked `ready` issue
                                     │  ready → in-progress, then post the assignment comment
                                     ▼
                  "<mention> — autonomous pipeline assignment for issue #N …"
                                     │  the comment IS the trigger
                                     ▼
             claude-runner.yml  ─or─  opencode-runner.yml   (whichever mention matched)
                                     │  orchestrator → pipeline skill → TDD → PR with
                                     │  `Closes #N` + `READY TO MERGE`
                                     ▼
                              auto-assign-next.yml
                                     │  enables auto-merge → CI → merge → close #N, label `done`
                                     └─ [agentic-assign] next `ready` issue → back to the top
```

## Four ways in, and why each exists

| Entry | Fires on | Covers |
|-------|----------|--------|
| `agentic-intake.yml` | `issues: opened, reopened, labeled` | The only human input. A filed issue starts a run by itself; a `ready` label on a previously `blocked` issue is the whole resume procedure |
| `auto-assign-next.yml` | `pull_request: opened, synchronize, closed` | Auto-merge on `READY TO MERGE`, then chain from the merge to the next issue |
| `agentic-watchdog.yml` | hourly schedule | Sweeps stalled runs, then restarts the queue if the pipeline is idle |
| `agentic-trigger.yml` | manual dispatch | A human forcing the queue forward |

Events get lost — GitHub keeps one pending run per concurrency group and drops the next, a webhook can be missed, a run can end without chaining. Every entry above except the watchdog is event-driven, which is why the watchdog also assigns: it is the only mechanism on a clock, so it is the floor under the queue. At worst an idle pipeline with ready issues restarts itself within the hour.

## Issue labels are the loop's state machine

| Label | Means | Applied by | Cleared by |
|-------|-------|-----------|-----------|
| `agent-task` | The pipeline owns this issue | Intake, or the issue form | — |
| `ready` | Waiting in the assignment queue | Intake, the issue form, or a human unblocking | `agentic-assign`, on assignment |
| `in-progress` | A run owns it. Single flight reads this label | `agentic-assign` | The merged-PR chain, the run itself when its deliverable is not a diff, or the watchdog |
| `blocked` | Halted; a human has to answer something | The run, or the watchdog | A human, by adding `ready` |
| `done` | Finished | The merged-PR chain, or a run releasing a non-PR deliverable | — |
| `decision-review` | A default the run chose, revisit at leisure. Carries no `ready`, so it never enters the queue | The run — see `agentic-decision-autonomy` | A human, by adding `ready` |

Intake labels an issue `agent-task` + `ready` only when it carries none of these. A human filing from the web form, from a phone, or through the API produces different labels each way and often none at all, and `agentic-assign` selects on `ready` alone — an unlabelled issue would otherwise be invisible to the pipeline forever.

**An issue is released by whoever finishes it.** A run whose deliverable is a pull request is released by the merge. A run whose deliverable is an answer or an executed command releases its own issue — closes it, labels it `done`, drops `in-progress`. Skipping that leaves single flight deferring behind a run that already succeeded, until the watchdog ages it out and reports it as lost.

## Two rules keep the loop alive

1. **Comments must be posted with `PAT_TOKEN_COPILOT_AUTOMATION`.** A comment created with `GITHUB_TOKEN` triggers no workflow, so the loop stops silently. The same applies to the PR: one opened with `GITHUB_TOKEN` raises no `pull_request` event, leaving `auto-assign-next.yml` dormant. The inverse is also load-bearing: intake labels with `GITHUB_TOKEN` precisely so its own `ready` label raises no event and the workflow cannot retrigger itself.
2. **The assignment comment carries the whole assignment.** It names the issue, mandates orchestrator-first delegation, states the branch names, the verification expectation, and the PR conventions. Its text is identical for every agent apart from the mention on the first line — the runtimes read the same instructions.

An issue the agent closes without opening a PR raises no `pull_request` event either, so each runner ends with its own chaining step for exactly that case.

## Single flight

Two agent sessions must never run at once — they would compete over the same `pipeline/*` branch names and the same working tree. Two independent mechanisms enforce it:

- **`agentic-assign` defers.** An issue keeps `in-progress` until its run is finished, so any *other* issue still carrying that label means a run is live. The action logs why and assigns nothing; finishing the outstanding run re-enters the step. It defers whether or not that issue has a linked PR, and **it never diagnoses**: a run 40 seconds old and a run that died hours ago look identical from the labels alone, so declaring one lost belongs to the watchdog, which is the only mechanism that ages it. `agentic-assign` used to comment "Pipeline halted — no linked PR was created" on sight, which it posted on #404 while that run was one minute into a two-hour session.
- **Intake serialises its assignments** through a job-level `agentic-assignment` concurrency group. The single-flight check reads the `in-progress` label, so parallel intakes — one per issue when a human files a batch in one sitting — would each read the list before any of them writes to it, and every one would assign. Labelling stays outside the group: a dropped run there would cost an issue its `ready` label and make it invisible, while a dropped assignment costs nothing the hourly sweep does not pick back up.
- **The runners share a `concurrency` group** named `agentic-runner`, declared identically in `claude-runner.yml` and `opencode-runner.yml`. Concurrency groups are repo-wide, so the two runners serialise against each other as well as themselves. `cancel-in-progress: false` — a queued run waits rather than killing the live one. GitHub keeps only one run pending per group; a third is dropped, which the watchdog's idle restart then recovers.

## Halt conditions

The loop stops deliberately when an issue is labelled `blocked`, while an issue is still `in-progress` (single flight), or when no unblocked `ready` issue remains. `handle-failure.yml` comments on `blocked` issues with the resume procedure — add `ready`, and intake takes it from there.

A run that dies without labelling anything — OOM, a hung tool call, the job timeout, a revoked token, a turn ended on outstanding work — would otherwise leave its issue `in-progress` forever and halt the chain silently. `agentic-watchdog.yml` sweeps hourly: an issue `in-progress` past `AGENTIC_STALL_MINUTES` with no linked PR is commented on, labelled `blocked`, and stripped of `in-progress`. That labelling is what surfaces the failure, so the watchdog must use the PAT — a label applied with `GITHUB_TOKEN` raises no `issues: labeled` event and `handle-failure.yml` would never fire.

**The watchdog is the only mechanism allowed to declare a run lost.** It is the only one that ages the run against a threshold; every other step defers instead of diagnosing. Two mechanisms declaring death from the same evidence produce contradictory comments on a healthy run.

## Rescue: a run that ends early must not end silently

Intent is not a mechanism, so `agentic-rescue` runs after the agent step in both runners, with `if: always()` — it also covers the crash, the 180-minute timeout and the cancelled run, none of which the agent can write instructions for. It pushes `pipeline/feature-<N>` if commits exist on it and opens a **draft** PR carrying `Closes #<N>` and no `READY TO MERGE`; when no feature branch was ever produced, it comments on the issue saying so. Either way the failure becomes visible immediately and the work survives, instead of surfacing hours later as a watchdog sweep over an issue whose branches no longer exist.

The rescue PR is a diagnosis, not a deliverable: it is unreviewed and unvalidated by definition, and it deliberately holds the chain (an in-progress issue with a linked PR defers assignment) until a human decides whether to finish it or drop it.

## Dependencies between issues

`agentic-assign` skips an issue whose declared dependencies are still open, in either spelling the issue templates produce — a `Blocked by` section or an inline `Depends on: #N`. Every `#N` in that section counts, and a dependency that does not exist is ignored rather than treated as blocking.

## Repository variables

| Variable | Values | Effect |
|----------|--------|--------|
| `AGENTIC_AGENT` | `@claude` / `@opencode` (leading `@` and case optional; unset means `@opencode`) | The agent that assignment comments address, and therefore the runner workflow that starts |
| `AGENTIC_AUTO_ASSIGN_ENABLED` | `true` / anything else | Whether a finished issue chains to the next ready one, and whether the watchdog restarts an idle queue |
| `AGENTIC_AUTO_MERGE_ENABLED` | `true` / anything else | Whether a `READY TO MERGE` PR gets GitHub native auto-merge |
| `AGENTIC_STALL_MINUTES` | minutes, default `240` | How long an issue may stay `in-progress` without a linked PR before the watchdog marks it `blocked` |

Switching agents is a one-value change: set `AGENTIC_AGENT` to `@claude` and every subsequent assignment comment mentions `@claude`, waking `claude-runner.yml` instead of `opencode-runner.yml`. Both runners stay enabled either way, so a human can still summon the other runtime by commenting its mention by hand. An unrecognised value fails the assignment step loudly rather than silently picking a default.

## Auto-merge

The orchestrator includes `READY TO MERGE` in the PR body when PR status is `ready`. `auto-assign-next.yml` (triggered on `pull_request: [opened, synchronize]`) detects this and enables GitHub native auto-merge via the PAT. Draft versus ready logic: `agentic-pipeline-pr-management`.

## Shared composite actions

They live in `.github/actions/`: `agentic-prompt` builds the trigger context both runners hand to their agent, `agentic-assign` picks and assigns the next issue, `agentic-rescue` salvages a feature branch from a run that ended before opening its PR.
