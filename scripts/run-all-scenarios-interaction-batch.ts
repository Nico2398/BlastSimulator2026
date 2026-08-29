/**
 * Interaction-mode batch loop for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`).
 *
 * Stub only — signature matches the current `runBatchInteraction` in
 * `run-all-scenarios.ts` (issue #824). Real logic moves in at implementation
 * time.
 */

import type { ScenarioResult } from './shared/command-runner.js';

// TODO: implement — move body from run-all-scenarios.ts's runBatchInteraction (#824)
export async function runBatchInteraction(
  _names: string[],
  _port: number,
): Promise<ScenarioResult[]> {
  throw new Error('not implemented');
}
