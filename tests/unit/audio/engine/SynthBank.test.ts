import { describe, it, expect } from 'vitest';
import { SynthBank, type SynthBankOptions } from '../../../../src/audio/engine/SynthBank.js';
import type { RenderedAudio, SynthRecipe } from '../../../../src/audio/synth/types.js';
import { FakeAudioBuffer, FakeAudioContext, asAudioContext } from '../../../helpers/audioFakes.js';

function tone(value: number, length = 8, channels = 1): RenderedAudio {
  return { sampleRate: 44100, channels: Array.from({ length: channels }, () => new Float32Array(length).fill(value)) };
}

function recipe(variants: number, make: (variant: number) => RenderedAudio = v => tone(v + 1)): SynthRecipe {
  return { variants, loop: false, render: make };
}

function harness(recipes: SynthBankOptions['recipes'], over: Partial<SynthBankOptions> = {}) {
  const ctx = new FakeAudioContext();
  let clock = 0;
  const yields: number[] = [];
  const bank = new SynthBank(asAudioContext(ctx), {
    recipes,
    renderImpulse: () => tone(0.5, 16, 2),
    yieldToEventLoop: async () => { yields.push(clock); },
    now: () => clock,
    sliceBudgetMs: 16,
    ...over,
  });
  return { bank, ctx, yields, advance: (ms: number) => { clock += ms; } };
}

describe('SynthBank', () => {
  it('renders every variant into buffers with the rendered samples', async () => {
    const { bank } = harness({ thunder: recipe(3), blast_sub: recipe(1) });
    await bank.renderAll();
    const thunder = bank.buffers('thunder') as unknown as FakeAudioBuffer[];
    expect(thunder).toHaveLength(3);
    expect(thunder[2]!.getChannelData(0)[0]).toBe(3);
    expect(thunder[0]!.sampleRate).toBe(44100);
    expect(bank.buffers('blast_sub')).toHaveLength(1);
    expect(bank.buffers('wind_bed')).toEqual([]);
  });

  it('keeps all channels of a stereo render', async () => {
    const { bank } = harness({ thunder: recipe(1, () => tone(0.25, 4, 2)) });
    await bank.renderAll();
    const buffer = bank.buffers('thunder')[0] as unknown as FakeAudioBuffer;
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.getChannelData(1)[3]).toBe(0.25);
  });

  it('renders only the listed ids and reports each', async () => {
    const { bank } = harness({ thunder: recipe(1), blast_sub: recipe(1) });
    const seen: string[] = [];
    await bank.renderAll(['blast_sub'], id => seen.push(id));
    expect(seen).toEqual(['blast_sub']);
    expect(bank.buffers('thunder')).toEqual([]);
  });

  it('records a recipe that throws and carries on with the others', async () => {
    const { bank } = harness({
      thunder: recipe(2, () => { throw new Error('not implemented'); }),
      blast_sub: recipe(1),
    });
    await expect(bank.renderAll(['thunder', 'blast_sub', 'wind_bed'])).resolves.toBeUndefined();
    expect(bank.buffers('thunder')).toEqual([]);
    expect(bank.buffers('blast_sub')).toHaveLength(1);
    expect([...bank.failed].sort()).toEqual(['thunder', 'wind_bed']);
  });

  it('treats an empty render as a failure', async () => {
    const { bank } = harness({ thunder: recipe(1, () => ({ sampleRate: 44100, channels: [] })) });
    await bank.renderAll();
    expect(bank.buffers('thunder')).toEqual([]);
    expect(bank.failed).toEqual(['thunder']);
  });

  it('does not yield while the slice budget holds', async () => {
    const { bank, yields } = harness({ thunder: recipe(4) });
    await bank.renderAll();
    expect(yields).toEqual([]);
  });

  it('yields to the event loop once the slice budget is spent', async () => {
    let clock = 0;
    const yields: number[] = [];
    const ctx = new FakeAudioContext();
    const bank = new SynthBank(asAudioContext(ctx), {
      recipes: { thunder: recipe(5, v => { clock += 10; return tone(v); }) },
      renderImpulse: () => tone(0),
      yieldToEventLoop: async () => { yields.push(clock); },
      now: () => clock,
      sliceBudgetMs: 16,
    });
    await bank.renderAll();
    // 10 ms per variant: the 16 ms budget is spent after every second one
    expect(yields).toEqual([20, 40]);
    expect(bank.buffers('thunder')).toHaveLength(5);
  });

  it('builds the reverb impulse, and survives a failing renderer', async () => {
    const { bank } = harness({});
    const impulse = await bank.renderImpulse() as unknown as FakeAudioBuffer;
    expect(impulse.numberOfChannels).toBe(2);
    expect(impulse.length).toBe(Math.round(16 * 48000 / 44100));

    const broken = harness({}, { renderImpulse: () => { throw new Error('nope'); } });
    await expect(broken.bank.renderImpulse()).resolves.toBeUndefined();
    expect(broken.bank.failed).toEqual(['reverb_impulse']);
  });

  it('resamples the impulse to the context rate, which a convolver requires', async () => {
    const h = harness({}, { renderImpulse: () => tone(0.5, 441, 2) });
    const impulse = await h.bank.renderImpulse() as unknown as FakeAudioBuffer;
    expect(impulse.sampleRate).toBe(h.ctx.sampleRate);
    expect(impulse.length).toBe(Math.round(441 * h.ctx.sampleRate / 44100));
    expect(impulse.numberOfChannels).toBe(2);
  });

  it('yields after a costly impulse render too', async () => {
    const h = harness({}, { sliceBudgetMs: 0 });
    await h.bank.renderImpulse();
    expect(h.yields).toHaveLength(1);
  });
});
