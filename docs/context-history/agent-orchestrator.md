# History — `orchestrator` agent

This file records why the rules in the `orchestrator` agent definition (`.claude/agents/orchestrator.md`) exist.

## Frontmatter (`hooks` comment)

A frontmatter hook is registered only for an agent started through the `Agent` tool, and `/agentic-run` forks the session into this agent instead — so this block alone never fired, and issue #406 lost its run to a backgrounded sub-agent. That is why enforcement moved to `.claude/settings.json`.

## Spend tokens where they buy quality — focused `logic`

`verify`'s `logic` channel runs the test files the diff reaches; the whole suite is CI's. Same measurement as `docs/context-history/entry-points.md`'s `logic` section.

## STEP 1 — the `epic` row

Added on 2026-11-09 with the epic system. An owner's `@claude` mention on an epic starts a runner session on it, and without its own row an epic reads as a feature request — the full pipeline would try to build the whole batch, and the ask pipeline would close it `done` whatever the code did. The hard-constraint exceptions follow from the owner's rule that an epic carries `epic` and nothing else.
