// BlastSimulator2026 — Shared console-command test helpers for
// tests/integration/ (root-level, createRunner-based tests).
//
// tickUntil was defined identically (or near-identically) in
// drill-plan-queueing.test.ts, charge-plan-queueing.test.ts, and
// collapse-vehicle-recovery.integration.test.ts. Extracted here per #808.

/** Runs `tick 1` until `predicate()` is true or `maxTicks` is exhausted. */
export function tickUntil(
  run: (cmd: string) => unknown,
  predicate: () => boolean,
  maxTicks = 400,
): void {
  throw new Error('not implemented');
}
