// BlastSimulator2026 — scenario-interaction-runner.ts: `repeat: N` step
// multiplier, interaction mode (#696)
//
// Pins runScenarioInteraction's own per-step loop (distinct from
// run-all-scenarios.ts's separate batch loop, covered elsewhere) against the
// same repeat contract command mode's runSteps must honor
// (scenario-types.ts's ScenarioStepDef.repeat doc comment):
//   - absent/1 -> no change from today
//   - N >= 2 -> the step's full `interaction` array runs N times in
//     immediate succession, through executeInteractionActions each time
//   - exactly one report/state-dump entry per step, carrying the LAST
//     iteration's output/game state
//   - expect's state-goal fields are evaluated once, against the state
//     immediately before the FIRST iteration and immediately after the LAST
//   - a failing iteration stops the loop — it never reaches a later one
//
// No real Puppeteer browser involved: initBrowser/executeInteractionActions/
// checkGoal/gameState are faked at the module boundary, the same technique
// tests/unit/scripts/scenario-interaction-runner.test.ts already uses for the
// skipBlastPlayback wiring — this stays in the `logic` channel.
//
// DO NOT implement anything here — only add implementation to scripts/.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn(() => ({ size: 0 }) as any),
  };
});

// vi.mock() factories are hoisted above ordinary top-level declarations, so
// any variable a factory closes over must itself be declared through
// vi.hoisted() (mirrors scenario-interaction-runner.test.ts's own setup).
const {
  fakePageRef,
  initBrowserMock,
  executeInteractionActionsMock,
  suspendDrawingMock,
  waitOneFrameMock,
  captureFrameMock,
  checkGoalMock,
  gameStateMock,
} = vi.hoisted(() => {
  const fakeBrowser = { close: vi.fn(async () => {}) };
  const fakePageRef: { current: { evaluate: ReturnType<typeof vi.fn<any[], Promise<undefined>>> } | null } = { current: null };
  return {
    fakePageRef,
    initBrowserMock: vi.fn(async () => ({ browser: fakeBrowser, page: fakePageRef.current })),
    executeInteractionActionsMock: vi.fn(async () => ({
      screenshotPaths: [] as string[],
      commandOutput: 'ok',
      gameState: {},
      uiState: {},
    })),
    suspendDrawingMock: vi.fn(async () => {}),
    waitOneFrameMock: vi.fn(async () => {}),
    captureFrameMock: vi.fn(async () => {}),
    checkGoalMock: vi.fn(async () => {}),
    gameStateMock: vi.fn(async () => ({})),
  };
});

let fakePage: { evaluate: ReturnType<typeof vi.fn<any[], Promise<undefined>>> };

vi.mock('../../../scripts/shared/puppeteer-utils.js', () => ({
  initBrowser: initBrowserMock,
  executeInteractionActions: executeInteractionActionsMock,
  waitOneFrame: waitOneFrameMock,
  DEFAULT_STEP_TIMEOUT: 60,
  captureFrame: captureFrameMock,
  suspendDrawing: suspendDrawingMock,
}));

vi.mock('../../../scripts/shared/interaction-driver.js', () => {
  class InteractionFailure extends Error {
    diagnosis = '';
  }
  return {
    checkGoal: checkGoalMock,
    gameState: gameStateMock,
    InteractionFailure,
  };
});

import { runScenarioInteraction } from '../../../scripts/scenario-interaction-runner.js';

function repeatStep(overrides: Partial<ScenarioStepDef> = {}): ScenarioStepDef {
  return {
    command: 'employee hire role:driller',
    role: 'bootstrap',
    interaction: [{ type: 'command', command: 'employee hire role:driller' }],
    ...overrides,
  };
}

async function runOneStep(step: ScenarioStepDef) {
  return runScenarioInteraction(
    'repeat-fixture-696',
    [step],
    [], 5173, undefined, 1, 200,
    { width: 1280, height: 720 },
    false, '/tmp/screenshots',
    false, // skipBlastPlayback
  );
}

describe('runScenarioInteraction — repeat: N step multiplier (#696)', () => {
  beforeEach(() => {
    fakePage = { evaluate: vi.fn(async () => undefined) };
    fakePageRef.current = fakePage;
    initBrowserMock.mockClear();
    // mockReset (not mockClear) — a previous test's queued mockResolvedValueOnce/
    // mockRejectedValueOnce entries left unconsumed (because the un-implemented
    // repeat loop only ever calls this mock once) must not leak into the next
    // test and be consumed there instead.
    executeInteractionActionsMock.mockReset();
    executeInteractionActionsMock.mockImplementation(async () => ({
      screenshotPaths: [] as string[],
      commandOutput: 'ok',
      gameState: {},
      uiState: {},
    }));
    suspendDrawingMock.mockClear();
    checkGoalMock.mockReset();
    checkGoalMock.mockImplementation(async () => {});
    gameStateMock.mockReset();
    gameStateMock.mockImplementation(async () => ({}));
  });

  it('absent repeat calls executeInteractionActions exactly once, as today', async () => {
    const results = await runOneStep(repeatStep());
    expect(executeInteractionActionsMock).toHaveBeenCalledTimes(1);
    expect(results[0]!.error).toBeUndefined();
  });

  it('repeat: 1 calls executeInteractionActions exactly once, same as absent', async () => {
    const results = await runOneStep(repeatStep({ repeat: 1 }));
    expect(executeInteractionActionsMock).toHaveBeenCalledTimes(1);
    expect(results[0]!.error).toBeUndefined();
  });

  it('repeat: N runs the step\'s interaction array N times through executeInteractionActions', async () => {
    await runOneStep(repeatStep({ repeat: 4 }));
    expect(executeInteractionActionsMock).toHaveBeenCalledTimes(4);
  });

  it('produces exactly ONE StepResult for the repeat step, carrying the LAST iteration\'s game state', async () => {
    executeInteractionActionsMock
      .mockResolvedValueOnce({ screenshotPaths: [], commandOutput: 'iter1', gameState: { employeeCount: 1 }, uiState: {} })
      .mockResolvedValueOnce({ screenshotPaths: [], commandOutput: 'iter2', gameState: { employeeCount: 2 }, uiState: {} })
      .mockResolvedValueOnce({ screenshotPaths: [], commandOutput: 'iter3', gameState: { employeeCount: 3 }, uiState: {} });

    const results = await runOneStep(repeatStep({ repeat: 3 }));

    expect(results).toHaveLength(1);
    expect(results[0]!.commandOutput).toBe('iter3');
    expect(results[0]!.gameState).toEqual({ employeeCount: 3 });
  });

  it('evaluates expect once, against the state before the FIRST iteration and after the LAST — not per iteration', async () => {
    gameStateMock.mockResolvedValueOnce({ employeeCount: 0 });
    executeInteractionActionsMock
      .mockResolvedValueOnce({ screenshotPaths: [], commandOutput: 'iter1', gameState: { employeeCount: 1 }, uiState: {} })
      .mockResolvedValueOnce({ screenshotPaths: [], commandOutput: 'iter2', gameState: { employeeCount: 2 }, uiState: {} })
      .mockResolvedValueOnce({ screenshotPaths: [], commandOutput: 'iter3', gameState: { employeeCount: 3 }, uiState: {} });

    await runOneStep(repeatStep({ repeat: 3, expect: { changedBy: { employeeCount: 3 } } }));

    // "before" is captured once, ahead of all iterations — never re-fetched per iteration.
    expect(gameStateMock).toHaveBeenCalledTimes(1);
    // checkGoal is called exactly once for the whole step, with the LAST
    // iteration's game state as "after" (iter3: employeeCount 3), not the
    // first (iter1: employeeCount 1).
    expect(checkGoalMock).toHaveBeenCalledTimes(1);
    const afterArg = checkGoalMock.mock.calls[0]![3];
    expect(afterArg).toEqual({ employeeCount: 3 });
  });

  it('stops at the first failing iteration — never reaches a later one in the same repeat block', async () => {
    executeInteractionActionsMock
      .mockResolvedValueOnce({ screenshotPaths: [], commandOutput: 'iter1', gameState: { employeeCount: 1 }, uiState: {} })
      .mockRejectedValueOnce(new Error('iteration 2 failed'));

    const results = await runOneStep(repeatStep({ repeat: 5 }));

    // Iterations 3, 4, 5 must never run.
    expect(executeInteractionActionsMock).toHaveBeenCalledTimes(2);
    expect(results[0]!.error).toBeDefined();
  });

  it('a role:"player" step with repeat: N whose interaction contains a command action fails on iteration 1 and never reaches iteration 2..N', async () => {
    // Mirrors checkStepActionAllowed's real rejection (interaction-executor.ts)
    // for a player-marked step whose interaction runs a console command —
    // exercised here as the runner's own contract: iteration 1 failing must
    // stop the loop before any later iteration runs.
    executeInteractionActionsMock.mockRejectedValueOnce(
      new Error('step "fire the drill" is player-marked but its interaction runs console command "drill_plan grid" — player steps must be completed by clicking, not a console command.'),
    );

    const results = await runOneStep(repeatStep({
      role: 'player',
      description: 'fire the drill',
      repeat: 6,
      interaction: [{ type: 'command', command: 'drill_plan grid' }],
    }));

    expect(executeInteractionActionsMock).toHaveBeenCalledTimes(1);
    expect(results[0]!.error).toMatch(/player-marked/);
  });
});
