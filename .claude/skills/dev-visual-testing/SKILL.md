---
name: dev-visual-testing
description: >
  Visual and scenario testing guide for BlastSimulator2026: taking screenshots, running
  Puppeteer scenario tests, inspecting state dumps, UI diagnostics, and before/after
  verification. Use when working on rendering, UI, or any visual feature.
---

## Taking Screenshots

One-command wrapper — starts server + captures screenshot:

```bash
bash scripts/visual-test.sh --name "terrain" --commands "new_game mine_type:desert seed:42"
```
PowerShell: `npx tsx scripts/screenshot.ts --name "terrain" --commands "new_game mine_type:desert seed:42"` (dev server must be running)

Dev server already running:

```bash
npx tsx scripts/screenshot.ts --name "after-blast" --commands "new_game seed:1; blast 3,5"
```

Multiple commands separated by `;`. Screenshots saved to `screenshots/`.

## Scenario Testing (State Dumps + Optional Screenshots)

### Single scenario runner
```bash
# Command mode (default, pure Node.js, no browser)
npx tsx scripts/scenario-test.ts --scenario blast-basic

# Interaction mode (Puppeteer with real UI clicks)
npx tsx scripts/scenario-test.ts --scenario blast-basic --mode interaction

# With screenshots for visual inspection
npx tsx scripts/scenario-test.ts --scenario blast-basic --mode interaction --screenshots

# Inline commands
npx tsx scripts/scenario-test.ts --name blast-test \
  --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15; charge hole:* explosive:boomite amount:5 stemming:2; sequence auto; blast"
```

### Batch runner (CI)
```bash
# All scenarios, command mode (fastest)
npx tsx scripts/run-all-scenarios.ts

# All scenarios, interaction mode (shared browser)
npx tsx scripts/run-all-scenarios.ts --mode interaction

# Filter by name
npx tsx scripts/run-all-scenarios.ts blast-basic tutorial-playthrough
```

Interaction actions (clickSelector, waitForSelector, type, etc.) defined in scenario step `interaction` arrays. Type definitions in `scripts/shared/scenario-types.ts`. Steps without `interaction` use command execution.

**Output per step:**
- `step-NN-command.json` — game state + command output (always)
- `step-NN-command.png` — screenshot (only with `--screenshots`)
- `report.json` — summary of all steps

Scenario definitions in `scripts/scenario-defs/*.json`.

### State Extraction Bridges

Browser entry point exposes:
- `window.__gameState()` — serialized game state
- `window.__uiState()` — panel visibility, button states, pointer-events

### UI Button Diagnostics

```bash
npx tsx scripts/ui-diagnostic.ts
```

Opens blast panel via Puppeteer click, tests all buttons, reports computed styles.

## Environment Notes

- `PUPPETEER_EXECUTABLE_PATH` may vary. Agent sandbox: `/usr/bin/chromium`
- Start dev server first:
  - Bash: `npm run dev &`
  - PowerShell: `Start-Process npm -ArgumentList "run dev"`

```bash
npx tsx scripts/scenario-test.ts --scenario blast-basic --puppeteer-path "/usr/bin/chromium"
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
1. `--scenario "before-fix-ISSUE" --screenshots` before change
2. `--scenario "after-fix-ISSUE" --screenshots` after change
3. Compare both → confirm no visual regression

## Completion Criteria

Never mark rendering task complete unless:
1. Screenshot confirms geometry visible + correct
2. `npm run validate` passes
3. State dumps confirm logical state matches expectations
