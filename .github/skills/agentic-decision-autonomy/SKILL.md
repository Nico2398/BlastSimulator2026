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

**3. Pause.** There is no bypass — the task cannot be delivered at all until the thing you found lands. Procedure below.

## ▶ Pausing — you are blocked by an issue, not by a human

The distinction that decides everything: **is what you are waiting for work, or an answer?**

Work — a defect, a missing affordance, a broken harness, an unrunnable channel that another issue can repair — is something the pipeline does by itself. Nothing about it needs a human, so nothing about it should wait for one. Pause.

An answer — which of two contradictory requirements is meant, a credential nobody has — needs a person. Block.

**Pausing, step by step:**

1. **File the blocker** as an ordinary issue, per `agentic-issue-creation`. It gets `ready` if you are confident it is real and specified, which after hitting it head-on you usually are.
2. **Set it as your issue's dependency** — the `blocked_by` relationship *and* the `## Blocked by` section, both, per `agentic-issue-creation`'s "Setting a dependency". The relationship is what `assignability.cjs` trusts.
3. **Save whatever you finished.** If you have commits, push `pipeline/feature-<label>` and open a **draft** pull request against `main`, labelled `paused`, carrying `Closes #<your issue>` and no `READY TO MERGE`. Its body states what is done, what remains, and what the blocker changes — format below. With no commits, skip this; there is nothing to hand over.
4. **Return your issue to the queue:** add `ready`, add `paused`, remove `in-progress`. `agentic-intake.yml` keeps the label defined, but create it idempotently first rather than assuming — the same `--force` pattern the `decision-review` label uses above, so a repository that has never paused does not fail the step:

   ```bash
   gh label create paused --color fbca04 --force \
     --description "A run stopped here on a dependency; the queue returns to it when that dependency lands"
   ```
5. **Comment on your issue** naming the blocker, what you finished, and the PR that holds it. Stop with `PAUSED: waiting on #<blocker>`.

What then happens without anyone watching: `assignability.cjs` skips your issue while the blocker is open, `handle-failure.yml` chains the queue on to the next issue, the pipeline works the blocker, and when the blocker's PR merges your issue becomes assignable again. The next run is told to resume from your draft PR's branch rather than start over.

**The handover PR body:**

```markdown
Closes #<your issue>

⏸️ **Paused — waiting on #<blocker>.**

## Done
- <what is on this branch, and which verification channels passed on it>

## Remaining
- <what is left, in the order to do it>

## What #<blocker> changes
<why the remaining work could not be done until that issue lands, and what
becomes possible once it has>

## Resuming
Continue on this branch. Do not open a second pull request against
#<your issue> — an issue with a second open PR is unassignable to everyone.
Re-run every verification channel: these results were recorded against an
older `main`.
```

**Never close a paused PR to tidy up, and never merge it.** Closing discards the work; merging lands a half-finished change. It stays a draft until the run that resumes it finishes it.

**Never leave a paused issue holding `in-progress`.** The pause is terminal for your session — `agentic-run-state` reads the `paused` label and schedules no retry — and an issue left `in-progress` defers every later assignment until the watchdog sweeps it.

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

`AskUserQuestion` is blocked project-wide, in two layers, and `npm run validate:context` fails if either goes missing. The tool suspends the session waiting for an answer nobody is there to give — the issue holds `in-progress` for as long as it waits, and every assignment behind it waits too. That is the halt this whole skill exists to prevent, arriving through a tool call instead of through a decision.

| Layer | Where | Holds when |
|-------|-------|-----------|
| `permissions.deny` | `.claude/settings.json` | The permission system is consulted at all |
| `PreToolUse` hook | `.claude/hooks/no-ask-user-question.sh` | Always — a hook runs on the tool call whatever mode the session is in |

The second layer is not redundancy. A session running with permissions bypassed never consults a deny rule, and an unattended session — a GitHub Actions runner, Claude Code on the web — is both the one that bypasses prompts and the one whose question can never be answered. The deny rule states the intent; the hook is what holds where it matters.

The denial removes an escape hatch, not an option: **an open choice was never a question to ask.** Default it and record it. A genuine blocker from the list above goes onto the issue as a comment, which is where a human will actually find it — asynchronously, in the place that already holds the run's history — rather than into a prompt in a session that has since ended.

This binds an interactive session at a keyboard exactly as it binds a pipeline run, and deliberately: the same context files drive both, and a rule that applies only when nobody is watching is a rule the pipeline cannot rely on.

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
