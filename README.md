# BlastSimulator2026

**A wacky open-pit mine management game in the spirit of Theme Hospital.** Manage blasting, rubble recovery, contracts, employees, and corruption — all while navigating union strikes, mafia entanglements, and the ever-present risk of launching boulders into nearby villages. A satirical caricature of capitalism with cartoon 3D visuals. Progress through a world map of increasingly challenging mine sites, from a beginner's quarry to an endgame rare-earth nightmare.

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Language | TypeScript | 5.x (strict) | Type safety |
| Build tool | Vite | 5.x | Fast build, HMR, static HTML output for itch.io |
| 3D Rendering | Three.js | latest | Cartoon 3D graphics |
| Physics | cannon-es | latest | Rigid body simulation for blast fragments |
| Terrain | Marching Cubes | custom impl | Smooth surface from voxel grid |
| Noise | simplex-noise | 4.x | Procedural terrain and ore vein generation |
| Testing | Vitest | latest | Unit + integration tests, Node.js native |
| Visual testing | Puppeteer | latest | Headless Chrome screenshot capture |
| Console mode | Node.js + tsx | latest | CLI gameplay for testing without a browser |
| CI agent | [opencode-agent](https://github.com/apps/opencode-agent) | latest | Autonomous PR creation and code review via GitHub App |

---

## Install and Run

```bash
npm install
npm run dev        # Start dev server at http://localhost:5173
```

---

## Console Mode

Every gameplay feature is accessible without a browser via the interactive CLI:

```bash
npm run console    # Start interactive REPL
# e.g.: new_game seed:42 mine_type:desert
#       survey 25,30
#       drill_plan grid origin:20,25 rows:3 cols:4 spacing:3 depth:8
#       blast
#       finances
#       scores
```

---

## Testing

### Quick Start

Run `npm test` for fast local feedback during development. Run `npm run validate` as the full PR gate — it runs TypeScript type-checking, all tests with coverage, and a production build.

```bash
npm test              # Quick feedback — unit + integration tests
npm run validate      # Full PR gate — typecheck → tests → build
```

### npm Script Reference

| Script | Command | What It Runs | When to Use |
|--------|---------|-------------|-------------|
| `npm test` | `vitest run` | All unit + integration tests (Vitest) | Quick local feedback during development |
| `npm run test:watch` | `vitest` | Same as `test` but in watch mode — re-runs on file changes | Iterative TDD |
| `npm run test:coverage` | `vitest run --coverage` | Tests + per-file coverage report (v8 provider) | Check coverage before PR |
| `npm run test:integration` | `vitest run tests/integration` | Integration tests only (small suites + full-level) | Validate cross-module behavior |
| `npm run test:scenarios` | `vitest run tests/unit/scenario-defs.test.ts` | Validates all scenario JSON files parse correctly | Ensure scenario definitions are valid |
| `npm run validate` | `tsc --noEmit && npm run test:coverage && npm run test:integration && npm run test:scenarios && vite build` | TypeScript type-check → tests with coverage → integration tests → scenario defs validation → production build | **Full PR gate** — must pass before merging |
| `npm run console` | `tsx src/console.ts` | Interactive CLI for manual gameplay testing | Exploratory testing without a browser |
| `npm run build` | `vite build` | Production build to `dist/` | Deploy to itch.io |

### Scripts Reference (`scripts/`)

| Script | Type | Purpose | Usage |
|--------|------|---------|-------|
| `scripts/validate.sh` | Bash | Full validation pipeline: type-check → tests (verbose) → build. Step-by-step colored output. | `bash scripts/validate.sh` |
| `scripts/visual-test.sh` | Bash | One-command screenshot capture: starts dev server, takes screenshot via Puppeteer, cleans up. | `bash scripts/visual-test.sh --name "scene" --commands "new_game seed:1"` |
| `scripts/screenshot.ts` | TypeScript | Puppeteer-based headless screenshot script. Launches Chrome, optionally runs console commands, saves PNG to `screenshots/`. | `npx tsx scripts/screenshot.ts --name "after-blast" --commands "survey 25,30; blast"` |
| `scripts/scenario-test.ts` | TypeScript | Full scenario test runner. Loads a scenario JSON from `scripts/scenario-defs/`, runs each command step in headless Chrome, captures screenshot + full game state dump after every step. Output: `screenshots/scenario-{name}/` with per-step PNGs, JSON state files, and `report.json`. | `npx tsx scripts/scenario-test.ts --scenario blast-basic` |
| `scripts/ui-diagnostic.ts` | TypeScript | Exhaustive UI button diagnostic. Opens game, clicks every interactive element across all panels. Output: `screenshots/ui-diagnostic/` with per-panel screenshots + `report.json`. | `npx tsx scripts/ui-diagnostic.ts` |
| `scripts/backlog.ts` | TypeScript | Developer backlog CLI for tracking task progress (see agentic-backlog skill). Commands: `list`, `next`, `start`, `done`, `block`, `reset`, `stats`. | `npx tsx scripts/backlog.ts list` |
| `scripts/check-tasks.sh` | Bash | Task consistency checker. Verifies completed tasks have expected source files, test files exist for core phases, i18n key parity, and no hardcoded strings. | `bash scripts/check-tasks.sh` |
| `scripts/build-itch.sh` | Bash | Full itch.io deployment build: runs tests → TypeScript check → production build → creates `dist.zip`. | `bash scripts/build-itch.sh` |

### Test Architecture — 4-Layer Pyramid

All four layers must pass before any PR is merged. `npm run validate` enforces this by running all layers in sequence.

```
┌────────────────────────────────────────────┐
│       Layer 4: Visual/Scenario Tests       │  Puppeteer-based, browser screenshots
├────────────────────────────────────────────┤
│   Layer 3: Full-Level Integration Tests    │  Complete game runs (win/loss per level)
├────────────────────────────────────────────┤
│       Layer 2: Small Integration Tests     │  Cross-module console command sequences
├────────────────────────────────────────────┤
│           Layer 1: Unit Tests              │  Pure logic, no DOM, no Three.js
└────────────────────────────────────────────┘
```

#### Layer 1: Unit Tests (`tests/unit/`)

- **Location:** `tests/unit/` — mirrors `src/core/` directory structure
- **Naming convention:** `{Module}.test.ts` at equivalent path (e.g., `src/core/nav/Pathfinding.ts` → `tests/unit/nav/Pathfinding.test.ts`)
- **Runner:** Vitest, no DOM, no Three.js — pure Node.js
- **Coverage requirements:**
  Every exported pure function must have:
  1. One positive test (happy path)
  2. One boundary test (edge values, empty inputs, zero, maximal)
  3. One failure/rejection test (invalid input, insufficient funds, wrong state)
- **Seeded PRNG:** Always use `{ seed: 42 }`. Never `Math.random()` in tests.
- **No I/O:** No side effects beyond constructing return values.
- **Test pattern:**
  ```typescript
  import { describe, it, expect } from 'vitest';
  describe('ModuleName', () => {
      it('specific behavior in present tense', () => {
          // Arrange → Act → Assert
      });
  });
  ```

#### Layer 2: Small Integration Tests (`tests/integration/`)

- **Location:** `tests/integration/` — same Vitest runner, same project
- **Scope:** Console command sequences exercising partial gameplay loops. No DOM, no Three.js. May import from `src/console/`.
- **Requirements:** Minimum 8 scenarios per test suite (10 recommended)
- **Available suites (21 total):**
  - `buildings.integration.test.ts` — placement, rejection, demolition, blast destruction, explosive warehouse, living quarters, research center, overcapacity, protected voxels
  - `vehicles.integration.test.ts` — purchase/qualification, traffic, damage/repair, blast destruction, driver re-entry, payload tracking
  - `skills.integration.test.ts` — qualification, training, XP, level-up, proficiency, salary, errors, ghost preview, duration
  - `survey.integration.test.ts` — seismic/core/aerial surveys, stale data, luck/bad RNG, skill scaling, building damage, overlapping surveys
  - `blast-enhanced.integration.test.ts` — multi-rock threshold, energy propagation, flood-fill, building destruction, death probability, Voronoi count, Tier A cap, navmesh dirty region
  - `navmesh.integration.test.ts` — A\* shortest path, blocked avoidance, buildings, drill holes, multi-level ramps, re-request, stuck detection, patching, vehicle-occupied flag
  - `needs.integration.test.ts` — hunger/fatigue drain, rest insertion, collapse, building-full, well-rested bonus, shift cycles, canteen cost, ground-rest
  - `economy.integration.test.ts` — ore sale, fines, negotiation, supply contracts, rubble costs, bankruptcy, save/load
  - `events.integration.test.ts` — union timer, probability scaling, decision follow-up, mafia, lawsuit, weather, traffic jam, unqualified task, fine amounts
  - `campaign.integration.test.ts` — level completion, star rating, next level unlock, persistence, all loss conditions
  - Supporting suites: `blast-execution.test.ts`, `blast-physics.test.ts`, `employee-commands.test.ts`, `survey-overlay.integration.test.ts`, `warehouse-commerce.test.ts`, `world-commands.test.ts`

#### Layer 3: Full-Level Integration Tests (`tests/integration/full-level/`)

- **Location:** `tests/integration/full-level/`
- **Scope:** Complete runs from `new_game` to terminal outcome (win or each loss condition)
- **Test files (10 total):**

| Test File | Level | Outcome | Final Assertion |
|-----------|-------|---------|-----------------|
| `level1-win.integration.test.ts` | Level 1 — Dusty Hollow | Win — efficient run | `levelEndReason === 'completed'`; star ≥ 2 |
| `level1-lose-bankruptcy.integration.test.ts` | Level 1 | Lose — overspend | `levelEndReason === 'bankruptcy'` |
| `level1-lose-revolt.integration.test.ts` | Level 1 | Lose — neglect needs | `levelEndReason === 'worker_revolt'` |
| `level1-lose-ecology.integration.test.ts` | Level 1 | Lose — repeated overblast | `levelEndReason === 'ecological_shutdown'` |
| `level1-lose-arrest.integration.test.ts` | Level 1 | Lose — corruption path | `levelEndReason === 'arrest'` |
| `level2-win.integration.test.ts` | Level 2 — Grumpstone Ridge | Win — multi-bench + vibration management | `levelEndReason === 'completed'`; star ≥ 2 |
| `level2-lose-bankruptcy.integration.test.ts` | Level 2 | Lose — cascade fines | `levelEndReason === 'bankruptcy'` |
| `level2-lose-revolt.integration.test.ts` | Level 2 | Lose — continuous shift, no LQ upgrade | `levelEndReason === 'worker_revolt'` |
| `level3-win.integration.test.ts` | Level 3 — Treranium Depths | Win — deep Treranium extraction | `levelEndReason === 'completed'`; star ≥ 1 |
| `level3-lose-ecology.integration.test.ts` | Level 3 | Lose — tropical storm + overblast | `levelEndReason === 'ecological_shutdown'` |

- **Helper:** `full-level/helpers.ts` — shared setup and assertion utilities

#### Layer 4: Visual/Scenario Tests (Puppeteer-based)

- **Scenario definitions:** JSON files in `scripts/scenario-defs/` — each defines a sequence of console commands and visual checkpoints
- **Runner:** `npx tsx scripts/scenario-test.ts --scenario <name>` — launches headless Chrome, executes each step, captures screenshot + full game state JSON after every command
- **Output per scenario:** `screenshots/scenario-{name}/` with `step-{NN}-{command}.png`, `step-{NN}-{command}.json`, and `report.json`
- **Prerequisite:** Dev server must be running (`npm run dev &`)

**Feature scenarios (15+ files):**

| Scenario File | Chapter | Purpose |
|--------------|---------|---------|
| `survey-then-blast.json` | 4 | Seismic survey → estimates → blast → ore report |
| `skill-progression.json` | 3 | Hire driller → 700 ticks work → verify Level 5 |
| `multi-deck-blast.json` | 5 | 3-deck charge → no surface projection, deep fracture |
| `presplit-wall.json` | 5 | Presplit row + production holes → zero back-break |
| `needs-cycle.json` | 7 | 3 workers → 20 ticks → canteen auto-queued |
| `ramp-navigation.json` | 6 | Build ramp → agent reaches lower bench |
| `vibration-budget.json` | — | Exceed vibration budget 3× → $5,000 fine |
| `building-lifecycle.json` | 1 | Place → research → demolish → rebuild Tier 2 |
| `vehicle-traffic.json` | 2 | 4 haulers on narrow ramp → TrafficJamEvent |
| `employee-training.json` | 3 | Hire generalist → train → blast task accepted |
| `blast-undercharge.json` | 5 | 30% optimal charge → oversized fragments, zero projections |
| `blast-overcharge.json` | 5 | 500% optimal charge → projections, catastrophic rating |
| `collapse-recovery.json` | 7 | Fatigue hits collapse → rest → original task resumes |
| `contract-negotiation.json` | — | Negotiate 10× → both improved and worsened outcomes |
| `weather-flood.json` | — | Heavy rain → flooded holes → water-sensitive explosive fails |

**Full-level visual playthrough scenarios (6 files):**

| Scenario File | Level | Outcome | Visual Checkpoints |
|--------------|-------|---------|-------------------|
| `level1-playthrough-win.json` | 1 | Win | Terrain, first survey, first blast crater, warehouse delivery, HUD scores, level-complete |
| `level1-playthrough-revolt.json` | 1 | Loss (revolt) | Morale gauges declining, strike notification, game-over UI |
| `level2-playthrough-win.json` | 2 | Win | Multi-bench terrain, ramp used, vibration alert, level-complete |
| `level2-playthrough-bankruptcy.json` | 2 | Loss (bankruptcy) | Balance declining, contract penalty dialog, bankruptcy screen |
| `level3-playthrough-win.json` | 3 | Win | Deep pit, Treranium ore tint, tropical weather sky, level-complete |
| `level3-playthrough-ecology.json` | 3 | Loss (ecology) | Ecology bar at 0, government notice, shutdown screen |

**Visual validation protocol:**

After any rendering change:
1. `npm run dev &`
2. Run relevant playthrough scenario: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/scenario-test.ts --scenario level1-playthrough-win`
3. Inspect every screenshot
4. Verify against expected visual description per checkpoint
5. If any checkpoint fails → fix rendering → re-run

**Mandatory check cadence:**

| Trigger | Scenarios to run |
|---------|-----------------|
| Terrain mesh change | `level1-playthrough-win.json` |
| Building renderer change | `building-lifecycle.json` + `level2-playthrough-win.json` |
| Vehicle/employee renderer change | `vehicle-traffic.json` + `level1-playthrough-win.json` |
| Blast renderer change | `blast-overcharge.json` + `level3-playthrough-win.json` |
| UI/HUD change | All 6 level playthrough scenarios |
| Before merging any PR | All 6 level playthrough scenarios |

### Per-Chapter Coverage Targets

| Chapter / Area | Minimum Line Coverage |
|---------------|----------------------|
| Ch. 1 — Buildings | 90% |
| Ch. 2 — Vehicles | 90% |
| Ch. 3 — Employee Skills | 90% |
| Ch. 4 — Survey System | 90% |
| Ch. 5 — Blast Full Pipeline | 95% |
| Ch. 6 — NavMesh | 90% |
| Ch. 7 — Employee Needs | 90% |
| `src/physics/` | 70% (harder to test deterministically) |
| `src/renderer/` | Covered by visual tests (no unit target) |
| `src/console/` | 80% |

**Coverage configuration:** v8 provider via `@vitest/coverage-v8`; reports: text, json, html, lcov — output to `coverage/`. Minimum per-file thresholds: statements 60%, branches 45%, functions 40%, lines 60%. Excluded from coverage: `src/audio/`, `src/renderer/`, `src/ui/`, `src/persistence/`, console commands, i18n files, event follow-up files, main entry points.

### Performance Benchmarks

| Benchmark | Target |
|-----------|--------|
| A\* path on 100×100 grid | < 2ms per request |
| Full blast pipeline (500 voxels) | < 50ms |
| NavGrid full rebuild (100×100) | < 10ms |
| Frame tick at 8× speed, 20 agents | < 16ms |
| Survey estimation (radius 20) | < 5ms |
| Full-level integration test (Level 1 win) | < 30s wall clock |

Benchmark tests live in `tests/unit/benchmarks/benchmarks.test.ts`.

### Regression Test Policy

Any bug fix must include a new unit or integration test that:
- **Fails** on the buggy code
- **Passes** on the fix

This ensures every fix is both verified and protected against regressions.

---

## Build for itch.io

```bash
npm run build
# Output: dist/
# Upload the entire dist/ folder to itch.io as an HTML5 game.
# The build produces a single index.html with bundled assets.
```

---

## Desktop App

There is currently no Electron wrapper. To add one:
1. `npm install --save-dev electron electron-builder`
2. Create a `src/electron/main.js` that loads `dist/index.html`
3. Add `"electron": "electron src/electron/main.js"` and `"package": "electron-builder"` scripts
4. The save system will auto-detect Node.js and use `FilePersistence` for saves

---

## Project Structure

```
src/
  core/         Pure TypeScript game logic — no DOM, no WebGL, fully testable in Node.js
  renderer/     Three.js visuals (depends on core, never the reverse)
  physics/      Cannon-es rigid body simulation (active only during blasts)
  ui/           HTML overlay panels (reads from GameState)
  audio/        Web Audio API sound system
  persistence/  Save backends: FilePersistence, IndexedDBPersistence, DownloadPersistence
  console/      CLI mode — same core logic as the browser UI
  main.ts       Browser entry point
  console.ts    CLI entry point

tests/
  unit/                 Layer 1: Pure logic tests (run in Node.js, no browser)
    benchmarks/         Performance benchmark suite
    scenario-defs.test.ts  Validates all scenario JSON files
  integration/          Layers 2–3: Small integration suites (≥8 scenarios each)
    full-level/         Layer 3: Full-level playthrough tests (win/loss per level)
      helpers.ts        Shared test utilities

scripts/
  backlog.ts            Developer backlog CLI
  build-itch.sh         Full itch.io deployment build
  check-tasks.sh        Task consistency checker
  screenshot.ts         Puppeteer-based screenshot script
  scenario-test.ts      Full scenario test runner (Puppeteer)
  ui-diagnostic.ts      UI button diagnostic tool
  validate.sh           Full validation pipeline
  visual-test.sh        One-command screenshot capture helper
  scenario-defs/        Scenario JSON definitions (15 feature + 6 playthrough)

.github/              Agent context (primary — edit here)
  copilot-instructions.md  Global instruction layer
  agents/             Agent role definitions (.agent.md)
  skills/             Domain-specific skill specs (SKILL.md)
  workflows/          GitHub Actions CI/CD

.claude/              Claude Code — derived copy of .github/
  CLAUDE.md           Project context
  agents/             Agent role definitions
  skills/             Domain-specific skill specs

.opencode/            OpenCode — derived copy of .github/
  AGENTS.md           Project context
  agents/             Agent role definitions
  skills/             Domain-specific skill specs

.github/workflows/    GitHub Actions workflows (CI + OpenCode pipeline)
```

---

## Agentic pipeline setup (GitHub CLI + token)

If the pipeline reaches the PR creation step, `gh` must be authenticated with a token that can write branches and PR metadata.

1. Create a GitHub token on your GitHub instance:
   - GitHub menu path: **Profile photo → Settings → Developer settings → Personal access tokens** (choose **Tokens (classic)** or **Fine-grained tokens**).
   - Classic PAT: `repo`, `read:org`, `gist`
   - Fine-grained PAT (alternative): repository access with **Contents: Read/Write**, **Pull requests: Read/Write**, **Issues: Read/Write**, **Metadata: Read**
2. Authenticate GitHub CLI (permanent credential storage):

   If `GITHUB_TOKEN` is set in your terminal, `gh` uses it instead of storing credentials. Clear it first:

   ```bash
   unset GITHUB_TOKEN
   gh auth login --with-token <<< "<your_token>"
   gh auth status
   ```

   ```powershell
   $env:GITHUB_TOKEN = $null
   "<your_token>" | gh auth login --with-token
   gh auth status
   ```

   This stores credentials in your system keychain. After this, `gh` works in new terminals without any env vars.

3. Quick permission sanity check:

   ```bash
   gh issue view 1
   gh pr list --limit 5
   ```

If these commands fail with permission/auth errors, the agent will not be able to open or update PRs.

### Comment trigger migration

> **Status: ACTIVE**
>
> Trigger path: `/opencode` or `/oc` comment invocation on issues and PRs triggers the OpenCode pipeline via `.github/workflows/opencode-runner.yml`.
