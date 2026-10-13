// BlastSimulator2026 — Asset probe

import { describe, expect, it } from 'vitest';
import { AssetProbe, memoizeBytes } from '../../../../src/audio/lab/assetProbe.js';
import type { SynthRecipeId } from '../../../../src/audio/SoundCatalog.js';
import type { RenderedAudio, SynthRecipe } from '../../../../src/audio/synth/types.js';

/** Just enough of an AudioBuffer for the probe. */
function clip(samples: number[], sampleRate = 1000): AudioBuffer {
  const data = Float32Array.from(samples);
  return { numberOfChannels: 1, duration: samples.length / sampleRate, getChannelData: () => data } as unknown as AudioBuffer;
}

const bytesFor = (url: string): ArrayBuffer => new TextEncoder().encode(url).buffer as ArrayBuffer;

async function loadSample(probe: AssetProbe, url: string, decoded: AudioBuffer | Error): Promise<'ok' | 'failed'> {
  const fetchBytes = probe.wrapFetch(async () => bytesFor(url));
  const decode = probe.wrapDecode(async () => { if (decoded instanceof Error) throw decoded; return decoded; });
  try {
    await decode(await fetchBytes(url));
    return 'ok';
  } catch {
    return 'failed';
  }
}

describe('AssetProbe samples', () => {
  it('records a decoded clip by file name with its length and peak', async () => {
    const probe = new AssetProbe();
    expect(await loadSample(probe, '/audio/sfx/ui_click_1.mp3', clip([0, 0.5, -0.25, 0.1]))).toBe('ok');
    expect(probe.report().loaded).toEqual([{ name: 'ui_click_1', kind: 'sample', durationS: 0.004, peakDbfs: -6 }]);
    expect(probe.report().failed).toEqual([]);
  });

  it('records a fetch failure and passes the error on', async () => {
    const probe = new AssetProbe();
    const fetchBytes = probe.wrapFetch(async () => { throw new Error('HTTP 404'); });
    await expect(fetchBytes('/audio/sfx/missing.mp3')).rejects.toThrow('HTTP 404');
    expect(probe.report().failed).toEqual(['sample:missing (HTTP 404)']);
  });

  it('records a decode failure with the file it came from', async () => {
    const probe = new AssetProbe();
    expect(await loadSample(probe, '/audio/sfx/bad.mp3', new Error('EncodingError'))).toBe('failed');
    expect(probe.report().failed).toEqual(['sample:bad (EncodingError)']);
  });

  it('fails a clip that decodes to silence, to nothing or to NaN', async () => {
    const probe = new AssetProbe();
    expect(await loadSample(probe, '/a/silent.mp3', clip([0, 0, 0]))).toBe('failed');
    expect(await loadSample(probe, '/a/empty.mp3', clip([]))).toBe('failed');
    expect(await loadSample(probe, '/a/nan.mp3', clip([0.5, Number.NaN]))).toBe('failed');
    expect(probe.report().failed.map(f => f.split(' ')[0])).toEqual(['sample:silent', 'sample:empty', 'sample:nan']);
    expect(probe.report().loaded).toEqual([]);
  });

  it('names bytes it did not fetch "unknown" and does not repeat a failure', async () => {
    const probe = new AssetProbe();
    const decode = probe.wrapDecode(async () => { throw new Error('x'); });
    await expect(decode(new ArrayBuffer(4))).rejects.toThrow('x');
    await expect(decode(new ArrayBuffer(4))).rejects.toThrow('x');
    expect(probe.report().failed).toEqual(['sample:unknown (x)']);
  });

  it('sorts the loaded list by name', async () => {
    const probe = new AssetProbe();
    await loadSample(probe, '/a/zeta.mp3', clip([0.5]));
    await loadSample(probe, '/a/alpha.mp3', clip([0.5]));
    expect(probe.report().loaded.map(l => l.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('AssetProbe recipes and impulse', () => {
  const audio = (samples: number[], sampleRate = 100): RenderedAudio => ({ sampleRate, channels: [Float32Array.from(samples)] });
  const recipe = (render: (variant: number) => RenderedAudio, variants = 1): SynthRecipe => ({ variants, loop: false, render });
  const recipes = (table: Partial<Record<SynthRecipeId, SynthRecipe>>) => table as Record<SynthRecipeId, SynthRecipe>;

  it('wraps recipes transparently and keeps the longest and loudest variant', () => {
    const probe = new AssetProbe();
    const wrapped = probe.wrapRecipes(recipes({
      phone_ring: recipe(v => audio(v === 0 ? [0.1, 0.1] : [0.5, 0.2, 0.2, 0.2], 100), 2),
    }));
    expect(wrapped.phone_ring.variants).toBe(2);
    expect(wrapped.phone_ring.render(0).channels[0]).toHaveLength(2);
    wrapped.phone_ring.render(1);
    expect(probe.report().loaded).toEqual([{ name: 'phone_ring', kind: 'recipe', durationS: 0.04, peakDbfs: -6 }]);
  });

  it('records a recipe that throws, renders nothing, NaN or silence, and rethrows', () => {
    const probe = new AssetProbe();
    const wrapped = probe.wrapRecipes(recipes({
      radio_order: recipe(() => { throw new Error('boom'); }),
      radio_info: recipe(() => ({ sampleRate: 100, channels: [] })),
      radio_good: recipe(() => audio([0.5, Number.NaN])),
      phone_ring: recipe(() => audio([0, 0, 0])),
    }));
    for (const id of ['radio_order', 'radio_info', 'radio_good', 'phone_ring'] as const) expect(() => wrapped[id].render(0)).toThrow();
    expect(probe.report().failed).toEqual([
      'recipe:radio_order (boom)',
      'recipe:radio_info (rendered no audio)',
      'recipe:radio_good (rendered NaN or infinite samples)',
      'recipe:phone_ring (rendered silence (peak -120 dBFS))',
    ]);
  });

  it('checks and lists the reverb impulse', () => {
    const probe = new AssetProbe();
    const render = probe.wrapImpulse(() => audio([0.2, -0.1, 0.05], 50));
    render();
    expect(probe.report().loaded).toEqual([{ name: 'reverb_impulse', kind: 'impulse', durationS: 0.06, peakDbfs: -14 }]);
    const broken = new AssetProbe().wrapImpulse(() => { throw new Error('no impulse'); });
    expect(() => broken()).toThrow('no impulse');
  });

  it('lists samples, then recipes, then the impulse', async () => {
    const probe = new AssetProbe();
    await loadSample(probe, '/a/one.mp3', clip([0.5]));
    probe.wrapImpulse(() => audio([0.5]))();
    probe.wrapRecipes(recipes({ blast_sub: recipe(() => audio([0.5])) })).blast_sub.render(0);
    expect(probe.report().loaded.map(l => l.kind)).toEqual(['sample', 'recipe', 'impulse']);
  });
});

describe('memoizeBytes', () => {
  it('fetches each url once and hands out independent copies', async () => {
    let calls = 0;
    const cached = memoizeBytes(async () => { calls++; return Uint8Array.from([1, 2, 3]).buffer; });
    const first = await cached('/a.mp3');
    const second = await cached('/a.mp3');
    expect(calls).toBe(1);
    expect(first).not.toBe(second);
    new Uint8Array(first)[0] = 99;
    expect(new Uint8Array(second)[0]).toBe(1);
  });

  it('forgets a failed fetch so the next call tries again', async () => {
    let calls = 0;
    const cached = memoizeBytes(async () => {
      calls++;
      if (calls === 1) throw new Error('flaky');
      return new ArrayBuffer(1);
    });
    await expect(cached('/a.mp3')).rejects.toThrow('flaky');
    await Promise.resolve();
    await expect(cached('/a.mp3')).resolves.toBeInstanceOf(ArrayBuffer);
    expect(calls).toBe(2);
  });
});
