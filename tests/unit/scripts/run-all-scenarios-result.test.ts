// BlastSimulator2026 — run-all-scenarios-result.ts (#824)
//
// Split of run-all-scenarios.ts's shared result/progress helpers into their
// own module: buildScenarioLoadFailure and logBatchProgress. Both are
// exercised indirectly today via run-all-scenarios-result-helper.test.ts
// (which imports the entrypoint's own re-export and drives it through
// main()'s process.argv/process.exit harness) — this file instead calls the
// two functions directly against this new module, now that they're
// independently importable, per issue #824's split.
//
// Characterization tests: pin the CURRENT real behavior read from
// run-all-scenarios.ts before the split, so they fail red against the stub
// body (`throw new Error('not implemented')`) and pass once @implementer
// moves the real logic into this file unchanged.
//
// DO NOT implement anything here — only add implementation to scripts/.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildScenarioLoadFailure, logBatchProgress } from '../../../scripts/run-all-scenarios-result.js';
import type { ScenarioResult } from '../../../scripts/shared/command-runner.js';

describe('run-all-scenarios-result.ts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildScenarioLoadFailure', () => {
    it('builds a failed ScenarioResult with zero steps and the error message, for a real Error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = buildScenarioLoadFailure('my-scenario', new Error('boom'));

      expect(result).toEqual({ name: 'my-scenario', totalSteps: 0, failed: true, error: 'boom' });
      expect(errorSpy).toHaveBeenCalledWith('\n[my-scenario] FAILED — boom');
    });

    it('String()-coerces a non-Error thrown value rather than reading a .message property', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = buildScenarioLoadFailure('s', 42);

      expect(result).toEqual({ name: 's', totalSteps: 0, failed: true, error: '42' });
      expect(errorSpy).toHaveBeenCalledWith('\n[s] FAILED — 42');
    });

    it('handles a thrown undefined without throwing itself', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => buildScenarioLoadFailure('s', undefined)).not.toThrow();
      expect(buildScenarioLoadFailure('s', undefined)).toEqual({
        name: 's', totalSteps: 0, failed: true, error: 'undefined',
      });
    });
  });

  describe('logBatchProgress', () => {
    it('logs passed/failed counts and elapsed seconds without throwing', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const results: ScenarioResult[] = [
        { name: 'a', totalSteps: 3, failed: false },
        { name: 'b', totalSteps: 1, failed: true, error: 'oops' },
      ];
      const startTime = Date.now() - 2500;

      expect(() => logBatchProgress(results, 1, 5, startTime)).not.toThrow();

      expect(logSpy).toHaveBeenCalledTimes(1);
      const logged = String(logSpy.mock.calls[0]![0]);
      expect(logged).toContain('2/5');
      expect(logged).toContain('1 passed');
      expect(logged).toContain('1 failed');
      expect(logged).toMatch(/\[\d+(\.\d+)?s\]/);
    });

    it('counts zero passed / zero failed correctly for an empty results list', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logBatchProgress([], 0, 0, Date.now());

      const logged = String(logSpy.mock.calls[0]![0]);
      expect(logged).toContain('0 passed');
      expect(logged).toContain('0 failed');
    });
  });
});
