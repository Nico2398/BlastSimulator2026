// BlastSimulator2026 — Sample bank
// Fetches and decodes the one-shot files. Bytes and decoding are injected, as in
// the model loader, so a Node test feeds it bytes from disk or from nowhere.
// A file that cannot be fetched or decoded is retried after a short backoff,
// then recorded and skipped: a missing sample costs one silent sound, never the
// game.

import { SAMPLE_BANK_CONFIG } from '../../core/config/audio/engine.js';

export type ByteSource = (url: string) => Promise<ArrayBuffer>;
export type Decoder = (bytes: ArrayBuffer) => Promise<AudioBuffer>;

interface SampleBankOptions {
  readonly base?: string;
  readonly extension?: string;
  readonly concurrency?: number;
  /** Extra attempts after a failure. */
  readonly retries?: number;
  /** Wait before retry n is n times this (ms). */
  readonly retryBackoffMs?: number;
  /** Wait `ms`; defaults to a timer. Injected so tests need no clock. */
  readonly delay?: (ms: number) => Promise<void>;
}

const timerDelay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export class SampleBank {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly failedNames = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly waiting: Array<() => void> = [];
  private running = 0;
  private readonly base: string;
  private readonly extension: string;
  private readonly concurrency: number;
  private readonly retries: number;
  private readonly retryBackoffMs: number;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(
    private readonly fetchBytes: ByteSource,
    private readonly decode: Decoder,
    options: SampleBankOptions = {},
  ) {
    this.base = options.base ?? SAMPLE_BANK_CONFIG.assetBase;
    this.extension = options.extension ?? SAMPLE_BANK_CONFIG.fileExtension;
    this.concurrency = Math.max(1, options.concurrency ?? SAMPLE_BANK_CONFIG.decodeConcurrency);
    this.retries = Math.max(0, options.retries ?? SAMPLE_BANK_CONFIG.retries);
    this.retryBackoffMs = options.retryBackoffMs ?? SAMPLE_BANK_CONFIG.retryBackoffMs;
    this.delay = options.delay ?? timerDelay;
  }

  get failed(): readonly string[] { return [...this.failedNames]; }

  get(name: string): AudioBuffer | undefined { return this.buffers.get(name); }

  url(name: string): string { return `${this.base}${name}${this.extension}`; }

  /**
   * Load every name not already loaded or failed; names already in flight share
   * that load. Resolves when all have settled and never rejects. `onSettled`
   * fires once per name this call waited on.
   */
  async load(names: readonly string[], onSettled?: (name: string, ok: boolean) => void): Promise<void> {
    const unique = [...new Set(names)];
    await Promise.all(unique.map(async (name) => {
      await this.loadOne(name);
      onSettled?.(name, this.buffers.has(name));
    }));
  }

  private loadOne(name: string): Promise<void> {
    if (this.buffers.has(name) || this.failedNames.has(name)) return Promise.resolve();
    const pending = this.inFlight.get(name);
    if (pending) return pending;
    const task = this.loadWithRetries(name)
      .then((ok) => { if (!ok) this.failedNames.add(name); })
      .finally(() => { this.inFlight.delete(name); });
    this.inFlight.set(name, task);
    return task;
  }

  /** Try `retries` more times after a failure, each after a longer wait that holds no decode slot. True once decoded. */
  private async loadWithRetries(name: string): Promise<boolean> {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await this.delay(this.retryBackoffMs * attempt);
      if (await this.limited(() => this.fetchOnce(name))) return true;
    }
    return false;
  }

  private async fetchOnce(name: string): Promise<boolean> {
    try {
      this.buffers.set(name, await this.decode(await this.fetchBytes(this.url(name))));
      return true;
    } catch {
      return false;
    }
  }

  /** Run `task` once fewer than `concurrency` tasks are running; a finishing task hands its slot straight to the next waiter. */
  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.running++;
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}
