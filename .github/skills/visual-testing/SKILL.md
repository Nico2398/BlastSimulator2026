---
name: visual-testing
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

Dev server already running:

```bash
npx tsx scripts/screenshot.ts --name "after-blast" --commands "new_game seed:1; blast 3,5"
```

Multiple commands separated by `;`. Screenshots saved to `screenshots/`.

## Scenario Testing (Per-Step Screenshots + State Dumps)

```bash
# Inline commands
npx tsx scripts/scenario-test.ts --name blast-test \
  --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15; charge hole:* explosive:boomite amount:5 stemming:2; sequence auto; blast"

# Scenario definition file
npx tsx scripts/scenario-test.ts --scenario blast-basic
```

**Output per step:**
- `step-NN-command.png` — screenshot after command
- `step-NN-command.json` — game state + UI state + command output
- `report.json` — summary of all steps

Scenario definitions in `scripts/scenario-defs/*.json`.

### Available Predefined Scenarios

| Scenario | Description |
|----------|-------------|
| `blast-basic` | Full blast pipeline |
| `level1-win-efficient` | Complete level 1 winning run |
| `level1-win-conservative` | Conservative strategy win |
| `level1-lose-bankruptcy` | Game over via bankruptcy |
| `level1-lose-arrest` | Game over via criminal charges |
| `level1-lose-ecology` | Game over via environmental collapse |
| `level1-lose-revolt` | Game over via worker revolt |

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
- Start dev server first: `npm run dev &`

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/scenario-test.ts --scenario blast-basic
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
1. `--name "before-fix-ISSUE"` before change
2. `--name "after-fix-ISSUE"` after change
3. Compare both → confirm no visual regression

## Completion Criteria

Never mark rendering task complete unless:
1. Screenshot confirms geometry visible + correct
2. `npm run validate` passes
3. State dumps confirm logical state matches expectations
