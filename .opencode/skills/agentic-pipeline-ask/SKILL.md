---
name: agentic-pipeline-ask
description: >
  Ask pipeline: the lead answers a question read-only with file:line evidence,
  posts the answer as a comment, and releases the assigned issue as a non-diff
  deliverable. Use when the task is a question or an analysis.
---

## ▶ PROCEDURE — EXECUTE IN ORDER

Read-only analysis. No branch, no commit, no sub-agent: the lead already holds the question, and a delegate would read the same files again.

| Step | Action |
|------|--------|
| 1 | [answer] Locate the code the question is about (grep, then read the ranges), load the skill that owns the domain, and write the answer with `file:line` evidence for every claim |
| 2 | [post] `gh issue comment <N> --body-file <answer>` or `gh pr comment <N> --body-file <answer>`, formatted `**Question:** <original>` then `**Answer:** <body>` |
| 3 | [release] For an assigned issue: `gh issue edit <N> --add-label done --remove-label in-progress`, then `gh issue close <N> --reason completed` |

### Rules

- **The answer finishes the issue.** Assignment labels an issue `in-progress`, and only a merged pull request or the stall sweep takes that label off. A pipeline whose deliverable is a comment releases its own issue, or the queue defers behind a run that already succeeded — the Definition of Done for a non-diff deliverable (`agentic-autonomous-pipeline`).
- A question asked on a pull request has no issue lifecycle: post the answer and stop.
- An answer that turns out to need a code change is still an answer: say what the change would be, and file it per `agentic-issue-creation` when it is a defect.
