---
name: agentic-issue-creation
description: Create or edit GitHub issues for agentic pipeline consumption — context, files, test files, dependencies (setting or reading a blocked_by relationship), labels, and verification criteria. Use when creating an issue for autonomous coding agents, or when editing an existing one's dependencies, labels, or lifecycle state.
---

# Skill: agentic-issue-creation

## When to Use

Use when creating a GitHub issue that an autonomous run will pick up, or when editing an already-filed one's dependencies, labels, or lifecycle state. An issue is the only input the pipeline takes, so it has to stand on its own — the run starts with the issue body and the codebase, and nothing else. Setting a `blocked_by` relationship on an existing issue is this skill's task exactly as much as authoring a new one is — see "Setting a dependency" below.

Two shapes are valid, and they differ in how much of the answer is already known:

| Shape | Written by | Carries |
|-------|-----------|---------|
| **Intent** | A human filing from the issue form or free-form | Context, Task, Verification, and any Blocked by. The planner derives the files and the tests. |
| **Complete** | An agent decomposing a feature into atomic tasks | Every section below. The decomposition already knows the file layout, so it states it. |

Both enter the same queue once `ready` lands on the issue — a two-line issue typed from a phone is still a valid input, and where it leaves a choice open, the run defaults it under `agentic-decision-autonomy` rather than bouncing it back. Entering the queue is not being picked up: runs start only on a manual dispatch of `agentic-trigger.yml`, from a merged pipeline pull request, or from a run that ended `blocked`.

## ▶ PROCEDURE — EXECUTE IN ORDER

1. Pick the shape: complete when you know the file layout, intent when you are describing an outcome
2. Fill every section that shape carries, using the headings below verbatim
3. Verify the Rules are satisfied
4. Run through the Checklist
5. Create the issue with `gh issue create`, setting labels yourself:
   - Human gave no instruction about labels → `--label ready,agent-task`. `ready` means eligible, not started: it places the issue in the queue, where it waits until a human dispatches `agentic-trigger.yml` or a merged pipeline PR chains to it. Creating an issue never starts a run.
   - Human specified labels, or said the issue should wait — `decision-review` for a default to revisit later, or an explicit hold — → follow that instruction instead, and leave `ready` off.

An issue that must **stay out** of the queue is created carrying a lifecycle label of its own instead of `ready` — `decision-review` for a default to revisit later. The issue joins the queue in number order once `ready` is on it, whoever put it there.

## Issue Body Template

```markdown
## Context
[Why this task exists. What larger feature it's part of. Where it fits in the implementation sequence.]

## Task
[What is different once this is done. The mechanic, screen, or behaviour that changes.]

## Files
- `path/to/file.ts` — create | modify — [specific change description]

## Test
- `path/to/test.ts` — create | modify — [what test should verify]

## Blocked by
- #N — [what must be completed first]
- If no dependencies, write: `None`

## Conventions
- [Any specific patterns, imports, naming, or code style to follow]

## Verification
- [Observable outcome that proves the task is done]
```

## Rules

1. **Every section the shape carries is required.** A run starting with zero context must be able to work from the issue alone.
2. **File paths are exact** — relative to workspace root, forward slashes.
3. **A dependency is set as a GitHub relationship, and written under `Blocked by` as well.** The relationship is what the queue trusts — a body reference is a mention, and quoting an issue must not be able to block on it — while the section is what a human reads. Setting one and not the other is the failure worth avoiding: a relationship with no section leaves the next reader guessing, and a section with no relationship is legacy, honoured only because issues written before relationships existed carry their dependencies there. Procedure below. A dependency mentioned outside a `Blocked by` heading, a `**Blocked by**` line, or a line starting `Blocked by:` / `Depends on:` is not read as one.
4. **Verification is observable** — a state to reach, a value to return, a thing visible on screen. Naming a command is optional: the run picks its verification channels from the Verification Gate.
5. **Test files map to the test pyramid** (unit/integration/visual/scenario) per `dev-testing-strategy`.
6. **Leave out implementation hints, solution approaches, and code snippets** — the run derives those from the codebase.
7. **Context explains the "why"** — what feature, what phase, what goal.
8. **Single task per issue.** A task touching several concerns is several issues. So is a task that is one concern but too large for one run — Sizing below is the test, and Splitting is what to do about it.
9. **SMART compliance.** Specific (one clear goal), Measurable (verifiable outcome), Achievable (within an agent's capabilities), Relevant (part of the larger feature), Time-bound (a single atomic task).
10. **`full-ci` is off by default — an issue has to earn it.** The label starts the interaction-mode browser job, which costs the merge path real time, so it goes on an issue only where that job is the only thing that could catch the regression: an interaction-mode scenario clicks its way through the control, panel or flow the issue changes, or the issue touches shared input, picking, camera, rendering or harness machinery every scenario runs through. **Never on a backend-only issue.** A change confined to `src/core/`, `src/console/`, config or pure logic is proven by `static`, `logic` and command-mode `scenario`; replaying browser flows the diff never reaches reports nothing about it. **Never where there is no interaction regression to catch** — a renderer detail no scenario reaches, a control added to an existing panel, copy, a new command parameter. The `visual` channel covers those in-session against the thing that actually changed, which is stronger evidence than a suite that never touches it. When in doubt, leave it off. Full test and cost: `agentic-pipeline-pr-management`.
11. **Label transfer.** A PR opened from a `full-ci` issue gets the same label, passed on the same `gh pr create` call that opens it (`--label "full-ci"`) — never a follow-up `gh pr edit --add-label`, which raises no `pull_request` event of its own and is how PR #615 merged with its interaction-mode job silently skipped. See `agentic-pipeline-finalization`'s `open-pr` step.

## ▶ Sizing — one issue is one run, and a run has a ceiling

An issue is not a unit of work, it is a unit of **assignment**: one run picks it up and carries it to a merged pull request inside a single job, whose budget is finite (`agentic-autonomous-pipeline` holds the number and what happens at the end of it). An issue that cannot finish inside that budget does not fail politely. The job is cancelled mid-work and what survives is whatever `agentic-rescue` can push — an unreviewed branch, a draft PR, a `blocked` issue, and a human who now has to work out which half is done. Issue #553 is the case to remember: its `## Test` section listed 64 scenario definitions to update **one at a time**, the run spent the entire budget, and it was cut off with 11 of them still red.

Before filing, ask whether **one run** could take this to a merged PR. Each of these says it could not, and each one means split:

- The Files or Test section enumerates more than about ten files.
- The body says "one at a time", "every remaining", "each of the N", or names a suite to migrate.
- The change breaks a behaviour that many tests, scenarios or callers depend on. The blast radius is the size, not the diff.
- Landing it means re-deriving values other files assert — tick counts, cash schedules, win/lose outcomes — in more than a handful of them.

Atomic is not the same as small. An issue that changes one mechanic across the three files that own it is atomic however deep the change goes, and splitting it further only buys handovers.

Parallel delegation raises this ceiling, but only for the right shape of work: a fan-out of sub-agents over N independent files multiplies throughput when every file takes the same recipe, and buys nothing where each file needs its own premise re-derived. Size the issue for the second case unless the first is demonstrably true. What parallel means here, and the backgrounding it never means, is in `agentic-pipeline-review-pr`.

## ▶ Splitting a change that breaks a whole suite

The obvious split — the mechanic in one issue, the tests it breaks in the next — is the one split that is never allowed. Its first PR merges red, and `main` stops being something the next run can branch from. **Every issue in a split must be able to reach a green PR on its own.** Three ways to get there, in the order to try them:

1. **Split the enablers off first, not the files.** Ask what makes each of the N files expensive and file *that* as its own issue ahead of the migration. It is usually a missing affordance: a knob the scenarios cannot set, a wait each file has to hand-measure, an identifier that drifts. #553 carried three — `campaign start` had no `staffed:` option (#551 gave one to `new_game` and `sandbox` only), every file needed its own sandbox-measured tick pad before its holes landed, and contract ids drifted under the added ticks so each file had to be renumbered by hand. Land a `staffed:` for campaign starts, a `tick_until <field>:<value>` step, and a stable way to name a contract, and most of the 64 files become a two-line edit that fits in one run. This is the best split available: it shrinks the work instead of rescheduling it, and the affordances outlive the migration.
2. **Land the new behaviour switched off, migrate, then flip it.** The mechanic ships opt-in so the suite still passes on the old path, each batch issue moves a slice of callers onto the new one, and the last issue flips the default and deletes the switch. Every PR is green. The cost is a dual code path that must not be allowed to survive, so file the flip issue in the same batch as the rest, `Blocked by` all of them.
3. **Stack the batches on an integration branch.** Sub-issues target the feature branch rather than `main`, and only the final merge has to be green. Last resort: assignability, auto-merge and rescue all assume a PR against `main`, so a human has to shepherd it.

Batch issues are ordinary issues — `Blocked by` the enabler, one slice each, verification of their own.

## Setting a dependency

Relationships are REST-only, on `/repos/{owner}/{repo}/issues/{number}/dependencies/blocked_by`.
No CLI subcommand and no MCP tool wraps them — in particular the GitHub MCP's
`sub_issue_write` is parent/child hierarchy, a different relationship that the
queue does not read as a dependency. The endpoint takes `issue_id` — the
issue's **database id**, not its number — which is the one detail that makes
this fail silently if guessed.

Use whichever transport the session has. Both call the same endpoint.

**With `gh`:**

```bash
REPO=Nico2398/BlastSimulator2026
BLOCKER_ID=$(gh api "repos/$REPO/issues/<blocker-number>" --jq .id)
gh api --method POST "repos/$REPO/issues/<blocked-number>/dependencies/blocked_by" \
  -F "issue_id=$BLOCKER_ID"
```

**Without `gh`** — Claude Code on the web has no `gh` CLI, but does carry a
`GITHUB_TOKEN` (and `GH_TOKEN`) in the environment, so `curl` reaches the same
endpoint. Never echo the token; pass it straight from the variable.

```bash
API=https://api.github.com
REPO=Nico2398/BlastSimulator2026
BLOCKER_ID=$(curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$API/repos/$REPO/issues/<blocker-number>" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -sS -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" \
  -d "{\"issue_id\":$BLOCKER_ID}" \
  "$API/repos/$REPO/issues/<blocked-number>/dependencies/blocked_by"
```

The blocker-id lookup is skippable when the blocker was created in this same
session: `mcp__github__issue_write` returns the database id as `id` in its own
response, which is exactly the value `issue_id` wants. Capture it at creation
rather than re-fetching.

Read them back, and remove one, with:

```bash
gh api "repos/$REPO/issues/<number>/dependencies/blocked_by" --jq '.[].number'
gh api --method DELETE "repos/$REPO/issues/<blocked-number>/dependencies/blocked_by/$BLOCKER_ID"
```

```bash
curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
  "$API/repos/$REPO/issues/<number>/dependencies/blocked_by" \
  | python3 -c "import sys,json; print([i['number'] for i in json.load(sys.stdin)])"
```

**Verify the relationship after setting it.** A `POST` that 4xx'd leaves an issue
that reads as blocked to a human and is assignable to the queue — the one
direction that matters. A successful `POST` returns the *blocked* issue's own
object, which looks identical whether or not the dependency landed, so the
response body is not the confirmation. The read-back above is the check.

**Never downgrade to a body-only dependency because the transport looked
unavailable.** The body's `Blocked by` section is honoured — `assignability.cjs`
unions it with the real relationships — so a body-only dependency does hold the
queue, which is exactly why skipping the relationship is easy to miss: nothing
fails, and the issue simply never gains the relationship a human reading the
GitHub UI expects to see. Establish the transport first; both are available in
every session this project runs in.

When several issues are filed as a batch, set every relationship before adding
`ready` to any of them: `ready` is the only thing standing between an issue and
an assignment, and an issue that gains it a moment before its dependency is
recorded can be picked up in that window.

## Checklist

- [ ] Title starts with feature context ("Add tutorial level - ...")
- [ ] Context section explains the larger feature and this task's place in it
- [ ] Task section states what changes
- [ ] Complete shape only: Files and Test sections name every file and what it verifies
- [ ] Dependencies set as GitHub `blocked_by` relationships — via `gh` or, with no `gh` CLI, `curl` with `$GITHUB_TOKEN` — and read back to confirm
- [ ] The same dependencies written under a `Blocked by` heading as `#N` references
- [ ] For a batch, every relationship set before `ready` goes on any of them
- [ ] Verification is a concrete observable outcome
- [ ] SMART criteria respected
- [ ] One run could carry this to a merged PR — no signal from Sizing fires
- [ ] If it was split: every issue in the split reaches a green PR on its own, and the enablers were split off before the files
- [ ] An issue that must stay out of the queue carries its own lifecycle label
- [ ] `full-ci` left off unless the interaction-mode job is the only thing that could catch the regression — never on a backend-only issue, never where no interaction regression exists
- [ ] If the issue has `full-ci`, the PR gets `full-ci` when opened
- [ ] Labels set on creation: `ready,agent-task` unless the human specified otherwise or the issue must stay out of the queue
