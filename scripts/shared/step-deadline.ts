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
    const t = now();
    spent += t - last;
    last = t;
    if (spent >= budgetMs) {
      timedOut = true;
      rejectFn(new Error(describe()));
      return;
    }
    arm();
  };

  arm();

  return {
    expired,
    async excluding<T>(work: () => Promise<T>): Promise<T> {
      if (depth === 0) {
        const t = now();
        spent += t - last;
        last = t;
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
