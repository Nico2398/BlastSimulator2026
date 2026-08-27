// BlastSimulator2026 — run-all-scenarios.ts's OWN interaction-mode batch
// loop: `repeat: N` step multiplier (#696)
//
// scripts/run-all-scenarios.ts is a SECOND, independent per-step interaction
// loop (runBatchInteraction) that does not share implementation with
// scenario-interaction-runner.ts's runScenarioInteraction — it is the runner
// `npm run scenarios:interaction` and the CI "Scenarios (interaction mode)"
// job actually invoke for a full batch (see this file's own module doc
// comment). The original issue's file list did not name this call site — a
// `repeat` step honored only by runScenarioInteraction would pass every
// single-scenario check (`npm run scenario -- --mode interaction`) while
// silently running once, not N times, in the one path CI's batch job takes.
//
// run-all-scenarios.ts runs main() unconditionally at import time and ends
// every path in a `process.exit(...)` call, so this test:
//   - mocks 'fs' (mkdirSync/writeFileSync as no-ops; readFileSync/existsSync/
//     readdirSync intercepted for one fixture scenario file, the same
//     technique tests/unit/scripts/shared/scenario-utils.test.ts already uses
//     for loadScenarioDef fixtures)
//   - mocks shared/puppeteer-utils.js (initBrowser/executeInteractionActions/
//     suspendDrawing), the same technique
//     tests/unit/scripts/scenario-interaction-runner.test.ts already uses for
//     the sibling runner
//   - mocks shared/interaction-driver.js (checkGoal/gameState)
//   - spies on process.exit so the batch's own exit call doesn't kill the
//     test worker
//   - sets process.argv before each dynamic import, and calls
//     vi.resetModules() so re-importing the module actually re-runs main()
//     instead of returning the cached first run
//
// No real Puppeteer browser or dev server involved — stays in the `logic`
// channel.
//
// DO NOT implement anything here — only add implementation to scripts/.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { resolve } from 'path';
import type { ScenarioDef, ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

const FIXTURE_NAME = 'repeat-fixture-696-batch';

const {
  fixtures,
  initBrowserMock,
  executeInteractionActionsMock,
  suspendDrawingMock,
  checkGoalMock,
  gameStateMock,
  fakePage,
} = vi.hoisted(() => {
  const fixtures = new Map<string, string>();
  const fakePage = {
    setViewport: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    evaluate: vi.fn(async () => undefined),
  };
  const fakeBrowser = {
    newPage: vi.fn(async () => fakePage),
    close: vi.fn(async () => {}),
  };
  return {
    fixtures,
    fakePage,
    initBrowserMock: vi.fn(async () => ({ browser: fakeBrowser, page: fakePage })),
    executeInteractionActionsMock: vi.fn(async () => ({
      screenshotPaths: [] as string[],
      commandOutput: 'ok',
      gameState: {},
      uiState: {},
    })),
    suspendDrawingMock: vi.fn(async () => {}),
    checkGoalMock: vi.fn(async () => {}),
    gameStateMock: vi.fn(async () => ({})),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: (dir: unknown, ...rest: unknown[]) => {
      if (String(dir).includes('scenario-defs')) return [`${FIXTURE_NAME}.json`];
      return (actual.readdirSync as (...a: unknown[]) => unknown)(dir, ...rest);
    },
    readFileSync: (path: unknown, encoding?: BufferEncoding) => {
      const key = String(path);
      if (fixtures.has(key)) return fixtures.get(key)!;
      return actual.readFileSync(path as never, encoding as never);
    },
    existsSync: (path: unknown) => {
      const key = String(path);
      if (fixtures.has(key)) return true;
      return actual.existsSync(path as never);
    },
  };
});

vi.mock('../../../scripts/shared/puppeteer-utils.js', () => ({
  initBrowser: initBrowserMock,
  executeInteractionActions: executeInteractionActionsMock,
  suspendDrawing: suspendDrawingMock,
  DEFAULT_STEP_TIMEOUT: 60,
  SCREENSHOT_DIR: '/tmp/bs2026-run-all-scenarios-repeat-fixture-screenshots',
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

/** Registers a fixture scenario file at the exact path loadScenarioDef (unmocked, real) will resolve for FIXTURE_NAME. */
async function registerFixtureScenario(steps: ScenarioStepDef[]): Promise<void> {
  const { SCENARIO_DIR } = await import('../../../scripts/shared/scenario-utils.js');
  const def: ScenarioDef = { name: FIXTURE_NAME, description: 'fixture for #696 run-all-scenarios repeat coverage', steps };
  fixtures.set(resolve(SCENARIO_DIR, `${FIXTURE_NAME}.json`), JSON.stringify(def));
}

const ORIGINAL_ARGV = process.argv;

describe('run-all-scenarios.ts batch interaction loop honors repeat: N (#696)', () => {
  let exitSpy: MockInstance<Parameters<typeof process.exit>, ReturnType<typeof process.exit>>;

  beforeEach(() => {
    vi.resetModules();
    fixtures.clear();
    initBrowserMock.mockClear();
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
    fakePage.evaluate.mockClear();
    process.argv = ['node', 'run-all-scenarios.js', '--mode', 'interaction', FIXTURE_NAME];
    // main() ends every path in process.exit(...); a real exit would kill
    // the test worker mid-run, so this spy neuters it while still recording
    // the call for tests that want to assert the batch actually finished.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => undefined) as unknown) as typeof process.exit);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.argv = ORIGINAL_ARGV;
  });

  it('repeat: N calls executeInteractionActions N times for a single scripted step, in this batch runner\'s own loop', async () => {
    await registerFixtureScenario([
      { command: 'employee hire role:driller', role: 'bootstrap', repeat: 4, interaction: [{ type: 'command', command: 'employee hire role:driller' }] },
    ]);

    await import('../../../scripts/run-all-scenarios.js');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), { timeout: 5000 });

    expect(executeInteractionActionsMock).toHaveBeenCalledTimes(4);
  });

  it('absent repeat calls executeInteractionActions exactly once, as today (regression guard alongside the N-times case)', async () => {
    await registerFixtureScenario([
      { command: 'employee hire role:driller', role: 'bootstrap', interaction: [{ type: 'command', command: 'employee hire role:driller' }] },
    ]);

    await import('../../../scripts/run-all-scenarios.js');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), { timeout: 5000 });

    expect(executeInteractionActionsMock).toHaveBeenCalledTimes(1);
  });

  it('repeat combined with a waitUntil interaction action on the same step is rejected before the first iteration, naming both constructs', async () => {
    await registerFixtureScenario([
      {
        command: 'wait_until field:tickCount equals:3 max_ticks:10',
        role: 'setup',
        repeat: 2,
        interaction: [{ type: 'waitUntil', field: 'tickCount', equals: 3, maxTicks: 10, timeoutMs: 30000 }],
      },
    ]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../../../scripts/run-all-scenarios.js');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), { timeout: 5000 });

    expect(executeInteractionActionsMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    const logged = logSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(logged).toMatch(/repeat/i);
    expect(logged).toMatch(/waitUntil/i);

    logSpy.mockRestore();
  });
});
