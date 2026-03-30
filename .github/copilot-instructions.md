# BlastSimulator2026 — Copilot Instructions

**What it is:** A satirical open-pit mine management game (Theme Hospital meets capitalism). Cartoon 3D visuals, blast physics, union strikes, mafia, lawsuits, 3-level campaign.

## Architecture (never violate these boundaries)

- `src/core/` → pure TypeScript, zero side effects, no DOM/WebGL/window. Fully testable in Node.js.
- `src/renderer/` → Three.js visuals. Depends on core. Core never imports renderer.
- `src/physics/` → Cannon-es. Active only during blasts.
- `src/persistence/` → Save backends (IndexedDB, File, Download). Imports only from core.
- `src/ui/` → HTML overlay. Reads GameState.
- `src/audio/` → Web Audio API.
- `src/console/` → CLI mode, same core logic as the UI.
- **State flows one way:** Input → Core → State mutation → Event emitted → Renderer/UI/Audio

Key patterns: single serializable `GameState`, tick-based loop with `timeScale`/`isPaused`, typed `EventEmitter` for core→renderer communication, seeded PRNG for all randomness.

See `.agent/ARCHITECTURE.md` for full details.

## Key Systems — Read Before Touching

| System | Reference | Location |
|--------|-----------|----------|
| Blast pipeline | `.agent/BLAST_SYSTEM.md` | `src/core/mining/BlastCalc.ts` |
| Event system | `.agent/GAME_DESIGN.md` §9–10 | `src/core/events/` |
| Campaign/levels | `.agent/GAME_DESIGN.md` §15 | `src/core/campaign/` |
| Save system | `SaveBackend` interface in core | `src/persistence/` for implementations |
| Score system | `src/core/scores/` | WellBeing, Safety, Ecology, Nuisance |
| Scenario tests | `.agent/VISUAL_TESTING.md` | `scripts/scenario-test.ts`, `scripts/scenario-defs/` |

## Testing and Validation

```bash
npm run validate        # TypeScript → tests → build (run after every change)
npm run test            # Tests only
npx tsx src/console.ts  # Manual gameplay testing without a browser
bash scripts/visual-test.sh --name "label" --commands "new_game seed:1"  # Screenshot
```

### Scenario Testing (autonomous verification)

Use the scenario test runner for multi-step visual + state verification:

```bash
# Run a predefined scenario (screenshots + state dumps after EVERY command)
npx tsx scripts/scenario-test.ts --scenario blast-basic

# Run inline commands
npx tsx scripts/scenario-test.ts --name my-test \
  --commands "new_game seed:42; drill_plan grid rows:2 cols:3 spacing:4 depth:6 start:15,15; charge hole:* explosive:boomite amount:5 stemming:2; sequence auto; blast"

# UI button responsiveness diagnostic
npx tsx scripts/ui-diagnostic.ts
```

Output per step: `screenshots/scenario-{name}/step-NN-cmd.{png,json}` + `report.json`.

Scenario definitions: `scripts/scenario-defs/*.json`. The browser exposes `window.__gameState()` and `window.__uiState()` for programmatic state extraction.

### Verification workflow

1. `npm run validate` — type check + unit tests + build
2. Run scenario test — per-step screenshots + state dumps
3. Read screenshots to visually verify (multimodal)
4. Read JSON state dumps to verify logical correctness
5. If issues found: fix → re-run scenario → verify again

Always run `npm run validate` before considering a fix or feature complete. For rendering changes, also take a screenshot to verify visuals (`.agent/VISUAL_TESTING.md`).

## File Conventions

- **300-line limit** per code file — split into sub-modules if needed (data/i18n files exempt)
- **TypeScript strict** — no `any` except in test fixtures
- **Seeded PRNG** (`src/core/math/Random.ts`) for all randomness — never `Math.random()`
- **Centralized config** for all game constants (`src/core/config/`) — never hardcode numbers in logic
- **Named exports** everywhere except entry points

## i18n Rule

Every user-facing string goes through `t('key')`. Always add both `en.json` and `fr.json` entries simultaneously. Never hardcode player-visible text.

## Creative Direction

The human is the **creative director**. Ask for input on:
- New fictional names (rocks, ores, explosives, characters, levels)
- New event content — propose 3–5 examples first, get tone approval before generating more
- Game feel decisions (how punishing, how fast, etc.)

Handle all technical decisions autonomously (architecture, algorithms, tests, balancing, translations).

## Deployment

```bash
npm run build    # Produces dist/ — upload to itch.io as HTML5 game
```

No Electron wrapper yet. See README.md for what would be needed to add one.
