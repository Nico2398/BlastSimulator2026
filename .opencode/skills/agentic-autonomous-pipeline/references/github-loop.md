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
                                     │  [agentic-run-state]  settled nothing? one more attempt
                                     │  [agentic-rescue]     still nothing? push what exists,
                                     │                       report it, label the issue `blocked`
                                     ▼
                              auto-assign-next.yml
                                     │  enables auto-merge → CI → merge → close #N, label `done`
                                     └─ [agentic-assign] next `ready` issue → back to the top
```

## Four ways in, and why each exists

| Entry | Fires on | Covers |
|-------|----------|--------|
| `agentic-intake.yml` | `issues: opened, reopened, labeled` | The only human input, but filing alone does not start a run — `ready` does, whether it arrives with the issue (the form's own `labels:` default, or an agent authoring the issue per `agentic-issue-creation`) or a human adds it later. A `ready` label on a previously `blocked` issue is the whole resume procedure |
| `auto-assign-next.yml` | `pull_request: opened, synchronize, closed` | Auto-merge on `READY TO MERGE`, then chain from the merge to the next issue |
| `agentic-watchdog.yml` | hourly schedule | Sweeps stalled runs, then restarts the queue if the pipeline is idle |
| `agentic-trigger.yml` | manual dispatch | A human forcing the queue forward |

Events get lost — GitHub keeps one pending run per concurrency group and drops the next, a webhook can be missed, a run can end without chaining. Every entry above except the watchdog is event-driven, which is why the watchdog also assigns: it is the only mechanism on a clock, so it is the floor under the queue. At worst an idle pipeline with ready issues restarts itself within the hour.

## Issue labels are the loop's state machine

| Label | Means | Applied by | Cleared by |
|-------|-------|-----------|-----------|
| `agent-task` | The pipeline owns this issue | The issue form, or an agent authoring the issue | — |
| `ready` | Waiting in the assignment queue | The issue form, an agent authoring the issue, or a human adding it by hand | `agentic-assign`, on assignment |
| `in-progress` | A run owns it. Single flight reads this label | `agentic-assign` | The merged-PR chain, the run itself when its deliverable is not a diff, `agentic-rescue` when the run ended without finishing, or the watchdog |
| `blocked` | Halted; a human has to answer something | The run, `agentic-rescue`, or the watchdog | A human, by adding `ready` |
| `done` | Finished | The merged-PR chain, or a run releasing a non-PR deliverable | — |
| `decision-review` | A default the run chose, revisit at leisure. Carries no `ready`, so it never enters the queue | The run — see `agentic-decision-autonomy` | A human, by adding `ready` |

Intake never applies `agent-task` or `ready` itself — that would take label assignment out of the hands of whoever files the issue. `agentic-assign` selects on `ready` alone, so an issue only enters the queue once something puts `ready` on it: the "Agent Task" form's own `labels:` default, an agent following `agentic-issue-creation`, or a human adding it by hand — including to resume a `blocked` issue, or to opt a free-form/API-filed issue in. A human filing without the form and without `ready` gets an issue that sits unlabelled and out of the queue until they choose to add it; that is deliberate, not an oversight.

**An issue is released by whoever finishes it.** A run whose deliverable is a pull request is released by the merge. A run whose deliverable is an answer or an executed command releases its own issue — closes it, labels it `done`, drops `in-progress`. Skipping that leaves single flight deferring behind a run that already succeeded, until the watchdog ages it out and reports it as lost.

## Two rules keep the loop alive

1. **Comments must be posted with `PAT_TOKEN_COPILOT_AUTOMATION`.** A comment created with `GITHUB_TOKEN` triggers no workflow, so the loop stops silently. The same applies to the PR: one opened with `GITHUB_TOKEN` raises no `pull_request` event, leaving `auto-assign-next.yml` dormant. The inverse is also load-bearing: the `label` job's own housekeeping (ensuring the label definitions exist, dropping a stale `done` on reopen) runs under `GITHUB_TOKEN` precisely so it raises no event the workflow could retrigger on — intake itself never applies `ready`, so this only matters for the labels it does still touch. The rule reaches `git push`, where it has to be enforced differently: `git push` reads no token from the environment, so a step that merely sets `GH_TOKEN` pushes with whatever credential the job's git configuration holds — and after the agent step that is the agent's own GitHub App token, which no `permissions:` block can grant `workflows` to, because there is no such key. A branch differing from `main` on a workflow file is then rejected outright. `agentic-rescue` pushes to an explicitly authenticated URL so the PAT is the credential actually used.

   **The agent step needs the PAT stated twice.** `claude-code-action` exports its own `github_token` input into the session environment, overriding the step-level `GH_TOKEN` — so that input is the identity `gh pr create` actually runs under. Left as `GITHUB_TOKEN`, the PR is authored by `github-actions[bot]`, and GitHub creates its `pull_request` workflow runs already parked as `action_required`: "N workflows awaiting approval", no CI, no `auto-assign-next.yml`. Both `claude-code-action` steps in `claude-runner.yml` therefore pass `PAT_TOKEN_COPILOT_AUTOMATION` as `github_token`. `opencode-runner.yml` needs no equivalent — opencode reads `GH_TOKEN` from the step environment and overrides nothing.

   **A consequence to respect:** under the PAT, everything the session posts is authored by a real user rather than a bot, and the runners' trigger guard filters on `comment.user.type != 'Bot'`. An agent-authored comment containing the agent's own mention would therefore wake a new run. No pipeline comment may contain `@claude` or `@opencode` — the assignment comment is the only comment allowed to carry a mention.
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

**Only a step that can see the run end may declare it lost.** That is a rule about evidence, not about seniority. `agentic-assign` sees labels alone, where a run 40 seconds old and one that died hours ago are indistinguishable, so it defers and never diagnoses. The watchdog ages the run against a threshold, which is inference — correct, but hours late. The runners' own post-agent steps have the one thing neither has: they run *after* the session is over, in the same job, so "this run finished and produced nothing" is an observation. They are allowed to settle the issue for that reason, and the watchdog remains the floor for the runs that never got that far — a job killed before its post-steps, a dropped webhook.

## The run is retried before it is written off

A session can end early for reasons no instruction reaches: a backgrounded delegation whose notification never arrives, a crash in the first minutes, a transient API error, a model that simply stops. Every one of those wastes a whole assignment and, before the retry existed, a whole day — #404 waited four hours for a watchdog sweep, and #406 sat `in-progress` after dying in 58 seconds.

`agentic-run-state` answers one question after the agent step: is the issue in a terminal state? Terminal means a linked pull request, a `blocked` label, or a closed issue. Anything else means the session stopped with the work unfinished, and the runner starts one more attempt in the same job — carrying what went wrong, an inventory of the `pipeline/*-<N>` branches the previous attempt left on disk (never pushed, so visible nowhere else), and the rule that most often broke it. The retry is gated on the clock as well: with less than `min_remaining_minutes` of the job budget left, the run is written off rather than cut off mid-work, because a cancelled job takes its unpushed branches with it.

One retry, not three. A real run takes over two hours, so a second attempt is all a 360-minute budget holds — and the failures worth retrying die early and leave the whole budget behind.

## Rescue: a run that ends early must not end silently

Intent is not a mechanism, so `agentic-rescue` runs last in both runners, with `if: always()` — it also covers the crash, the job timeout and the cancelled run, none of which the agent can write instructions for. It pushes `pipeline/feature-<N>` if commits exist on it and opens a **draft** PR carrying `Closes #<N>` and no `READY TO MERGE`; when no feature branch was produced, or the branch is empty, it comments on the issue saying so. A push it cannot complete is reported too, with the rejection, the commit list and the diffstat of what is being lost: a step that ends on `::error::` alone leaves exactly the silence this action exists to prevent, since the job log is not somewhere anyone is watching. Either way the failure becomes visible immediately and the work survives, instead of surfacing hours later as a watchdog sweep over an issue whose branches no longer exist.

**Every outcome here labels the issue `blocked`**, because reaching this step at all means the run did not finish it — and by then the session is over, so there is nothing left to wait for. That includes the successful rescue: an issue left `in-progress` with a draft PR attached passes both the single-flight check *and* the watchdog's linked-PR skip, so it would hold the queue for as long as the draft stayed open. `blocked` is the honest state — work preserved, human notified by `handle-failure.yml`, queue released. It is applied once and only to an issue that is still open and not already `blocked`: a run whose deliverable was an answer has closed its own issue, and re-labelling an escalated one would fire a second notification for the same failure.

The rescue PR is a diagnosis, not a deliverable: unreviewed and unvalidated by definition. Finishing it or dropping it is a human decision, and adding `ready` back to the issue is the whole resume procedure.

**An escalation does not chain to the next issue, and that is deliberate.** The runner's own chaining step covers a run whose deliverable was not a diff — an issue closed and labelled `done`. A run that failed is different: chaining from it means the queue restarts as fast as runs fail, and a systemic failure (an expired token, a broken `main`) would march through the whole backlog labelling every issue `blocked` in minutes. The hourly sweep restarts the queue instead, which rate-limits the damage to one issue an hour and gives a human time to see the first notification.

## Dependencies between issues

`agentic-assign` skips an issue whose declared dependencies are still open, in either spelling the issue templates produce — a `Blocked by` section or an inline `Depends on: #N`. Every `#N` in that section counts, and a dependency that does not exist is ignored rather than treated as blocking.

## Repository variables

| Variable | Values | Effect |
|----------|--------|--------|
| `AGENTIC_AGENT` | `@claude` / `@opencode` (leading `@` and case optional; unset means `@opencode`) | The agent that assignment comments address, and therefore the runner workflow that starts |
| `AGENTIC_AUTO_ASSIGN_ENABLED` | `true` / anything else | Whether a finished issue chains to the next ready one, and whether the watchdog restarts an idle queue |
| `AGENTIC_AUTO_MERGE_ENABLED` | `true` / anything else | Whether a `READY TO MERGE` PR gets GitHub native auto-merge |
| `AGENTIC_STALL_MINUTES` | minutes, default `420`; a value below the runners' 360-minute job timeout is clamped up to it | How long an issue may stay `in-progress` without a linked PR before the watchdog marks it `blocked`. Below the job timeout it would sweep live runs |

Switching agents is a one-value change: set `AGENTIC_AGENT` to `@claude` and every subsequent assignment comment mentions `@claude`, waking `claude-runner.yml` instead of `opencode-runner.yml`. Both runners stay enabled either way, so a human can still summon the other runtime by commenting its mention by hand. An unrecognised value fails the assignment step loudly rather than silently picking a default.

## Auto-merge

The orchestrator includes `READY TO MERGE` in the PR body when PR status is `ready`. `agentic-auto-merge` reads that marker, releases any workflow run parked as `action_required` on the PR head, and enables GitHub native auto-merge via the PAT. Draft versus ready logic: `agentic-pipeline-pr-management`.

**The marker decides, never the account.** A PR authored by `github-actions[bot]` raises `pull_request` workflow runs that GitHub creates and immediately parks as `action_required`. Nothing runs: not CI, not the auto-merge step. PR #430 sat open that way, fully verified and marked, with zero checks and no auto-merge, holding its issue and the queue behind it. The runners now pass the PAT as the agent step's `github_token` so every pipeline PR is authored by a real user and its runs start unprompted — but the parked-run release stays, because a PR opened by hand with `GITHUB_TOKEN`, or by an older workflow, still lands parked, and selection here must never branch on who opened a PR.

The fix is not a poller. It is that **the run which opens the PR arms it, in the same job**:

| Entry | Fires on | Covers |
|-------|----------|--------|
| Both runners, `Arm auto-merge on the PR this run opened` | The run itself, after the agent step and after `agentic-rescue`, with `always()` | Every PR the pipeline opens, whatever account it ends up attributed to. The step reads the marker off `pipeline/feature-<N>` — the branch the assignment told the run to build |
| `auto-assign-next.yml` | `pull_request: opened, synchronize, reopened, edited, ready_for_review` | The marker arriving after the PR did — a body edited, a draft marked ready. Only reached when the author's events are not gated |
| `agentic-auto-merge.yml` | `workflow_run` on CI completing | The moment the PR actually becomes mergeable. Every other entry fires while the checks are still running, and CI finishing raises no `pull_request` event, so without this the last word on a PR is always spoken before its last check reports |
| `agentic-auto-merge.yml` | manual dispatch | A PR stranded by an older run, or by a job cancelled before its arming step. Still not a clock: both triggers react to something |

All four call the same composite action, so they cannot disagree about what "ready to merge" means. Selection is the marker on a line of its own plus a non-draft PR; the author is logged and never branched on. The action also releases any workflow run parked as `action_required` on the PR head, which is what makes CI start at all on a bot-authored PR — that needs `actions: write` on the PAT, and without it the step still enables auto-merge, warns naming the missing scope, and the PR waits on checks that never start.

**Every refusal is decided on the PR's state, never on the wording of the error.** GitHub declines native auto-merge on a PR that has nothing left to wait for and on a repository with the feature switched off, so the action falls back to merging the PR itself: it waits for `mergeable_state` to settle — `unknown` is what a PR reports in the seconds after it was opened, which is exactly when the runner arms it — and merges on `clean`. `dirty` and `behind` end the wait immediately, since neither resolves on its own.

**On this repository the fallback is not the exception, it is the path.** `main` requires no status check, so a PR is mergeable the moment it opens and GitHub refuses native auto-merge on every pipeline PR — `Pull request is in unstable status`, meaning there is nothing left for auto-merge to wait on. Every merge therefore happens inside the action, which makes *when the action runs* the whole mechanism. PR #499 was verified on all five channels, marked, and green, and sat open anyway: armed once at `opened`, it polled its 10-minute settle budget while the `full-ci` browser jobs still had 35 minutes to run, reported the PR stuck, and was never swept again. That is what the `workflow_run` entry above is for.

**A check still running and a check that failed are not the same answer.** `unstable` and `blocked` cover both, so the verdict reads the head's check runs alongside `mergeable_state`: a failure is stuck immediately rather than polled out, and a run still in flight is `pending` — reported, not failed, and left to the CI-completion sweep. The settle budget is for mergeability that GitHub has not finished computing, which resolves in seconds; it was never long enough to outlast CI and is not meant to be. A marked PR that ends neither armed nor merged **fails the step**: it holds its issue and every assignment queued behind it, and a warning in a job log is not somewhere anyone is watching. PR #434 was that PR — verified, marked, green, and never merged, because the `enablePullRequestAutoMerge` mutation named its variable `$method`, which @octokit/graphql rejects before the request leaves the runner (`method`, `url`, `baseUrl`, `headers`, `query`, `request` and `mediaType` are its own request options). Both arming paths threw on every call and both reported success.

## Shared composite actions

They live in `.github/actions/`: `agentic-prompt` builds the trigger context both runners hand to their agent, `agentic-assign` picks and assigns the next issue, `agentic-run-state` reports whether a finished session left its issue terminal and whether the remaining job budget can carry another attempt, `agentic-rescue` salvages a feature branch from a run that ended before opening its PR and settles the issue either way, and `agentic-auto-merge` puts a marked PR into auto-merge whatever account opened it, releasing any workflow run parked as `action_required` on the way.
