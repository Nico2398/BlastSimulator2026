---
name: agentic-pipeline-fix-bug
description: >
  Fix-bug pipeline: the TDD cycle (`agentic-pipeline-tdd`) with a RED test that
  reproduces the bug, then finalization (`agentic-pipeline-finalization`) without
  the refactor phase.
---

## ▶ PROCEDURE — EXECUTE IN ORDER

```
 1. TDD cycle      → `agentic-pipeline-tdd`, label = <issue>-<runId>.
                     The Contract's first criterion is the bug's reproduction: the input,
                     the wrong result today, the right one. The skeleton is often empty —
                     a fix adds no API — so commit `skeleton: none (#<issue>)` with
                     `git commit --allow-empty` and split from it.
 2. [visual-loop]  → Only when the bug is player-facing — `agentic-pipeline-full`'s loop.
 3. Finalization   → `agentic-pipeline-finalization`.
```

No refactor phase: a bug fix changes what the bug needs and nothing else. A fix whose root cause sits in code the issue did not name is still this run's fix; a neighbouring defect it reveals is a finding (`agentic-pipeline-finalization`'s follow-up register).

### Failure loops

| Failure at | Loops back to |
|------------|--------------|
| TDD cycle | `agentic-pipeline-tdd`'s failure handling |
| The reproduction passes on `main` | The bug is not what the issue says: comment what was tried, and either find the real reproduction or close the issue as `done` with the evidence (the Definition of Done for a non-diff deliverable, `agentic-autonomous-pipeline`) |
| Finalization | `agentic-pipeline-finalization` |
| Any step × 7 | Comment the history on the issue, stop with `ESCALATED: human intervention required` |
