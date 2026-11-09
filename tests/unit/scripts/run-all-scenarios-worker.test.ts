// BlastSimulator2026 — run-all-scenarios-worker.ts
//
// The IPC protocol between a fanned-out command-mode batch and its worker
// processes, both ends, without forking anything: the worker side against a
// fake host, the parent side against a fake child process. What matters is
// that it fails closed — a worker that dies, breaks protocol, or never
// started rejects the scenario it was running, with its exit status and the
// output it left — and that a scenario's output is captured whole, per
// scenario, and the real stdout/stderr restored afterwards.

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import {
  serveScenarioWorker,
  processWorkerHost,
  attachScenarioWorker,
  describeExit,
  WorkerDiedError,
  type OutputChunk,
  type WorkerHost,
  type WorkerProcess,
  type WorkerReport,
  type WorkerRequest,
} from '../../../scripts/run-all-scenarios-worker.js';
import type { ScenarioResult } from '../../../scripts/shared/command-runner.js';

// ─── Worker side ─────────────────────────────────────────────────────────────

interface FakeHost extends WorkerHost {
  request(message: unknown): void;
  sent: WorkerReport[];
  exited: boolean;
  lastWords: () => string;
  /** Lets a fake scenario print through the redirected "process" output. */
  print(stream: OutputChunk['stream'], text: string): void;
}

function fakeHost(): FakeHost {
  let listener: (message: unknown) => void = () => {};
  let sink: OutputChunk[] | null = null;
  const host: FakeHost = {
    sent: [],
    exited: false,
    lastWords: () => '',
    onRequest: (l) => { listener = l; },
    send: (report) => { host.sent.push(report); },
    exit: () => { host.exited = true; },
    onDeath: (lastWords) => { host.lastWords = lastWords; },
    redirectOutput: (s) => {
      sink = s;
      return () => { sink = null; };
    },
    request: (message) => listener(message),
    print: (stream, text) => {
      if (sink === null) throw new Error('printed outside a captured scenario');
      sink.push({ stream, text });
    },
  };
  return host;
}

const ok = (name: string): ScenarioResult => ({ name, totalSteps: 2, failed: false });

describe('run-all-scenarios-worker.ts', () => {
  describe('serveScenarioWorker', () => {
    it('runs a requested scenario and sends its result with the output it printed, in write order', () => {
      const host = fakeHost();
      serveScenarioWorker(host, (name) => {
        host.print('stdout', `[${name}] Running 2 steps...\n`);
        host.print('stderr', `[${name}] warning\n`);
        host.print('stdout', `[${name}] OK — 2 steps\n`);
        return ok(name);
      });

      host.request({ type: 'run', name: 'blast-basic' } satisfies WorkerRequest);

      expect(host.sent).toEqual([{
        type: 'result',
        name: 'blast-basic',
        result: ok('blast-basic'),
        output: [
          { stream: 'stdout', text: '[blast-basic] Running 2 steps...\n' },
          { stream: 'stderr', text: '[blast-basic] warning\n' },
          { stream: 'stdout', text: '[blast-basic] OK — 2 steps\n' },
        ],
      }]);
    });

    it('keeps each scenario\'s output to its own report', () => {
      const host = fakeHost();
      serveScenarioWorker(host, (name) => { host.print('stdout', name); return ok(name); });

      host.request({ type: 'run', name: 'a' });
      host.request({ type: 'run', name: 'b' });

      expect(host.sent.map(r => r.output.map(c => c.text).join(''))).toEqual(['a', 'b']);
    });

    it('sends a failed result rather than dying when a scenario throws', () => {
      const host = fakeHost();
      serveScenarioWorker(host, () => { throw new Error('engine exploded'); });

      host.request({ type: 'run', name: 'x' });

      expect(host.sent[0]!.result).toEqual({
        name: 'x', totalSteps: 0, failed: true,
        error: "threw out of the worker's scenario loop: engine exploded",
      });
    });

    it('restores the real output after a scenario, even one that throws', () => {
      const host = fakeHost();
      serveScenarioWorker(host, () => { throw new Error('boom'); });
      host.request({ type: 'run', name: 'x' });
      expect(() => host.print('stdout', 'after')).toThrow(/outside a captured scenario/);
    });

    it('exits on stop', () => {
      const host = fakeHost();
      serveScenarioWorker(host, ok);
      host.request({ type: 'stop' } satisfies WorkerRequest);
      expect(host.exited).toBe(true);
      expect(host.sent).toEqual([]);
    });

    it('ignores a message that is not a request', () => {
      const host = fakeHost();
      const runOne = vi.fn(ok);
      serveScenarioWorker(host, runOne);
      host.request({ type: 'hello' });
      expect(runOne).not.toHaveBeenCalled();
      expect(host.sent).toEqual([]);
    });

    it('hands the death hook the in-flight scenario\'s output, and nothing between scenarios', () => {
      const host = fakeHost();
      let wordsMidScenario = '';
      serveScenarioWorker(host, (name) => {
        host.print('stdout', `[${name}] step 1\n`);
        host.print('stderr', `[${name}] step 2 blew up\n`);
        wordsMidScenario = host.lastWords();
        return ok(name);
      });

      host.request({ type: 'run', name: 's' });

      expect(wordsMidScenario).toBe('[s] step 1\n[s] step 2 blew up\n');
      expect(host.lastWords()).toBe('');
    });
  });

  describe('processWorkerHost().redirectOutput', () => {
    it('captures process stdout and stderr writes, strings and bytes alike, then restores both', () => {
      const realOut = process.stdout.write;
      const realErr = process.stderr.write;
      const sink: OutputChunk[] = [];

      const restore = processWorkerHost().redirectOutput(sink);
      try {
        process.stdout.write('to stdout\n');
        process.stderr.write(Buffer.from('to stderr\n'));
      } finally {
        restore();
      }

      expect(sink).toEqual([
        { stream: 'stdout', text: 'to stdout\n' },
        { stream: 'stderr', text: 'to stderr\n' },
      ]);
      expect(process.stdout.write).toBe(realOut);
      expect(process.stderr.write).toBe(realErr);
    });

    it('still fires a write\'s completion callback, so a caller awaiting it does not hang', async () => {
      const sink: OutputChunk[] = [];
      const restore = processWorkerHost().redirectOutput(sink);
      let flushed: Promise<unknown>;
      try {
        flushed = new Promise(resolve => process.stdout.write('awaited\n', 'utf8', resolve));
      } finally {
        restore();
      }
      await expect(flushed).resolves.toBeNull();
      expect(sink).toEqual([{ stream: 'stdout', text: 'awaited\n' }]);
    });
  });

  // ─── Parent side ───────────────────────────────────────────────────────────

  class FakeChild extends EventEmitter implements WorkerProcess {
    sent: WorkerRequest[] = [];
    killedWith: string | null = null;
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly pid: number | undefined;
    constructor(started = true) {
      super();
      this.pid = started ? 4242 : undefined;
    }
    send(message: WorkerRequest): boolean { this.sent.push(message); return true; }
    kill(signal: 'SIGKILL'): boolean { this.killedWith = signal; return true; }
    answer(name: string, result: ScenarioResult = ok(name)): void {
      this.emit('message', { type: 'result', name, result, output: [] } satisfies WorkerReport);
    }
    /** stdio drains before `close`, as Node orders it. */
    async die(code: number | null, signal: string | null, last = ''): Promise<void> {
      if (last !== '') this.stderr.write(last);
      await new Promise(resolve => setImmediate(resolve));
      this.emit('close', code, signal);
    }
  }

  describe('attachScenarioWorker', () => {
    it('sends a run request and resolves with the matching report', async () => {
      const child = new FakeChild();
      const worker = attachScenarioWorker(child, 'worker 1/2');

      const answer = worker.run('blast-basic');
      expect(child.sent).toEqual([{ type: 'run', name: 'blast-basic' }]);
      child.answer('blast-basic');

      await expect(answer).resolves.toMatchObject({ name: 'blast-basic', result: ok('blast-basic') });
    });

    it('rejects the in-flight scenario with the worker\'s exit and everything it wrote when it dies', async () => {
      const child = new FakeChild();
      const worker = attachScenarioWorker(child, 'worker 2/4');
      child.stdout.write('engine ready\n');

      const answer = worker.run('level2-playthrough-win');
      await child.die(1, null, 'FATAL ERROR: heap out of memory\n');

      const err = await answer.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WorkerDiedError);
      expect((err as WorkerDiedError).message).toBe('worker 2/4 died before reporting "level2-playthrough-win" (exit code 1)');
      expect((err as WorkerDiedError).exit.output).toBe('engine ready\nFATAL ERROR: heap out of memory\n');
    });

    it('rejects when the worker exits cleanly without having answered', async () => {
      const child = new FakeChild();
      const worker = attachScenarioWorker(child, 'w');
      const answer = worker.run('s');
      await child.die(0, null);
      await expect(answer).rejects.toThrow('w died before reporting "s" (exit code 0)');
    });

    it('kills a worker that answers for a scenario it was not asked to run, and rejects the pending one', async () => {
      const child = new FakeChild();
      const worker = attachScenarioWorker(child, 'w');
      const answer = worker.run('asked');

      child.answer('other');
      expect(child.killedWith).toBe('SIGKILL');
      await child.die(null, 'SIGKILL');

      await expect(answer).rejects.toThrow(/w sent a message it was not asked for .*"other".* \(killed by SIGKILL\)/);
    });

    it('kills a worker that sends a report while idle', () => {
      const child = new FakeChild();
      attachScenarioWorker(child, 'w');
      child.answer('unprompted');
      expect(child.killedWith).toBe('SIGKILL');
    });

    it('refuses a second run while one is in flight', async () => {
      const child = new FakeChild();
      const worker = attachScenarioWorker(child, 'w');
      void worker.run('first');
      await expect(worker.run('second')).rejects.toThrow('w is already running "first"');
    });

    it('rejects a run on a worker that has already exited, without sending it', async () => {
      const child = new FakeChild();
      const worker = attachScenarioWorker(child, 'w');
      await child.die(0, null);
      await expect(worker.run('late')).rejects.toBeInstanceOf(WorkerDiedError);
      expect(child.sent).toEqual([]);
    });

    it('stop sends stop and resolves with the exit once the process closes', async () => {
      const child = new FakeChild();
      const worker = attachScenarioWorker(child, 'w');

      const stopped = worker.stop();
      expect(child.sent).toEqual([{ type: 'stop' }]);
      await child.die(0, null);

      await expect(stopped).resolves.toEqual({ code: 0, signal: null, output: '' });
    });

    it('stop on an exited worker resolves at once with that exit', async () => {
      const child = new FakeChild();
      const worker = attachScenarioWorker(child, 'w');
      await child.die(5, null, 'oops\n');
      await expect(worker.stop()).resolves.toEqual({ code: 5, signal: null, output: 'oops\n' });
    });

    it('a process that never started fails its run at once instead of waiting for a close that never comes', async () => {
      const child = new FakeChild(false);
      const worker = attachScenarioWorker(child, 'w');
      const answer = worker.run('s');

      child.emit('error', new Error('spawn ENOENT'));

      await expect(answer).rejects.toThrow('w could not be driven: spawn ENOENT (exit code null)');
    });

    it('kill ends the process with SIGKILL', () => {
      const child = new FakeChild();
      attachScenarioWorker(child, 'w').kill();
      expect(child.killedWith).toBe('SIGKILL');
    });
  });

  describe('describeExit', () => {
    it('names the signal when there is one, else the exit code', () => {
      expect(describeExit({ code: null, signal: 'SIGKILL' })).toBe('killed by SIGKILL');
      expect(describeExit({ code: 2, signal: null })).toBe('exit code 2');
    });
  });
});
