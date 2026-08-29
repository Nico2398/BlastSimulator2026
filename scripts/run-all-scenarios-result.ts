/**
 * Shared result/progress helpers for the batch scenario runner
 * (`scripts/run-all-scenarios.ts`).
 */

import type { ScenarioResult } from './shared/command-runner.js';

/**
 * Builds the `ScenarioResult` for a scenario whose own load/run threw before
 * producing a real per-step result (bad scenario JSON, an uncaught exception
 * escaping the step loop) — as opposed to a scenario that ran to completion
 * and already carries its own totalSteps/failed/error. Logs the same
 * `[name] FAILED — msg` line both call sites printed before this refactor
 * (#800), so a caller only needs `results.push(buildScenarioLoadFailure(name, err))`.
 */
export function buildScenarioLoadFailure(name: string, err: unknown): ScenarioResult {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n[${name}] FAILED — ${msg}`);
  return { name, totalSteps: 0, failed: true, error: msg };
}

export function logBatchProgress(results: ScenarioResult[], index: number, total: number, startTime: number): void {
  const passed = results.filter(r => !r.failed).length;
  const failed = results.filter(r => r.failed).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Progress: ${index + 1}/${total} (${passed} passed, ${failed} failed) [${elapsed}s]`);
}
