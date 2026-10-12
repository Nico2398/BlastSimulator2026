import { describe, it, expect } from 'vitest';
import { SampleBank } from '../../../../src/audio/engine/SampleBank.js';
import { fakeBuffer } from '../../../helpers/audioFakes.js';

function harness(options: { failFetch?: string[]; failDecode?: string[]; concurrency?: number } = {}) {
  const fetched: string[] = [];
  let running = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
    fetched.push(url);
    running++;
    peak = Math.max(peak, running);
    await new Promise<void>(resolve => releases.push(resolve));
    running--;
    if (options.failFetch?.some(n => url.includes(n))) throw new Error('404');
    return new ArrayBuffer(8);
  };
  const decoded: ArrayBuffer[] = [];
  const decode = async (bytes: ArrayBuffer): Promise<AudioBuffer> => {
    decoded.push(bytes);
    if (options.failDecode && decoded.length === 1) throw new Error('bad data');
    return fakeBuffer(0.1);
  };
  const bank = new SampleBank(fetchBytes, decode, { base: '/sfx/', concurrency: options.concurrency ?? 4 });
  /** Let every pending fetch complete, repeatedly, until none remain. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 200; i++) {
      await Promise.resolve();
      while (releases.length > 0) releases.shift()!();
    }
  };
  return { bank, fetched, flush, peak: () => peak, decoded };
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
});
