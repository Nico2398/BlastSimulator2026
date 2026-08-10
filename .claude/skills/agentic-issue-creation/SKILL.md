---
name: agentic-issue-creation
description: Create GitHub issues formatted for agentic pipeline consumption with complete context, files, test files, dependencies, and verification criteria. Use when creating issues for autonomous coding agents.
---

# Skill: agentic-issue-creation

## When to Use

Use when creating a GitHub issue that an autonomous run will pick up. An issue is the only input the pipeline takes, so it has to stand on its own — the run starts with the issue body and the codebase, and nothing else.

Two shapes are valid, and they differ in how much of the answer is already known:

| Shape | Written by | Carries |
|-------|-----------|---------|
| **Intent** | A human filing from the issue form or free-form | Context, Task, Verification, and any Blocked by. The planner derives the files and the tests. |
| **Complete** | An agent decomposing a feature into atomic tasks | Every section below. The decomposition already knows the file layout, so it states it. |

Both enter the same queue once `ready` lands on the issue — a two-line issue typed from a phone is still a valid input, and where it leaves a choice open, the run defaults it under `agentic-decision-autonomy` rather than bouncing it back. Entering the queue is not being picked up: runs start only on a manual dispatch of `agentic-trigger.yml` or from a merged pipeline pull request.

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
3. **Dependencies go under `Blocked by`, as `#N` issue references.** The heading is what defers the issue until its dependencies close; a dependency mentioned anywhere else is not seen.
4. **Verification is observable** — a state to reach, a value to return, a thing visible on screen. Naming a command is optional: the run picks its verification channels from the Verification Gate.
5. **Test files map to the test pyramid** (unit/integration/visual/scenario) per `dev-testing-strategy`.
6. **Leave out implementation hints, solution approaches, and code snippets** — the run derives those from the codebase.
7. **Context explains the "why"** — what feature, what phase, what goal.
8. **Single task per issue.** A task touching several concerns is several issues.
9. **SMART compliance.** Specific (one clear goal), Measurable (verifiable outcome), Achievable (within an agent's capabilities), Relevant (part of the larger feature), Time-bound (a single atomic task).
10. **`full-ci` is off by default — an issue has to earn it.** The label starts the interaction-mode browser job, which costs the merge path real time, so it goes on an issue only where that job is the only thing that could catch the regression: an interaction-mode scenario clicks its way through the control, panel or flow the issue changes, or the issue touches shared input, picking, camera, rendering or harness machinery every scenario runs through. **Never on a backend-only issue.** A change confined to `src/core/`, `src/console/`, config or pure logic is proven by `static`, `logic` and command-mode `scenario`; replaying browser flows the diff never reaches reports nothing about it. **Never where there is no interaction regression to catch** — a renderer detail no scenario reaches, a control added to an existing panel, copy, a new command parameter. The `visual` channel covers those in-session against the thing that actually changed, which is stronger evidence than a suite that never touches it. When in doubt, leave it off. Full test and cost: `agentic-pipeline-pr-management`.
11. **Label transfer.** A PR opened from a `full-ci` issue gets the same label: `gh pr edit <number> --add-label "full-ci"`.

## Checklist

- [ ] Title starts with feature context ("Add tutorial level - ...")
- [ ] Context section explains the larger feature and this task's place in it
- [ ] Task section states what changes
- [ ] Complete shape only: Files and Test sections name every file and what it verifies
- [ ] Dependencies live under a `Blocked by` heading as `#N` references
- [ ] Verification is a concrete observable outcome
- [ ] SMART criteria respected
- [ ] An issue that must stay out of the queue carries its own lifecycle label
- [ ] `full-ci` left off unless the interaction-mode job is the only thing that could catch the regression — never on a backend-only issue, never where no interaction regression exists
- [ ] If the issue has `full-ci`, the PR gets `full-ci` when opened
- [ ] Labels set on creation: `ready,agent-task` unless the human specified otherwise or the issue must stay out of the queue
