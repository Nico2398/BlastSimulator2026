---
name: agentic-pipeline-multi
description: >
  Multi-pipeline for a task mixing several task types: decompose it into ordered
  sections, run each code section's TDD cycle (`agentic-pipeline-tdd`) onto one
  shared feature branch, run question and command sections in place, and
  finalize once into a single PR (`agentic-pipeline-finalization`).
---

## ▶ PROCEDURE — EXECUTE IN ORDER

```
 1. [decompose]   Split the task into N ordered sections:
                  { id, title, task_type, acceptance_criteria }, task_type one of
                  feature, fix-bug, ask, executor, review-pr. One issue for all of them.
 2. [plan-all]    One plan file per code section (`agentic-pipeline-tdd`'s format), and a
                  TODO list naming the order: "Section 1 → … → Section N. Single PR."
 3. For each section K:
      code (feature, fix-bug) → `agentic-pipeline-tdd` with
          label     = <run-label>-s<K>
          --feature   pipeline/feature-<run-label>
          --base      main for K = 1, pipeline/feature-<run-label> after
      ask / executor / review-pr → that pipeline's skill, in place; its result goes in
          the PR body.
 4. After every section:
      [visual-loop]   once, for all player-facing sections — `agentic-pipeline-full`
      [refactor] and [context]  once — `agentic-pipeline-full`
      Finalization    once — `agentic-pipeline-finalization`, its reviewer briefed with
                      every section's label
```

`<run-label>` is `<issue>-<runId>` (`agentic-pipeline-tdd`'s Branch naming, and the #554 incident behind it). Every section joins onto `pipeline/feature-<run-label>`, so each section's tests run against everything the earlier sections built — `verify` after each join catches a cross-section regression where it entered.

### Rules

- Each section has its own blind phase, its own RED proof and its own seven-failure budget.
- One review, one PR, one CI wait, at the end.
- A non-code section creates no branch and runs no cycle.
