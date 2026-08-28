---
name: agentic-issue-creation
description: Create or edit GitHub issues for agentic pipeline consumption — context, files, test files, dependencies (setting or reading a blocked_by relationship), labels, and verification criteria. Use when filing an issue for autonomous coding agents, when recording technical debt, a codebase gap, an inconsistency or a defect found while working on something else, when cutting a task that turns out to be bigger than one run and filing the remainder, or when editing an already-filed issue's dependencies, labels, or lifecycle state.
---

# Skill: agentic-issue-creation

## When to Use

Use when creating a GitHub issue that an autonomous run will pick up, when recording something found while working on a different task, when cutting an oversized task and filing the remainder, or when editing an already-filed one's dependencies, labels, or lifecycle state. An issue is the only input the pipeline takes, so it has to stand on its own — the run starts with the issue body and the codebase, and nothing else. Setting a `blocked_by` relationship on an existing issue is this skill's task exactly as much as authoring a new one is — see "Setting a dependency" below.

Four situations put an agent here, and they differ only in what the issue records:

| Situation | What the issue carries |
|-----------|------------------------|
| **Planned work** — decomposing a feature, or a human filing a task | The task itself, in one of the two shapes below |
| **A finding** — technical debt, a codebase gap, an inconsistency, a defect noticed while working on something else | The finding, plus where it was found and why it was not fixed on the spot |
| **A blocker you routed around** — something in your task's way that you bypassed with a `TODO(#N)` | The finding, plus the bypass to remove and the file it is in |
| **A scope cut** — the assigned task turns out to be bigger than one run can carry | The remainder deliberately left out, and what was landed instead |

All three of the latter become ordinary issues the moment they are filed. They differ from planned work only in provenance, which the template's optional sections carry.

**Not everything you find belongs here.** The Follow-up Gate in `CLAUDE.md` sorts that, and `agentic-decision-autonomy` holds the procedures: something small enough to fix where you stand is fixed, not filed. Filing is for work that is genuinely its own task. An issue per two-minute fix costs a whole run to deliver two minutes of work.

**Convention debt is not filed at all.** Duplication, file length, naming, comment drift, a missing mirrored test, "consider extracting" — in code the run wrote, @refactorer fixes it in the run; in code the run only read, it is recorded in the run's follow-up comment and goes no further. That class reproduces off the pipeline's own output: every merged pull request is fresh surface for the same reviewers, so filing it makes the queue grow with throughput instead of with need. A convention worth holding is worth a lint test under `tests/unit/lint/` — the file-size budget is the worked example — and a convention a test already owns is never issue material. What earns an issue is a defect: behaviour observably wrong, or a verification channel that fails to prove what it claims. `agentic-pipeline-finalization` holds the gate and the per-run cap.

Two shapes are valid, and they differ in how much of the answer is already known:

| Shape | Written by | Carries |
|-------|-----------|---------|
| **Intent** | A human filing from the issue form or free-form | Context, Task, Verification, and any Blocked by. The planner derives the files and the tests. |
| **Complete** | An agent decomposing a feature into atomic tasks | Every section below. The decomposition already knows the file layout, so it states it. |

Both enter the same queue once `ready` lands on the issue — a two-line issue typed from a phone is still a valid input, and where it leaves a choice open, the run defaults it under `agentic-decision-autonomy` rather than bouncing it back. Entering the queue is not being picked up: runs start only on a manual dispatch of `agentic-trigger.yml`, from a merged pipeline pull request, or from a run that halted — `blocked` or `paused` — chaining past itself.

## ▶ PROCEDURE — EXECUTE IN ORDER

1. Run the duplicate check below. An open issue that already covers it is updated, not duplicated
2. Pick the shape: complete when you know the file layout, intent when you are describing an outcome
3. Fill every section that shape carries, using the headings below verbatim
4. Verify the Rules are satisfied
5. Run through the Checklist
6. Create the issue with `gh issue create`, setting labels per the Labels section below. A human who specified labels, or said the issue should wait, overrides that table

`ready` means eligible, not started: it places the issue in the queue, where it waits until a human dispatches `agentic-trigger.yml` or a merged pipeline pull request chains to it. Creating an issue never starts a run. The issue joins the queue in number order once `ready` is on it, whoever put it there.

## ▶ Duplicate check — run before filing anything

An issue nobody reads twice is cheap; two issues for one problem are not. They split the discussion, and the second run to pick one up rediscovers what the first already fixed.

1. Search open issues for the thing itself rather than for your phrasing of it — the symbol, the file path, the error text, the convention being violated.
   ```bash
   gh issue list --state open --search "<symbol or file path>" --limit 20
   gh issue list --state open --label agent-task --limit 50   # when the term is a concept, not a string
   ```
   With no `gh` CLI — Claude Code on the web has none — the same search runs against the REST API with the `GITHUB_TOKEN` already in the environment. Never echo the token; pass it straight from the variable.
   ```bash
   curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
     --get --data-urlencode "q=repo:Nico2398/BlastSimulator2026 is:issue is:open <terms>" \
     "https://api.github.com/search/issues" \
     | python3 -c "import sys,json; [print(i['number'], i['title']) for i in json.load(sys.stdin)['items']]"
   ```
2. **A match that covers your finding → update it.** Add what you learned as a comment when it is evidence (a second occurrence, a reproduction, an exact line number), or edit the body when it is a correction (a wrong path, a missing consumer, a premise that no longer holds). Name the run that found it, so the next reader knows where the addition came from.
3. **A match that overlaps without covering it** → file, and name the neighbour in your Context section so a human can merge the two if they disagree.
4. **A closed match** → read how it closed. Closed with a merged pull request means the problem came back and yours is a regression report, which is worth saying in the body. Closed unmerged means it was declined, and refiling needs a reason.

Searching costs one command. Filing a duplicate costs a run.

## ▶ Labels — `ready` is a confidence statement

`agentic-assign` selects on `ready` alone. Putting it on an issue says *this work should be done, and the description is good enough to start from.* Putting it on a hunch spends a whole run discovering the hunch was wrong.

| Confidence | Labels | What follows |
|-----------|--------|--------------|
| **High** — a defect you reproduced, a convention you can point at, a gap you verified in the code | `agent-task`, `ready` | The work is real and specified. The issue joins the queue in number order. |
| **Open** — something looks wrong, and a human should confirm it is worth doing or pick between two directions | `agent-task` | The issue stays out of the queue until a human adds `ready`. |
| **Already decided by the run** — a default you implemented that a human may want to revisit | `decision-review` | Held by `agentic-decision-autonomy`, which owns that flow end to end. |
| **In the way of a run right now** — you bypassed it with a `TODO(#N)`, or you paused behind it | `agent-task`, `ready` | Highest confidence there is: you hit it head-on. Another issue is queued behind this one, so it earns its place at the front. |

**`paused` is not a label you put on an issue you file.** It goes on the issue whose *run* stopped — alongside `ready`, with this new issue as its `Blocked by` — and `agentic-assign` strips it when that issue is picked up again. `agentic-decision-autonomy` holds the procedure.

An issue held for confirmation carries an `## Open question` section naming exactly what a human must answer and what changes with each answer. Without it the issue is a hunch nobody can act on, and it waits until someone re-derives the question you already knew.

Leave `ready` off while you are uncertain. An issue carrying `agent-task` alone loses nothing — it keeps its number, its body and its place — and gains `ready` the moment a human agrees.

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

## Where found
[Findings and scope cuts only. Which run, which pull request or review round, what was being worked on at the time.]

## Why not fixed here
[Findings and scope cuts only. Why filing was right rather than folding it into the work in hand.]

## Bypass to remove
[Bypassed blockers only. The exact `TODO(#N)` comment and the file and function it sits in,
what the workaround currently does, and what should replace it. Closing this issue means
deleting that comment and the workaround with it.]

## Open question
[Issues held at `agent-task` without `ready` only. What a human must answer, and what changes with each answer.]
```

The last four sections are provenance and are omitted for planned work. `## Where found` and `## Why not fixed here` are what let the next reader judge a finding without reconstructing the review round that produced it; `## Bypass to remove` is what stops a `TODO(#N)` outliving the issue that owns it; `## Open question` is what a human answers before adding `ready`.

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
11. **Search before filing, and update what already exists.** An open issue covering the same problem is updated rather than duplicated — procedure above.
12. **`ready` states confidence, not hope.** It goes on an issue whose work is verified real and whose description is good enough to start from. Anything short of that is `agent-task` alone, with an `## Open question` section naming what a human must answer.
13. **Label transfer.** A PR opened from a `full-ci` issue gets the same label, passed on the same `gh pr create` call that opens it (`--label "full-ci"`) — never a follow-up `gh pr edit --add-label`, which raises no `pull_request` event of its own and is how PR #615 merged with its interaction-mode job silently skipped. See `agentic-pipeline-finalization`'s `open-pr` step.
14. **An issue that owns a bypass says so, and says where.** A `TODO(#N)` in the codebase and issue #N are one unit: the comment points at the issue, and the issue's `## Bypass to remove` and `## Files` point back at the comment. Either half alone rots — a bare `TODO` nobody can queue, or an issue that lands and leaves its workaround in place. Closing the issue deletes the comment.
15. **A blocker filed from inside a run comes first.** Something that stopped or diverted a live run is reproduced, specified and urgent by construction — another issue is queued behind it. File it `ready` unless you genuinely could not characterise it.

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

## ▶ Discovering mid-run that the task is bigger than one run

Sizing above is the test applied *before* filing. The same ceiling exists mid-run, and reaching it is ordinary: the issue was sized on what a reader could see, and the codebase disagreed.

What turns it into a lost run is carrying on regardless. A run that spends its whole budget is not cancelled politely — the job is killed, and what survives is whatever `agentic-rescue` can push: an unreviewed branch, a draft pull request, a `blocked` issue, and a human working out which half is done.

Cut instead:

1. **Pick the slice that reaches a green pull request on its own.** Not the slice already written — the slice that is coherent. A half-migrated call site is worse than an unmigrated one.
2. **Land it, verified through every channel it owes.** A reduced scope changes nothing about the Verification Gate.
3. **File the remainder**, one issue per slice, each able to reach green alone. The three splitting strategies above apply unchanged, and splitting the enablers off first is still the best of them.
4. **Say what was cut**, in the pull request body and on the original issue, naming the new issue numbers. A remainder nobody can find is a remainder nobody does.
5. **Set `Blocked by` only where a real ordering exists.** Slices touching different files are independent, and marking them blocked on each other serialises work that could run side by side.

The original issue closes on its own merged pull request with its reduced scope stated. It stays open to track nothing — that is what the new issues are for, and an issue held open past its own merge defers every assignment behind it.

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
- [ ] Open issues searched for this problem — none covers it, or the existing one was updated instead of a new one filed
- [ ] Labels set on creation per the Labels table: `ready` only at high confidence, `agent-task` alone otherwise, unless the human specified something else
- [ ] An issue held for confirmation carries `## Open question`
- [ ] A finding or a scope cut carries `## Where found` and `## Why not fixed here`
- [ ] A scope cut names its remainder issues in the pull request body and on the original issue
- [ ] The finding was too big to fix on the spot — anything small enough was fixed, not filed
- [ ] The finding is a defect, or a structural filing (bypass, pause, scope cut, decision) — convention debt is recorded in the run's follow-up comment, never filed
- [ ] The run has filed no other finding: one filed finding per run, structural filings aside
- [ ] A bypassed blocker carries `## Bypass to remove`, and its `## Files` names the file the `TODO(#N)` sits in
- [ ] A blocker a run paused behind is set as that issue's `blocked_by` relationship **and** written under its `Blocked by` heading, and read back to confirm
