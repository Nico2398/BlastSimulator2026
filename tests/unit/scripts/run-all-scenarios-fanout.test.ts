// BlastSimulator2026 — run-all-scenarios-fanout.ts
//
// The command-mode batch fans out across worker processes so `npm run
// scenarios` stops running 246 scenarios serially on one of four cores
// (120 s locally, 5.5 min in CI). These tests drive the parent side against
// fake workers — no process is forked: job-count planning, the longest-first
// queue, fail-closed handling of a worker that dies or exits badly, output
// printed whole and in name order whatever order workers finish in, and
// result aggregation that never drops a scenario.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MAX_DEFAULT_JOBS,
  resolveJobCount,
  orderLongestFirst,
  runScenarioQueue,
  createOrderedPrinter,
  collectResults,
  deathOutcome,
  notRunOutcome,
  describeInFlight,
  runFanOutCommand,
  type ScenarioOutcome,
} from '../../../scripts/run-all-scenarios-fanout.js';
import { WorkerDiedError, type OutputChunk, type ScenarioWorker, type WorkerExit, type WorkerReport } from '../../../scripts/run-all-scenarios-worker.js';
import type { ScenarioResult } from '../../../scripts/shared/command-runner.js';

const CLEAN_EXIT: WorkerExit = { code: 0, signal: null, output: '' };

function report(name: string, failed = false): WorkerReport {
  return {
    type: 'result',
    name,
    result: { name, totalSteps: 3, failed },
    output: [{ stream: 'stdout', text: `[${name}] ${failed ? 'FAILED' : 'OK'}\n` }],
  };
}

interface FakeWorker extends ScenarioWorker {
  ran: string[];
  stopped: boolean;
  killed: boolean;
}

/**
 * A worker whose `run` answers through `answer` — a report, or a thrown
 * error standing in for a death — after one microtask, so several fake
 * workers genuinely interleave inside `runScenarioQueue`.
 */
function fakeWorker(
  label: string,
  answer: (name: string) => WorkerReport = report,
  exit: WorkerExit = CLEAN_EXIT,
): FakeWorker {
  const worker: FakeWorker = {
    label,
    ran: [],
    stopped: false,
    killed: false,
    async run(name) {
      worker.ran.push(name);
      await Promise.resolve();
      return answer(name);
    },
    async stop() {
      worker.stopped = true;
      return exit;
    },
    kill() {
      worker.killed = true;
    },
  };
  return worker;
}

function died(label: string, name: string, output = ''): WorkerDiedError {
  return new WorkerDiedError(label, { code: null, signal: 'SIGKILL', output }, `died before reporting "${name}"`);
}

describe('run-all-scenarios-fanout.ts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveJobCount', () => {
    it('defaults to the machine parallelism when no --jobs is given', () => {
      expect(resolveJobCount(undefined, 4, 246)).toBe(4);
    });

    it('caps the default at MAX_DEFAULT_JOBS on a many-core machine', () => {
      expect(resolveJobCount(undefined, 64, 246)).toBe(MAX_DEFAULT_JOBS);
    });

    it('honours an explicit --jobs above the default cap', () => {
      expect(resolveJobCount(12, 4, 246)).toBe(12);
    });

    it('keeps --jobs 1 as one job, the in-process path', () => {
      expect(resolveJobCount(1, 8, 246)).toBe(1);
    });

    it('never starts more workers than there are scenarios', () => {
      expect(resolveJobCount(undefined, 8, 3)).toBe(3);
      expect(resolveJobCount(16, 8, 2)).toBe(2);
    });

    it('a single-scenario run never forks', () => {
      expect(resolveJobCount(undefined, 8, 1)).toBe(1);
    });

    it('an empty batch still resolves to one job rather than zero', () => {
      expect(resolveJobCount(undefined, 8, 0)).toBe(1);
    });
  });

  describe('orderLongestFirst', () => {
    it('orders by descending cost, ascending name on a tie', () => {
      const cost: Record<string, number> = { a: 1, b: 9, c: 5, d: 9 };
      expect(orderLongestFirst(['a', 'b', 'c', 'd'], n => cost[n]!)).toEqual(['b', 'd', 'c', 'a']);
    });

    it('does not mutate its input', () => {
      const names = ['a', 'b'];
      orderLongestFirst(names, n => (n === 'b' ? 2 : 1));
      expect(names).toEqual(['a', 'b']);
    });

    it('costs each name once, however many comparisons the sort makes', () => {
      const costOf = vi.fn((n: string) => n.length);
      orderLongestFirst(['aaa', 'b', 'cc', 'dddd', 'e'], costOf);
      expect(costOf).toHaveBeenCalledTimes(5);
    });

    it('returns an empty order for an empty batch', () => {
      expect(orderLongestFirst([], () => 1)).toEqual([]);
    });
  });

  describe('runScenarioQueue', () => {
    it('hands every scenario to exactly one worker and reports each once', async () => {
      const workers = [fakeWorker('w1'), fakeWorker('w2'), fakeWorker('w3')];
      const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const seen: string[] = [];

      const queue = await runScenarioQueue(names, workers, name => seen.push(name));

      expect([...seen].sort()).toEqual(names);
      expect(workers.flatMap(w => w.ran).sort()).toEqual(names);
      expect(queue.workerErrors).toEqual([]);
      expect(workers.every(w => w.stopped)).toBe(true);
    });

    it('spreads the queue across workers rather than letting one drain it', async () => {
      const workers = [fakeWorker('w1'), fakeWorker('w2')];
      await runScenarioQueue(['a', 'b', 'c', 'd'], workers, () => {});
      expect(workers[0]!.ran.length).toBeGreaterThan(0);
      expect(workers[1]!.ran.length).toBeGreaterThan(0);
    });

    it('takes scenarios in queue order, so the costliest start first', async () => {
      const worker = fakeWorker('only');
      await runScenarioQueue(['heavy', 'medium', 'light'], [worker], () => {});
      expect(worker.ran).toEqual(['heavy', 'medium', 'light']);
    });

    it('fails a scenario whose worker dies, names the worker, and keeps draining on the survivors', async () => {
      const dying = fakeWorker('worker 1/2', name => { throw died('worker 1/2', name, 'Fatal: out of memory\n'); });
      const healthy = fakeWorker('worker 2/2');
      const outcomes = new Map<string, ScenarioOutcome>();

      const queue = await runScenarioQueue(['a', 'b', 'c', 'd'], [dying, healthy], (n, o) => outcomes.set(n, o));

      expect(dying.ran).toHaveLength(1);
      const victim = dying.ran[0]!;
      expect(outcomes.get(victim)!.result).toMatchObject({ name: victim, failed: true });
      expect(outcomes.get(victim)!.result.error).toContain('worker 1/2');
      expect(outcomes.get(victim)!.output.map(c => c.text).join('')).toContain('Fatal: out of memory');
      expect(healthy.ran.sort()).toEqual(['a', 'b', 'c', 'd'].filter(n => n !== victim));
      expect(outcomes.size).toBe(4);
      expect(queue.workerErrors).toHaveLength(1);
      expect(queue.workerErrors[0]).toContain('worker 1/2');
      // A dead worker is not asked to stop — it is already gone.
      expect(dying.stopped).toBe(false);
    });

    it('does not retry a scenario that killed its worker on another worker', async () => {
      const poison = (name: string): WorkerReport => {
        if (name === 'poison') throw died('w', name);
        return report(name);
      };
      const workers = [fakeWorker('w1', poison), fakeWorker('w2', poison)];

      await runScenarioQueue(['poison', 'a', 'b'], workers, () => {});

      expect(workers.flatMap(w => w.ran).filter(n => n === 'poison')).toHaveLength(1);
    });

    it('fails every scenario left in the queue when every worker has died', async () => {
      const workers = [
        fakeWorker('w1', name => { throw died('w1', name); }),
        fakeWorker('w2', name => { throw died('w2', name); }),
      ];
      const outcomes = new Map<string, ScenarioOutcome>();

      const queue = await runScenarioQueue(['a', 'b', 'c', 'd', 'e'], workers, (n, o) => outcomes.set(n, o));

      expect(outcomes.size).toBe(5);
      for (const outcome of outcomes.values()) expect(outcome.result.failed).toBe(true);
      const neverRun = [...outcomes.values()].filter(o => o.result.error!.includes('never run'));
      expect(neverRun).toHaveLength(3);
      expect(queue.workerErrors).toHaveLength(2);
    });

    it('counts a worker that exits non-zero after its last scenario as a failure, though every scenario passed', async () => {
      const bad = fakeWorker('worker 1/1', report, { code: 3, signal: null, output: 'late crash\n' });
      const outcomes = new Map<string, ScenarioOutcome>();

      const queue = await runScenarioQueue(['a'], [bad], (n, o) => outcomes.set(n, o));

      expect(outcomes.get('a')!.result.failed).toBe(false);
      expect(queue.workerErrors).toEqual(['worker 1/1 ended badly after its last scenario (exit code 3)']);
      expect(queue.strayOutput).toEqual([{ label: 'worker 1/1', output: 'late crash\n' }]);
    });

    it('counts a worker killed by a signal at stop as a failure', async () => {
      const bad = fakeWorker('w', report, { code: null, signal: 'SIGTERM', output: '' });
      const queue = await runScenarioQueue(['a'], [bad], () => {});
      expect(queue.workerErrors).toEqual(['w ended badly after its last scenario (killed by SIGTERM)']);
    });

    it('keeps output a clean worker printed outside any scenario', async () => {
      const chatty = fakeWorker('w', report, { code: 0, signal: null, output: 'warning: something\n' });
      const queue = await runScenarioQueue(['a'], [chatty], () => {});
      expect(queue.workerErrors).toEqual([]);
      expect(queue.strayOutput).toEqual([{ label: 'w', output: 'warning: something\n' }]);
    });

    it('stops a worker whose handle refused a request with a non-death error, and fails that scenario', async () => {
      const refusing = fakeWorker('w1', () => { throw new Error('w1 is already running "x"'); });
      const healthy = fakeWorker('w2');
      const outcomes = new Map<string, ScenarioOutcome>();

      const queue = await runScenarioQueue(['a', 'b', 'c'], [refusing, healthy], (n, o) => outcomes.set(n, o));

      expect(refusing.stopped).toBe(true);
      expect(outcomes.size).toBe(3);
      expect(queue.workerErrors).toEqual(['w1 is already running "x"']);
    });

    it('stops every worker without running anything for an empty queue', async () => {
      const workers = [fakeWorker('w1'), fakeWorker('w2')];
      const queue = await runScenarioQueue([], workers, () => {});
      expect(workers.every(w => w.stopped && w.ran.length === 0)).toBe(true);
      expect(queue.workerErrors).toEqual([]);
    });
  });

  describe('createOrderedPrinter', () => {
    const outcome = (name: string): ScenarioOutcome => ({
      result: { name, totalSteps: 1, failed: false },
      output: [{ stream: 'stdout', text: name }],
    });

    it('prints outcomes in name order whatever order they arrive in', () => {
      const printed: string[] = [];
      const printer = createOrderedPrinter(['a', 'b', 'c'], o => printed.push(o.result.name));

      printer.accept('c', outcome('c'));
      expect(printed).toEqual([]);
      printer.accept('b', outcome('b'));
      expect(printed).toEqual([]);
      printer.accept('a', outcome('a'));
      expect(printed).toEqual(['a', 'b', 'c']);
    });

    it('prints each outcome as soon as every name before it has printed', () => {
      const printed: string[] = [];
      const printer = createOrderedPrinter(['a', 'b', 'c'], o => printed.push(o.result.name));

      printer.accept('a', outcome('a'));
      expect(printed).toEqual(['a']);
      printer.accept('c', outcome('c'));
      expect(printed).toEqual(['a']);
      printer.accept('b', outcome('b'));
      expect(printed).toEqual(['a', 'b', 'c']);
    });

    it('hands print the results printed so far, for the progress count', () => {
      const counts: number[] = [];
      const printer = createOrderedPrinter(['a', 'b'], (_o, soFar) => counts.push(soFar.length));
      printer.accept('b', outcome('b'));
      printer.accept('a', outcome('a'));
      expect(counts).toEqual([1, 2]);
    });

    it('prints a name once even if it is accepted twice', () => {
      const printed: string[] = [];
      const printer = createOrderedPrinter(['a'], o => printed.push(o.result.name));
      printer.accept('a', outcome('a'));
      printer.accept('a', outcome('a'));
      expect(printed).toEqual(['a']);
    });
  });

  describe('collectResults', () => {
    it('returns results in name order', () => {
      const outcomes = new Map<string, ScenarioOutcome>([
        ['b', { result: { name: 'b', totalSteps: 2, failed: true, error: 'x' }, output: [] }],
        ['a', { result: { name: 'a', totalSteps: 1, failed: false }, output: [] }],
      ]);
      expect(collectResults(['a', 'b'], outcomes).map(r => r.name)).toEqual(['a', 'b']);
    });

    it('fails a scenario no worker reported instead of shrinking the total', () => {
      const results = collectResults(['a', 'missing'], new Map([
        ['a', { result: { name: 'a', totalSteps: 1, failed: false }, output: [] }],
      ]));
      expect(results).toHaveLength(2);
      expect(results[1]).toEqual({ name: 'missing', totalSteps: 0, failed: true, error: 'no worker reported this scenario' });
    });

    it('returns an empty list for an empty batch', () => {
      expect(collectResults([], new Map())).toEqual([]);
    });
  });

  describe('deathOutcome / notRunOutcome', () => {
    it('a worker death fails the scenario and prints the worker\'s captured output under its name', () => {
      const outcome = deathOutcome('blast-basic', died('worker 2/4', 'blast-basic', 'RangeError: boom\n    at x'));
      expect(outcome.result).toEqual({
        name: 'blast-basic', totalSteps: 0, failed: true,
        error: 'worker 2/4 died before reporting "blast-basic" (killed by SIGKILL)',
      });
      const text = outcome.output.map(c => c.text).join('');
      expect(text).toContain('[blast-basic] FAILED');
      expect(text).toContain('--- worker 2/4 output ---\nRangeError: boom\n    at x\n--- end worker 2/4 output ---');
      expect(outcome.output.every(c => c.stream === 'stderr')).toBe(true);
    });

    it('omits the output block for a worker that printed nothing', () => {
      const text = deathOutcome('s', died('w', 's')).output.map(c => c.text).join('');
      expect(text).not.toContain('--- w output ---');
    });

    it('accepts a non-Error rejection', () => {
      expect(deathOutcome('s', 'bad').result.error).toBe('bad');
    });

    it('a scenario never run is failed, not skipped', () => {
      expect(notRunOutcome('s').result).toMatchObject({ name: 's', failed: true });
    });
  });

  describe('describeInFlight', () => {
    it('names each busy worker, its scenario and how long it has run', () => {
      const running = new Map([['worker 1/4', { name: 'level2-playthrough-win', since: 1000 }]]);
      expect(describeInFlight(running, 13_500)).toBe(
        'Scenarios still running:\n  worker 1/4: level2-playthrough-win (running 12.5s)\n',
      );
    });

    it('says so when nothing is running', () => {
      expect(describeInFlight(new Map(), 0)).toBe('No scenario was running.\n');
    });
  });

  describe('runFanOutCommand', () => {
    it('runs every scenario on the workers, prints each whole in name order, and returns results in name order', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const emitted: OutputChunk[] = [];
      // Each run waits on a deferred the test resolves by hand, so the
      // finishing order (b, c, d, then a) is chosen, not timed.
      const answers = new Map<string, () => void>();
      const spawnWorker = (label: string): ScenarioWorker => ({
        label,
        run: (name) => new Promise(resolve => answers.set(name, () => resolve({
          type: 'result',
          name,
          result: { name, totalSteps: 2, failed: name === 'c', ...(name === 'c' ? { error: 'step 1 failed' } : {}) },
          output: [{ stream: 'stdout', text: `[${name}] start\n` }, { stream: 'stdout', text: `[${name}] end\n` }],
        }))),
        stop: async () => CLEAN_EXIT,
        kill: () => {},
      });
      const finish = async (name: string) => {
        await vi.waitFor(() => expect(answers.has(name)).toBe(true));
        answers.get(name)!();
      };

      const batch = runFanOutCommand({
        names: ['a', 'b', 'c', 'd'], jobs: 2, reportDrift: false, costOf: () => 1,
        entry: 'unused', startTime: Date.now(), spawnWorker, emit: c => emitted.push(c),
      });
      for (const name of ['b', 'c', 'd']) await finish(name);
      expect(emitted.some(c => c.text.startsWith('['))).toBe(false); // 'a' still holds the line
      await finish('a');
      const { results, workerErrors } = await batch;

      const scenarioLines = emitted.map(c => c.text).filter(t => t.startsWith('['));
      expect(scenarioLines).toEqual([
        '[a] start\n', '[a] end\n', '[b] start\n', '[b] end\n',
        '[c] start\n', '[c] end\n', '[d] start\n', '[d] end\n',
      ]);
      expect(results.map((r: ScenarioResult) => [r.name, r.failed])).toEqual([['a', false], ['b', false], ['c', true], ['d', false]]);
      expect(workerErrors).toEqual([]);
    });

    it('forks one worker per job with a numbered label', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const labels: string[] = [];
      await runFanOutCommand({
        names: ['a', 'b', 'c'], jobs: 3, reportDrift: false, costOf: () => 1, entry: 'unused', startTime: 0,
        spawnWorker: (label) => { labels.push(label); return fakeWorker(label); },
        emit: () => {},
      });
      expect(labels).toEqual(['worker 1/3', 'worker 2/3', 'worker 3/3']);
    });

    it('reports a dead worker in workerErrors and its scenario as failed', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const { results, workerErrors } = await runFanOutCommand({
        names: ['a', 'b'], jobs: 1, reportDrift: false, costOf: () => 1, entry: 'unused', startTime: 0,
        spawnWorker: (label) => fakeWorker(label, name => { throw died(label, name); }),
        emit: () => {},
      });
      expect(results.every(r => r.failed)).toBe(true);
      expect(workerErrors).toEqual(['worker 1/1 died before reporting "a" (killed by SIGKILL)']);
    });

    it('prints what a worker said outside any scenario after the scenarios', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const emitted: string[] = [];
      await runFanOutCommand({
        names: ['a'], jobs: 1, reportDrift: false, costOf: () => 1, entry: 'unused', startTime: 0,
        spawnWorker: (label) => fakeWorker(label, report, { code: 0, signal: null, output: 'deprecation warning' }),
        emit: c => emitted.push(c.text),
      });
      expect(emitted.at(-1)).toBe('\n--- worker 1/1 output outside any scenario ---\ndeprecation warning\n--- end worker 1/1 output ---\n');
    });

    it('removes its interrupt handlers once the batch is done', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const before = process.listenerCount('SIGTERM');
      await runFanOutCommand({
        names: ['a'], jobs: 1, reportDrift: false, costOf: () => 1, entry: 'unused', startTime: 0,
        spawnWorker: (label) => fakeWorker(label), emit: () => {},
      });
      expect(process.listenerCount('SIGTERM')).toBe(before);
    });
  });
});
