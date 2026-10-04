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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const { fakePageRef, initBrowserMock, executeInteractionActionsMock, suspendDrawingMock, waitOneFrameMock, captureFrameMock, forceRenderFrameMock } = vi.hoisted(() => {
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
    forceRenderFrameMock: vi.fn(async () => {}),
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
  forceRenderFrame: forceRenderFrameMock,
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

import { runScenarioInteraction, type ShotDef } from '../../../scripts/scenario-interaction-runner.js';

function blastStep(overrides: Partial<ScenarioStepDef> = {}): ScenarioStepDef {
  return { command: 'blast', role: 'player', description: 'fire the blast', ...overrides };
}

function genericStep(overrides: Partial<ScenarioStepDef> = {}): ScenarioStepDef {
  return { command: 'tick 1', role: 'setup', description: 'advance time', ...overrides };
}

const shotsFixture: ShotDef[] = [{ name: 'overview', yaw: 0, pitch: 45 }];

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

describe('multi-angle shots camera sync (#1244)', () => {
  beforeEach(() => {
    fakePage = { evaluate: vi.fn(async () => undefined) };
    fakePageRef.current = fakePage;
    initBrowserMock.mockClear();
    executeInteractionActionsMock.mockClear();
    suspendDrawingMock.mockClear();
    waitOneFrameMock.mockClear();
    forceRenderFrameMock.mockClear();
  });

  it('calls forceRenderFrame after __cameraReset when the scenario defines shots', async () => {
    await runScenarioInteraction(
      'shots-fixture',
      [genericStep()],
      shotsFixture, 5173, undefined, 1, 200,
      { width: 1280, height: 720 },
      true, // enableScreenshots
      '/tmp/screenshots',
      false, // skipBlastPlayback
    );

    expect(forceRenderFrameMock).toHaveBeenCalled();

    // Ordering is the actual regression being guarded against: __cameraReset
    // must fire, then forceRenderFrame, then the next waitOneFrame — a real
    // render between the reset and the frame that follows it.
    const cameraResetCallIndex = fakePage.evaluate.mock.calls.findIndex(call =>
      String(call[0]).includes('__cameraReset'),
    );
    expect(cameraResetCallIndex).toBeGreaterThanOrEqual(0);
    const cameraResetOrder = fakePage.evaluate.mock.invocationCallOrder[cameraResetCallIndex]!;
    const forceRenderOrder = forceRenderFrameMock.mock.invocationCallOrder[0]!;
    const waitOneFrameOrderAfterReset = waitOneFrameMock.mock.invocationCallOrder.find(
      order => order > cameraResetOrder,
    );

    expect(cameraResetOrder).toBeLessThan(forceRenderOrder);
    expect(waitOneFrameOrderAfterReset).toBeDefined();
    expect(forceRenderOrder).toBeLessThan(waitOneFrameOrderAfterReset!);
  });

  it('does not call forceRenderFrame when the scenario defines no shots', async () => {
    await runScenarioInteraction(
      'no-shots-fixture',
      [genericStep()],
      [], 5173, undefined, 1, 200,
      { width: 1280, height: 720 },
      true, // enableScreenshots
      '/tmp/screenshots',
      false, // skipBlastPlayback
    );

    expect(forceRenderFrameMock).not.toHaveBeenCalled();
  });

  it('does not call forceRenderFrame when screenshots are disabled', async () => {
    await runScenarioInteraction(
      'screenshots-disabled-fixture',
      [genericStep()],
      shotsFixture, 5173, undefined, 1, 200,
      { width: 1280, height: 720 },
      false, // enableScreenshots
      '/tmp/screenshots',
      false, // skipBlastPlayback
    );

    expect(forceRenderFrameMock).not.toHaveBeenCalled();
    const calledCameraReset = fakePage.evaluate.mock.calls.some(call =>
      String(call[0]).includes('__cameraReset'),
    );
    expect(calledCameraReset).toBe(false);
  });

  it('calls forceRenderFrame once per step that has shots, across multiple steps', async () => {
    await runScenarioInteraction(
      'two-step-shots-fixture',
      [genericStep({ command: 'tick 1' }), genericStep({ command: 'tick 2' })],
      shotsFixture, 5173, undefined, 1, 200,
      { width: 1280, height: 720 },
      true, // enableScreenshots
      '/tmp/screenshots',
      false, // skipBlastPlayback
    );

    expect(forceRenderFrameMock).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────
// #1224 — capture time never counts against a step's deadline. The deadline
// covers the step's own interaction actions and its `expect` check; the
// end-of-step captures (base image, frames, shots) run after it is satisfied,
// and inline `screenshot` actions run through the `excludeFromDeadline`
// wrapper handed to executeInteractionActions.
// ──────────────────────────────────────────────
describe('step deadline excludes capture time (#1224)', () => {
  const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
  const okResult = { screenshotPaths: [] as string[], commandOutput: 'ok', gameState: {}, uiState: {} };

  beforeEach(() => {
    vi.useFakeTimers();
    fakePage = { evaluate: vi.fn(async () => undefined) };
    fakePageRef.current = fakePage;
    initBrowserMock.mockClear();
    executeInteractionActionsMock.mockReset();
    executeInteractionActionsMock.mockImplementation(async () => okResult);
    captureFrameMock.mockReset();
    captureFrameMock.mockImplementation(async () => {});
    waitOneFrameMock.mockClear();
  });

  afterEach(() => { vi.useRealTimers(); });

  async function run(steps: ScenarioStepDef[], shots: ShotDef[], enableScreenshots: boolean, frames = 1) {
    const p = runScenarioInteraction(
      'deadline-fixture', steps, shots, 5173, undefined, frames, 200,
      { width: 1280, height: 720 }, enableScreenshots, '/tmp/screenshots', false,
    );
    // Settle the whole run in simulated time; far past any capture below.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    return p;
  }

  it('does not time out when base, frame and shot captures each outlast the step deadline', async () => {
    captureFrameMock.mockImplementation(() => sleep(5000));
    const results = await run(
      [genericStep({ timeout: 1, frames: 2 })],
      [{ name: 'a', yaw: 0, pitch: 45 }, { name: 'b', yaw: 90, pitch: 45 }],
      true,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toBeUndefined();
    // base + 2 frames + 2 shots, all really captured.
    expect(captureFrameMock).toHaveBeenCalledTimes(5);
  });

  it('does not charge inline screenshot time passed through excludeFromDeadline', async () => {
    executeInteractionActionsMock.mockImplementation(async (...args: unknown[]) => {
      const exclude = args[8] as <T>(work: () => Promise<T>) => Promise<T>;
      expect(typeof exclude).toBe('function');
      await exclude(() => sleep(3000));
      return okResult;
    });
    const results = await run([genericStep({ timeout: 1 })], [], true);
    expect(results[0]!.error).toBeUndefined();
  });

  it('control: the same time in a non-excluded action times out, naming the last progress', async () => {
    executeInteractionActionsMock.mockImplementation(async (...args: unknown[]) => {
      (args[6] as (d: string) => void)('action 1/1 (wait)');
      await sleep(3000);
      return okResult;
    });
    const results = await run([genericStep({ timeout: 1 })], [], true);
    expect(results[0]!.error).toMatch(/timed out after 1000ms \(last progress: action 1\/1 \(wait\)\)/);
  });

  it('gives the same deadline with and without screenshots enabled', async () => {
    executeInteractionActionsMock.mockImplementation(async () => { await sleep(3000); return okResult; });
    const withShots = await run([genericStep({ timeout: 1 })], shotsFixture, true);
    const without = await run([genericStep({ timeout: 1 })], shotsFixture, false);
    expect(withShots[0]!.error).toMatch(/timed out after 1000ms/);
    expect(without[0]!.error).toMatch(/timed out after 1000ms/);
  });

  it('a step whose actions finish in time still passes under screenshots', async () => {
    executeInteractionActionsMock.mockImplementation(async () => { await sleep(900); return okResult; });
    const results = await run([genericStep({ timeout: 1 })], shotsFixture, true);
    expect(results[0]!.error).toBeUndefined();
  });

  it('fails the step when an end-of-step capture throws after the race', async () => {
    captureFrameMock.mockRejectedValueOnce(new Error('capture boom'));
    const results = await run([genericStep({ timeout: 1 })], [], true);
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toContain('capture boom');
  });

  it('stops at the failed capture instead of running later steps', async () => {
    captureFrameMock.mockRejectedValueOnce(new Error('capture boom'));
    const results = await run(
      [genericStep({ timeout: 1 }), genericStep({ command: 'tick 2', timeout: 1 })], [], true,
    );
    expect(results).toHaveLength(1);
  });
});
