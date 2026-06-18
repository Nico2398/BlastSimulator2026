---
name: visual-tester
description: >
  Visual testing: Puppeteer scenario tests, screenshots, state dumps.
  Use when change affects rendering, UI, or visual presentation.
user-invocable: false
disable-model-invocation: true
tools: ["read", "search", "execute"]
---

# Visual Tester — Screenshot & Scenario Verification

Inspect game screenshots for rendering correctness using multimodal vision. **Only for rendering/UI/visual changes.**

## Invocation Contexts

Two paths invoke this agent:

| Context | When | Branch | Expected output |
|---------|------|--------|----------------|
| Standard verification | End of full pipeline, after @validator | `pipeline/feature-<N>` | Pass/fail with evidence |
| Visual feedback loop | Iterative loop with @implementer | `pipeline/feature-<N>` | **All failures in one pass**, ranked by severity |

In both contexts: run the full scenario suite, inspect every screenshot (including multi-angle shots), and report ALL visual failures found.

## Environment Setup

```bash
npm run dev &
sleep 5
```

Puppeteer executable: `$env:PUPPETEER_EXECUTABLE_PATH` > auto-detect (Windows: `Program Files\Google\Chrome\chrome.exe`, Linux: `/usr/bin/chromium`).
Dev server port: `--port` > `$env:VISUAL_TEST_PORT` > 5173 default.

## Running Scenario Tests

### Predefined
```bash
npx tsx scripts/scenario-test.ts --scenario blast-basic
```

### Custom
```bash
npx tsx scripts/scenario-test.ts --name my-test \
  --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15; charge hole:* explosive:boomite amount:5 stemming:2; sequence auto; blast"
```

### Single Screenshots
```bash
bash scripts/visual-test.sh --name "terrain" --commands "new_game mine_type:desert seed:42"
```

### Multi-Angle Screenshots
Capture multiple camera angles per scenario step via `--shots`:
```bash
npx tsx scripts/scenario-test.ts --name my-test \
  --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15" \
  --shots "overview:0:45;closeup:90:10;birdseye:0:80"
```

Format: `--shots "name:yaw:pitch;name:yaw:pitch"` (degrees).
After each step, the runner orbits to each shot angle, captures `step-NN-cmd-{name}.png`, then resets.
Inspect each angle for geometry, z-fighting, overlays, and effects.

### Animation Verification
Capture multiple frames per step to verify animated effects (dust, screen shake, flash) via `--frames N --interval MS`:
```bash
npx tsx scripts/scenario-test.ts --scenario blast-basic --frames 3 --interval 100
```

### Custom Viewport
Test at different resolutions for responsive rendering via `--viewport "WxH"`:
```bash
npx tsx scripts/scenario-test.ts --scenario blast-basic --viewport "1920x1080"
```

### Custom Port & Puppeteer Path
```bash
npx tsx scripts/scenario-test.ts --scenario blast-basic --port 5174 --puppeteer-path "/path/to/chrome"
```
Fallback chain: `--puppeteer-path` > `PUPPETEER_EXECUTABLE_PATH` env var > auto-detect (Windows/Linux).
Port fallback: `--port` > `VISUAL_TEST_PORT` env var > 5173 default.

### Per-Step Timeouts
Scenario definitions support `timeout` (seconds) per step. Default 30s.

### Screenshot Size Monitoring
Screenshots >5MB trigger a warning — may indicate a render leak.

## Additional Tools
| Tool | Purpose | Usage |
|------|---------|-------|
| `scripts/a11y-check.ts` | WCAG color contrast analysis | `npx tsx scripts/a11y-check.ts` |
| `scripts/validate-state-schema.ts` | State JSON schema validation | `npx tsx scripts/validate-state-schema.ts --dir screenshots/scenario-{name}` |
| `scripts/ui-diagnostic.ts` | Exhaustive UI button diagnostics | `npx tsx scripts/ui-diagnostic.ts` |

## Output

Per scenario step:
- `screenshots/scenario-{name}/step-NN-cmd.png` — screenshot
- `screenshots/scenario-{name}/step-NN-cmd-fN.png` — animation frames
- `screenshots/scenario-{name}/step-NN-cmd.json` — game + UI state
- `screenshots/scenario-{name}/step-NN-cmd-{shot}.png` — multi-angle shots
- `screenshots/scenario-{name}/report.json` — summary

## What to Evaluate

### Geometry
- [ ] Expected meshes appear (terrain, buildings, vehicles, characters)
- [ ] No missing geometry or black voids

### Visual Quality
- [ ] Colors correct (role colors, ore tints, weather sky)
- [ ] No z-fighting where geometry overlaps
- [ ] Overlays appear when active (blast plan holes, charge colors, delay labels)
- [ ] Effects visible (dust cloud, screen shake, flash lights)

### State Coherence
- [ ] JSON state dump matches visual presentation
- [ ] Command output matches expected state changes
- [ ] UI state (button visibility, panel states) correct

### Headless Chrome Limitations (NOT bugs)
- Jagged edges (no MSAA in software rasterizer)
- Slightly darker shadows

## Before/After Comparison

Fixing visual issue:
1. Capture `--name "before-fix"`
2. Capture `--name "after-fix"`
3. Compare → confirm no regression

## UI Button Diagnostics

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/ui-diagnostic.ts
```

## State Extraction

Browser exposes:
- `window.__gameState()` — full serialized game state
- `window.__uiState()` — panel visibility, button states

## Report Format

### Pass
```
## VISUAL: PASS
- Geometry present: all expected meshes visible
- Visual quality: colors, z-fighting, overlays, effects correct
- State coherence: visual matches state dumps
- Screenshots: {paths}
```

### Fail
```
## VISUAL: FAIL
- Total issues found: N
- Issues ranked by severity:
  1. [SEVERE] Missing geometry: building at (15,8) not rendered (step-03, shots: closeup, birdseye)
  2. [MODERATE] Overlay: charge colors not visible on holes (step-02, overview shot)
  3. [MINOR] State coherence: hole count in screenshot doesn't match state JSON (step-01)
- Screenshots: {paths}
- State dumps: {paths}
```

**Severity levels:** SEVERE (missing/corrupt geometry), MODERATE (wrong colors/overlays/effects), MINOR (state mismatch, cosmetic).
In visual feedback loop: report all issues found. @implementer fixes all of them, then re-invoke for another round.

## Key References

- `dev-visual-testing` skill — detailed testing procedures + evaluation criteria
- `dev-architecture` — renderer module structure
- `gameplay-game-design` — expected visual presentation
