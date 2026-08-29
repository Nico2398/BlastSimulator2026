/**
 * Command-mode batch loop for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`).
 *
 * Stub only — signature matches the current inline command-mode branch of
 * `main()` in `run-all-scenarios.ts` (issue #824). Real logic moves in at
 * implementation time.
 */

import type { ScenarioResult } from './shared/command-runner.js';

// TODO: implement — move body from run-all-scenarios.ts's main() command-mode branch (#824)
export function runBatchCommand(
  _names: string[],
  _reportDrift: boolean,
  _startTime: number,
): ScenarioResult[] {
  throw new Error('not implemented');
}
