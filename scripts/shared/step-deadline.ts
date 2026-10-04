/** Per-step wall-clock budget that excludes explicitly-marked work (e.g. screenshot capture). */
export interface StepDeadline {
  /** Rejects when the budget (minus excluded time) is spent. */
  readonly expired: Promise<never>;
  /** Runs `work` without its elapsed time counting against the budget. */
  excluding<T>(work: () => Promise<T>): Promise<T>;
  /** Cancels the deadline. */
  stop(): void;
  /** True once the budget has expired. */
  readonly timedOut: boolean;
}

export function createStepDeadline(
  budgetMs: number,
  describe: () => string,
  now?: () => number,
): StepDeadline {
  void budgetMs;
  void describe;
  void now;
  // TODO: implement
  throw new Error('not implemented');
}
