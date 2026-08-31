---
name: agentic-decision-autonomy
description: >
  How an autonomous run resolves an underspecified requirement or an obstacle on its own: the
  default-and-record rule, when to fix a finding on the spot rather than file it, how to bypass a
  blocker with a TODO tagged to its issue, how to pause behind a dependency instead of blocking, and
  the narrow list of genuine blockers. Use when a task leaves a choice open, when something you found
  is in the way of the work, or when weighing whether to escalate.
---

# Decision Autonomy

A pipeline run gets one turn and has nobody to ask. Underspecification is the normal state of an issue — humans write the main line and leave the corners implicit — so **an open choice is work to do, not a reason to stop.** So is most of what gets in the way: a finding you could fix in two minutes, or work around behind a `TODO`, is not a halt.

The cost of stopping is concrete: a halted run holds its issue `in-progress`, which defers every later assignment until a human returns. A wrong default costs one follow-up issue.

Four ways a run stops, and only one of them waits for a person:

| Outcome | What it means | Who acts next |
|---------|---------------|---------------|
| Merged-ready PR | The work landed | Nobody — auto-merge |
| `done` + closed | The deliverable was an answer or a command, not a diff | Nobody |
| `paused` | An issue you filed has to land first; yours is back in the queue behind it | The pipeline, on its own |
| `blocked` | A human has to answer something | A human |

Reach for the last one last.

## ▶ The default-and-record rule

When a requirement leaves a choice open, resolve it in this order and keep going:

1. **Derive the default** from the narrowest source that already answers it:

   | Order | Source |
   |-------|--------|
   | 1 | The `gameplay-*` or `dev-*` skill that owns the mechanic — its stated design intent, thresholds and penalties |
   | 2 | The convention in the surrounding code (how the neighbouring case already behaves) |
   | 3 | The analogous mechanic elsewhere in the game |
   | 4 | The option that preserves existing incentives — the one where the new path stays worse than the path the design already rewards |

   A verification failure that traces to missing or unreachable content is closed by adding that content, never by loosening the check or retuning balance to route around it — the check was reporting the game accurately.

2. **Implement it** and test it like any other behaviour. A defaulted decision is not a lesser decision.
3. **Write it into the skill that owns the rule**, so the project keeps one source of truth and the next run inherits the answer instead of re-deciding it. A constant belongs in `src/core/config/`, named, alongside the spec entry.
4. **Record it in the PR body** under `## Decisions taken` — see the format below.
5. **Continue the pipeline.** A defaulted decision never downgrades a PR to draft and never removes `READY TO MERGE`.

When at least one decision changes gameplay, economy, or a player-facing default, open a follow-up issue after the PR:

```
gh label create decision-review --color ededed --force \
  --description "A default the pipeline chose; revisit when convenient"
gh issue create --label decision-review \
  --title "Decision review: <one-line summary> (from #<N>)" \
  --body "<the Decisions taken block>, linking the PR"
```

The `decision-review` label carries no `ready`, so the issue stays out of the assignment queue and halts nothing: `agentic-assign` selects on `ready` alone, and nothing in the pipeline ever applies `ready` to an issue a human filed. It is where a human goes to revisit a default at leisure; adding `ready` later is how they put it back in the queue, and one of the pipeline's three entry points — a manual dispatch, the next merged pipeline PR, or the next run that ends `blocked` — is what starts it.

`--force` updates the label when it already exists, so the step is safe to run on every issue rather than only the first. Both runners give the agent's shell a `GH_TOKEN` that already opens PRs and edits labels, and both workflows declare `issues: write`, so no extra permission is needed.

## ▶ Something in your way — try three things before you stop

An obstacle is not a verdict. Most of what stops a run mid-task is smaller than the run, and stopping costs the whole session either way. Work down this list and take the first option that holds — never skip to the bottom because the finding *sounds* structural.

**1. Fix it.** Small, local, and inside what you already understand — a wrong path, a stale comment, a missing guard, an unexported type, a test fixture one value out. Fix it in your own diff and say so in the PR body. Filing an issue for a two-minute fix spends a whole run to deliver two minutes of work, and leaves your own task blocked in the meantime for no reason.

Size is the test, not tidiness. "It is not my task" is never a reason to file something you could have fixed while you were looking at it.

**2. Bypass it, with a `TODO` that names the issue.** The finding is real work — too big for your diff, or in code your task has no business rewriting — but your task can still be delivered around it. File the issue, then write the smallest honest workaround and tag it:

```ts
// TODO(#742): SurveyPanel re-reads the grid on every tick. Cache once #742 lands.
const composition = grid.compositionAt(x, y); // recomputed per frame until then
```

**File the issue first, then write the comment.** This is the one follow-up that cannot wait for the pipeline's `followup` step: that step runs *after* `open-pr`, and a `TODO` cannot name a number that does not exist yet. File it the moment you decide to bypass, take the number, write it into the code, and let `followup` merely record it in the summary table.

Rules for a bypass:

- **It names its issue.** `TODO(#N)`, with the number of an issue that exists. A bare `TODO` is debt nobody can find; `TODO(#N)` is debt with an owner and a queue position.
- **It says what to do when the issue lands**, not just what is wrong. The run that closes #N deletes this comment, and it should not have to re-derive the plan.
- **It is honest about the cost.** A bypass that quietly degrades behaviour says so on the line and in the PR body under `## Decisions taken`.
- **It never bypasses a verification channel.** Working around a failing check by loosening the check is not a bypass, it is a false report — see the default-and-record rule above.
- **The filed issue owns the cleanup.** Its `## Task` says the `TODO(#N)` comes out, and its `## Files` names the file the bypass is in.

A bypassed run is a normal run: full verification, `READY TO MERGE`, no draft, nothing about it holds the PR.

**3. Pause.** There is no bypass — the task cannot be delivered at all until the thing you found lands. Read `references/pausing.md` and follow it before halting: it holds the five steps, the handover PR body, and the two ways a pause is undone by accident.

## ▶ Pausing — you are blocked by an issue, not by a human

The distinction that decides everything: **is what you are waiting for work, or an answer?**

Work — a defect, a missing affordance, a broken harness, an unrunnable channel that another issue can repair — is something the pipeline does by itself. Nothing about it needs a human, so nothing about it should wait for one. Pause.

An answer — which of two contradictory requirements is meant, a credential nobody has — needs a person. Block.

A pause files the blocker, sets it as this issue's dependency, hands over whatever is finished on a draft PR labelled `paused`, and returns the issue to the queue as `ready` + `paused` with `in-progress` removed. Every step of it, verbatim, with the commands and the PR body: `references/pausing.md`. Follow that file rather than reconstructing the sequence — a pause that skips a step strands the issue.

## ▶ Genuine blockers — the whole list

Everything above is a way not to be here. Block only when the work cannot be produced or trusted, **and** what is missing is something only a human can supply:

| Blocker | Shape it takes |
|---------|----------------|
| Contradictory requirements | The issue asks for X and for not-X; no reading satisfies both, and picking one silently discards stated intent |
| Missing external dependency | A credential, asset, endpoint, or data file the run cannot obtain, cannot substitute, and **cannot file an issue for** — nobody but a human can produce it |
| Capability gap | The task needs something the runtime does not have — see the Capability Gate in `CLAUDE.md` |
| A verification channel cannot run, **and no issue would fix it** | The runtime has no browser at all, or the channel is unrunnable for a reason no code change addresses. A channel broken by a defect is a **pause**, not a block: file the defect and requeue behind it |
| Irreversible action outside the ask | Force-pushing a shared branch, deleting work the run does not own, rewriting published history |

Escalation is the same shape as any other halt: label the issue `blocked`, comment what is missing and what would unblock it, stop with `ESCALATED: <reason>`.

Everything not on that list is a decision to take, a fix to make, a bypass to write, or a pause.

## There is no asking

`AskUserQuestion` is blocked project-wide, by a deny rule and a `PreToolUse` hook, in an interactive session exactly as in a pipeline run. **An open choice was never a question to ask** — default it and record it; a genuine blocker from the list above goes onto the issue as a comment, where a human finds it asynchronously. Both enforcement layers, and why one alone does not hold: `references/no-asking.md`.

## Churn is not a blocker

The count of review findings, visual iterations, implementer rounds, cherry-pick retries, and failed test runs decides nothing about PR status. A run that converged after five iterations converged. What decides status is whether every verification channel the change owes reports PASS.

An earlier convention held a PR back for "significant churn". It cost a green, fully verified run its auto-merge and sent a human to re-review work that five specialist reviewers had already passed — while the issue stayed `in-progress` and the chain stalled behind it. Iteration count measures how hard the problem was, not how likely the answer is to be wrong.

## Scope beyond the issue's framing is not a blocker

An issue's title describes where the reporter noticed the problem, not where the problem lives. When the fix reaches deeper than the framing — a visual-coherence issue that turns out to need a simulation fix — implement the fix that is actually correct, say so in the PR body, and continue. A correct fix outside the framing beats an incorrect one inside it.

The limit is relevance, not depth: fix what this issue's own change exposes. Unrelated defects noticed along the way become their own issues — reported into the run's follow-up register and filed at the end of the pipeline, per `agentic-issue-creation`. Recording one is not escalating: it never holds the PR and never delays the run's own issue.

## Recording format

In the PR body, after the change summary:

```markdown
## Decisions taken

Defaulted under `agentic-decision-autonomy` — none blocked this run.

- **What was open:** the issue did not say what a rest with no building restores.
  **Chosen:** cap the gauge at 70 and double the rest duration (`NEED_REST_NO_BUILDING_CAP`,
  `NEED_REST_NO_BUILDING_DURATION_MULTIPLIER`), recorded in `gameplay-employee-needs`.
  **Why:** the spec's only stated penalty for no building is a longer rest; a full restore would
  make an empty site better than a Tier 1 one, inverting the incentive to build.
  **If reversed:** change the two constants; no call site moves.
```

One entry per decision: what was open, what was chosen, why, and what a human would change to reverse it. The last line is what makes the decision cheap to revisit — a decision nobody can find the lever for is a decision nobody will revisit.
