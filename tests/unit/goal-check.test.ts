// BlastSimulator2026 — checkGoal (interaction-mode half of a step's expect)
//
// checkGoal (interaction-driver.ts) is shared, unmodified, between every
// caller that needs it (scenario-interaction-runner.ts and
// run-all-scenarios.ts's batch loop both call it directly) — one evaluator
// instead of several that can drift. checkGoalAgainstState (scenario-goal.ts,
// tests/unit/scenario-goal.test.ts) is the command-mode half: equals/increased
// only, no DOM.
//
// No real Puppeteer browser — `Page` is faked at the `evaluate` boundary,
// matching tests/unit/scenario-interaction.test.ts's approach.

import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'puppeteer';
import { checkGoal, InteractionFailure } from '../../scripts/shared/interaction-driver.js';

/**
 * Builds a fake page whose `evaluate` dispatches on the bridge function it
 * would call in the browser (`__gameState`, `__tutorialState`,
 * `__probeSelector`, `__uiActions`) by inspecting the function body — the
 * same trick used to keep these tests independent of Puppeteer's actual
 * argument-marshalling.
 */
function fakePage(bridges: {
  gameState?: Record<string, unknown>;
  tutorialState?: { active: boolean; stepIndex: number; stepId: string | null; title: string; total: number };
  probeSelector?: (selector: string) => string | null;
  uiActions?: unknown[];
} = {}): Page {
  const evaluate = vi.fn().mockImplementation((fn: unknown, ...args: unknown[]) => {
    const src = String(fn);
    if (src.includes('__gameState')) return bridges.gameState ?? {};
    if (src.includes('__tutorialState')) {
      return bridges.tutorialState ?? { active: false, stepIndex: -1, stepId: null, title: '', total: 0 };
    }
    if (src.includes('__probeSelector')) {
      const selector = args[0] as string;
      return (bridges.probeSelector ?? (() => null))(selector);
    }
    if (src.includes('__uiActions')) return bridges.uiActions ?? [];
    return undefined;
  });
  return { evaluate } as unknown as Page;
}

describe('checkGoal — equals', () => {
  it('passes when every field matches after the step', async () => {
    const page = fakePage({ gameState: { cash: 70000, buildingCount: 1 } });
    await expect(checkGoal(page, { equals: { cash: 70000, buildingCount: 1 } }, {})).resolves.toBeUndefined();
  });

  it('throws InteractionFailure naming the field, expected, and actual', async () => {
    const page = fakePage({ gameState: { cash: 80000 } });
    let caught: unknown;
    try {
      await checkGoal(page, { equals: { cash: 70000 } }, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InteractionFailure);
    expect((caught as Error).message).toContain('cash');
    expect((caught as Error).message).toContain('70000');
    expect((caught as Error).message).toContain('80000');
  });
});

describe('checkGoal — increased', () => {
  it('passes when the field grew relative to the before snapshot', async () => {
    const page = fakePage({ gameState: { employeeCount: 1 } });
    await expect(
      checkGoal(page, { increased: ['employeeCount'] }, { employeeCount: 0 }),
    ).resolves.toBeUndefined();
  });

  it('throws when the field did not grow, reporting was → now', async () => {
    const page = fakePage({ gameState: { employeeCount: 1 } });
    let caught: unknown;
    try {
      await checkGoal(page, { increased: ['employeeCount'] }, { employeeCount: 1 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InteractionFailure);
    expect((caught as Error).message).toContain('1 → 1');
  });
});

describe('checkGoal — decreased', () => {
  it('passes when the field shrank relative to the before snapshot', async () => {
    const page = fakePage({ gameState: { nuisance: 20 } });
    await expect(
      checkGoal(page, { decreased: ['nuisance'] }, { nuisance: 50 }),
    ).resolves.toBeUndefined();
  });

  it('throws when the field did not shrink, reporting was → now', async () => {
    const page = fakePage({ gameState: { nuisance: 50 } });
    let caught: unknown;
    try {
      await checkGoal(page, { decreased: ['nuisance'] }, { nuisance: 50 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InteractionFailure);
    expect((caught as Error).message).toContain('50 → 50');
  });
});

describe('checkGoal — tutorialStep', () => {
  it('passes when the tutorial card is on the expected step', async () => {
    const page = fakePage({
      tutorialState: { active: true, stepIndex: 2, stepId: 'survey', title: 'Survey the site', total: 20 },
    });
    await expect(checkGoal(page, { tutorialStep: 'survey' }, {})).resolves.toBeUndefined();
  });

  it('throws naming both the expected and actual step id', async () => {
    const page = fakePage({
      tutorialState: { active: true, stepIndex: 1, stepId: 'hire-surveyor', title: 'Hire a surveyor', total: 20 },
    });
    let caught: unknown;
    try {
      await checkGoal(page, { tutorialStep: 'survey' }, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InteractionFailure);
    expect((caught as Error).message).toContain('"survey"');
    expect((caught as Error).message).toContain('"hire-surveyor"');
  });
});

describe('checkGoal — blocked (a control must NOT be reachable)', () => {
  it('passes when the control is present but genuinely unusable', async () => {
    const page = fakePage({ probeSelector: () => 'disabled' });
    await expect(
      checkGoal(page, { blocked: '#bs-build-panel [data-build-type="vehicle"] .bs-build-buy-btn' }, {}),
    ).resolves.toBeUndefined();
  });

  it('throws when the "blocked" control is actually reachable', async () => {
    const page = fakePage({ probeSelector: () => null });
    let caught: unknown;
    try {
      await checkGoal(page, { blocked: '.bs-return-map' }, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InteractionFailure);
    expect((caught as Error).message).toContain('reachable but should not be');
  });

  it('throws when the "blocked" selector is absent — proves nothing, likely a stale selector', async () => {
    const page = fakePage({ probeSelector: () => 'absent' });
    let caught: unknown;
    try {
      await checkGoal(page, { blocked: '#does-not-exist' }, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InteractionFailure);
    expect((caught as Error).message).toContain('proves nothing');
  });
});

describe('checkGoal — usable (fast path only; the polling-timeout path is exercised in real interaction-mode runs, not here)', () => {
  it('passes immediately when the control is already usable', async () => {
    const page = fakePage({ probeSelector: () => null });
    await expect(
      checkGoal(page, { usable: '#bs-build-panel [data-build-type="living_quarters"] .bs-build-buy-btn' }, {}),
    ).resolves.toBeUndefined();
  });
});

describe('checkGoal — a goal with no checkable fields (note-only) is a no-op', () => {
  it('resolves without touching the page for state', async () => {
    const page = fakePage();
    await expect(checkGoal(page, { note: 'informational only' }, {})).resolves.toBeUndefined();
  });
});

describe('checkGoal — multiple fields, first violation wins', () => {
  it('checks tutorialStep before increased/equals (source order in checkGoal)', async () => {
    const page = fakePage({
      tutorialStep: undefined,
      tutorialState: { active: true, stepIndex: 0, stepId: 'time-speed', title: '', total: 20 },
      gameState: { employeeCount: 99 },
    } as never);
    let caught: unknown;
    try {
      await checkGoal(page, { tutorialStep: 'survey', increased: ['employeeCount'] }, { employeeCount: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(InteractionFailure);
    // The tutorialStep mismatch, not the (satisfied) increased check, is reported.
    expect((caught as Error).message).toContain('time-speed');
  });
});
