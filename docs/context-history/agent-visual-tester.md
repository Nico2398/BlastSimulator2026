# History — agent-visual-tester

This file records why the rules in the `visual-tester` agent definition (`.claude/agents/visual-tester.md`) exist.

## Capture the steps that show the change, and only those (Nov 2026)

Of the 65 pipeline runs on the `agentic-metrics` branch at the time, 40 called the visual-tester, for 19 hours in all: 1–4 minutes on most runs, 46–190 minutes on others. The runner logs of the long ones (issues 2143, 2153, 2154, 2118) put 93–98% of that time into re-running whole interaction-mode scenarios with a screenshot at every step — tutorial-steps-visual took about 59 minutes where CI's interaction shard runs it in 28 s with no captures. Opening the screenshots, the one part CI does not do, took 0.1–0.6 minutes per run. Every capture renders a frame in software, and drawing is otherwise suspended: on money-surfaces-visual (16 steps, one camera angle), a 4-core sandbox measured 19 s with no captures, 46 s capturing the last step, and 273 s capturing every step. `--screenshot-steps` was added so a check renders only the frames it looks at, and the procedure leaves to CI the proof that every scenario still plays.

The procedure also ran `npm run a11y` and `npm run validate:state` on every call; in practice they were skipped. They are now asked for only when the change can affect them.

On issue 2118's retry the visual-tester waited 19 minutes on `npm run long` handles a timed-out first attempt had left running. That was the runner's to clean up between attempts, and it now does (`.github/scripts/agent-processes.cjs`).
