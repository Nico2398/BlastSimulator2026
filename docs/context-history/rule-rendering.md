# History — rule-rendering

This file records why the rules in the `rendering` rule (`.claude/rules/rendering.md`) exist.

## Interactive changes capture the steps that show them (Nov 2026)

Step 4 drove the real UI with `--screenshots`, a capture at every step. Each capture renders a frame in software, so a scenario CI plays in seconds took minutes per step locally — the visual-tester's share of the pipeline's wall clock (`docs/context-history/agent-visual-tester.md`). It now captures the steps that show the change.
