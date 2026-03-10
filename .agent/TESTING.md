# BlastSimulator2026 — Testing Strategy

## 1. Philosophy

Every task must have **acceptance criteria** that the agent can verify autonomously. This means:
- Every core feature has unit tests
- Every gameplay flow has console-mode integration tests
- Every visual feature has a screenshot test

The agent must **run tests before and after each task** to confirm nothing is broken and the new feature works.

## 2. Test Levels

### Level 1: Unit Tests (Vitest)
- Location: `tests/unit/`
- Run: `npx vitest run`
- Coverage: All `src/core/` modules
- No DOM, no browser, no side effects
- Each test file mirrors the source file it tests

**Patterns:**
```typescript
// tests/unit/mining/BlastCalc.test.ts
import { describe, it, expect } from 'vitest';
import { calculateEnergy, calculateFragmentation } from '../../../src/core/mining/BlastCalc';

describe('calculateEnergy', () => {
    it('returns higher energy closer to the hole', () => {
        const hole = { position: { x: 0, y: 0, z: 0 }, energy: 1000 };
        const near = calculateEnergy({ x: 1, y: 0, z: 0 }, [hole]);
        const far = calculateEnergy({ x: 10, y: 0, z: 0 }, [hole]);
        expect(near).toBeGreaterThan(far);
    });

    it('sums energy from multiple holes', () => {
        const holes = [
            { position: { x: -5, y: 0, z: 0 }, energy: 500 },
            { position: { x: 5, y: 0, z: 0 }, energy: 500 },
        ];
        const center = calculateEnergy({ x: 0, y: 0, z: 0 }, holes);
        const edge = calculateEnergy({ x: 20, y: 0, z: 0 }, holes);
        expect(center).toBeGreaterThan(edge);
    });
});

describe('calculateFragmentation', () => {
    it('produces no fragments when energy is below threshold', () => {
        const result = calculateFragmentation(10, 100); // energy=10, threshold=100
        expect(result.fractured).toBe(false);
    });

    it('produces small fragments when energy is well above threshold', () => {
        const result = calculateFragmentation(300, 100);
        expect(result.fractured).toBe(true);
        expect(result.fragmentSize).toBeLessThan(0.3);
    });
});
```

### Level 2: Console Integration Tests
- Location: `tests/integration/`
- Run: `npx vitest run tests/integration/`
- These tests instantiate a full GameState and execute console commands programmatically
- They verify end-to-end gameplay flows without any rendering

**Patterns:**
```typescript
// tests/integration/blast-scenario.test.ts
import { describe, it, expect } from 'vitest';
import { GameState, createGame } from '../../src/core/state/GameState';
import { executeCommand } from '../../src/console/ConsoleRunner';

describe('Full blast scenario', () => {
    let state: GameState;

    beforeEach(() => {
        state = createGame({ mineType: 'desert', seed: 42 });
    });

    it('survey → drill → charge → sequence → blast produces fragments', () => {
        executeCommand(state, 'survey 25,30');
        executeCommand(state, 'drill_plan grid origin:20,25 rows:2 cols:2 spacing:3 depth:8');
        executeCommand(state, 'charge hole:* explosive:pop_rock amount:3kg stemming:1.5m');
        executeCommand(state, 'sequence auto delay_step:25ms');
        const result = executeCommand(state, 'blast');

        expect(result.fragments.length).toBeGreaterThan(0);
        expect(result.projections).toBe(0); // well-designed plan
        expect(state.terrain.getVoxel(25, 30).density).toBe(0); // terrain removed
    });

    it('overcharged blast produces projections', () => {
        executeCommand(state, 'drill_plan grid origin:20,25 rows:2 cols:2 spacing:3 depth:8');
        executeCommand(state, 'charge hole:* explosive:pop_rock amount:50kg stemming:0m');
        executeCommand(state, 'sequence auto delay_step:25ms');
        const result = executeCommand(state, 'blast');

        expect(result.projections).toBeGreaterThan(0);
        expect(result.rating).toBe('catastrophic');
    });
});
```

### Level 3: Visual Snapshot Tests (Puppeteer)
- Location: `tests/visual/`
- Run: `npx tsx scripts/screenshot.ts`
- These launch the game in headless Chrome, perform actions, and save screenshots
- The agent can inspect screenshots to validate rendering
- Optional: pixel-diff comparison against reference images

**Patterns:**
```typescript
// scripts/screenshot.ts
import puppeteer from 'puppeteer';

async function captureScreenshot(name: string, actions: string[]) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto('http://localhost:5173');

    // Wait for game to initialize
    await page.waitForSelector('#game-canvas');
    await page.waitForTimeout(2000);

    // Execute actions via console bridge (exposed in dev mode)
    for (const action of actions) {
        await page.evaluate((cmd) => (window as any).__gameConsole(cmd), action);
        await page.waitForTimeout(500);
    }

    await page.screenshot({ path: `screenshots/${name}.png` });
    await browser.close();
}
```

## 3. Validation Script

The `scripts/validate.sh` script is the agent's primary tool. Run it after every change:

```bash
#!/bin/bash
set -e

echo "=== TypeScript Compilation Check ==="
npx tsc --noEmit

echo "=== Unit Tests ==="
npx vitest run --reporter=verbose

echo "=== Build Check ==="
npx vite build

echo "=== All validations passed ==="
```

The agent MUST run `bash scripts/validate.sh` after completing each task. If any step fails, the task is not done.

## 4. Test Naming Convention

Test files: `{ModuleName}.test.ts`
Test descriptions: `describe('{ModuleName}')` → `it('{specific behavior}')`

Use concrete, behavior-focused descriptions:
- GOOD: `it('returns zero fragments when energy below threshold')`
- BAD: `it('works correctly')`

## 5. Acceptance Criteria Format

Every task in the README has acceptance criteria formatted as:

```
**Acceptance criteria:**
- [ ] Unit test: {specific test description}
- [ ] Unit test: {specific test description}
- [ ] Integration test: {scenario description}
- [ ] `npm run validate` passes
```

The agent must write ALL listed tests and confirm they pass before marking a task as done.

## 6. Test Data and Fixtures

For deterministic tests, always use seeded random generation:
```typescript
// Use a seed for procedural generation so tests are reproducible
const terrain = generateTerrain({ seed: 42, width: 50, height: 50 });
```

Common fixtures should be in `tests/fixtures/`:
- Pre-built game states at various stages
- Known blast plans with expected outcomes
- Event sequences for testing chains

## 7. Coverage Goals

- `src/core/`: 90%+ line coverage
- `src/physics/`: 70%+ (harder to test deterministically)
- `src/renderer/`: Covered by visual tests (no unit coverage target)
- `src/console/`: 80%+ (tested via integration tests)
