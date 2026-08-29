// BlastSimulator2026 — run-all-scenarios-command-batch.ts (#824)
//
// Split of run-all-scenarios.ts's command-mode batch loop (the mode !==
// 'interaction' branch of main()) into its own module, `runBatchCommand`.
// Unlike runBatchInteraction, this branch was never an extracted named
// function before the split and had no direct unit coverage of its own —
// only the real `npm run scenarios` invocation (the `scenario` verification
// channel) exercised it end-to-end. Now that it's an independently
// importable, synchronous, non-process.exit-ing function, it's cheap to
// drive directly by mocking its two real dependencies
// (scripts/shared/command-runner.ts, scripts/shared/scenario-utils.ts) —
// no browser, no dynamic-import-plus-process.exit harness needed.
//
// Characterization tests: pin the CURRENT real behavior read from
// run-all-scenarios.ts's command-mode branch before the split (issue #824),
// so they fail red against the stub body (`throw new Error('not
// implemented')`) and pass once @implementer moves the real logic into this
// file unchanged.
//
// DO NOT implement anything here — only add implementation to scripts/.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import type { ScenarioResult } from '../../../scripts/shared/command-runner.js';

const { createGameEngineMock, runScenarioMock, loadScenarioDefMock } = vi.hoisted(() => ({
  createGameEngineMock: vi.fn(() => ({ fakeEngine: true })),
  runScenarioMock: vi.fn(),
  loadScenarioDefMock: vi.fn(),
}));

vi.mock('../../../scripts/shared/command-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../scripts/shared/command-runner.js')>();
  return {
    ...actual,
    createGameEngine: createGameEngineMock,
    runScenario: runScenarioMock,
  };
});

vi.mock('../../../scripts/shared/scenario-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../scripts/shared/scenario-utils.js')>();
  return {
    ...actual,
    loadScenarioDef: loadScenarioDefMock,
  };
});

describe('run-all-scenarios-command-batch.ts', () => {
  beforeEach(() => {
    createGameEngineMock.mockClear();
    runScenarioMock.mockReset();
    loadScenarioDefMock.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates exactly one shared game engine for the whole batch, not one per scenario', async () => {
    const { runBatchCommand } = await import('../../../scripts/run-all-scenarios-command-batch.js');
    loadScenarioDefMock.mockReturnValue({ name: 'x', description: '', steps: [] as ScenarioStepDef[] });
    runScenarioMock.mockReturnValue({ name: 'x', totalSteps: 0, failed: false } satisfies ScenarioResult);

    runBatchCommand(['a', 'b', 'c'], false, Date.now());

    expect(createGameEngineMock).toHaveBeenCalledTimes(1);
  });

  it('runs each named scenario against the shared engine and collects its result, in order', async () => {
    const { runBatchCommand } = await import('../../../scripts/run-all-scenarios-command-batch.js');
    loadScenarioDefMock.mockImplementation((name: string) => ({ name, description: '', steps: [] as ScenarioStepDef[] }));
    runScenarioMock.mockImplementation((_engine, name: string) => ({ name, totalSteps: 2, failed: false }) satisfies ScenarioResult);

    const results = runBatchCommand(['alpha', 'beta'], false, Date.now());

    expect(results.map(r => r.name)).toEqual(['alpha', 'beta']);
    expect(runScenarioMock).toHaveBeenCalledTimes(2);
  });

  it('passes reportDrift through to runScenario for every scenario', async () => {
    const { runBatchCommand } = await import('../../../scripts/run-all-scenarios-command-batch.js');
    loadScenarioDefMock.mockReturnValue({ name: 'x', description: '', steps: [] as ScenarioStepDef[] });
    runScenarioMock.mockReturnValue({ name: 'x', totalSteps: 0, failed: false } satisfies ScenarioResult);

    runBatchCommand(['x'], true, Date.now());

    expect(runScenarioMock).toHaveBeenCalledWith(expect.anything(), 'x', expect.anything(), expect.anything(), true);
  });

  it('a scenario whose loadScenarioDef throws is recorded as a load failure, not thrown out of the batch', async () => {
    const { runBatchCommand } = await import('../../../scripts/run-all-scenarios-command-batch.js');
    loadScenarioDefMock.mockImplementation((name: string) => {
      if (name === 'broken') throw new Error('bad scenario JSON');
      return { name, description: '', steps: [] as ScenarioStepDef[] };
    });
    runScenarioMock.mockImplementation((_engine, name: string) => ({ name, totalSteps: 1, failed: false }) satisfies ScenarioResult);

    const results = runBatchCommand(['ok', 'broken'], false, Date.now());

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ name: 'ok', totalSteps: 1, failed: false });
    expect(results[1]).toMatchObject({ name: 'broken', totalSteps: 0, failed: true, error: 'bad scenario JSON' });
  });

  it('returns an empty array for an empty scenario list without creating an engine call failure', async () => {
    const { runBatchCommand } = await import('../../../scripts/run-all-scenarios-command-batch.js');

    const results = runBatchCommand([], false, Date.now());

    expect(results).toEqual([]);
    expect(runScenarioMock).not.toHaveBeenCalled();
  });
});
