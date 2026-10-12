// BlastSimulator2026 — Synth bank
// Renders the generative sounds once at startup into AudioBuffers. Rendering is
// pure CPU work on the main thread. It is sliced only between variants: once the
// slice budget is spent after a variant, control goes back to the event loop. A
// variant itself renders atomically, so the heavy ones stall the page for
// 70-105 ms each (measured; nine at startup). A recipe that throws or renders
// nothing is recorded and skipped, never fatal.

import type { SynthRecipeId } from '../SoundCatalog.js';
import type { RenderedAudio, SynthRecipe } from '../synth/types.js';
import { resampleLinear } from './resample.js';

interface BufferFactory {
  /** The context's rate: a ConvolverNode only accepts an impulse recorded at exactly this rate. */
  readonly sampleRate: number;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
}

export interface SynthBankOptions {
  readonly recipes: Partial<Record<SynthRecipeId, SynthRecipe>>;
  /** Renders the shared reverb's impulse response. */
  readonly renderImpulse: () => RenderedAudio;
  readonly yieldToEventLoop: () => Promise<void>;
  /** Millisecond clock used to measure the slice. */
  readonly now: () => number;
  readonly sliceBudgetMs: number;
}

export class SynthBank {
  private readonly rendered = new Map<SynthRecipeId, AudioBuffer[]>();
  private readonly failedIds = new Set<string>();
  private sliceStart: number;

  constructor(private readonly factory: BufferFactory, private readonly options: SynthBankOptions) {
    this.sliceStart = options.now();
  }

  get failed(): readonly string[] { return [...this.failedIds]; }

  /** Rendered variants of a recipe; empty until it is rendered (or if it failed). */
  buffers(recipe: SynthRecipeId): readonly AudioBuffer[] { return this.rendered.get(recipe) ?? []; }

  /** Render the listed recipes (default: all of them) one variant at a time. */
  async renderAll(ids?: readonly SynthRecipeId[], onEach?: (id: SynthRecipeId) => void): Promise<void> {
    const wanted = ids ?? (Object.keys(this.options.recipes) as SynthRecipeId[]);
    this.sliceStart = this.options.now();
    for (const id of wanted) {
      await this.renderRecipe(id);
      onEach?.(id);
    }
  }

  /** The reverb impulse response as a buffer at the context's sample rate, or undefined when it could not be rendered. */
  async renderImpulse(): Promise<AudioBuffer | undefined> {
    try {
      const audio = this.options.renderImpulse();
      const rate = this.factory.sampleRate;
      const buffer = this.toBuffer({
        sampleRate: rate,
        channels: audio.channels.map(channel => resampleLinear(channel, audio.sampleRate, rate)),
      });
      await this.yieldIfSliceSpent();
      return buffer;
    } catch {
      this.failedIds.add('reverb_impulse');
      return undefined;
    }
  }

  private async renderRecipe(id: SynthRecipeId): Promise<void> {
    const recipe = this.options.recipes[id];
    if (!recipe) {
      this.failedIds.add(id);
      return;
    }
    const buffers: AudioBuffer[] = [];
    for (let variant = 0; variant < recipe.variants; variant++) {
      try {
        buffers.push(this.toBuffer(recipe.render(variant)));
      } catch {
        this.failedIds.add(id);
        return;
      }
      await this.yieldIfSliceSpent();
    }
    if (buffers.length > 0) this.rendered.set(id, buffers);
  }

  private toBuffer(audio: RenderedAudio): AudioBuffer {
    const first = audio.channels[0];
    if (!first || first.length === 0) throw new Error('empty synth render');
    const buffer = this.factory.createBuffer(audio.channels.length, first.length, audio.sampleRate);
    audio.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
    return buffer;
  }

  private async yieldIfSliceSpent(): Promise<void> {
    if (this.options.now() - this.sliceStart < this.options.sliceBudgetMs) return;
    await this.options.yieldToEventLoop();
    this.sliceStart = this.options.now();
  }
}
