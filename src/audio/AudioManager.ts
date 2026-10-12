// BlastSimulator2026 — Audio manager
// Owns the AudioContext and the mixing graph; knows nothing about individual
// sounds.
//
//   voice -> bus (user volume -> duck) -> master gain -> limiter -> destination
//   voice -> reverb send -> reverb bus (user volume -> duck) -> convolver -> return -> master gain
//
// Every bus has a dry lane and a wet lane so a volume slider or a duck affects
// a sound's reverb tail exactly as it affects the sound itself. Without Web
// Audio (no AudioContext, or its constructor throws) the manager still keeps the
// volumes and the mute flag, so the settings panel works; `context` is null.

import { AUDIO_DEFAULT_VOLUMES } from '../core/config/balance.js';
import { DUCK_CONFIG, MASTER_LIMITER_CONFIG, MIXER_CONFIG } from '../core/config/audio/engine.js';
import { jumpTo, smoothTo } from './engine/audioParams.js';
import { duckLevelAt, mergeDuck, NO_DUCK, scheduleDuck, type DuckState } from './engine/ducking.js';
import { clamp, dbToGain } from './engine/units.js';

export type AudioCategory = 'effects' | 'ambient' | 'ui' | 'music';

/** A volume slider target: the master bus or one category. */
export type VolumeChannel = 'master' | AudioCategory;

/** The part of `document` the manager listens to, so tests need no DOM. */
interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

interface AudioManagerOptions {
  /** Build the context; defaults to `new AudioContext()` when the browser has one. */
  readonly createContext?: () => AudioContext;
  /** Page visibility source; defaults to the global `document` when there is one. */
  readonly document?: VisibilitySource | null;
}

const CATEGORIES: readonly AudioCategory[] = ['effects', 'ambient', 'ui', 'music'];

/** Volume then duck: the two gain stages every bus lane runs through. */
interface BusLane {
  readonly user: GainNode;
  readonly duck: GainNode;
}

interface Graph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly convolver: ConvolverNode;
  readonly dry: Record<AudioCategory, BusLane>;
  readonly wet: Record<AudioCategory, BusLane>;
}

function defaultContext(): AudioContext | null {
  return typeof AudioContext === 'undefined' ? null : new AudioContext();
}

function defaultDocument(): VisibilitySource | null {
  return typeof document === 'undefined' ? null : document;
}

export class AudioManager {
  private readonly graph: Graph | null;
  private readonly page: VisibilitySource | null;
  private readonly volumes: Record<VolumeChannel, number> = { ...AUDIO_DEFAULT_VOLUMES };
  private readonly ducks: Record<AudioCategory, DuckState> = { effects: NO_DUCK, ambient: NO_DUCK, ui: NO_DUCK, music: NO_DUCK };
  private muted = false;
  /** The context was running when the page was hidden, so it should run again when shown. */
  private resumeWhenVisible = false;
  private readonly onVisibility = (): void => this.handleVisibility();

  constructor(options: AudioManagerOptions = {}) {
    this.graph = this.buildGraph(options.createContext);
    this.page = options.document === undefined ? defaultDocument() : options.document;
    if (this.graph) this.page?.addEventListener('visibilitychange', this.onVisibility);
  }

  /** The Web Audio context, or null when the browser has none. */
  get context(): AudioContext | null { return this.graph?.ctx ?? null; }

  get isMuted(): boolean { return this.muted; }

  /** Where a voice of `bus` connects. Only valid while `context` is non-null. */
  busInput(bus: AudioCategory): AudioNode { return this.requireGraph().dry[bus].user; }

  /** Where a voice's reverb send connects; follows the same bus volume and ducking as `busInput`. */
  reverbInput(bus: AudioCategory = 'effects'): AudioNode { return this.requireGraph().wet[bus].user; }

  /** Install the shared reverb's impulse response (decoded stereo buffer). */
  setReverbImpulse(buffer: AudioBuffer): void {
    if (!this.graph) return;
    try {
      this.graph.convolver.buffer = buffer;
    } catch {
      // an unsupported impulse leaves the reverb silent rather than the game broken
    }
  }

  /** Pull `bus` down by `amountDb` (negative), hold, then release exponentially. The deeper of overlapping ducks wins. */
  duck(bus: AudioCategory, amountDb: number, holdS: number, releaseS: number): void {
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    const timeConstants = DUCK_CONFIG.releaseTimeConstants;
    const previous = this.ducks[bus];
    const previousLevel = duckLevelAt(previous, now, timeConstants);
    const target = dbToGain(clamp(amountDb, DUCK_CONFIG.maxDepthDb, 0));
    if (target >= 1 && previousLevel >= 1) return;
    const next = mergeDuck(previous, now, target, Math.max(holdS, 0), Math.max(releaseS, 0), DUCK_CONFIG.attackS, timeConstants);
    this.ducks[bus] = next;
    for (const lane of [g.dry[bus], g.wet[bus]]) {
      scheduleDuck(lane.duck.gain, previousLevel, next, now, DUCK_CONFIG.attackS, timeConstants);
    }
  }

  /** Start (or restart) audio. Browsers only honour this inside a user gesture; never wait on it. */
  resume(): Promise<void> {
    const g = this.graph;
    if (!g) return Promise.resolve();
    if (this.page?.hidden) {
      this.resumeWhenVisible = true;
      return Promise.resolve();
    }
    return g.ctx.state === 'running' ? Promise.resolve() : g.ctx.resume().catch(() => undefined);
  }

  /** Pause the audio clock; scheduled sounds wait. */
  suspend(): void {
    const g = this.graph;
    if (!g) return;
    this.resumeWhenVisible = false;
    if (g.ctx.state === 'running') void g.ctx.suspend().catch(() => undefined);
  }

  /** Set volume for a channel (0–1, clamped). Applied smoothly; the master is held at zero while muted. */
  setVolume(channel: VolumeChannel, value: number): void {
    if (Number.isNaN(value)) return;
    const clamped = clamp(value, 0, 1);
    this.volumes[channel] = clamped;
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    if (channel === 'master') {
      if (!this.muted) smoothTo(g.master.gain, clamped, now, MIXER_CONFIG.volumeSmoothS);
      return;
    }
    smoothTo(g.dry[channel].user.gain, clamped, now, MIXER_CONFIG.volumeSmoothS);
    smoothTo(g.wet[channel].user.gain, clamped, now, MIXER_CONFIG.volumeSmoothS);
  }

  /** Apply several stored volumes at once (0–1 each); absent channels keep their value. */
  applyVolumes(volumes: Partial<Record<VolumeChannel, number>>): void {
    for (const channel of Object.keys(volumes) as VolumeChannel[]) {
      const v = volumes[channel];
      if (v !== undefined) this.setVolume(channel, v);
    }
  }

  getVolume(channel: VolumeChannel): number { return this.volumes[channel]; }

  /** Mute silences the output at once; unmuting returns to the master volume smoothly. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    if (muted) jumpTo(g.master.gain, 0, now);
    else smoothTo(g.master.gain, this.volumes.master, now, MIXER_CONFIG.volumeSmoothS);
  }

  /** Close the context for good. */
  dispose(): void {
    this.page?.removeEventListener('visibilitychange', this.onVisibility);
    void this.graph?.ctx.close().catch(() => undefined);
  }

  private requireGraph(): Graph {
    if (!this.graph) throw new Error('AudioManager has no Web Audio context');
    return this.graph;
  }

  private handleVisibility(): void {
    const g = this.graph;
    if (!g || !this.page) return;
    if (this.page.hidden) {
      this.resumeWhenVisible = g.ctx.state === 'running';
      if (this.resumeWhenVisible) void g.ctx.suspend().catch(() => undefined);
    } else if (this.resumeWhenVisible) {
      this.resumeWhenVisible = false;
      void g.ctx.resume().catch(() => undefined);
    }
  }

  private buildGraph(createContext: (() => AudioContext) | undefined): Graph | null {
    let ctx: AudioContext | null;
    try {
      ctx = createContext ? createContext() : defaultContext();
    } catch {
      return null;
    }
    if (!ctx) return null;

    const master = ctx.createGain();
    master.gain.value = this.volumes.master;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = MASTER_LIMITER_CONFIG.thresholdDb;
    limiter.knee.value = MASTER_LIMITER_CONFIG.kneeDb;
    limiter.ratio.value = MASTER_LIMITER_CONFIG.ratio;
    limiter.attack.value = MASTER_LIMITER_CONFIG.attackS;
    limiter.release.value = MASTER_LIMITER_CONFIG.releaseS;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    const convolver = ctx.createConvolver();
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = MIXER_CONFIG.reverbReturnGain;
    convolver.connect(reverbReturn);
    reverbReturn.connect(master);

    const lane = (target: AudioNode, volume: number): BusLane => {
      const user = ctx.createGain();
      user.gain.value = volume;
      const duck = ctx.createGain();
      user.connect(duck);
      duck.connect(target);
      return { user, duck };
    };
    const dry = {} as Record<AudioCategory, BusLane>;
    const wet = {} as Record<AudioCategory, BusLane>;
    for (const category of CATEGORIES) {
      dry[category] = lane(master, this.volumes[category]);
      wet[category] = lane(convolver, this.volumes[category]);
    }
    return { ctx, master, convolver, dry, wet };
  }
}
