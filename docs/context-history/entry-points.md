# History — entry points (`.claude/CLAUDE.md`, `.github/copilot-instructions.md`, `.opencode/AGENTS.md`)

This file records why the rules in the three runtime entry points exist.

## ▶ Claude Code only — running a command that outlives one Bash call (`.claude/CLAUDE.md`)

### ▶ There is no later turn

`npm run test` has grown as the suite has. `npm run scenarios` is ~90 s in a sandbox since the #1080-era hotspot fixes and was ~9 m 20 s before them.

The rule that a backgrounded result is never collected already governed delegation (`require-foreground-agents.mjs`, issues #404 and #406) before it arrived through the shell. It cost three runs in four days:

| PR | How the turn ended | Cost |
|----|--------------------|------|
| #604 | "Scenario verification is running in the background — pausing here until it reports back." | 3 h 11 m and $30.55 of finished TDD work, discarded. Its retry repeated it in 2 m 51 s. |
| #594 | "Waiting for the background vitest run — will be notified automatically." | Both attempts, same sentence. |
| #603 | Never ended the turn — hand-rolled `timeout 280 bash -c 'until ! ps -p <pid>…'` 40+ times instead. | The whole 360-minute job budget spent polling, then the job timeout, with no budget left to retry. |

Two hooks enforce this, because prose did not hold.

The minutes-per-scenario-beat cost of a browser-driven run without a GPU was measured in #475.

## ▶ Autonomous pipeline sessions (all three entry points)

The before-ending checklist's rule about how GitHub's own merge-time parser reads a PR body was hard-won.

## ▶ Follow-up Gate — work you found that is not your task (all three entry points)

**One issue per run.** The measured cost of a pipeline that files as fast as it merges was pointed to in `agentic-pipeline-finalization`.
