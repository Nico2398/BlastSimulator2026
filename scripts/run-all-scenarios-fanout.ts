/**
 * Fans a command-mode batch (`npm run scenarios`) out across worker
 * processes, so the `scenario` channel uses the machine's cores instead of one.
 *
 * Why: the batch ran every scenario serially in one process — 120 s for 246
 * scenarios on a 4-core sandbox with three cores idle, 5.5 min in CI's
 * `scenario-command` job — and `npm run pipeline -- verify` runs it on every
 * src/core, src/console or scenario-definition change, several times per
 * pipeline run. Waiting on programs, not model time, is what pushed #2142,
 * #2143, #2148, #2154 and #2199 into the 270-minute agent-step timeout.
 *
 * Why a shared queue rather than `--shard i/K` slices: the cost of a
 * command-mode scenario is not in its definition. Measured serially (246
 * scenarios, 117.6 s summed), the longest is 12.5 s against a 114 ms median,
 * and step count — `estimateScenarioCost`'s command-mode proxy — ranks a
 * 365-step playthrough (2.4 s) above a 181-step one (12.5 s). Cost-balanced
 * static shards on that proxy put 34.7 s on the slowest of 4 workers against
 * a 29.4 s ideal; a queue that hands each idle worker the next scenario,
 * costliest first by the same proxy, lands at 29.4 s, and keeps adapting
 * when another process steals a core mid-run.
 *
 * Output stays the serial runner's: each scenario's captured output is
 * printed whole, in the batch's alphabetical order, followed by the same
 * progress line — never two scenarios interleaved, whichever worker ran them.
 */

import type { ScenarioResult } from './shared/command-runner.js';
import { logBatchProgress } from './run-all-scenarios-result.js';
import {
  forkScenarioWorker,
  WorkerDiedError,
  describeExit,
  type OutputChunk,
  type ScenarioWorker,
} from './run-all-scenarios-worker.js';

/**
 * Upper bound on the default worker count. Each worker holds its own engine:
 * the serial batch peaked at 429 MB RSS, so six workers stay under ~2.6 GB —
 * inside the 7 GB of the smallest GitHub-hosted runner. Past six the even
 * share (~20 s of 117.6 s) is already within 2x of the 12.5 s longest
 * scenario, the floor no worker count beats, so more workers buy little.
 * `--jobs N` overrides it.
 */
export const MAX_DEFAULT_JOBS = 6;

/**
 * How many workers a batch of `scenarioCount` scenarios gets: `requested`
 * (`--jobs`) when given, else the machine's parallelism capped at
 * `MAX_DEFAULT_JOBS`; never more workers than scenarios, never fewer than one.
 * One means the in-process path — a single-scenario run never pays a fork.
 */
export function resolveJobCount(requested: number | undefined, available: number, scenarioCount: number): number {
  const wanted = requested ?? Math.min(available, MAX_DEFAULT_JOBS);
  return Math.max(1, Math.min(wanted, scenarioCount));
}

/**
 * The queue order: costliest first, so the long scenarios start while every
 * worker is still free instead of landing last on one; ascending name on a
 * tie, the same tie-break `selectShard` uses, so the order is stable.
 */
export function orderLongestFirst(names: readonly string[], costOf: (name: string) => number): string[] {
  const cost = new Map(names.map(name => [name, costOf(name)]));
  return [...names].sort((a, b) => cost.get(b)! - cost.get(a)! || (a < b ? -1 : a > b ? 1 : 0));
}

/** One scenario's verdict and the output to print for it. */
export interface ScenarioOutcome {
  result: ScenarioResult;
  output: OutputChunk[];
}

/** The outcome for a scenario whose worker died before reporting it: failed, with the worker's last words. */
export function deathOutcome(name: string, err: unknown): ScenarioOutcome {
  const message = err instanceof Error ? err.message : String(err);
  let text = `\n[${name}] FAILED — ${message}\n`;
  if (err instanceof WorkerDiedError && err.exit.output !== '') {
    text += `--- ${err.label} output ---\n${err.exit.output.replace(/\n?$/, '\n')}--- end ${err.label} output ---\n`;
  }
  return {
    result: { name, totalSteps: 0, failed: true, error: message },
    output: [{ stream: 'stderr', text }],
  };
}

/** The outcome for a scenario no worker was left alive to run. */
export function notRunOutcome(name: string): ScenarioOutcome {
  const error = 'never run — every worker process died before reaching it';
  return {
    result: { name, totalSteps: 0, failed: true, error },
    output: [{ stream: 'stderr', text: `\n[${name}] FAILED — ${error}\n` }],
  };
}

/** What the workers themselves did, beyond the scenarios they reported. */
export interface QueueReport {
  /** One line per worker that died or exited non-zero. Each one fails the batch. */
  workerErrors: string[];
  /** Output a worker printed outside any scenario, kept so nothing a worker said is dropped. */
  strayOutput: Array<{ label: string; output: string }>;
}

/**
 * Drains `order` across `workers`: each worker takes the next scenario as
 * soon as it is idle. Every name reaches `onOutcome` exactly once — reported,
 * failed with its worker's death, or never run because every worker died. A
 * worker that dies takes no further scenarios; the one it was running is not
 * retried elsewhere, since a scenario that kills its worker would kill the
 * next one too.
 */
export async function runScenarioQueue(
  order: readonly string[],
  workers: readonly ScenarioWorker[],
  onOutcome: (name: string, outcome: ScenarioOutcome) => void,
): Promise<QueueReport> {
  const queue = [...order];
  const report: QueueReport = { workerErrors: [], strayOutput: [] };

  const drain = async (worker: ScenarioWorker): Promise<void> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      try {
        const answer = await worker.run(name);
        onOutcome(name, { result: answer.result, output: answer.output });
      } catch (err: unknown) {
        onOutcome(name, deathOutcome(name, err));
        report.workerErrors.push(err instanceof Error ? err.message : String(err));
        if (err instanceof WorkerDiedError) return;
        // Not a death (the handle refused the request): stop the worker, then step aside.
        await worker.stop();
        return;
      }
    }
    const exit = await worker.stop();
    if (exit.code !== 0 || exit.signal !== null) {
      report.workerErrors.push(`${worker.label} ended badly after its last scenario (${describeExit(exit)})`);
    }
    if (exit.output !== '') report.strayOutput.push({ label: worker.label, output: exit.output });
  };

  await Promise.all(workers.map(drain));
  for (const name of queue.splice(0)) onOutcome(name, notRunOutcome(name));
  return report;
}

/**
 * Accepts outcomes in any order and prints them in `names` order, each as
 * soon as every name before it has printed. `print` receives the results
 * printed so far, so a progress line can count them.
 */
export function createOrderedPrinter(
  names: readonly string[],
  print: (outcome: ScenarioOutcome, printedSoFar: readonly ScenarioResult[]) => void,
): { accept(name: string, outcome: ScenarioOutcome): void } {
  const waiting = new Map<string, ScenarioOutcome>();
  const printed: ScenarioResult[] = [];
  return {
    accept(name, outcome) {
      if (!waiting.has(name)) waiting.set(name, outcome);
      while (printed.length < names.length && waiting.has(names[printed.length]!)) {
        const next = waiting.get(names[printed.length]!)!;
        printed.push(next.result);
        print(next, printed);
      }
    },
  };
}

/**
 * The batch's results in `names` order. A name with no outcome — which
 * `runScenarioQueue` never leaves, so this is the last line of defence — is
 * a failure, never a silent omission that shrinks the total.
 */
export function collectResults(names: readonly string[], outcomes: ReadonlyMap<string, ScenarioOutcome>): ScenarioResult[] {
  return names.map(name => outcomes.get(name)?.result
    ?? { name, totalSteps: 0, failed: true, error: 'no worker reported this scenario' });
}

export interface FanOutOptions {
  names: string[];
  jobs: number;
  reportDrift: boolean;
  costOf: (name: string) => number;
  /** The runner entry a worker is forked from (`run-all-scenarios.ts`). */
  entry: string;
  startTime: number;
  /** Starts one worker; the default forks `entry --worker`. Injected in tests. */
  spawnWorker?: (label: string) => ScenarioWorker;
  /** Where printed output goes; the default writes each chunk to its own stream. */
  emit?: (chunk: OutputChunk) => void;
}

function emitToProcess(chunk: OutputChunk): void {
  (chunk.stream === 'stderr' ? process.stderr : process.stdout).write(chunk.text);
}

/**
 * What each worker is running right now, one line per busy worker — printed
 * when the batch is interrupted. Output is buffered per scenario, so without
 * this a scenario that hangs would leave no trace of which one it was.
 */
export function describeInFlight(running: ReadonlyMap<string, { name: string; since: number }>, now: number): string {
  if (running.size === 0) return 'No scenario was running.\n';
  const lines = [...running].map(([label, { name, since }]) => `  ${label}: ${name} (running ${((now - since) / 1000).toFixed(1)}s)`);
  return `Scenarios still running:\n${lines.join('\n')}\n`;
}

/** Runs `names` across `jobs` workers and returns every result plus the workers' own failures. */
export async function runFanOutCommand(options: FanOutOptions): Promise<{ results: ScenarioResult[]; workerErrors: string[] }> {
  const { names, jobs, reportDrift, costOf, entry, startTime } = options;
  const emit = options.emit ?? emitToProcess;
  const spawnWorker = options.spawnWorker
    ?? ((label: string) => forkScenarioWorker(entry, label, ['--worker', ...(reportDrift ? ['--report-drift'] : [])]));

  emit({ stream: 'stdout', text: `\nStarting ${jobs} worker processes (--jobs 1 runs in-process). Running ${names.length} scenarios...\n` });
  const running = new Map<string, { name: string; since: number }>();
  const workers = Array.from({ length: jobs }, (_, i): ScenarioWorker => {
    const worker = spawnWorker(`worker ${i + 1}/${jobs}`);
    return {
      label: worker.label,
      run: (name) => {
        running.set(worker.label, { name, since: Date.now() });
        return worker.run(name).finally(() => running.delete(worker.label));
      },
      stop: () => worker.stop(),
      kill: () => worker.kill(),
    };
  });

  // Interrupted (Ctrl-C, a job timeout): say what was running, and take the
  // workers down with the batch — a worker stuck in a synchronous scenario
  // never notices its parent is gone and would run on as an orphan.
  const onInterrupt = (signal: NodeJS.Signals) => {
    emit({ stream: 'stderr', text: `\nInterrupted by ${signal}. ${describeInFlight(running, Date.now())}` });
    for (const worker of workers) worker.kill();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);

  const outcomes = new Map<string, ScenarioOutcome>();
  const printer = createOrderedPrinter(names, (outcome, printedSoFar) => {
    for (const chunk of outcome.output) emit(chunk);
    logBatchProgress([...printedSoFar], printedSoFar.length - 1, names.length, startTime);
  });
  let report: QueueReport;
  try {
    report = await runScenarioQueue(orderLongestFirst(names, costOf), workers, (name, outcome) => {
      outcomes.set(name, outcome);
      printer.accept(name, outcome);
    });
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onInterrupt);
  }

  for (const { label, output } of report.strayOutput) {
    emit({ stream: 'stdout', text: `\n--- ${label} output outside any scenario ---\n${output.replace(/\n?$/, '\n')}--- end ${label} output ---\n` });
  }
  return { results: collectResults(names, outcomes), workerErrors: report.workerErrors };
}
