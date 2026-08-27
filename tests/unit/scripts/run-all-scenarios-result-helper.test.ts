// BlastSimulator2026 — run-all-scenarios.ts's buildScenarioLoadFailure (#800)
//
// Both of run-all-scenarios.ts's batch loops (interaction-mode and
// command-mode) had an identical catch block that built a load-failure
// ScenarioResult and logged it:
//
//   } catch (err: unknown) {
//     const msg = err instanceof Error ? err.message : String(err);
//     console.error(`\n[${name}] FAILED — ${msg}`);
//     results.push({ name: name!, totalSteps: 0, failed: true, error: msg });
//   }
//
// buildScenarioLoadFailure(name, err) replaces both call sites. This test
// exercises it directly as a unit — the exported, mandatory helper — rather
// than driving main() end-to-end, since it is pure aside from one
// console.error side effect.
//
// scripts/run-all-scenarios.ts runs main() unconditionally at import time and
// ends every path in process.exit(...), so importing it still requires the
// same harness as tests/unit/scripts/run-all-scenarios-repeat.test.ts (mock
// 'fs', mock shared/puppeteer-utils.js, mock shared/interaction-driver.js,
// spy on process.exit, set process.argv before each dynamic import, and
// vi.resetModules() in beforeEach so re-importing re-runs main() instead of
// returning the cached first run). One fixture scenario with zero steps
// keeps main()'s own batch loop harmless while the module is imported.
//
// logBatchProgress is deliberately NOT unit-tested here — per the plan, it's
// a console.log wrapper over already-tested data, indirectly covered by
// run-all-scenarios-repeat.test.ts.
//
// DO NOT implement anything here — only add implementation to scripts/.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { resolve } from 'path';
import type { ScenarioDef, ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

const FIXTURE_NAME = 'result-helper-fixture-800-batch';

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
  SCREENSHOT_DIR: '/tmp/bs2026-run-all-scenarios-result-helper-fixture-screenshots',
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
  const def: ScenarioDef = { name: FIXTURE_NAME, description: 'fixture for #800 buildScenarioLoadFailure coverage', steps };
  fixtures.set(resolve(SCENARIO_DIR, `${FIXTURE_NAME}.json`), JSON.stringify(def));
}

const ORIGINAL_ARGV = process.argv;

describe('run-all-scenarios.ts buildScenarioLoadFailure (#800)', () => {
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

  it('Error input: returns exact ScenarioResult shape and logs the FAILED line', async () => {
    await registerFixtureScenario([]);
    const module = await import('../../../scripts/run-all-scenarios.js');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), { timeout: 5000 });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = module.buildScenarioLoadFailure('my-scenario', new Error('boom'));

    expect(result).toEqual({ name: 'my-scenario', totalSteps: 0, failed: true, error: 'boom' });
    expect(Object.keys(result).sort()).toEqual(['error', 'failed', 'name', 'totalSteps'].sort());
    expect(errorSpy).toHaveBeenCalledWith('\n[my-scenario] FAILED — boom');

    errorSpy.mockRestore();
  });

  it('non-Error string thrown: error field is the raw string', async () => {
    await registerFixtureScenario([]);
    const module = await import('../../../scripts/run-all-scenarios.js');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), { timeout: 5000 });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = module.buildScenarioLoadFailure('s', 'raw string');

    expect(result).toEqual({ name: 's', totalSteps: 0, failed: true, error: 'raw string' });
    expect(errorSpy).toHaveBeenCalledWith('\n[s] FAILED — raw string');

    errorSpy.mockRestore();
  });

  it('non-Error number thrown: error field is String()-coerced, matching the original ternary', async () => {
    await registerFixtureScenario([]);
    const module = await import('../../../scripts/run-all-scenarios.js');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), { timeout: 5000 });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = module.buildScenarioLoadFailure('s', 42);

    expect(result).toEqual({ name: 's', totalSteps: 0, failed: true, error: '42' });
    expect(errorSpy).toHaveBeenCalledWith('\n[s] FAILED — 42');

    errorSpy.mockRestore();
  });

  it('edge case: err is undefined — totalSteps 0, failed true, error is "undefined"', async () => {
    await registerFixtureScenario([]);
    const module = await import('../../../scripts/run-all-scenarios.js');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), { timeout: 5000 });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = module.buildScenarioLoadFailure('s', undefined);

    expect(result).toEqual({ name: 's', totalSteps: 0, failed: true, error: 'undefined' });
    expect(errorSpy).toHaveBeenCalledWith('\n[s] FAILED — undefined');

    errorSpy.mockRestore();
  });

  it('edge case: err is null — totalSteps 0, failed true, error is "null"', async () => {
    await registerFixtureScenario([]);
    const module = await import('../../../scripts/run-all-scenarios.js');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled(), { timeout: 5000 });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = module.buildScenarioLoadFailure('s', null);

    expect(result).toEqual({ name: 's', totalSteps: 0, failed: true, error: 'null' });
    expect(errorSpy).toHaveBeenCalledWith('\n[s] FAILED — null');

    errorSpy.mockRestore();
  });
});
