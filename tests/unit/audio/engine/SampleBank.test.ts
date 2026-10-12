import { describe, it, expect } from 'vitest';
import { SAMPLE_BANK_CONFIG } from '../../../../src/core/config/audio/engine.js';
import { SampleBank } from '../../../../src/audio/engine/SampleBank.js';
import { fakeBuffer } from '../../../helpers/audioFakes.js';

function harness(options: { failFetch?: string[]; failDecode?: string[]; concurrency?: number; retries?: number; failFirst?: number } = {}) {
  const fetched: string[] = [];
  const attempts = new Map<string, number>();
  let running = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    fetched.push(url);
    running++;
    peak = Math.max(peak, running);
    await new Promise<void>(resolve => releases.push(resolve));
    running--;
    attempts.set(url, (attempts.get(url) ?? 0) + 1);
    if (options.failFetch?.some(n => url.includes(n)) && attempts.get(url)! <= (options.failFirst ?? Infinity)) throw new Error('404');
    return new ArrayBuffer(8);
  };
  const decoded: ArrayBuffer[] = [];
  const decode = async (bytes: ArrayBuffer): Promise<AudioBuffer> => {
    decoded.push(bytes);
    if (options.failDecode && decoded.length === 1) throw new Error('bad data');
    return fakeBuffer(0.1);
  };
  const sleeps: number[] = [];
  const bank = new SampleBank(fetchBytes, decode, {
    base: '/sfx/',
    concurrency: options.concurrency ?? 4,
    retries: options.retries ?? 0,
    delay: async (ms) => { sleeps.push(ms); },
  });
  /** Let every pending fetch complete, repeatedly, until none remain. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) {
      await Promise.resolve();
      while (releases.length > 0) releases.shift()!();
    }
  };
  return { bank, fetched, flush, peak: () => peak, decoded, sleeps };
}

describe('SampleBank', () => {
  it('builds the URL from base, name and extension', () => {
    const { bank } = harness();
    expect(bank.url('ui_click_1')).toBe('/sfx/ui_click_1.mp3');
    expect(new SampleBank(async () => new ArrayBuffer(0), async () => fakeBuffer())
      .url('x')).toBe('/audio/sfx/x.mp3');
  });

  it('loads and exposes decoded buffers', async () => {
    const { bank, flush, fetched } = harness();
    const done = bank.load(['a', 'b']);
    await flush();
    await done;
    expect(fetched).toEqual(['/sfx/a.mp3', '/sfx/b.mp3']);
    expect(bank.get('a')).toBeDefined();
    expect(bank.get('missing')).toBeUndefined();
    expect(bank.failed).toEqual([]);
  });

  it('never runs more than the concurrency limit at once', async () => {
    const { bank, flush, peak } = harness({ concurrency: 4 });
    const done = bank.load(Array.from({ length: 11 }, (_, i) => `s${i}`));
    await flush();
    await done;
    expect(peak()).toBe(4);
    expect(bank.get('s10')).toBeDefined();
  });

  it('records fetch and decode failures without throwing', async () => {
    const { bank, flush } = harness({ failFetch: ['bad'], failDecode: ['x'] });
    const settled: Array<[string, boolean]> = [];
    const done = bank.load(['first', 'bad', 'good'], (name, ok) => settled.push([name, ok]));
    await flush();
    await expect(done).resolves.toBeUndefined();
    expect(bank.get('good')).toBeDefined();
    expect([...bank.failed].sort()).toEqual(['bad', 'first']);
    expect(settled).toHaveLength(3);
    expect(settled.filter(([, ok]) => ok)).toEqual([['good', true]]);
  });

  it('shares an in-flight load and does not refetch loaded or failed names', async () => {
    const { bank, flush, fetched } = harness({ failFetch: ['bad'] });
    const first = bank.load(['a', 'bad']);
    const second = bank.load(['a', 'bad']);
    await flush();
    await Promise.all([first, second]);
    expect(fetched.sort()).toEqual(['/sfx/a.mp3', '/sfx/bad.mp3']);
    const again = bank.load(['a', 'bad']);
    await flush();
    await again;
    expect(fetched).toHaveLength(2);
  });

  it('dedupes repeated names in one call', async () => {
    const { bank, flush, fetched } = harness();
    const done = bank.load(['a', 'a', 'a']);
    await flush();
    await done;
    expect(fetched).toEqual(['/sfx/a.mp3']);
  });

  it('retries a failed fetch after a growing backoff and keeps the file when a retry succeeds', async () => {
    const { bank, flush, fetched, sleeps } = harness({ failFetch: ['flaky'], failFirst: 2, retries: 2 });
    const done = bank.load(['flaky']);
    await flush();
    await done;
    expect(fetched).toHaveLength(3);
    expect(sleeps).toEqual([SAMPLE_BANK_CONFIG.retryBackoffMs, SAMPLE_BANK_CONFIG.retryBackoffMs * 2]);
    expect(bank.get('flaky')).toBeDefined();
    expect(bank.failed).toEqual([]);
  });

  it('records the failure only after every retry failed, then never refetches it', async () => {
    const { bank, flush, fetched } = harness({ failFetch: ['gone'], retries: 1 });
    const done = bank.load(['gone']);
    await flush();
    await done;
    expect(fetched).toHaveLength(2);
    expect(bank.failed).toEqual(['gone']);
    const again = bank.load(['gone']);
    await flush();
    await again;
    expect(fetched).toHaveLength(2);
  });

  it('does not hold its decode slot while it waits to retry', async () => {
    let openDelay!: () => void;
    const gate = new Promise<void>((resolve) => { openDelay = resolve; });
    const bank = new SampleBank(
      async (url) => { if (url.includes('bad')) throw new Error('404'); return new ArrayBuffer(1); },
      async () => fakeBuffer(0.1),
      { base: '/sfx/', concurrency: 1, retries: 1, delay: () => gate },
    );
    const bad = bank.load(['bad']);
    await bank.load(['good']);
    expect(bank.get('good')).toBeDefined();
    openDelay();
    await bad;
    expect(bank.failed).toEqual(['bad']);
  });
});
