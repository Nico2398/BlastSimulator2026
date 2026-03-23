# BlastSimulator2026 — Visual Testing Guide

## Taking Screenshots

Use the one-command wrapper to start the server and capture a screenshot:

```bash
bash scripts/visual-test.sh --name "terrain" --commands "new_game mine_type:desert seed:42"
```

Or, if the dev server is already running:

```bash
npx tsx scripts/screenshot.ts --name "after-blast" --commands "new_game seed:1; blast 3,5"
```

Multiple commands are separated by `;`. Screenshots are saved to `screenshots/`.

## Scenario Testing (Per-Step Screenshots + State Dumps)

For multi-step verification, use the scenario test runner:

```bash
# Using inline commands
npx tsx scripts/scenario-test.ts --name blast-test \
  --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15; charge hole:* explosive:boomite amount:5 stemming:2; sequence auto; blast"

# Using a scenario definition file
npx tsx scripts/scenario-test.ts --scenario blast-basic
```

This produces for EACH step:
- `step-NN-command.png` — screenshot after the command
- `step-NN-command.json` — game state + UI state + command output
- `report.json` — summary of all steps

Scenario definitions live in `scripts/scenario-defs/*.json`.

### State Extraction Bridges

The browser entry point exposes two functions for programmatic inspection:
- `window.__gameState()` — returns serialized game state (holes, charges, sequences, finances, etc.)
- `window.__uiState()` — returns panel visibility, button states, pointer-events

### UI Button Diagnostics

To verify UI responsiveness, run:
```bash
npx tsx scripts/ui-diagnostic.ts
```
This opens the blast panel via Puppeteer click, tests all buttons, and reports their computed styles.

## Viewing Screenshots

The `view` tool (Read tool with an image path) renders images natively in the agent context.
After capturing, read the file path to inspect the result visually.

## What to Evaluate

For each rendering task, check:
- **Geometry present**: expected meshes appear (terrain, buildings, vehicles, characters)
- **Colors correct**: role colors, ore tints, weather sky, injured states
- **No z-fighting or black voids** where geometry should be visible
- **Overlays appear** when blast plan is active (holes with X-ray shafts, charge colors, delay labels)
- **Effects visible**: dust cloud, screen shake (check camera offset in logs), flash lights
- **State coherence**: command output matches expected state changes in JSON dump

## Headless Chrome Limitations

Headless Chrome has no GPU. Expect:
- Jagged edges on geometry (no MSAA in software rasterizer)
- Slightly darker shadows than in a real browser
- These are **not bugs** — they are renderer limitations. Do not fix for these.

## Before/After Screenshots

When fixing a visual issue, capture two screenshots:
1. `--name "before-fix-ISSUE"` before your change
2. `--name "after-fix-ISSUE"` after your change

Compare both to confirm the fix visually regressed nothing.

## Fix Before Mark Complete

Never mark a rendering task `[x]` unless:
1. A screenshot confirms the geometry is visible and correct
2. `npm run validate` passes
3. State dumps confirm the logical state matches expectations
