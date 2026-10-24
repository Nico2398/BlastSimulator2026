# History — `orchestrator` agent

This file records why the rules in the `orchestrator` agent definition (`.claude/agents/orchestrator.md`) exist.

## Frontmatter (`hooks` comment)

A frontmatter hook is registered only for an agent started through the `Agent` tool, and `/agentic-run` forks the session into this agent instead — so this block alone never fired, and issue #406 lost its run to a backgrounded sub-agent. That is why enforcement moved to `.claude/settings.json`.
