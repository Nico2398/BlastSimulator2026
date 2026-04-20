---
name: testing-strategy
description: >
  Testing strategy and conventions for BlastSimulator2026: 4-layer test pyramid (unit, integration,
  visual, scenario), Vitest patterns, per-chapter coverage goals, integration test suites with
  specific scenarios, full-level integration tests, scenario definitions, performance benchmarks,
  and validation workflow. Use when writing tests, setting up test infrastructure, or validating changes.
---

## Philosophy

No layer is optional. **More tests are always better** — do not limit the number of test cases.

1. **Unit tests** — Every exported pure function in `src/core/` has exhaustive coverage. Fast, no I/O, seeded PRNG.
2. **Small integration tests** — Console command sequences covering partial gameplay loops with huge scenario variation.
3. **Full-level integration tests** — Complete runs from `new_game` to a terminal outcome (win or each loss condition).
4. **Visual scenario tests** — Full browser sessions (Puppeteer). Screenshots + JSON state dumps after every command.

All four layers must pass before any PR is merged. `npm run validate` runs TS type-check + unit + integration tests + build.

## Validation Commands

```bash
npm run validate          # TypeScript → tests → build
npm run test              # Unit + integration tests only
npm run test:integration  # Integration tests only
npm run test:scenarios    # Scenario tests only
npx tsx src/console.ts    # Interactive gameplay testing (no browser)
```

## Unit Test Conventions

**Location:** `tests/unit/` — mirrors `src/core/` structure.
**Naming:** `{Module}.test.ts` at same path. E.g., `src/core/nav/Pathfinding.ts` → `tests/unit/nav/Pathfinding.test.ts`

Every exported pure function must have:
- One positive test (happy path)
- One boundary test (edge values, empty inputs, zero, maximal)
- One failure/rejection test (invalid input, insufficient funds, wrong state)

```typescript
import { describe, it, expect } from 'vitest';
describe('ModuleName', () => {
    it('specific behavior in present tense', () => {
        // Arrange → Act → Assert
    });
});
```

Always use seeded PRNG: `{ seed: 42 }`. Never use `Math.random()` in tests.

## Per-Chapter Coverage Targets

| Chapter | Minimum Line Coverage |
|---------|----------------------|
| 1 — Buildings | 90% |
| 2 — Vehicles | 90% |
| 3 — Employee Skills | 90% |
| 4 — Survey System | 90% |
| 5 — Blast Full Pipeline | 95% |
| 6 — NavMesh | 90% |
| 7 — Employee Needs | 90% |
| `src/physics/` | 70% (harder to test deterministically) |
| `src/renderer/` | Covered by visual tests (no unit target) |
| `src/console/` | 80% |

## Integration Test Conventions

**Location:** `tests/integration/` and `tests/integration/full-level/`

Same Vitest runner. May import from `src/console/` (command layer). Must exercise at least one full round-trip through the game loop. No DOM, no Three.js.

### Small Integration Tests (≥ 8 scenarios per suite)

| Suite | Key Scenarios (minimum) |
|-------|------------------------|
| `buildings.integration.test.ts` | (1) Place valid flat terrain; (2) reject slope; (3) reject overlap; (4) demolish frees navmesh; (5) blast destroys building + score penalty; (6) explosive warehouse secondary blast; (7) LQ well-being per tier; (8) research center unlocks tier; (9) overcapacity penalty; (10) protected voxels block drill |
| `vehicles.integration.test.ts` | (1) Purchase → qualified driver → move; (2) reject unqualified; (3) two vehicles converge → one waits; (4) TrafficJamEvent at threshold; (5) `broken` state after damage; (6) depot repair; (7) blast projection destroys vehicle; (8) driver re-enters for next task; (9) uncrewed vehicle rejected; (10) payload tracked during haul |
| `skills.integration.test.ts` | (1) New hire has 0 qualifications; (2) training grants skill; (3) XP accumulates per task tick; (4) level-up at threshold; (5) proficiency reduces duration; (6) multi-skill salary higher; (7) unqualified → UnqualifiedTaskError; (8) qualified-busy → no error; (9) ghost added/removed; (10) duration uses combined modifiers |
| `survey.integration.test.ts` | (1) Seismic within ±15%; (2) core sample within ±5%; (3) aerial surface-only; (4) stale at tick 101; (5) Lucky Strike > 120%; (6) Barren Blast < 60%; (7) insufficient funds error; (8) skill level reduces error; (9) seismic damages nearby building; (10) overlapping surveys accumulate |
| `blast-enhanced.integration.test.ts` | (1) Multi-rock threshold weighted; (2) energy local for strong rock; (3) spreads for weak rock; (4) island flood-fill; (5) building destroyed at threshold; (6) death probability scales; (7) Voronoi count scales; (8) deep fragment v≈0; (9) surface overcharged v≈MAX; (10) Tier A cap enforced; (11) ore yield matches voxels; (12) navmesh dirty-region fires |
| `navmesh.integration.test.ts` | (1) A* shortest path; (2) avoids blocked; (3) avoids buildings; (4) drill hole passable; (5) multi-level via ramp; (6) no ramp → found:false; (7) path re-requested on block; (8) stuck after 3 fails; (9) patch only affects blast region; (10) patch after building; (11) vehicle-occupied flag per tick |
| `needs.integration.test.ts` | (1) Hunger drains during task; (2) fatigue faster during task; (3) rest auto-inserted at warning; (4) collapse interrupts + prepends; (5) rest resolves + resumes; (6) building-full queuing; (7) well-rested bonus at all >80; (8) shift cycle for Bunkhouse Tier 2+; (9) canteen cost deducted; (10) ground-rest 2× when no building |
| `economy.integration.test.ts` | (1) Ore sale deducts + credits; (2) missed deadline fine; (3) successful negotiation; (4) failed negotiation; (5) supply contract delivers on schedule; (6) rubble disposal cost; (7) bankruptcy tracker; (8) save/load finance state |
| `events.integration.test.ts` | (1) Union timer interval; (2) probability scales with score; (3) decision affects follow-up; (4) mafia unlocked after corruption; (5) lawsuit after death; (6) weather modifies flood state; (7) TrafficJamEvent threshold; (8) UnqualifiedTaskError; (9) timer resets; (10) fine amounts scale with score |
| `campaign.integration.test.ts` | (1) Level completes at profit threshold; (2) star rating computed; (3) next level unlocked; (4) progress persists on restart; (5) bankruptcy ends level; (6) arrest ends level; (7) ecological shutdown; (8) worker revolt; (9) replay completed level; (10) star rating updates on replay |

### Full-Level Integration Tests

| Test File | Level | Outcome | Final Assertion |
|-----------|-------|---------|-----------------|
| `level1-win.integration.test.ts` | Level 1 (Dusty Hollow) | Win — efficient run | `levelEndReason === 'completed'`; star ≥ 2 |
| `level1-lose-bankruptcy.integration.test.ts` | Level 1 | Lose — overspend | `levelEndReason === 'bankruptcy'` |
| `level1-lose-revolt.integration.test.ts` | Level 1 | Lose — neglect needs | `levelEndReason === 'worker_revolt'` |
| `level1-lose-ecology.integration.test.ts` | Level 1 | Lose — repeated overblast | `levelEndReason === 'ecological_shutdown'` |
| `level1-lose-arrest.integration.test.ts` | Level 1 | Lose — corruption path | `levelEndReason === 'arrest'` |
| `level2-win.integration.test.ts` | Level 2 (Grumpstone Ridge) | Win — multi-bench + vibration management | `levelEndReason === 'completed'`; star ≥ 2 |
| `level2-lose-bankruptcy.integration.test.ts` | Level 2 | Lose — cascade fines | `levelEndReason === 'bankruptcy'` |
| `level2-lose-revolt.integration.test.ts` | Level 2 | Lose — continuous shift, no LQ upgrade | `levelEndReason === 'worker_revolt'` |
| `level3-win.integration.test.ts` | Level 3 (Treranium Depths) | Win — deep Treranium extraction | `levelEndReason === 'completed'`; star ≥ 1 |
| `level3-lose-ecology.integration.test.ts` | Level 3 | Lose — tropical storm + overblast | `levelEndReason === 'ecological_shutdown'` |

## Scenario Test Definitions

JSON files in `scripts/scenario-defs/`. Runner captures screenshot + state JSON after every command.

### Feature Scenarios (Ch.1–7 visual regression)

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

### Full-Level Visual Playthrough Scenarios

| Scenario File | Level | Outcome | Visual Checkpoints |
|--------------|-------|---------|-------------------|
| `level1-playthrough-win.json` | Level 1 | Win | Terrain, first survey, first blast crater, warehouse delivery, HUD scores, level-complete |
| `level1-playthrough-revolt.json` | Level 1 | Loss (revolt) | Morale gauges declining, strike notification, game-over UI |
| `level2-playthrough-win.json` | Level 2 | Win | Multi-bench terrain, ramp used, vibration alert, level-complete |
| `level2-playthrough-bankruptcy.json` | Level 2 | Loss (bankruptcy) | Balance declining, contract penalty dialog, bankruptcy screen |
| `level3-playthrough-win.json` | Level 3 | Win | Deep pit, Treranium ore tint, tropical weather sky, level-complete |
| `level3-playthrough-ecology.json` | Level 3 | Loss (ecology) | Ecology bar at 0, government notice, shutdown screen |

### Visual Validation Protocol

After any rendering change:
1. `npm run dev &`
2. Run relevant playthrough scenario:
   ```bash
   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npx tsx scripts/scenario-test.ts --scenario level1-playthrough-win
   ```
3. Inspect every screenshot using the `view` tool
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

## Performance Benchmarks

| Benchmark | Target |
|-----------|--------|
| A* path on 100×100 grid | < 2ms per request |
| Full blast pipeline (500 voxels) | < 50ms |
| NavGrid full rebuild (100×100) | < 10ms |
| Frame tick at 8× speed, 20 agents | < 16ms |
| Survey estimation (radius 20) | < 5ms |
| Full-level integration test (Level 1 win) | < 30s wall clock |

## Regression Test Policy

Any bug fix must be accompanied by a new unit or integration test that:
- Fails on the buggy code
- Passes on the fix

## Testing Infrastructure Atomic Tasks

| # | Task | File(s) |
|---|------|---------|
| 8.1 | Add coverage reporter to `vitest.config.ts` (v8, per-file thresholds) | `vitest.config.ts` |
| 8.2 | Create `tests/integration/` and `tests/integration/full-level/` | `vitest.config.ts`, `package.json` |
| 8.3 | Add 10 small integration test suites (≥ 8 scenarios each) | `tests/integration/` |
| 8.4 | Add 10 full-level integration tests | `tests/integration/full-level/` |
| 8.5 | Add 15 feature scenario JSON files | `scripts/scenario-defs/` |
| 8.6 | Add 6 full-level playthrough scenario JSON files | `scripts/scenario-defs/` |
| 8.7 | Add performance benchmark suite | `tests/unit/benchmarks/` |
| 8.8 | Add `npm run test:integration` and `npm run test:scenarios` scripts | `package.json` |
| 8.9 | Update `npm run validate` to include integration tests and coverage gate | `package.json` |
| 8.10 | Document test conventions in `README.md` under "Testing" section | `README.md` |
| 8.11 | Run all 6 level playthrough scenarios after final renderer integration; inspect screenshots | Manual step |
