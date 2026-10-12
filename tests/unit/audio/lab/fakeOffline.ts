// BlastSimulator2026 — Fake offline context for the lab tests
// Renders nothing but honours suspend/resume the way an OfflineAudioContext does and
// ends sources when their time has passed, so the lab's scheduling can be driven in Node.

import type { SynthRecipeId } from '../../../../src/audio/SoundCatalog.js';
import type { RenderedAudio, SynthRecipe } from '../../../../src/audio/synth/types.js';
import { FakeAudioBuffer, FakeAudioContext, FakeSource } from '../../../helpers/audioFakes.js';

/** A source the voice probe can listen to: `ended` listeners fire together with `onended`. */
export class ListenableSource extends FakeSource {
  private readonly endedListeners: Array<() => void> = [];
  ended = false;

  addEventListener(_type: string, listener: () => void): void {
    this.endedListeners.push(listener);
  }

  override end(): void {
    super.end();
    for (const listener of this.endedListeners) listener();
  }
}

/** A context that renders nothing but honours suspend/resume and ends sources like a real one. */
export class FakeOfflineContext extends FakeAudioContext {
  private readonly pauses = new Map<number, () => void>();
  private release: (() => void) | null = null;
  readonly pausedAt: number[] = [];
  /** Time the rendering ran to. */
  renderedTo = 0;

  constructor(private readonly frames: number) {
    super();
  }

  override suspend(time?: number): Promise<void> {
    if (time === undefined) return super.suspend();
    if (this.pauses.has(time)) return Promise.reject(new Error('duplicate suspend'));
    return new Promise<void>((resolve) => { this.pauses.set(time, resolve); });
  }

  override resume(): Promise<void> {
    this.release?.();
    return super.resume();
  }

  override createBufferSource(): FakeSource {
    const source = new ListenableSource(this);
    this.nodes.push(source);
    return source;
  }

  override decodeAudioData(bytes: ArrayBuffer): Promise<FakeAudioBuffer> {
    const buffer = new FakeAudioBuffer(1, bytes.byteLength, this.sampleRate);
    buffer.channels[0]?.fill(0.5);
    return Promise.resolve(buffer);
  }

  async startRendering(): Promise<AudioBuffer> {
    for (const time of [...this.pauses.keys()].sort((a, b) => a - b)) {
      this.currentTime = time;
      this.pausedAt.push(time);
      this.endFinishedSources(time);
      const resumed = new Promise<void>((resolve) => { this.release = resolve; });
      this.pauses.get(time)?.();
      await resumed;
    }
    this.renderedTo = this.frames / this.sampleRate;
    this.currentTime = this.renderedTo;
    const left = new Float32Array(this.frames).fill(0.1);
    const right = new Float32Array(this.frames).fill(-0.1);
    return { sampleRate: this.sampleRate, numberOfChannels: 2, getChannelData: (i: number) => (i === 0 ? left : right) } as unknown as AudioBuffer;
  }

  private endFinishedSources(time: number): void {
    for (const source of this.sources() as ListenableSource[]) {
      const start = source.starts[0]?.when;
      if (start === undefined || source.loop || source.ended) continue;
      if (start + (source.buffer?.duration ?? 0) / source.playbackRate.value <= time) {
        source.ended = true;
        source.end();
      }
    }
  }
}

const recipe = (loop: boolean): SynthRecipe => ({
  variants: 1,
  loop,
  render: () => ({ sampleRate: 22050, channels: [new Float32Array(22050).fill(0.4)] }),
});

/** One short constant-level recipe per id, so a render needs no real synthesis. */
export const FAKE_RECIPES = {
  blast_sub: recipe(false), blast_tail: recipe(false), blast_beep: recipe(false), blast_cancel: recipe(false),
  siren_loop: recipe(true), thunder: recipe(false), wind_bed: recipe(true), rain_light_bed: recipe(true),
  rain_heavy_bed: recipe(true), machinery_bed: recipe(true),
} as Record<SynthRecipeId, SynthRecipe>;

export const FAKE_IMPULSE = (): RenderedAudio => ({ sampleRate: 48000, channels: [new Float32Array(480).fill(0.1), new Float32Array(480).fill(0.1)] });
