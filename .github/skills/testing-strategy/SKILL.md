---
name: testing-strategy
description: >
  Testing strategy and conventions for BlastSimulator2026: 4-layer test pyramid (unit, integration,
  visual, scenario), Vitest patterns, coverage goals, test data fixtures, acceptance criteria format,
  and validation workflow. Use when writing tests, setting up test infrastructure, or validating changes.
---

## Philosophy

Every task must have **acceptance criteria** that the agent can verify autonomously:
- Every core feature has unit tests
- Every gameplay flow has console-mode integration tests
- Every visual feature has a screenshot test

The agent must **run tests before and after each task** to confirm nothing is broken.

## Test Levels

### Level 1: Unit Tests (Vitest)
- **Location:** `tests/unit/`
- **Run:** `npx vitest run`
- **Coverage:** All `src/core/` modules
- No DOM, no browser, no side effects
- Each test file mirrors the source file it tests

**Patterns:**
```typescript
import { describe, it, expect } from 'vitest';
import { calculateEnergy } from '../../../src/core/mining/BlastCalc';

describe('calculateEnergy', () => {
    it('returns higher energy closer to the hole', () => {
        const hole = { position: { x: 0, y: 0, z: 0 }, energy: 1000 };
        const near = calculateEnergy({ x: 1, y: 0, z: 0 }, [hole]);
        const far = calculateEnergy({ x: 10, y: 0, z: 0 }, [hole]);
        expect(near).toBeGreaterThan(far);
    });
});
```

### Level 2: Console Integration Tests
- **Location:** `tests/integration/`
- **Run:** `npx vitest run tests/integration/`
- Instantiate full GameState and execute console commands programmatically
- Verify end-to-end gameplay flows without rendering

### Level 3: Visual Snapshot Tests (Puppeteer)
- **Location:** `tests/visual/`
- **Run:** `npx tsx scripts/screenshot.ts`
- Launch game in headless Chrome, perform actions, save screenshots
- Agent inspects screenshots to validate rendering

### Level 4: Scenario Tests
- **Location:** `scripts/scenario-defs/*.json`
- **Run:** `npx tsx scripts/scenario-test.ts --scenario <name>`
- Multi-step game scenarios with per-step screenshots + state dumps
- Full pipeline verification from game start to terminal state

## Validation Commands

```bash
npm run validate        # TypeScript → tests → build (run after every change)
npm run test            # Tests only
npx tsx src/console.ts  # Interactive gameplay testing (no browser)
```

## Test Naming Convention

- Test files: `{ModuleName}.test.ts`
- `describe('{ModuleName}')` → `it('{specific behavior}')`
- Use concrete, behavior-focused descriptions:
  - ✅ `it('returns zero fragments when energy below threshold')`
  - ❌ `it('works correctly')`

## Acceptance Criteria Format

```markdown
**Acceptance criteria:**
- [ ] Unit test: {specific test description}
- [ ] Integration test: {scenario description}
- [ ] `npm run validate` passes
```

## Test Data and Fixtures

Always use seeded random generation for deterministic tests:
```typescript
const terrain = generateTerrain({ seed: 42, width: 50, height: 50 });
```

Common fixtures in `tests/fixtures/`:
- Pre-built game states at various stages
- Known blast plans with expected outcomes
- Event sequences for testing chains

## Coverage Goals

| Module | Target |
|--------|--------|
| `src/core/` | 90%+ line coverage |
| `src/physics/` | 70%+ (harder to test deterministically) |
| `src/renderer/` | Covered by visual tests (no unit coverage target) |
| `src/console/` | 80%+ (tested via integration tests) |

## Performance Benchmarks

| Benchmark | Target |
|-----------|--------|
| A* path on 100×100 grid | < 2ms |
| Full blast pipeline (500 voxels) | < 50ms |
| NavGrid full rebuild (100×100) | < 10ms |
| Frame tick at 8× speed, 20 agents | < 16ms |
| Survey estimation (radius 20) | < 5ms |
| Full-level integration test (Level 1 win) | < 30s wall clock |

## Integration Test Conventions

### Small Integration Tests
- Test partial gameplay loops (e.g., "drill + charge + blast" without full economy)
- ≥ 8 scenario variants per suite, each exercising a distinct code path
- Located in `tests/integration/`

### Full-Level Integration Tests
- Drive the game from `new_game` to a terminal condition (win or specific lose)
- Assert on `levelEndReason`, final finances, final scores, fragment counts
- Located in `tests/integration/full-level/`

## Test-Driven Workflow

For each new feature:
1. Write the test first (red)
2. Implement the minimum code to pass (green)
3. Refactor for clarity if needed (refactor)
4. Run `npm run validate` to confirm no regressions
5. For visual changes: run scenario test and inspect screenshots
