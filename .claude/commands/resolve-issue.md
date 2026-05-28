---
description: Resolve a GitHub issue end-to-end through the TDD pipeline.
argument-hint: <issue number>
disable-model-invocation: true
context: fork
agent: pipeline
---

If no issue number was provided, stop and ask: "Please provide a GitHub issue number."

Resolve GitHub issue #$ARGUMENTS.
