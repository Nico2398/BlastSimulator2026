/**
 * Shared result/progress helpers for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`).
 *
 * Stub only — signatures match the current inline implementation in
 * `run-all-scenarios.ts` (issue #824). Real logic moves in at implementation
 * time.
 */

import type { ScenarioResult } from './shared/command-runner.js';

// TODO: implement — move body from run-all-scenarios.ts's buildScenarioLoadFailure (#824)
export function buildScenarioLoadFailure(_name: string, _err: unknown): ScenarioResult {
  throw new Error('not implemented');
}

// TODO: implement — move body from run-all-scenarios.ts's logBatchProgress (#824)
export function logBatchProgress(
  _results: ScenarioResult[],
  _index: number,
  _total: number,
  _startTime: number,
): void {
  throw new Error('not implemented');
}
