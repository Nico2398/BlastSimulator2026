// BlastSimulator2026 — Shared console-command test helpers for
// tests/integration/ (root-level, createRunner-based tests).
//
// tickUntil was defined identically (or near-identically) in
// drill-plan-queueing.test.ts, charge-plan-queueing.test.ts, and
// collapse-vehicle-recovery.integration.test.ts. Extracted here per #808.

/**
 * `tick 1` that clears a random event the tick refuses to run past ("Pending event! Resolve it first").
 * Long waits (the explosive delivery wait, #1895) cross an event's firing tick; the clock stays halted
 * until a player resolves it, so a test that only wants time to pass resolves it with the first option.
 */
export function tickResolvingEvents(run: (cmd: string) => unknown): void {
  const result = run('tick 1') as { output?: string } | undefined;
  if (result?.output?.startsWith('Pending event!')) run('event choose 0');
}

/** Runs `tick 1` until `predicate()` is true or `maxTicks` is exhausted. */
export function tickUntil(
  run: (cmd: string) => unknown,
  predicate: () => boolean,
  maxTicks = 400,
): void {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    tickResolvingEvents(run);
  }
}
