/**
 * Both ends of the IPC protocol between a fanned-out command-mode batch
 * (`run-all-scenarios-fanout.ts`) and its worker processes.
 *
 * A worker is `run-all-scenarios.ts --worker`, forked with the parent's own
 * `execArgv` so tsx's loader comes along. It builds one game engine — the
 * same engine-per-process the in-process batch has always shared across its
 * scenarios — and then runs one scenario per `run` request, answering with
 * the scenario's result and everything it printed. Output is captured per
 * scenario rather than streamed, so the parent can print each one whole and
 * in a fixed order however the workers interleave.
 *
 * Fail closed: a worker that dies — a crash, a kill, an exit before answering
 * — rejects the scenario it was running with its exit status and every byte
 * it wrote outside a captured scenario (a fatal stack trace included), and
 * the death hook below writes the in-flight scenario's captured output there
 * too, so the parent can name the worker and show what it said.
 */

import { fork } from 'child_process';
import { writeSync } from 'fs';
import type { Readable } from 'stream';
import type { ScenarioResult } from './shared/command-runner.js';

/** Parent → worker. */
export type WorkerRequest = { type: 'run'; name: string } | { type: 'stop' };

/** One write a scenario made, kept with the stream it went to so replay preserves stdout/stderr. */
export interface OutputChunk {
  stream: 'stdout' | 'stderr';
  text: string;
}

/** Worker → parent: one scenario's verdict and everything it printed. */
export interface WorkerReport {
  type: 'result';
  name: string;
  result: ScenarioResult;
  output: OutputChunk[];
}

// ─── Worker side ─────────────────────────────────────────────────────────────

/** What `serveScenarioWorker` needs from its process — injected so a test drives it without IPC. */
export interface WorkerHost {
  onRequest(listener: (message: unknown) => void): void;
  send(report: WorkerReport): void;
  /** Ends the worker once the parent holds every report it asked for. */
  exit(): void;
  /**
   * Registers what to write straight to stderr if the process exits while a
   * scenario is in flight, so the captured output reaches the parent's death
   * report instead of dying with the process.
   */
  onDeath(lastWords: () => string): void;
  /** Routes every stdout/stderr write into `sink` until the returned restore runs. */
  redirectOutput(sink: OutputChunk[]): () => void;
}

/**
 * A stand-in for `stream.write` that appends to `sink` instead. A completion
 * callback, if the caller passed one, still fires — a caller awaiting its
 * write must not hang because nothing reached a real stream.
 */
function captureWrites(stream: OutputChunk['stream'], sink: OutputChunk[]): (chunk: unknown, ...rest: unknown[]) => boolean {
  return (chunk, ...rest) => {
    sink.push({ stream, text: typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8') });
    const done = rest.find((arg): arg is (err: null) => void => typeof arg === 'function');
    if (done) process.nextTick(done, null);
    return true;
  };
}

/** The real process as a `WorkerHost`. */
export function processWorkerHost(): WorkerHost {
  return {
    onRequest: (listener) => { process.on('message', listener); },
    send: (report) => { process.send!(report); },
    exit: () => process.exit(0),
    onDeath: (lastWords) => {
      process.on('exit', () => {
        const text = lastWords();
        // fd 2 directly: process.stderr.write may still be redirected into the lost buffer.
        if (text !== '') writeSync(2, text);
      });
    },
    redirectOutput: (sink) => {
      const out = process.stdout.write;
      const err = process.stderr.write;
      // Every console.* call lands here: Console writes through these methods.
      process.stdout.write = captureWrites('stdout', sink) as typeof out;
      process.stderr.write = captureWrites('stderr', sink) as typeof err;
      return () => { process.stdout.write = out; process.stderr.write = err; };
    },
  };
}

/**
 * Connects the real process to `serveScenarioWorker`. A worker whose parent
 * is gone (the IPC channel closes under it) exits rather than run on as an
 * orphan burning a core nobody is waiting on.
 */
export function serveScenarioWorkerProcess(runOne: (name: string) => ScenarioResult): void {
  process.on('disconnect', () => process.exit(1));
  serveScenarioWorker(processWorkerHost(), runOne);
}

/**
 * Serves `run` requests one at a time: runs the scenario with its output
 * captured, then sends the result and the output together. A `runOne` that
 * throws (it is not meant to — `runCommandScenario` turns every failure into
 * a result) still answers, with a failed result, so one scenario never takes
 * the worker's remaining queue down with it.
 */
export function serveScenarioWorker(host: WorkerHost, runOne: (name: string) => ScenarioResult): void {
  let inFlight: OutputChunk[] | null = null;
  host.onDeath(() => (inFlight ?? []).map(c => c.text).join(''));
  host.onRequest((message) => {
    const request = message as WorkerRequest;
    if (request.type === 'stop') {
      host.exit();
      return;
    }
    if (request.type !== 'run') return;
    const output: OutputChunk[] = [];
    inFlight = output;
    const restore = host.redirectOutput(output);
    let result: ScenarioResult;
    try {
      result = runOne(request.name);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result = { name: request.name, totalSteps: 0, failed: true, error: `threw out of the worker's scenario loop: ${msg}` };
    } finally {
      restore();
      inFlight = null;
    }
    host.send({ type: 'result', name: request.name, result, output });
  });
}

// ─── Parent side ─────────────────────────────────────────────────────────────

/** How a worker process ended. */
export interface WorkerExit {
  code: number | null;
  signal: string | null;
  /** Everything the worker wrote outside a captured scenario: start-up noise, a fatal trace. */
  output: string;
}

export function describeExit(exit: Pick<WorkerExit, 'code' | 'signal'>): string {
  return exit.signal !== null ? `killed by ${exit.signal}` : `exit code ${exit.code}`;
}

/** A worker died (or broke the protocol and was killed) before answering a `run`. */
export class WorkerDiedError extends Error {
  constructor(readonly label: string, readonly exit: WorkerExit, reason?: string) {
    super(`${label} ${reason ?? 'died'} (${describeExit(exit)})`);
    this.name = 'WorkerDiedError';
  }
}

/** The parent's handle on one worker. */
export interface ScenarioWorker {
  readonly label: string;
  /** Runs one scenario; rejects with `WorkerDiedError` if the process is gone before it answers. */
  run(name: string): Promise<WorkerReport>;
  /** Asks the worker to exit and resolves with how it did. */
  stop(): Promise<WorkerExit>;
  /** Ends the worker now, mid-scenario or not — for a batch that is itself being interrupted. */
  kill(): void;
}

/** The slice of `ChildProcess` a `ScenarioWorker` drives — a fake stands in for it in tests. */
export interface WorkerProcess {
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'close', listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  send(message: WorkerRequest): boolean;
  kill(signal: 'SIGKILL'): boolean;
  /** Undefined when the process never started. */
  readonly pid?: number | undefined;
  stdout: Readable | null;
  stderr: Readable | null;
}

/**
 * Wraps a worker process in the request/answer protocol. Listens for `close`
 * rather than `exit`: `close` fires only once the process's stdout and stderr
 * have drained, so a death report carries the worker's last words.
 */
export function attachScenarioWorker(child: WorkerProcess, label: string): ScenarioWorker {
  let output = '';
  let exited: WorkerExit | null = null;
  let protocolError: string | undefined;
  let pending: { name: string; resolve: (r: WorkerReport) => void; reject: (e: Error) => void } | null = null;
  const exitWaiters: Array<(exit: WorkerExit) => void> = [];

  const collect = (data: Buffer | string) => { output += String(data); };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  // SIGKILL, not SIGTERM: a worker stuck in a synchronous scenario never
  // reaches a JS-level signal handler, and tsx's loader may have bound one.
  const kill = () => { child.kill('SIGKILL'); };
  const breakProtocol = (reason: string) => {
    protocolError ??= reason;
    kill();
  };

  child.on('message', (message) => {
    const report = message as Partial<WorkerReport>;
    if (pending === null || report.type !== 'result' || report.name !== pending.name || !report.result) {
      breakProtocol(`sent a message it was not asked for (${JSON.stringify(message).slice(0, 200)})`);
      return;
    }
    const { resolve } = pending;
    pending = null;
    resolve(report as WorkerReport);
  });

  const finish = (code: number | null, signal: string | null) => {
    if (exited !== null) return;
    const exit: WorkerExit = { code, signal, output };
    exited = exit;
    if (pending !== null) {
      const { reject, name } = pending;
      pending = null;
      reject(new WorkerDiedError(label, exit, protocolError ?? `died before reporting "${name}"`));
    }
    for (const waiter of exitWaiters.splice(0)) waiter(exit);
  };

  child.on('error', (err) => {
    breakProtocol(`could not be driven: ${err.message}`);
    // A process that never started has no `close` to wait for.
    if (child.pid === undefined) finish(null, null);
  });

  child.on('close', finish);

  return {
    label,
    run(name) {
      if (exited !== null) return Promise.reject(new WorkerDiedError(label, exited, 'had already exited'));
      if (pending !== null) return Promise.reject(new Error(`${label} is already running "${pending.name}"`));
      return new Promise<WorkerReport>((resolve, reject) => {
        pending = { name, resolve, reject };
        child.send({ type: 'run', name });
      });
    },
    stop() {
      if (exited !== null) return Promise.resolve(exited);
      return new Promise<WorkerExit>((resolve) => {
        exitWaiters.push(resolve);
        child.send({ type: 'stop' });
      });
    },
    kill,
  };
}

/**
 * Forks `entry` as a worker. `fork` reuses this process's `execArgv`, which
 * under `tsx` carries its TypeScript loader, so the worker runs the same
 * sources the parent does without a build step.
 */
export function forkScenarioWorker(entry: string, label: string, args: string[]): ScenarioWorker {
  const child = fork(entry, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced' });
  return attachScenarioWorker(child, label);
}
