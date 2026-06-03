---
description: Resolve a GitHub issue end-to-end through the TDD pipeline.
agent: pipeline
---

If $ARGUMENTS is non-empty, resolve GitHub issue #$ARGUMENTS.

If $ARGUMENTS is empty, auto-select from GitHub:
1. Run `gh issue list --label "agent-task" --label "ready" --state open --sort created --order asc --limit 30 --json number,title,labels`
2. Pick the first result whose labels array does NOT include "blocked"
3. Resolve that issue instead

If no eligible issue found, stop and report "No unblocked agent-task+ready issues available."
