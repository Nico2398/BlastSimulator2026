---
name: agentic-workflow-edition
description: >
  Standards for editing the pipeline's GitHub Actions layer — workflows under
  .github/workflows/, composite actions under .github/actions/, and the shared
  decision modules under .github/scripts/. Covers the no-timer rule, which token
  raises which event, event-driven triggers, concurrency groups, idempotency and
  brakes, fail-closed/fail-loud reporting, and how a change here is proven. Use
  when creating or changing any of those files.
---

# Workflow Edition

The Actions layer is the part of the pipeline with no agent in it. It runs when nobody is watching, its failures are silent by default, and every mechanism in it exists because a specific run was lost. Edit it accordingly.

What lives where — one concept per file, same as the context layer:

| Path | Holds |
|------|-------|
| `.github/workflows/*.yml` | One trigger and its reaction. Nothing shared |
| `.github/actions/agentic-*/action.yml` | Logic more than one workflow needs, so the workflows cannot disagree about it |
| `.github/scripts/*.cjs` | Decision rules read from the workspace (hence `actions/checkout` in every workflow that needs them), unit-tested against the source that ships |
| `tests/unit/config/autonomy-loop.test.ts` | The enforcement. Triggers, tokens and guards are pinned here, because every one of them fails in silence |

The system these files implement — entry points, labels, single flight, rescue, auto-merge, the cascade brake — is described in `agentic-autonomous-pipeline` and its `references/github-loop.md`. This skill is about *how to write* that layer, not what it does.

## ▶ Rule 1 — No timer

**No verdict is decided on a duration.** Not "wait 10 minutes and call it stuck", not "if 60 minutes have passed, ask again", not "sleep until CI is probably done". Decide on events, on identity, and on state.

A duration is a guess about a system that changes underneath it. Every interval that was ever tuned in this repository was tuned to the CI of that week, and each one broke the moment a shard count, a scenario suite or a runner queue moved:

| What was timed | What it did instead of working |
|----------------|-------------------------------|
| `agentic-auto-merge`'s 10-minute settle poll | Reported PR #499 stuck while its `full-ci` jobs had 35 minutes left to run, and was never swept again |
| A 45-minute wait budget in `await-pr-ci` | Would report "still running" as an outcome — the exact ending that left PR #581's red CI unread |
| A 60-minute per-commit cooldown in `agentic-ci-failure` | Long enough to stall once CI slows, short enough to double-ask when it speeds up |

What to reach for instead, in order of preference:

1. **An event.** GitHub raises one for nearly everything worth reacting to. `workflow_run` on CI completing is what made auto-merge work: the moment the checks report is an event, not a time. If your reaction needs to happen "later", find the event that means later.
2. **Identity.** "Have I already answered this?" is not a question about elapsed time. A workflow run has an id and a redelivered webhook carries the same one; a commit has a SHA. `agentic-ci-failure` writes the CI run id into its comment marker and answers each run once.
3. **State you can read.** Is a run live? List the runs. Has CI reported? Read the runs on the head. Did a session settle its issue? Read the labels. `mergeVerdict` in `agentic-auto-merge` is state alone — failed is stuck, anything unreported is pending, and `total === 0` is pending rather than green.
4. **A counter with a brake.** When something must be bounded, bound it by *attempts*, not by minutes: `AGENTIC_BLOCKED_CHAIN_LIMIT`, `AGENTIC_CI_FIX_ATTEMPT_LIMIT`. A counter is exact, visible in the artifacts it counts, and does not drift.
5. **The job's own timeout.** When a wait genuinely has no natural end, let `timeout-minutes` be the bound rather than inventing a second one — and make reaching it *safe*: `[await-ci]` waits with no deadline because a killed job leaves no live runner run, which is precisely the state `agentic-ci-failure` picks up.

### The five clocks that are allowed, and why each is not a verdict

Every one of these is in the tree today. Adding a sixth needs the same kind of argument, and an entry in the allowlist that `autonomy-loop.test.ts` checks.

| Clock | Where | Why it is not a verdict |
|-------|-------|------------------------|
| **Poll cadence** | `agentic-watchdog.yml`'s `cron`, `await-pr-ci`'s `--interval-seconds` | How often a question is asked. No answer depends on the value; halving or doubling it changes nothing but latency |
| **Network backoff** | `agentic-rescue`'s `sleep $(( 2 ** attempt ))` | Spacing retries of a failed call. The verdict is the call's own result |
| **The runner's own budget** | `agentic-run-state`'s `budget_minutes` / `min_remaining_minutes` | Asks "is there enough job time left to start another attempt", never "is the work finished". It reads a hard clock that Actions itself enforces |
| **Event ordering** | `issue-api.cjs`'s timestamp comparisons | Which of two events came first. A comparison, not a threshold — nothing to tune |
| **A clamped last-resort floor** | `agentic-watchdog.yml`'s `AGENTIC_STALL_MINUTES` | Only fires on a run that left *no other trace at all*, and is clamped above the runners' job timeout so it can never sweep a live run. It is the net under every other mechanism, and it reports rather than deciding |

**The smell to catch in review:** a number of minutes appearing anywhere near a word like `stuck`, `stale`, `settle`, `cooldown`, `retry`, `give up`, or `probably`. If removing the number would leave the logic unable to decide, the logic is deciding on the wrong thing.

## ▶ Rule 2 — The token decides whether anything happens next

Half of this layer's failures are one wrong token.

| Need | Token | Because |
|------|-------|---------|
| A comment, label, PR or push that must **raise an event** | `PAT_TOKEN_COPILOT_AUTOMATION` | `GITHUB_TOKEN` raises no workflow event. A label applied with it fires no `issues: labeled`, so `handle-failure.yml` never chains; a PR opened with it fires no `pull_request`, so `auto-assign-next.yml` stays dormant |
| Housekeeping that must **raise nothing** | `GITHUB_TOKEN`, deliberately | `agentic-intake.yml`'s label upkeep and `handle-failure.yml`'s notification comment. Write the "deliberately" into the step comment, or the next editor will "fix" it |
| Releasing a workflow run parked as `action_required`, or dispatching a workflow | PAT **plus** `actions: write` | Without the scope the step warns and the PR waits on checks that never start |
| A comment that must **wake a runner** | PAT, always | The runners filter `comment.user.type != 'Bot'`. Under `GITHUB_TOKEN` the author is `github-actions[bot]` and the trigger is written but never read |

`git push` reads no token from the environment: setting `GH_TOKEN` on the step is not enough, and after an agent step the git credential is the agent's own App token, which cannot carry `workflows` scope — a branch that differs from `main` on a workflow file is rejected outright. Push to an explicitly authenticated URL, as `agentic-rescue` does.

Only two comments in the whole system may carry `@claude` or `@opencode`, and both are written by a workflow: the assignment comment and the CI handback. Anything else that mentions an agent starts a session nobody asked for.

## ▶ Rule 3 — React to an event; never schedule work

A trigger states what happened, not what time it is. `schedule:` is for sweeping and reporting, never for starting work: the watchdog's cron releases lost runs and re-raises a red CI, and it assigns nothing. Adding an assignment path to a scheduled workflow is how a repository starts sessions on its own.

When you add a trigger, add it to `ASSIGNING_WORKFLOWS` or `NON_ASSIGNING_WORKFLOWS` in `autonomy-loop.test.ts`. The lists are named individually rather than globbed so that widening the entry points fails a test instead of passing quietly.

`workflows: ["CI"]` on a `workflow_run` trigger matches the workflow's `name:`, not its filename. A rename in `ci.yml` silently unhooks it — which is why a test reads `ci.yml`'s declared name and compares.

## ▶ Rule 4 — Fail closed, and fail loud

- **A fact you could not read is not an absent fact.** A 500 from the PR list is `unknown`, and `unknown` blocks. Every rule in `assignability.cjs` works this way: an idle queue is recoverable, a run started on absent ground is not.
- **An absence of evidence is never a pass.** `total === 0` runs on a head means nothing has reported, not that nothing failed.
- **A warning in a job log is not somewhere anyone is watching.** When a state must not persist, fail the step so the Actions list shows red — `agentic-auto-merge` fails on a marked PR it could not arm, for exactly this reason. Better still, comment where a human is already looking.
- **Every terminal outcome releases the queue.** A workflow that ends a run's life must leave the issue in a terminal state — merged and `done`, or `blocked` (which is itself an entry point, so the chain continues). A brake that parks work without releasing the issue converts one stalled PR into a stalled repository.
- **`if: always()`** on any step whose whole purpose is to cover a crash, a timeout or a cancellation.

## ▶ Rule 5 — Idempotency by identity, and never on the wording of an error

Every workflow here can fire twice: webhooks redeliver, sweeps repeat, humans dispatch. Make the second run a no-op by construction.

- Mark what you wrote with an HTML comment (`<!-- agentic-ci-failure -->`) and read it back before writing again. Include the identity of the thing you were answering — a run id, a SHA — so "again" is distinguishable from "still".
- `--force` on `gh label create`, and treat "auto-merge already enabled" as success.
- Branch on **state, not on messages**. `agentic-auto-merge` re-reads the PR and decides from `mergeable_state` plus the runs, because a refusal string it did not recognise once fell through to a warning and a green step — and PR #434 sat unmerged while both arming paths reported success.
- When reading workflow runs on a head: keep the newest run per `workflow_id` (`cancel-in-progress` leaves superseded runs behind, and a stale `cancelled` reads as red forever), skip the workflow the code itself is running in (or it waits on itself), and treat `skipped`/`neutral` as passes.

## Repository variables

Configuration lives in repository variables, defaults live in code, and a bad value never disables a safety mechanism: an unparseable limit falls back to its default, an unrecognised agent name fails the step loudly, and a stall threshold below the job timeout is clamped up with a warning. Document every new variable in `references/github-loop.md`'s table — including its default and what breaks when it is off.

## How a change here is proven

The Actions layer has no runtime you can drive locally, so its channel is `logic`:

1. Add or update the assertions in `tests/unit/config/autonomy-loop.test.ts`. Pin the trigger, the token, and every guard — each of them fails silently in production.
2. Read the **shipped source**, never a copy of it. The existing tests lift `agentic-auto-merge`'s inline script out of its `action.yml` and evaluate the real function; a re-typed duplicate drifts and then passes forever.
3. Where a predicate is deliberately inlined in more than one place — the deliverable-PR check exists in three, because two of its sites run without a checkout — pin every copy so they cannot disagree.
4. `npm run test` and `npm run typecheck`. A YAML parse check (`python3 -c "import yaml; yaml.safe_load(open(...))"`) catches an indentation error before a push does.
5. State in the PR body which mechanism changed and which run it was lost to. Nothing about this layer is self-evident three months later.

## Write the incident into the file

Every non-obvious mechanism here carries a comment naming the run that made it necessary — #404, #430, #434, #499, #507, #552, #581. That is not decoration: the guards look redundant, and each one was added after a queue stalled for a day. A comment that says *what* the code does can be deleted safely by anyone; a comment that says which PR was lost cannot.
