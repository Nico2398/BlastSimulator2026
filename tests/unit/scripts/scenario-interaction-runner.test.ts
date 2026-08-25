// BlastSimulator2026 — scenario-interaction-runner.ts: skipBlastPlayback wiring (#761)
//
// Interaction mode's post-blast collapse animation costs real wall-clock time
// (~6s/frame without a GPU, #475) that a scenario with no visual checkpoint
// over the collapse has no reason to pay. tutorial-interactive.json opts out
// via ScenarioDef.skipBlastPlayback: true, threaded into runScenarioInteraction
// as a required parameter — this suite pins the wiring that reads it and calls
// window.__skipBlastPlayback() after a successful `blast` step, and confirms
// it is NOT called when the flag is false (interaction mode's default:
// OBSERVE the collapse).
//
// No real Puppeteer browser involved: initBrowser/executeInteractionActions/
// checkGoal/gameState are all faked at the module boundary (same technique
// tests/unit/scenario-interaction.test.ts and tests/unit/scenario-test.test.ts
// already use), so this stays in the `logic` channel.
//
// scenario-interaction-runner.ts's skipBlastPlayback wiring is fully
// implemented on this branch — these tests exercise the real call site
// (the page.evaluate(__skipBlastPlayback) call inside the per-step try
// block, after a successful blast step), not a pending TODO.

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
// vi.hoisted() — a plain `const` here would throw "Cannot access before
// initialization" the moment the mocked module is imported.
const { fakePageRef, initBrowserMock, executeInteractionActionsMock, suspendDrawingMock, waitOneFrameMock, captureFrameMock } = vi.hoisted(() => {
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
    checkGoal: vi.fn(async () => {}),
    gameState: vi.fn(async () => ({})),
    InteractionFailure,
  };
});

import { runScenarioInteraction } from '../../../scripts/scenario-interaction-runner.js';

function blastStep(overrides: Partial<ScenarioStepDef> = {}): ScenarioStepDef {
  return { command: 'blast', role: 'player', description: 'fire the blast', ...overrides };
}

describe('runScenarioInteraction — skipBlastPlayback wiring (#761)', () => {
  beforeEach(() => {
    fakePage = { evaluate: vi.fn(async () => undefined) };
    fakePageRef.current = fakePage;
    initBrowserMock.mockClear();
    executeInteractionActionsMock.mockClear();
    suspendDrawingMock.mockClear();
  });

  it('calls window.__skipBlastPlayback() via page.evaluate after a successful blast step when skipBlastPlayback is true', async () => {
    await runScenarioInteraction(
      'tutorial-interactive-fixture',
      [blastStep()],
      [], 5173, undefined, 1, 200,
      { width: 1280, height: 720 },
      false, '/tmp/screenshots',
      true, // skipBlastPlayback
    );

    const calledWithSkip = fakePage.evaluate.mock.calls.some(call =>
      String(call[0]).includes('__skipBlastPlayback'),
    );
    expect(calledWithSkip).toBe(true);
  });

  it('never calls window.__skipBlastPlayback() when skipBlastPlayback is false, even after a successful blast step', async () => {
    await runScenarioInteraction(
      'tutorial-interactive-fixture',
      [blastStep()],
      [], 5173, undefined, 1, 200,
      { width: 1280, height: 720 },
      false, '/tmp/screenshots',
      false, // skipBlastPlayback
    );

    const calledWithSkip = fakePage.evaluate.mock.calls.some(call =>
      String(call[0]).includes('__skipBlastPlayback'),
    );
    expect(calledWithSkip).toBe(false);
  });

  it('does not call window.__skipBlastPlayback() for a non-blast step, even when skipBlastPlayback is true', async () => {
    await runScenarioInteraction(
      'tutorial-interactive-fixture',
      [{ command: 'tick 1', role: 'setup' }],
      [], 5173, undefined, 1, 200,
      { width: 1280, height: 720 },
      false, '/tmp/screenshots',
      true, // skipBlastPlayback
    );

    const calledWithSkip = fakePage.evaluate.mock.calls.some(call =>
      String(call[0]).includes('__skipBlastPlayback'),
    );
    expect(calledWithSkip).toBe(false);
  });

  it('never calls window.__skipBlastPlayback() when the blast step itself throws, even when skipBlastPlayback is true', async () => {
    // The skip call sits inside the same try block as the step's own actions
    // (scenario-interaction-runner.ts, after `results.push(...)`), so a step
    // that throws before reaching that line must never reach the skip call
    // either — this pins that ordering rather than just the flag/command
    // gating the other cases cover.
    executeInteractionActionsMock.mockRejectedValueOnce(new Error('step action failed'));

    await runScenarioInteraction(
      'tutorial-interactive-fixture',
      [blastStep()],
      [], 5173, undefined, 1, 200,
      { width: 1280, height: 720 },
      false, '/tmp/screenshots',
      true, // skipBlastPlayback
    );

    const calledWithSkip = fakePage.evaluate.mock.calls.some(call =>
      String(call[0]).includes('__skipBlastPlayback'),
    );
    expect(calledWithSkip).toBe(false);
  });
});
