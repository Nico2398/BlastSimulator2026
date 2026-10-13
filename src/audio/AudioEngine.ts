// BlastSimulator2026 — Audio engine
// The facade the game builds once: wires the sample bank, the synth bank and the
// sound player to an AudioManager, loads everything in tiers and then is the
// AudioPlayer the directors talk to. Without a Web Audio context every method
// is a safe no-op and `ready` stays false.

import type { Random } from '../core/math/Random.js';
import { SAMPLE_BANK_CONFIG, SYNTH_RENDER_CONFIG } from '../core/config/audio/engine.js';
import type { AudioManager } from './AudioManager.js';
import { NULL_AUDIO_PLAYER, type AudioPlayer, type LoopHandle, type LoopOptions, type Listener, type PlayOptions, type SoundHandle } from './AudioPlayer.js';
import { SOUND_CATALOG, type LoopId, type OneShotId, type SoundBus, type SoundDefinition, type SynthRecipeId } from './SoundCatalog.js';
import { planPreload } from './engine/preloadPlan.js';
import { SampleBank, type ByteSource, type Decoder } from './engine/SampleBank.js';
import { SoundPlayer } from './engine/SoundPlayer.js';
import { SynthBank } from './engine/SynthBank.js';
import { SYNTH_RECIPES, renderReverbIr } from './synth/recipes.js';
import type { RenderedAudio, SynthRecipe } from './synth/types.js';

export interface AudioEngineOptions {
  /** Runtime variation (pitch, level, variant choice). */
  readonly random: Random;
  /** URL prefix of the sample files; defaults to the served public/audio/sfx/. */
  readonly assetBase?: string;
  readonly fetchBytes?: ByteSource;
  readonly decode?: Decoder;
  readonly recipes?: Partial<Record<SynthRecipeId, SynthRecipe>>;
  readonly renderImpulse?: () => RenderedAudio;
  readonly catalog?: Readonly<Record<string, SoundDefinition>>;
  /** Millisecond clock for cooldowns and render slicing. */
  readonly now?: () => number;
  readonly yieldToEventLoop?: () => Promise<void>;
  /** Wait `ms` before a failed sample is retried; defaults to a timer. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Loaded assets so far, out of all assets the preload will try. */
type PreloadProgress = (done: number, total: number) => void;

/** Fetch a file's bytes, or throw on a non-2xx answer. Shared with the sound lab. */
export async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** Let the event loop run one task (paint, input) before continuing. Shared with the lab renderer. */
export const yieldOneMacrotask = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

export class AudioEngine implements AudioPlayer {
  private readonly player: SoundPlayer | null;
  private readonly samples: SampleBank | null;
  private readonly synth: SynthBank | null;
  private readonly catalog: Readonly<Record<string, SoundDefinition>>;
  private essentialsLoaded = false;
  private preloading: Promise<void> | null = null;
  private preloadSettled = false;
  private preloadCrashed = false;

  constructor(private readonly manager: AudioManager, options: AudioEngineOptions) {
    const ctx = manager.context;
    this.catalog = options.catalog ?? SOUND_CATALOG;
    if (!ctx) {
      this.player = null;
      this.samples = null;
      this.synth = null;
      return;
    }
    const now = options.now ?? (() => performance.now());
    this.samples = new SampleBank(
      options.fetchBytes ?? fetchArrayBuffer,
      options.decode ?? (bytes => ctx.decodeAudioData(bytes)),
      { base: options.assetBase ?? SAMPLE_BANK_CONFIG.assetBase, ...(options.sleep && { delay: options.sleep }) },
    );
    const samples = this.samples;
    this.synth = new SynthBank(ctx, {
      recipes: options.recipes ?? SYNTH_RECIPES,
      renderImpulse: options.renderImpulse ?? renderReverbIr,
      yieldToEventLoop: options.yieldToEventLoop ?? yieldOneMacrotask,
      now,
      sliceBudgetMs: SYNTH_RENDER_CONFIG.sliceBudgetMs,
    });
    const synth = this.synth;
    this.player = new SoundPlayer({
      context: ctx,
      mixer: manager,
      library: { sample: name => samples.get(name), synth: recipe => synth.buffers(recipe) },
      random: options.random,
      catalog: this.catalog,
      now,
      isReady: () => this.essentialsLoaded,
    });
  }

  /** True once the tier-1 samples (interface sounds and high-priority sampled sounds) are decoded. Synth cues (blast synths, siren, weather) come later: see `preloaded`. */
  get ready(): boolean { return this.player !== null && this.essentialsLoaded; }

  /** True once the preload has tried every sample and recipe, whether or not they all loaded. */
  get preloaded(): boolean { return this.preloadSettled; }

  /** Sample files and synth recipes the preload could not load, plus 'preload' when it died unexpectedly (empty while it is still running). */
  get failedAssets(): readonly string[] {
    return [...(this.samples?.failed ?? []), ...(this.synth?.failed ?? []), ...(this.preloadCrashed ? ['preload'] : [])];
  }

  /**
   * Load all audio in tiers: samples of interface and high-priority sampled
   * sounds (flips `ready`), then the synth recipes rendered while the remaining
   * samples download (the radio and phone cues are synth, so they come right
   * after the essentials and before the large beds), then the reverb impulse.
   * `ready` excludes synth cues. Safe to call twice (same promise); never rejects.
   */
  preload(onProgress?: PreloadProgress): Promise<void> {
    this.preloading ??= this.runPreload(onProgress).catch(() => { this.preloadCrashed = true; }).finally(() => { this.preloadSettled = true; });
    return this.preloading;
  }

  play(id: OneShotId, opts?: PlayOptions): SoundHandle | null { return (this.player ?? NULL_AUDIO_PLAYER).play(id, opts); }
  loop(id: LoopId, opts?: LoopOptions): LoopHandle { return (this.player ?? NULL_AUDIO_PLAYER).loop(id, opts); }
  duck(bus: SoundBus, amountDb: number, holdS: number, releaseS: number): void { this.player?.duck(bus, amountDb, holdS, releaseS); }
  setListener(listener: Listener): void { this.player?.setListener(listener); }

  /** Stop everything that is playing. The AudioManager (and its context) stays with its owner. */
  dispose(): void { this.player?.dispose(); }

  private async runPreload(onProgress: PreloadProgress | undefined): Promise<void> {
    const { samples, synth, player } = this;
    if (!samples || !synth || !player) return;
    const plan = planPreload(this.catalog);
    const total = plan.essentialSamples.length + plan.otherSamples.length + plan.recipes.length + 1;
    let done = 0;
    const tick = (): void => { onProgress?.(++done, total); };

    await samples.load(plan.essentialSamples, tick);
    this.essentialsLoaded = true;
    const others = samples.load(plan.otherSamples, tick);
    await synth.renderAll(plan.recipes, tick);
    await others;
    const impulse = await synth.renderImpulse();
    if (impulse) this.manager.setReverbImpulse(impulse);
    tick();
    player.refreshLoops();
  }
}
