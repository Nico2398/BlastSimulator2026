---
name: agentic-decision-autonomy
description: >
  How an autonomous run resolves an underspecified requirement on its own: the default-and-record
  rule, the narrow list of genuine blockers, and how a defaulted decision is recorded so a human can
  revisit it later. Use when a task leaves a choice open, or when weighing whether to escalate.
---

# Decision Autonomy

A pipeline run gets one turn and has nobody to ask. Underspecification is the normal state of an issue — humans write the main line and leave the corners implicit — so **an open choice is work to do, not a reason to stop.**

The cost of stopping is concrete: a halted run holds its issue `in-progress`, which defers every later assignment until a human returns. A wrong default costs one follow-up issue.

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

## ▶ Genuine blockers — the whole list

Escalate only when the work cannot be produced, or cannot be trusted once produced:

| Blocker | Shape it takes |
|---------|----------------|
| Contradictory requirements | The issue asks for X and for not-X; no reading satisfies both, and picking one silently discards stated intent |
| Missing external dependency | A credential, asset, endpoint, or data file the run cannot obtain and cannot substitute |
| Capability gap | The task needs something the runtime does not have — see the Capability Gate in `CLAUDE.md` |
| A verification channel cannot run | `VISUAL: BLOCKED`, no browser, dev server unreachable — the work may be right but nothing can prove it |
| Irreversible action outside the ask | Force-pushing a shared branch, deleting work the run does not own, rewriting published history |

Escalation is the same shape as any other halt: label the issue `blocked`, comment what is missing and what would unblock it, stop with `ESCALATED: <reason>`.

Everything not on that list is a decision to take.

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
