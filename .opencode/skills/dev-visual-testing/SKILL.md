---
name: dev-visual-testing
description: >
  Visual and scenario testing guide for BlastSimulator2026: taking screenshots, running
  Puppeteer scenario tests, inspecting state dumps, UI diagnostics, and before/after
  verification. Use when working on rendering, UI, or any visual feature.
---

## The Visual Channel

Type checks and unit tests cannot see a black screen, a mesh at the wrong scale, or a button with zero height. This channel closes that gap by producing images and reading them.

**Capturing is not verifying.** A screenshot proves nothing until it is opened with the Read tool and described. You have vision — use it. State JSON is a complement to an image, never a substitute for one.

Confirm the channel is live before relying on it:

```bash
npm run verify:env
```

It prints the resolved browser path and whether the dev server is up, and names the remedy for whatever is missing.

## Prerequisites

Dev server on :5173 (override with `--port` or `VISUAL_TEST_PORT`):

```bash
npm run dev &
```

## ▶ What to run here, and what to leave to CI

No GPU means Chromium rasterises in software, and the terrain material costs
~6 s/frame that way (#475, open) — in a sandbox and on a CI runner alike. The
cost is per *frame*, not per level load (a `new_game` is ~4 s) and not the
simulation (ticking is 1.7% of a frame). So anything that waits on frames in a
loop runs for tens of minutes, while a single screenshot pays it once.

| Task | Where |
|------|-------|
| Single screenshot (`npm run screenshot`) | Here. Seconds to a minute; this is the channel's core loop. |
| One named scenario, interaction mode | Here, when you are debugging that scenario. |
| **All** scenarios in interaction mode | CI (`Scenarios (interaction mode)`, label a PR `full-ci`). Never in a session. |

### ▶ While any browser-driven run is in flight

1. **Do not edit any file in the repo.** Vite watches the tree; a save reloads
   the page and destroys the Puppeteer execution context mid-run. The failure
   (`Execution context was destroyed`) looks like a game bug and is not.
2. **Do not start a second browser harness.** Each launches Chromium; two at
   once starve each other and both look hung.
3. **Wait for the run's own terminal line.** Slow is not stuck — a killed run
   proves nothing, and reporting it as a stall is a false finding.

Browser resolution is automatic, in this order: `--puppeteer-path` > `PUPPETEER_EXECUTABLE_PATH` > `PLAYWRIGHT_BROWSERS_PATH` > Puppeteer's own cache > system Chrome/Chromium > conventional Playwright caches. Both environment variables state operator intent, so they outrank anything auto-discovered — an incidental `/usr/bin/chromium` on a CI runner must not shadow a sandbox-provisioned browser. When nothing resolves, the error names the fix rather than failing opaquely.

## Taking Screenshots

One-command wrapper — starts server + captures screenshot:

```bash
bash scripts/visual-test.sh --name "terrain" --commands "new_game mine_type:desert seed:42"
```

Dev server already running:

```bash
npm run screenshot -- --name "after-blast" --commands "new_game seed:1; blast 3,5"
```

Multiple commands separated by `;`. Screenshots saved to `screenshots/`.

Then open the PNG with the Read tool and describe what it shows.

## Scenario Testing (State Dumps + Optional Screenshots)

### Single scenario runner
```bash
# Command mode (default, pure Node.js, no browser)
npm run scenario -- --scenario blast-basic

# Interaction mode (Puppeteer with real UI clicks)
npm run scenario -- --scenario blast-basic --mode interaction

# With screenshots for visual inspection
npm run scenario -- --scenario blast-basic --mode interaction --screenshots

# Inline commands
npm run scenario -- --name blast-test \
  --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15; charge hole:* explosive:boomite amount:5 stemming:2; sequence auto; blast"
```

### Batch runner (CI)
```bash
# All scenarios, command mode (fastest)
npm run scenarios

# All scenarios, interaction mode (shared browser)
npm run scenarios:interaction

# Filter by name
npm run scenarios -- blast-basic tutorial-playthrough
```

Interaction actions (clickSelector, waitForSelector, type, etc.) defined in scenario step `interaction` arrays. Type definitions in `scripts/shared/scenario-types.ts`. Steps without `interaction` use command execution. A step's `expect` (same file) is what proves game state actually moved during the step, not merely that nothing threw — role/expect mechanics: `dev-testing-strategy`.

**Output per step:**
- `step-NN-command.json` — game state + command output (always)
- `step-NN-command.png` — screenshot (only with `--screenshots`)
- `report.json` — summary of all steps

Scenario definitions in `scripts/scenario-defs/*.json`.

### State Extraction Bridges

Browser entry point exposes:
- `window.__gameState()` — serialized game state
- `window.__uiState()` — panel visibility, button states, pointer-events
- `window.__uiActions()` — every interactive control on screen: `selector`, `label`, `region`, `usable`, `blockedBy`, `hint`. Ask "what can I do right now?" instead of guessing selectors.
- `window.__probeSelector(sel)` — `null` when usable, else `'absent' | 'disabled' | 'hidden' | 'zero-size' | 'covered' | 'pointer-events-none'`. Ask "why can't I click this?" about one control.
- `window.__tutorialState()` — `{ active, stepIndex, stepId, title, total }`. Know which tutorial card is showing, by id.

Implementation: `src/ui/uiActionProbe.ts`. `blockedBy` is the diagnosis, not a detail:

- `disabled` — the panel decided you may not do this. Read the region's `hint`; it usually says why ("Hire a surveyor with a geology qualification first"). A permanently disabled control with no in-game way to satisfy its condition is a dead end, not a hint.
- `covered` — a real click at the control's centre would hit something else. A full-screen overlay swallowing clicks looks exactly like a broken button.
- `absent` — the control is not in the DOM. Either the panel never rendered it, or the feature has no UI at all.
- `zero-size` / `pointer-events-none` — a CSS bug; the control exists but no click can reach it.

### ▶ Diagnosing an interaction-mode step that cannot complete

Work in this order. Stop at the first one that explains it.

1. **Read the hint.** The failure prints the region's status line. `"No selection"`, `"Ramp carved."`, `"Insufficient funds"` are answers.
2. **Check for a qualification or licence gate.** Skill-gated actions (`survey`, `drill`, driving a vehicle, management) require a `SkillCategory`. Ask: which button grants it? If the answer is "none, only the console", that is the bug. See `gameplay-employee-skills`.
3. **Check affordability.** A tutorial step the starting cash cannot pay for is a dead end even though every control works. `startingCash` is per level in `src/core/campaign/Level.ts`.
4. **Check for a covering overlay.** `blockedBy: 'covered'` names the element on top. Confirmation modals, tile pickers, and the tutorial card all overlay the scene.
5. **Check for duplicate element ids.** Several panels each own a `TileSelectOverlay`, and their forms reuse ids. A `document.getElementById` that resolves to a closed panel's control is invisible in the DOM and fatal to a click. Panel code must scope lookups to its own root.
6. **Check whether the control is disabled until a precondition.** A `point`-mode tile picker starts with Confirm disabled and enables on the first tile click. Awaiting Confirm *before* picking can never succeed.
7. **Check for a timed card.** Auto-advance tutorial steps move on after 2s. Acting before the next card appears makes that step snapshot state *after* the change it was watching for, so it never completes. Use `waitForTutorialStep`.
8. **Only then suspect the harness.** If `__probeSelector` says a control is usable and clicking it does nothing, the handler is not wired.

A real failure this diagnostic order was built to catch: `hireEmployee` created every employee with `qualifications: []`. Surveys require a `geology` qualification, so a hired surveyor could not survey. `logic` and `scenario` were both green — the unit tests granted the skill with `assignSkill`, and the console-mode scenarios did the same. The model was correct; the game was unplayable, and only a real click caught it.

### Extra Capture Modes

| Flag | Effect |
|------|--------|
| `--shots "name:yaw:pitch;..."` | Orbit to each camera angle per step → `step-NN-cmd-{name}.png` |
| `--frames N --interval MS` | N frames per step, for animated effects → `step-NN-cmd-fN.png` |
| `--viewport "WxH"` | Capture at a different resolution |
| `--puppeteer-path PATH` | Explicit browser binary |
| `--port N` | Dev server port |

### Supporting Checks

```bash
npm run a11y             # WCAG AA contrast analysis of every visible text element
npm run validate:state   # State JSON schema validation
npm run ui:diagnostic    # Clicks every UI button, reports computed styles and dead controls
```

## What to Evaluate

For each rendering task:
- **Geometry present:** Expected meshes appear (terrain, buildings, vehicles, characters)
- **Colors correct:** Role colors, ore tints, weather sky, injured states
- **No z-fighting or black voids** where geometry should be visible
- **Overlays appear** when blast plan active (holes with X-ray shafts, charge colors, delay labels)
- **Effects visible:** Dust cloud, screen shake, flash lights
- **State coherence:** Command output matches expected state changes in JSON dump

## Headless Chrome Limitations

Headless Chrome has no GPU. Expect:
- Jagged edges on geometry (no MSAA in software rasterizer)
- Slightly darker shadows than in real browser
- These are **not bugs** — do not fix for these.

## Before/After Screenshots

When fixing visual issue:
1. `--name "before-fix-ISSUE" --screenshots` before change; open the PNGs, describe the defect
2. `--name "after-fix-ISSUE" --screenshots` after change; open the PNGs, describe the result
3. Compare the two descriptions → confirm the defect is gone and nothing else moved

## Completion Criteria

Never mark rendering task complete unless:
1. Screenshots were captured **and opened with the Read tool** — geometry visible and correct
2. `npm run validate` passes
3. State dumps confirm logical state matches expectations

When images could not be produced at all, say the visual channel is unverified and give the `npm run verify:env` remedy. Never report a rendering change verified on the strength of the test suite alone.

## A Screenshot Alone Does Not Prove Playability

A screenshot shows a button. It does not show that the button is enabled, that a click reaches it, or that a player can satisfy its preconditions. What proves that: a `role: 'player'` scenario step, whose `interaction` array can never fall back to a console command (`checkStepActionAllowed`, `scripts/shared/interaction-executor.ts` — throws before the command reaches the game), combined with an `expect.usable`/`expect.blocked` check on the control it just clicked. A step whose click cannot complete fails the whole scenario and names the blocking control, the same diagnosis `__probeSelector`/`blockedBy` gives above.

When the change touches a player-facing flow, run the scenario suite in interaction mode (`npm run scenarios:interaction`, or one named scenario with `npm run scenario -- --mode interaction --screenshots`) — no console command may stand in for a player action. Step roles and the allowlists each role is checked against: `dev-scenario-authoring` skill.
