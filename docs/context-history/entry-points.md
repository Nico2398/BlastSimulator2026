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

## ▶ Verification Gate — `logic` is split between the session and CI

Issues #2142, #2143, #2148, #2154 and #2199 each ran their agent step for the whole 270-minute budget (Nov 2026). The `agentic-metrics` branch's 58 recorded runs (159 wall-hours) put the model's own API time at about 6 hours — 4 % — and the waiting at: 49 hours inside `npm run pipeline -- verify`, 23.5 hours inside `npm run ci:await`. `verify` ran the whole vitest suite (734 s for 1005 files on a 4-core sandbox, longer on the runner) five to seven times per run, and its per-tree cache almost never answered because every fix changes the tree. CI then ran the same suite twice more on every head — once in the test shards, once more, unsharded, under coverage (45 minutes, the longest job of every CI run). The local runs were the duplicate, so `logic` became a focused pre-flight in the session and the whole suite CI's alone.

An import-graph measurement drove the selection: a third of `src/` reaches ~98 % of the suite transitively, so "every related test" saves nothing for a core change, while the tests that import a changed module directly cost 32 s of test time at the 90th percentile.

### ▶ There is no later turn — the commands that outrun one call (Nov 2026)

The list named `npm run test` at ~270 s and `npm run scenarios` at ~90 s. Measured again while the timeouts above were investigated: the whole suite took 734 s on a 4-core sandbox before its slowest files stopped repeating identical sandbox starts (the heaviest went from 181 s to 45 s), and the scenario batch 117–123 s serially, about a minute once it fanned out across worker processes. The whole suite stopped being a session command at the same time: `verify` runs it only for a diff that changes how every test runs.

## Verification Gate — the `visual` row captures the steps that show a change (Nov 2026)

The row named `--screenshots`, a capture at every step, which is how the visual-tester came to spend up to three hours re-running scenarios CI plays in seconds (`docs/context-history/agent-visual-tester.md`).
