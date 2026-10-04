// BlastSimulator2026 — Audio Manager (11.1)
// Central audio system using Web Audio API.
// Categories: master, effects, ambient, ui.
// Designed so placeholder oscillator sounds can be replaced with audio files later.

import { AUDIO_DEFAULT_VOLUMES } from '../core/config/balance.js';

export type AudioCategory = 'effects' | 'ambient' | 'ui';

/** A volume slider target: the master bus or one category. */
export type VolumeChannel = 'master' | AudioCategory;

export interface SoundHandle {
  /** Stop the sound (for looping sounds). */
  stop(): void;
}

const NOOP_HANDLE: SoundHandle = { stop: () => undefined };

export class AudioManager {
  private readonly ctx: AudioContext;
  private readonly masterGain: GainNode;
  private readonly categoryGains: Record<AudioCategory, GainNode>;
  private muted = false;
  private volumes: Record<'master' | AudioCategory, number> = { ...AUDIO_DEFAULT_VOLUMES };

  constructor() {
    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.masterGain.gain.value = 1.0;

    this.categoryGains = {
      effects: this.ctx.createGain(),
      ambient: this.ctx.createGain(),
      ui: this.ctx.createGain(),
    };

    for (const cat of Object.keys(this.categoryGains) as AudioCategory[]) {
      this.categoryGains[cat].connect(this.masterGain);
      this.categoryGains[cat].gain.value = this.volumes[cat];
    }
  }

  /** Resume AudioContext if suspended (browsers require user gesture). */
  resume(): Promise<void> {
    return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve();
  }

  /** Get the raw AudioContext for use by Placeholder sounds. */
  getContext(): AudioContext { return this.ctx; }

  /** Get a category's output GainNode. */
  getCategoryGain(cat: AudioCategory): GainNode { return this.categoryGains[cat]; }

  /** Play a one-shot AudioBuffer on the given category. */
  playBuffer(buffer: AudioBuffer, category: AudioCategory, delayMs = 0): SoundHandle {
    if (this.muted) return NOOP_HANDLE;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.categoryGains[category]);
    const startTime = this.ctx.currentTime + delayMs / 1000;
    source.start(startTime);
    return { stop: () => { try { source.stop(); } catch { /* already stopped */ } } };
  }

  /** Start a looping AudioBuffer on the given category. Returns a handle to stop it. */
  playLooping(buffer: AudioBuffer, category: AudioCategory): SoundHandle {
    if (this.muted) return NOOP_HANDLE;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.categoryGains[category]);
    source.start();
    return { stop: () => { try { source.stop(); } catch { /* already stopped */ } } };
  }

  /** Set volume for a category or master (0–1). */
  setVolume(channel: 'master' | AudioCategory, value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.volumes[channel] = clamped;
    if (channel === 'master') {
      if (!this.muted) this.masterGain.gain.value = clamped;
    } else {
      if (!this.muted) this.categoryGains[channel].gain.value = clamped;
    }
  }

  /** Apply several stored volumes at once (0–1 each); absent channels keep their value. */
  applyVolumes(volumes: Partial<Record<VolumeChannel, number>>): void {
    for (const channel of Object.keys(volumes) as VolumeChannel[]) {
      const v = volumes[channel];
      if (v !== undefined) this.setVolume(channel, v);
    }
  }

  /** Get the current volume for a channel. */
  getVolume(channel: 'master' | AudioCategory): number { return this.volumes[channel]; }

  /** Toggle mute for all audio. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.masterGain.gain.value = muted ? 0 : this.volumes.master;
  }

  get isMuted(): boolean { return this.muted; }

  /** Dispose the AudioContext. */
  dispose(): void {
    void this.ctx.close();
  }
}
