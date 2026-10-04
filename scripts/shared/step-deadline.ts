/** Raised by a step deadline when its budget is spent. */
export class StepTimeoutError extends Error {}

/** Per-step wall-clock budget that excludes explicitly-marked work (e.g. screenshot capture). */
interface StepDeadline {
  /** Rejects when the budget (minus excluded time) is spent. */
  readonly expired: Promise<never>;
  /** Runs `work` without its elapsed time counting against the budget. */
  excluding<T>(work: () => Promise<T>): Promise<T>;
  /** Cancels the deadline. */
  stop(): void;
  /** True once the budget has expired. */
  readonly timedOut: boolean;
}

/**
 * Creates a wall-clock budget for one step. The clock runs while the step does
 * and pauses inside `excluding(...)` (nestable; resumes when the outermost span
 * ends). `describe` is evaluated lazily at expiry so the message can name the
 * last progress. `expired` never causes an unhandled rejection if nobody awaits it.
 * Call `stop()` when the step ends. `now` is injectable for tests.
 */
export function createStepDeadline(
  budgetMs: number,
  describe: () => string,
  now: () => number = () => Date.now(),
): StepDeadline {
  let spent = 0;
  let last = now();
  let depth = 0;
  let timedOut = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Charges the time since the last checkpoint to the budget. */
  const accrue = (): void => {
    const t = now();
    spent += t - last;
    last = t;
  };
  let rejectFn: (e: Error) => void = () => {};
  const expired = new Promise<never>((_, reject) => { rejectFn = reject; });
  expired.catch(() => {});

  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (stopped || timedOut || depth > 0) return;
    const remaining = Math.max(0, budgetMs - spent);
    timer = setTimeout(check, remaining);
  };
  const check = (): void => {
    timer = undefined;
    if (stopped || timedOut || depth > 0) return;
    accrue();
    if (spent >= budgetMs) {
      timedOut = true;
      rejectFn(new StepTimeoutError(describe()));
      return;
    }
    arm();
  };

  arm();

  return {
    expired,
    async excluding<T>(work: () => Promise<T>): Promise<T> {
      if (depth === 0) {
        accrue();
        if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      }
      depth++;
      try {
        return await work();
      } finally {
        depth--;
        if (depth === 0) {
          last = now();
          arm();
        }
      }
    },
    stop(): void {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    get timedOut(): boolean { return timedOut; },
  };
}

/** What a raced step's work receives from its deadline. */
interface StepRaceContext {
  /** Records where the step stands; named in the timeout message. */
  readonly reportProgress: (detail: string) => void;
  /** Runs work whose time does not count against the budget. */
  readonly excluding: StepDeadline['excluding'];
}

/**
 * Runs `work` against a fresh step deadline and stops the deadline afterwards.
 * Rejects with a StepTimeoutError "<label> timed out after <budget>ms (last progress: ...)"
 * if the budget (excluding marked work) is spent first.
 */
export async function raceStepDeadline<T>(
  budgetMs: number,
  label: string,
  work: (ctx: StepRaceContext) => Promise<T>,
): Promise<T> {
  let lastProgress = 'no interaction action has started yet';
  const deadline = createStepDeadline(
    budgetMs,
    () => `${label} timed out after ${budgetMs}ms (last progress: ${lastProgress})`,
  );
  try {
    return await Promise.race([
      work({ reportProgress: (detail) => { lastProgress = detail; }, excluding: deadline.excluding }),
      deadline.expired,
    ]);
  } finally {
    deadline.stop();
  }
}
