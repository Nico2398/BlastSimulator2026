# The GitHub Actions autonomy loop

How a filed issue becomes a merged pull request with nobody watching, and every mechanism that keeps the chain from going quiet.

```
       merged PR            run ended `blocked`         manual dispatch
            │                        │                        │
            ▼                        ▼                        ▼
   auto-assign-next.yml     handle-failure.yml        agentic-trigger.yml
            └────────────────────────┼────────────────────────┘
                                     ▼
                        [agentic-assign] oldest assignable `ready` issue
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
                                     │                                     │
                                     ▼                                     ▼
                              auto-assign-next.yml              handle-failure.yml
                                     │  merge → close #N,          │  report the failure,
                                     │  label `done`               │  then chain unless the
                                     └─ [agentic-assign] ──────────┴─ cascade brake is tripped
                                              next `ready` issue → back to the top

   the branch off that path: the PR opened, CI reported, and CI was red
            │
            ▼
   agentic-ci-failure.yml  ── on `workflow_run` CI completed + failure
            │  the run that opened the PR is normally still here, waiting on this
            │  very verdict through `[await-ci]` — so the workflow declines while
            │  any runner run is live, and `agentic-watchdog.yml` re-raises it later
            ▼
   "<mention> — CI is red on this pull request …"  → the runner, on the same PR
            │  fix on `pipeline/feature-<N>`, push, CI again
            └─ green → auto-merge → back into the loop above
               limit spent → PR to draft, issue `blocked` → handle-failure.yml
```

## Three ways in, and nothing else

| Entry | Fires on | Covers |
|-------|----------|--------|
| `agentic-trigger.yml` | manual dispatch | A human starting the pipeline on the oldest assignable `ready` issue. This is how a run begins from a standing start |
| `auto-assign-next.yml` | `pull_request: closed` with `merged == true` | Chain from the merge to the next issue. This is how a run begins from the previous one succeeding |
| `handle-failure.yml` | `issues: labeled` with `blocked` | Chain past a run that ended blocked, and report the failure. This is how a run begins from the previous one *failing* |

**Nothing else may start a session on a new issue.** Filing an issue, labelling one `ready`, reopening one, and the passage of time all leave the queue exactly where it was.

There is one path that starts a session without assigning anything, and the distinction is the whole of why it is allowed: `agentic-ci-failure.yml` hands a **pull request that already exists** back to the agent that already owns it. It selects no issue, reads no queue, and changes no label on the happy path — see "A red CI is nobody's report" below. `agentic-intake.yml` still reacts to `issues: opened, reopened`, but only to keep the label definitions present and to drop a stale `done` from a reopened issue — it assigns nothing. `agentic-watchdog.yml` still sweeps hourly, but only to release issues whose runs died; it does not restart the queue itself — the `blocked` label it applies does, through `handle-failure.yml`, which is why that label must be applied with the PAT.

**The third entry is what makes the loop closed.** A blocked run is terminal exactly as a merge is, and both outcomes have to release the queue: with only the first two entries, every failure parked the pipeline until a human dispatched the trigger, which on a repository with nobody watching means until somebody noticed. The chain from a failure is bounded rather than unconditional — see the cascade brake below.

A `ready` issue can still sit in the queue indefinitely, because nothing is scheduled to notice it. Events genuinely do get lost — GitHub keeps one pending run per concurrency group and drops the next, a webhook can be missed — and when that happens the chain stops until a human dispatches `agentic-trigger.yml`. That is the remaining trade: an idle pipeline is preferable to sessions nobody asked for.

## Issue labels are the loop's state machine

| Label | Means | Applied by | Cleared by |
|-------|-------|-----------|-----------|
| `agent-task` | The pipeline owns this issue | The issue form, or an agent authoring the issue | — |
| `ready` | Waiting in the assignment queue | The issue form, an agent authoring the issue, or a human adding it by hand | `agentic-assign`, on assignment |
| `in-progress` | A run owns it. Single flight reads this label | `agentic-assign` | The merged-PR chain, the run itself when its deliverable is not a diff, `agentic-rescue` when the run ended without finishing, or the watchdog |
| `blocked` | This run ended without finishing; a human has to answer something. The queue does not wait on it — the label is itself an entry point | The run, `agentic-rescue`, or the watchdog | A human, by adding `ready` |
| `done` | Finished | The merged-PR chain, or a run releasing a non-PR deliverable | — |
| `decision-review` | A default the run chose, revisit at leisure. Carries no `ready`, so it never enters the queue | The run — see `agentic-decision-autonomy` | A human, by adding `ready` |

Intake never applies `agent-task` or `ready` itself — that would take label assignment out of the hands of whoever files the issue. `agentic-assign` selects on `ready` alone, so an issue only becomes *selectable* once something puts `ready` on it: the "Agent Task" form's own `labels:` default, an agent following `agentic-issue-creation`, or a human adding it by hand — including to resume a `blocked` issue, or to opt a free-form/API-filed issue in.

`ready` marks an issue as **eligible**, never as **started**. The label puts it in the queue; only one of the three entries above takes it out again. This is the distinction to hold on to when reading anything below that talks about an issue "entering the queue": entering the queue is not being picked up.

**An issue is released by whoever finishes it.** A run whose deliverable is a pull request is released by the merge. A run whose deliverable is an answer or an executed command releases its own issue — closes it, labels it `done`, drops `in-progress`. Skipping that leaves single flight deferring behind a run that already succeeded, until the watchdog ages it out and reports it as lost.

## Two rules keep the loop alive

1. **Comments must be posted with `PAT_TOKEN_COPILOT_AUTOMATION`.** A comment created with `GITHUB_TOKEN` triggers no workflow, so the loop stops silently. The same applies to the PR: one opened with `GITHUB_TOKEN` raises no `pull_request` event, leaving `auto-assign-next.yml` dormant. The inverse is also load-bearing: the `label` job's own housekeeping (ensuring the label definitions exist, dropping a stale `done` on reopen) runs under `GITHUB_TOKEN` precisely so it raises no event the workflow could retrigger on — intake itself never applies `ready`, so this only matters for the labels it does still touch. The rule reaches `git push`, where it has to be enforced differently: `git push` reads no token from the environment, so a step that merely sets `GH_TOKEN` pushes with whatever credential the job's git configuration holds — and after the agent step that is the agent's own GitHub App token, which no `permissions:` block can grant `workflows` to, because there is no such key. A branch differing from `main` on a workflow file is then rejected outright. `agentic-rescue` pushes to an explicitly authenticated URL so the PAT is the credential actually used.

   **The agent step needs the PAT stated twice.** `claude-code-action` exports its own `github_token` input into the session environment, overriding the step-level `GH_TOKEN` — so that input is the identity `gh pr create` actually runs under. Left as `GITHUB_TOKEN`, the PR is authored by `github-actions[bot]`, and GitHub creates its `pull_request` workflow runs already parked as `action_required`: "N workflows awaiting approval", no CI, no `auto-assign-next.yml`. Both `claude-code-action` steps in `claude-runner.yml` therefore pass `PAT_TOKEN_COPILOT_AUTOMATION` as `github_token`. `opencode-runner.yml` needs no equivalent — opencode reads `GH_TOKEN` from the step environment and overrides nothing.

   **A consequence to respect:** under the PAT, everything the session posts is authored by a real user rather than a bot, and the runners' trigger guard filters on `comment.user.type != 'Bot'`. An agent-authored comment containing the agent's own mention would therefore wake a new run. **No comment written by an agent session may contain `@claude` or `@opencode`.** Exactly two comments in the whole system carry a mention, and both are written by a workflow rather than by a session: the assignment comment from `agentic-assign`, and the CI handback from `agentic-ci-failure.yml`. Each is a deliberate trigger, each is bounded, and each must be posted with the PAT for the same reason — under `GITHUB_TOKEN` the author is a bot and the runners filter it out, so the trigger would be written and never read.
2. **The assignment comment carries the whole assignment.** It names the issue, mandates orchestrator-first delegation, states the branch names, the verification expectation, and the PR conventions. Its text is identical for every agent apart from the mention on the first line — the runtimes read the same instructions.

An issue the agent closes without opening a PR raises no `pull_request` event either, so nothing chains from it. The runners used to carry their own step for that case; it was removed, because a run starting the next run is the pipeline deciding to run again on its own. Such a run still *releases* its issue — closes it, labels it `done`, drops `in-progress` — so the queue is free the moment somebody asks for the next one.

## Single flight

Two agent sessions must never run at once — they would compete over the same `pipeline/*` branch names and the same working tree. Two independent mechanisms enforce it:

- **`agentic-assign` defers.** An issue keeps `in-progress` until its run is finished, so any *other* issue still carrying that label means a run is live. The action logs why and assigns nothing; finishing the outstanding run re-enters the step. It defers whether or not that issue has a linked PR, and **it never diagnoses**: a run 40 seconds old and a run that died hours ago look identical from the labels alone, so declaring one lost belongs to the watchdog, which is the only mechanism that ages it. `agentic-assign` used to comment "Pipeline halted — no linked PR was created" on sight, which it posted on #404 while that run was one minute into a two-hour session.
- **The entries share a concurrency group.** Two of them could once be argued safe by construction — a manual dispatch is one act by one human, and the merged-PR chain fires once per merge. A third entry ends that argument: a merge and a `blocked` label can land in the same second, and each would read `in-progress` before either wrote it. Every assigning job therefore declares `concurrency: agentic-assignment`, repo-wide, `cancel-in-progress: false`. Only the assigning job: `auto-assign-next.yml` splits arming auto-merge into a separate job precisely so it stays *out* of the group, since GitHub keeps one pending run per group and drops the rest, and a dropped arming run is a PR that never merges.
- **The runners share a `concurrency` group** named `agentic-runner`, declared identically in `claude-runner.yml` and `opencode-runner.yml`. Concurrency groups are repo-wide, so the two runners serialise against each other as well as themselves. `cancel-in-progress: false` — a queued run waits rather than killing the live one. GitHub keeps only one run pending per group; a third is dropped, and nothing recovers it automatically — dispatch `agentic-trigger.yml` to pick the queue back up.

## Halt conditions

The loop stops while an issue is still `in-progress` (single flight), when no assignable `ready` issue remains, and when the cascade brake trips. A `blocked` label no longer stops it: the issue it names is finished, and `handle-failure.yml` chains to the next assignable issue while reporting the failure on the one that stopped. Its comment states what happened to the queue — moved on to #N, idle, or parked — because that is the part a human cannot infer from the issue alone.

Resuming a blocked issue is still a human act: add `ready` to put it back in the queue. The label alone starts nothing, and if a rescued draft PR is still open against the issue it will not be selected at all until that PR is closed or merged.

A run that dies without labelling anything — OOM, a hung tool call, the job timeout, a revoked token, a turn ended on outstanding work — would otherwise leave its issue `in-progress` forever and halt the chain silently. `agentic-watchdog.yml` sweeps hourly: an issue `in-progress` past `AGENTIC_STALL_MINUTES` with no linked PR is commented on, labelled `blocked`, and stripped of `in-progress`. That labelling is what surfaces the failure, so the watchdog must use the PAT — a label applied with `GITHUB_TOKEN` raises no `issues: labeled` event and `handle-failure.yml` would never fire.

The linked-PR skip in that sweep has a blind spot of its own, and the watchdog carries a second sweep for it: an open, non-draft `pipeline/feature-<N>` PR whose latest CI run failed is handed to `agentic-ci-failure.yml` by dispatch. It decides nothing itself — every guard stays in the fail-safe — so this is the same event raised again, not a second opinion about it. See "A red CI is nobody's report".

**Only a step that can see the run end may declare it lost.** That is a rule about evidence, not about seniority. `agentic-assign` sees labels alone, where a run 40 seconds old and one that died hours ago are indistinguishable, so it defers and never diagnoses. The watchdog ages the run against a threshold, which is inference — correct, but hours late. The runners' own post-agent steps have the one thing neither has: they run *after* the session is over, in the same job, so "this run finished and produced nothing" is an observation. They are allowed to settle the issue for that reason, and the watchdog remains the floor for the runs that never got that far — a job killed before its post-steps, a dropped webhook.

## The run is retried before it is written off

A session can end early for reasons no instruction reaches: a backgrounded delegation whose notification never arrives, a crash in the first minutes, a transient API error, a model that simply stops. Every one of those wastes a whole assignment and, before the retry existed, a whole day — #404 waited four hours for a watchdog sweep, and #406 sat `in-progress` after dying in 58 seconds.

`agentic-run-state` answers one question after the agent step: is the issue in a terminal state? Terminal means a linked pull request, a `blocked` label, or a closed issue. Anything else means the session stopped with the work unfinished, and the runner starts one more attempt in the same job — carrying what went wrong, an inventory of the `pipeline/*-<N>` branches the previous attempt left on disk (never pushed, so visible nowhere else), and the rule that most often broke it. The retry is gated on the clock as well: with less than `min_remaining_minutes` of the job budget left, the run is written off rather than cut off mid-work, because a cancelled job takes its unpushed branches with it.

One retry, not three. A real run takes over two hours, so a second attempt is all a 360-minute budget holds — and the failures worth retrying die early and leave the whole budget behind.

## Rescue: a run that ends early must not end silently

Intent is not a mechanism, so `agentic-rescue` runs last in both runners, with `if: always()` — it also covers the crash, the job timeout and the cancelled run, none of which the agent can write instructions for. It pushes `pipeline/feature-<N>` if commits exist on it and opens a **draft** PR carrying `Closes #<N>` and no `READY TO MERGE`; when no feature branch was produced, or the branch is empty, it comments on the issue saying so. A push it cannot complete is reported too, with the rejection, the commit list and the diffstat of what is being lost: a step that ends on `::error::` alone leaves exactly the silence this action exists to prevent, since the job log is not somewhere anyone is watching. Either way the failure becomes visible immediately and the work survives, instead of surfacing hours later as a watchdog sweep over an issue whose branches no longer exist.

**Every outcome here labels the issue `blocked`**, because reaching this step at all means the run did not finish it — and by then the session is over, so there is nothing left to wait for. That includes the successful rescue: an issue left `in-progress` with a draft PR attached passes both the single-flight check *and* the watchdog's linked-PR skip, so it would hold the queue for as long as the draft stayed open. `blocked` is the honest state — work preserved, human notified by `handle-failure.yml`, queue released. It is applied once and only to an issue that is still open and not already `blocked`: a run whose deliverable was an answer has closed its own issue, and re-labelling an escalated one would fire a second notification for the same failure.

The rescue PR is a diagnosis, not a deliverable: unreviewed and unvalidated by definition. Finishing it or dropping it is a human decision — and it has to be made *before* `ready` goes back on the issue, because an issue with an open PR against it is not assignable. That is not an obstacle to work around; it is what stops a second run being told to build a branch that already has commits on it.

**No runner chains to the next issue itself.** A run starting the next run is the pipeline deciding to run again on its own, and a runner has no view of the queue it would be restarting. The chain from a failure belongs to `handle-failure.yml`, which reacts to the `blocked` label whoever applied it — the run, `agentic-rescue`, or the watchdog — and can weigh it against every other failure since the last merge.

## The cascade brake

Chaining from a failure is what keeps an unattended queue moving, and it is also the one mechanism that can run away with itself. A systemic failure — an expired token, a broken `main`, a runner image that no longer builds — fails every run identically, and an unconditional chain would march through the entire backlog labelling each issue `blocked` in minutes. That risk is why the chain did not exist before.

`agentic-assign`'s `after_blocked_run` guard bounds it. Before chaining it counts the runs that have ended `blocked` **since the pipeline last merged one of its own pull requests**, and stops at `AGENTIC_BLOCKED_CHAIN_LIMIT` (default 3). A merged pipeline PR is proof the loop can still finish something, so it is what resets the count; nothing else does, and no clock is involved. When the brake trips the guard posts one notice — marked with an HTML comment so a second trip does not stack another — naming the count, the limit, and the two ways out: fix what the runs have in common and dispatch the trigger, or merge any pipeline PR.

Two smaller guards sit in front of the count, and both are about not chaining from something that was never a run. The issue must still carry `blocked` when the guard reads it, and it must have carried `in-progress` at some point — a human labelling a backlog issue `blocked` is filing a note, not ending a session. The guard also drops a leftover `in-progress` from the blocked issue, since `blocked` means the run is over and the two labels cannot both stand: left on, it would defer this very assignment against a session that no longer exists.

## What may be assigned

The rules live in `.github/scripts/assignability.cjs`, required from the workspace by `agentic-assign` rather than written inline in the action, so every entry point decides identically and the decision is unit tested against the source that ships (`tests/unit/config/assignability.test.ts`). **Every rule fails closed.** A fact the module cannot establish — an issue it cannot read, a dependency graph larger than it will walk — blocks, and an idle queue is recoverable in a way a run started on absent ground is not.

An issue is skipped when:

| Condition | Why |
|-----------|-----|
| It carries `blocked`, `in-progress`, or `done` | Respectively: halted, already owned, already finished. `done` on an open `ready` issue is contradictory, not a permission |
| It is a pull request | `listForRepo` returns PRs alongside issues; one carrying `ready` would be assigned as a task |
| An **open** pull request carries it | A deliverable PR — one from its own `pipeline/feature-<N>` branch, or one GitHub records as closing it — is open, so the branch has commits a second run would collide with or silently duplicate. This is the state a rescued issue is left in. A PR that merely *mentions* the issue is not this: #567's own body cites half the backlog, and under a mention predicate that one PR froze it |
| A declared dependency is still open | The ordinary case, and the transitive one — the whole declared graph is walked, not just the first level, because a human can close an issue by hand while the issue *it* declared is still open |
| Its `blocked_by` relationships **could not be read** | A failed call is not an empty list. Only the feature being absent (404/410) falls back to the body section |
| A declared dependency was closed as **not planned** | Closed is not delivered. The work was abandoned; whatever declared it is still missing its ground |
| A declared dependency is closed but an **open PR** still carries it | The headline case. The issue is closed, the code has not merged, and `main` does not have it — issue #547 with PR #566. Both deliverable arms are checked: the dep's own pipeline branch, and its closing references |
| A declared dependency **is** a pull request that has not merged | A `Blocked by` line may name the PR rather than the issue it closes |
| A declared dependency **cannot be read** | A typo in a `Blocked by` line used to read as "no dependency" and start the run anyway. Unverifiable counts as unmet |
| Its pull requests **could not be read**, by any path | A failed deliverable read is `unknown`, and unknown blocks — a 500 must never read as "no pull request". Every read is retried on a transient status first, and the closing-PR read falls back to REST before giving up (below), so this now means *nothing* answered rather than *one thing* answered badly. A pass that ends with nothing assigned and any candidate unread **fails the step** — see below |
| Its dependency graph exceeds 40 issues | A malformed body, and an unwalked graph is an unverified one |

### Where a dependency comes from

Two sources, unioned, and an issue stays blocked until every member of the union has landed.

**GitHub's own `blocked_by` relationships are the authority** — the Relationships panel on an issue, read through `GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by`. A relationship is a *declaration*: nothing about quoting an issue in prose can produce one, which is exactly what a body reference cannot promise. `agentic-issue-creation` sets them; the endpoint takes `issue_id`, the database id rather than the issue number, which is the detail that fails silently when guessed.

**The body section is the secondary source**, kept because every issue written before relationships existed carries its dependencies there and nowhere else. Dropping it the moment relationships arrived would make that entire backlog instantly assignable — a regression in the property the relationships are being adopted for. It is read strictly, because a mention is not a declaration: a section opens on a heading (`## Blocked by`), a bold line (`**Blocked by**`), or a line *starting* with the phrase (`Depends on: #12`), and ends at the next heading or bold line. A phrase inside a sentence opens nothing, so `## Context` citing #55 as background declares nothing — and neither does a bullet reading "depends on the rework in #123".

A relationship call that fails for any reason other than the feature being absent is `unknown`, and `unknown` blocks. A 403 or a 500 must never read as "this issue has no dependencies"; a repository without the feature at all is a different fact, and there the body section is simply the only source there is.

### What counts as an issue's pull request

Everywhere the loop asks "does this issue have its PR" — the single-flight defer, the watchdog's leave-alone, the run-state settle check, and the two assignability rules above — the answer is the **deliverable predicate**: a PR whose head is the issue's own `pipeline/feature-<N>` branch (open or merged; closed-unmerged is a rejected deliverable), or a PR GitHub records as closing the issue (`closedByPullRequestsReferences`, open and merged only). A timeline cross-reference counts for nothing: any PR that merely writes `#N` in prose raises one, which is how docs PR #561's passing mention of #547 read as run #133's deliverable and disarmed its retry with five hours of budget left. The predicate is inlined in `agentic-watchdog.yml` and `agentic-run-state` because both run without a checkout, and shared from `issue-api.cjs` for everything `agentic-assign` decides; all copies are pinned identical in shape by `autonomy-loop.test.ts`.

**One degraded API surface must not park the queue.** The two arms are read independently, each retried on a transient status (408, 429, 5xx, or a network fault) before it counts as failed. When `closedByPullRequestsReferences` stays unavailable, the closers arm falls back to the REST timeline: a cross-referenced PR whose *body carries a closing keyword* for the issue, open or merged only. The keyword is what keeps the fallback from being the mention predicate #568 removed — a PR that only cites the issue writes none. It is narrower than the field it replaces, since a PR linked by hand in the sidebar carries no keyword either; that is the accepted cost. On 17 Aug 2026 that field answered 503 for every candidate, three dispatches of `agentic-trigger.yml` in a row skipped the entire `ready` queue, and issue #554 sat unassigned behind three green runs.

**A queue that was not read is not an idle queue.** A refusal carries which of the two it is, and `agentic-assign` fails the step when a pass assigns nothing while any candidate went unread — naming each one. The step is otherwise indistinguishable from an empty backlog, and a green Actions row is all a human dispatching the trigger ever sees of it.

**Undeclared coupling is not detected, and deliberately so.** Comparing an issue's `## Files` list against the files an open pipeline PR touches was considered and rejected: on this repository nearly every gameplay issue touches `GameState.ts` or `GameLoop.ts`, so a single stale draft PR would make the whole backlog unassignable — the exact stall the blocked-chain exists to prevent. An issue that depends on another's work says so in its `Blocked by` section; that is what `agentic-issue-creation` is for.

## Repository variables

| Variable | Values | Effect |
|----------|--------|--------|
| `AGENTIC_AGENT` | `@claude` / `@opencode` (leading `@` and case optional; unset means `@opencode`) | The agent that assignment comments address, and therefore the runner workflow that starts |
| `AGENTIC_AUTO_ASSIGN_ENABLED` | `true` / anything else | Whether a merged pipeline PR chains to the next ready issue. Set to anything else, the manual trigger is the only way a run ever starts |
| `AGENTIC_AUTO_MERGE_ENABLED` | `true` / anything else | Whether a `READY TO MERGE` PR gets GitHub native auto-merge |
| `AGENTIC_STALL_MINUTES` | minutes, default `420`; a value below the runners' 360-minute job timeout is clamped up to it | How long an issue may stay `in-progress` without a linked PR before the watchdog marks it `blocked`. Below the job timeout it would sweep live runs |
| `AGENTIC_BLOCKED_CHAIN_LIMIT` | positive integer, default `3`; anything else falls back to the default rather than disabling the brake | How many runs may end `blocked` since the last merged pipeline PR before the chain from a failure parks the queue |
| `AGENTIC_CI_FIX_ENABLED` | anything but `false`, default on | Whether a red CI on a pipeline PR is handed back to the agent. Off, a red CI reports to nobody again — the state PR #581 was left in |
| `AGENTIC_CI_FIX_ATTEMPT_LIMIT` | positive integer, default `3`; anything else falls back to the default rather than disabling the brake | How many times the same pull request may be handed back for a red CI before it is parked as a draft with its issue `blocked` |

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

A fifth entry does the opposite and belongs in the same list for that reason: `agentic-ci-failure.yml` fires on the same `workflow_run` event with the opposite conclusion, and hands the PR back to the agent instead of merging it. Between them the two workflows cover both verdicts, which is what the CI-completion event is worth reacting to at all.

All four call the same composite action, so they cannot disagree about what "ready to merge" means. Selection is the marker on a line of its own plus a non-draft PR; the author is logged and never branched on. The action also releases any workflow run parked as `action_required` on the PR head, which is what makes CI start at all on a bot-authored PR — that needs `actions: write` on the PAT, and without it the step still enables auto-merge, warns naming the missing scope, and the PR waits on checks that never start.

**Every refusal is decided on the PR's state, never on the wording of the error.** GitHub declines native auto-merge on a PR that has nothing left to wait for and on a repository with the feature switched off, so the action falls back to merging the PR itself.

**On this repository the fallback is not the exception, it is the path.** `main` requires no status check, so a PR is mergeable the moment it opens and GitHub refuses native auto-merge on every pipeline PR — `Pull request is in unstable status`, meaning there is nothing left for auto-merge to wait on. Every merge therefore happens inside the action, which makes *when the action runs* the whole mechanism. PR #499 was verified on all five channels, marked, and green, and sat open anyway: armed once at `opened`, it polled its 10-minute settle budget while the `full-ci` browser jobs still had 35 minutes to run, reported the PR stuck, and was never swept again. That is what the `workflow_run` entry above is for.

**A PR that is neither marked nor draft fails the sweep.** Selection needs the marker, so an unmarked PR is skipped — which is correct for anyone's ordinary work in progress and fatal for the pipeline's own. PRs #507 and #508 were opened non-draft and unmarked, each body promising `READY TO MERGE` "once the `full-ci` jobs report", and no step exists anywhere that comes back to write it. Skipped here, chaining from a merge that never happens, and passed over by a watchdog that leaves alone any issue with a linked PR, they held their issues indefinitely. So a non-draft PR from `pipeline/feature-<N>` with no marker now fails this step by name: the pipeline's own branch means the pipeline's own PR, and that PR ships marked or says why it does not. What the run should do instead: `agentic-pipeline-pr-management`.

**Nothing in the path waits on a clock.** The verdict is read off the workflow runs on the PR head — the same object the CI-completion trigger fires on, so what the action reads and what wakes it cannot drift. A failed run is stuck. A run still going, *or a head that has reported nothing at all*, is `pending`: reported, not failed, and left to the sweep that CI completing will raise. `mergeable_state` is consulted only for `dirty` and `behind`, the two things it alone knows and neither of which resolves without a human or a branch update.

`unknown` — mergeability GitHub has not finished computing — used to be polled out. It no longer is: **the merge request is the authority on whether a PR merges**, so once every run has reported the action asks GitHub to merge and reads the answer, instead of polling a state until it looks like the answer would be yes. One request replaces the loop, and a refusal names what stopped it.

Two traps in that reading, both load-bearing. A head with *no* runs is `pending`, never a merge: a PR read in the second before its CI run is created has nothing failing and nothing running, and treating that as green ships code no channel ever saw. And a run belonging to the workflow hosting the action is skipped — otherwise the sweep counts itself as a check in flight and waits on itself forever, on a PR whose real checks all passed. A marked PR that ends neither armed nor merged **fails the step**: it holds its issue and every assignment queued behind it, and a warning in a job log is not somewhere anyone is watching. PR #434 was that PR — verified, marked, green, and never merged, because the `enablePullRequestAutoMerge` mutation named its variable `$method`, which @octokit/graphql rejects before the request leaves the runner (`method`, `url`, `baseUrl`, `headers`, `query`, `request` and `mediaType` are its own request options). Both arming paths threw on every call and both reported success.

## A red CI is nobody's report

Every path above ends at a merge or at `blocked`. There was a third ending nothing owned: **the pull request opened, marked, and its CI came back red.**

`agentic-auto-merge.yml` declines to run at all when the CI run that woke it concluded `failure` — correct on its own terms, since a failed run has nothing to merge and sweeping it would restate a red check as a red workflow. But declining is not reporting. No merge fires, so `auto-assign-next.yml` never chains. The watchdog leaves the issue alone precisely because a pull request *is* linked to it. And the session that could have read the verdict exited minutes before it arrived. PR #581 sat there — green on every channel its own session ran, two interaction-mode shards red in CI — holding issue #552 `in-progress` with the whole queue behind it, until a human noticed.

Two mechanisms close it, at different distances, and neither replaces the other:

| Mechanism | Owns | Reaches |
|-----------|------|---------|
| `[await-ci]`, the last step of `agentic-pipeline-finalization` | The run reads its own verdict, in the turn that opened the PR. `npm run ci:await` listens to the workflow runs on the head, with no deadline of its own; RED is work, GREEN ends the run | Every run that is still alive when CI reports — which is the normal case, because the wait is what keeps it alive |
| `agentic-ci-failure.yml`, on `workflow_run` CI completed + `failure` | Posting the failure back to the agent as a fresh task on the same PR, with the failing jobs and their log URLs named | The crashed session, the job timeout, the run that pushed a fix and ran out of budget, the CI run that reported an hour later |

The fail-safe is guarded so it cannot fight the step:

- **Only `pipeline/feature-<N>`.** CI failing on `main`, on a human's branch or on a harness branch summons nobody.
- **Never while a runner run is live.** A live session is already waiting on this verdict, and a second comment would queue a second runner behind it (`cancel-in-progress: false`) with two sessions pushing to one branch. The check covers the whole runner job, so a run in its rescue or arming steps still counts. `agentic-watchdog.yml` sweeps open pipeline PRs with a red CI and dispatches this workflow again, so a verdict that landed while the runner was busy is picked up on the next sweep rather than by a human. The sweep re-raises the event; every decision stays in the fail-safe, made once, on current state.
- **Never a draft.** A draft has already said a channel stayed red, and its issue is already released.
- **Never a pull request labelled `ci-fix-hold`.** The live-session check above sees the two runner workflows and nothing else, so a session driven from the web app, the desktop app, or a human at a terminal is invisible to it — and a handback then wakes a second worker onto a branch somebody is already fixing. "Is a human working on this" is not observable from the Actions API, so it is **declared rather than detected**: put `ci-fix-hold` on the pull request to take the red CI yourself, remove it to hand it back. It is deliberately an opt-out and not a detector; nothing infers it, and nothing removes it for you.
- **Once per CI run, identified by its run id.** The head SHA and the CI run id are written into the comment's marker, and the `workflow_run` path answers a run id once: the same event redelivered carries the same id, and answering twice would queue a second session. **This is deliberately not a cooldown.** A duration long enough for today's CI is a stall once a shard count grows, and one short enough for tomorrow double-asks today; event identity does not drift. What re-opens a run id is a *dispatch* — the watchdog's re-raise, or a human's — which bypasses the dedup, because a handback whose session died before pushing leaves the head and the run id unchanged and must not be skipped forever. Every ask counts against the limit, so the retry is bounded by the brake rather than by a guessed interval.
- **Bounded by `AGENTIC_CI_FIX_ATTEMPT_LIMIT`.** When it is spent the workflow converts the PR to a draft — which takes it out of auto-merge's selection before the unmarked-PR check can see it — labels the issue `blocked` with the PAT, and drops `in-progress`. That is the same terminal shape every other failure ends in, so `handle-failure.yml` chains the queue past it. A CI failure that is not converging must not become a new way to stall.

**Nothing in either mechanism waits on a duration**, the same property the auto-merge path holds. `[await-ci]` ends when the runs end, bounded by the runner's own `timeout-minutes` — and reaching *that* is safe rather than silent, because a killed job leaves no live runner run and the fail-safe picks the PR up. The fail-safe's own dedup is event identity, and its brake counts attempts. The only intervals anywhere are poll cadences — the watchdog's cron, the script's `--interval-seconds` — and no decision reads them.

The handback lands as an `issue_comment` on a pull request, where `agentic-prompt` resolves `entity` to `pr <n>` and leaves `issue` empty — so the runner's `agentic-run-state`, `agentic-rescue` and arming steps all skip. That is right rather than unfortunate: the branch is already pushed and the PR already exists, so there is nothing to rescue, and arming is covered twice over by `auto-assign-next.yml` on `synchronize` and by the CI-completion sweep. What the session owes is a green CI on a branch that already exists — `agentic-pipeline-ci-fix`.

## Shared composite actions

They live in `.github/actions/`: `agentic-prompt` builds the trigger context both runners hand to their agent, `agentic-assign` picks and assigns the next issue — reading its rules from `.github/scripts/assignability.cjs` and its GitHub reads from `.github/scripts/issue-api.cjs`, which is why every workflow that assigns must check the repository out first — `agentic-run-state` reports whether a finished session left its issue terminal and whether the remaining job budget can carry another attempt, `agentic-rescue` salvages a feature branch from a run that ended before opening its PR and settles the issue either way, and `agentic-auto-merge` puts a marked PR into auto-merge whatever account opened it, releasing any workflow run parked as `action_required` on the way.
