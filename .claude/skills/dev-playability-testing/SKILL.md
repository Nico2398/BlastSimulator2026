---
name: dev-playability-testing
description: >
  Playing BlastSimulator2026 autonomously to prove it is playable: the UI action probe,
  the npm run playtest harness, playtest definition format, and how to diagnose a step
  no player can complete. Use when changing any player-facing flow, when a step "cannot
  be performed", or before reporting a gameplay feature done.
---

**2026-08-09 — mid-consolidation, tracked by issue #515.** This skill is scheduled for retirement once the scenario suite's click-only enforcement is total (`docs/plans/scenario-assertions-and-playtest-removal.md`, Phase 3); its still-true content folds into `dev-visual-testing`/`dev-testing-strategy`. Until then, everything below describes real, current, required procedure. When a `role: 'player'` scenario step with `expect` would prove the same thing as a new playtest beat, add the scenario step, not the beat.

## Why This Channel Exists

The game is driven from two places. `src/console/` accepts commands; the UI offers buttons. **The console is a superset of the UI**, and that gap is where dead ends live.

A real failure this channel was built to catch: `hireEmployee` created every employee with `qualifications: []`. Surveys require a `geology` qualification, so a hired surveyor could not survey. Every other channel was green — the unit tests granted the skill with `assignSkill`, the integration tests called `employee assign_skill`, and the scenarios did the same. The model was correct. The game was unplayable, and the only thing that noticed was a human clicking buttons.

**A harness that reaches for a console command to get past a step destroys its own value.** It converts "no player can do this" into PASS. That is the one rule this channel enforces above all others.

## What You Can Ask The Running Game

The browser entry point exposes three bridges beyond `__gameState` and `__uiState`. They exist so you can play without guessing.

| Bridge | Returns | Use it to |
|--------|---------|-----------|
| `window.__uiActions()` | Every interactive control on screen: `selector`, `label`, `region`, `usable`, `blockedBy`, `hint` | Ask "what can I do right now?" instead of guessing selectors |
| `window.__probeSelector(sel)` | `null` when usable, else `'absent' \| 'disabled' \| 'hidden' \| 'zero-size' \| 'covered' \| 'pointer-events-none'` | Ask "why can't I click this?" about one control |
| `window.__tutorialState()` | `{ active, stepIndex, stepId, title, total }` | Know which tutorial card is showing, by id |

`blockedBy` is the diagnosis, not a detail:

- `disabled` — the panel decided you may not do this. Read the region's `hint`; it usually says why ("Hire a surveyor with a geology qualification first"). A permanently disabled control with no in-game way to satisfy its condition is a dead end, not a hint.
- `covered` — a real click at the control's centre would hit something else. A full-screen overlay swallowing clicks looks exactly like a broken button.
- `absent` — the control is not in the DOM. Either the panel never rendered it, or the feature has no UI at all.
- `zero-size` / `pointer-events-none` — a CSS bug; the control exists but no click can reach it.

Implementation: `src/ui/uiActionProbe.ts`.

## ▶ Where to run it: CI, not an agent sandbox

`npm run playtest` drives headless Chromium against the dev server, and every
probe it makes (`__probeSelector`, `__uiActions`, `__gameState`) is a CDP call
that waits for the main thread — that is, a full frame. Without a GPU the
terrain material costs ~6 s per frame (#475, open), so each poll costs ~6 s,
each player action several polls, and each beat minutes. Measured on a CI
runner: 11 m 30 s for "place a living quarters", 32 minutes for one definition
of three.

Two things this is *not*, both measured, so nobody re-derives them:

- **Not level loading.** A `new_game` is ~4 s and a campaign start ~16 s; the
  beat that does two full level loads takes 34 s.
- **Not the simulation.** Turning ticking off changes frame time by 1.7%. It is
  fragment shading, and it is the same on a CI runner as in a sandbox.

So the `playtest` job in `.github/workflows/ci.yml` is gated behind the
`full-ci` label, like the interaction-mode scenario job. It runs every
definition and uploads the FAIL screenshots as an artifact.

1. **When a definition drives the change: label the PR `full-ci`, push, and read
   the CI job.** Treat `Playtest (playability)` as the channel's result — read
   the failing beat and the uploaded screenshot from the run, exactly as you
   would locally. The label is a decision, not a reflex: it costs the merge path
   ~50 minutes, and the definitions in this directory are the whole channel, so
   a diff none of them clicks its way into learns nothing from running them.
   `agentic-pipeline-pr-management` holds the rule and the two other cases that
   earn the label. Labelling never withholds `READY TO MERGE` — the marker is
   what makes auto-merge wait for the job and merge on its result.
2. **Run it locally only for one named definition you are actively debugging**,
   never the whole suite: `npm run playtest -- <name> --screenshots`.
3. **Never claim the channel passed from a run you interrupted.** A run with no
   terminal line (`N/N beats reached`, `PLAYTEST PASSED`, or a `FAIL`) produced
   no result. "It was taking too long" is not a result either — say the channel
   is pending CI.

### ▶ While any browser-driven run is in flight

1. **Do not edit any file in the repo.** Vite watches the tree; a save reloads
   the page and destroys the Puppeteer execution context. The run dies with
   `Execution context was destroyed`, which reads like a game bug and is not.
2. **Do not start a second browser harness.** Screenshot, scenario and playtest
   runs each launch Chromium; two at once starve each other and make both look
   hung.
3. **Wait for the terminal line before concluding anything.** Slow is not stuck.

## ▶ PROCEDURE — Prove a flow is playable

1. Start the dev server: `npm run dev &`
2. Run the playtest: `npm run playtest -- <name> --screenshots`
3. Read the output. It stops at the first beat a player could not complete and prints the blocking control, the reason, the panel's own hint, and the full list of what *was* usable.
4. **Open the `FAIL-NN.png` with the Read tool.** The image often shows the answer immediately — a modal you did not know was open, an empty panel, a picker with nothing selected.
5. Fix the game, not the playtest. Change the definition only when the definition described the wrong player behaviour (wrong order, racing a timed card, awaiting a control that is disabled by design until a prior action).
6. Re-run until every beat passes. Report `N/N beats reached`.

`npm run playtest` with no name runs every definition.

## ▶ PROCEDURE — Diagnose a beat no player can complete

Work in this order. Stop at the first one that explains it.

1. **Read the hint.** The failure prints the region's status line. `"No selection"`, `"Ramp carved."`, `"Insufficient funds"` are answers.
2. **Check for a qualification or licence gate.** Skill-gated actions (`survey`, `drill`, driving a vehicle, management) require a `SkillCategory`. Ask: which button grants it? If the answer is "none, only the console", that is the bug. See `gameplay-employee-skills`.
3. **Check affordability.** A tutorial step the starting cash cannot pay for is a dead end even though every control works. `startingCash` is per level in `src/core/campaign/Level.ts`.
4. **Check for a covering overlay.** `blockedBy: 'covered'` names the element on top. Confirmation modals, tile pickers, and the tutorial card all overlay the scene.
5. **Check for duplicate element ids.** Several panels each own a `TileSelectOverlay`, and their forms reuse ids. A `document.getElementById` that resolves to a closed panel's control is invisible in the DOM and fatal to a click. Panel code must scope lookups to its own root.
6. **Check whether the control is disabled until a precondition.** A `point`-mode tile picker starts with Confirm disabled and enables on the first tile click. Awaiting Confirm *before* picking can never succeed.
7. **Check for a timed card.** Auto-advance tutorial steps move on after 2s. Acting before the next card appears makes that step snapshot state *after* the change it was watching for, so it never completes. Use `awaitTutorialStep`.
8. **Only then suspect the harness.** If `__probeSelector` says a control is usable and clicking it does nothing, the handler is not wired.

## Writing a Playtest

Definitions live in `scripts/playtests/*.json`. One file per flow; `name` matches the file name.

A **beat** is one thing a player is trying to do. It states its goal in plain words, performs actions, and asserts that the game moved.

```json
{
  "goal": "the hired surveyor can actually be sent to survey",
  "actions": [
    { "do": "click", "selector": "#bs-toolbar [data-panel=\"survey\"]" }
  ],
  "expect": {
    "usable": "#bs-survey-run",
    "note": "A surveyor who cannot survey is not a surveyor."
  }
}
```

### Actions

| Action | Fields | Notes |
|--------|--------|-------|
| `click` | `selector` | Fails with a diagnosis if absent, disabled, or covered |
| `clickLabel` | `label`, `region?` | Finds the first *usable* control whose label matches — survives a selector change |
| `set` | `selector`, `value` | Selects or types, then fires `input` and `change` |
| `pickTile` | `x`, `z` | Clicks a tile in the open picker, in grid coordinates. Waits for the picker to open |
| `dragTiles` | `x1`, `z1`, `x2`, `z2` | Drags a rectangle for `area`-mode pickers |
| `awaitUsable` | `selector`, `timeoutMs?` | Waits for a control that becomes usable asynchronously (a pending action resolving on a tick) |
| `awaitTutorialStep` | `stepId`, `timeoutMs?` | Waits for a tutorial card, so a timed auto-advance is not raced |
| `letTimePass` | `ticks` | The only way a playtest passes time |

### Goals

`tutorialStep` (card id), `increased` (state fields that must grow), `equals` (exact state match), `usable` (a control that must be reachable by now), `note` (free text for the report).

A beat with only a `note` is legitimate in exactly one case: the step auto-advances, so the next beat carries the assertion. Say so in the note.

### ▶ The allowlist — non-negotiable

A beat's `setup` may run only `new_game`, `campaign`, `tutorial_start`, `tick`, `time`. Everything else must be clicked.

Setting up a world and passing time are not player actions the UI hides; every other command has a button, or should have. `tests/unit/playtest-defs.test.ts` fails the suite if a definition breaks this, and the runner refuses the command at runtime. **Do not widen the allowlist to get a playtest green.** If a step needs a command, the missing button *is* the finding.

## Reading The Report

`screenshots/playtests/<name>/`:

- `beat-NN.png` — the screen after each passing beat. Inspect these too; a beat can pass while the screen is wrong.
- `FAIL-NN.png` — the screen at the blocked beat.
- `report.json` — per-beat pass/fail with the error and the full diagnosis.

## Relationship To The Other Channels

`playability` proves a player can reach the goal. It does not prove the screen looks right — for that, read the images (`dev-visual-testing`), and it does not prove the numbers are right — for that, `logic` and `scenario`.

When `playability` fails and everything else passes, believe `playability`. That combination is the signature of a feature that works perfectly and no player can use.
