// BlastSimulator2026 — Music player
// Streams one track per HTMLAudioElement through the 'music' bus and crossfades
// between them. Fades are scheduled on the audio clock, so a frame hitch never
// bends them; the only per-frame work is retiring elements whose fade-out has
// ended. Nothing is created until a track is requested, and nothing here throws
// into the game: a blocked or failing element just stays silent.

import { MUSIC_CONFIG, type MusicConfig } from '../../core/config/audio/music.js';
import { jumpTo } from '../engine/audioParams.js';
import { dbToGain } from '../engine/units.js';
import { fadeLevelAt, scheduleFade, type Fade } from './fadeCurve.js';
import type { MusicTrack } from './MusicCatalog.js';

/** The part of the audio manager the player needs; `AudioManager` satisfies it. */
export interface MusicOutput {
  readonly context: AudioContext | null;
  busInput(bus: 'music'): AudioNode;
  duck(bus: 'music', amountDb: number, holdS: number, releaseS: number): void;
}

/** What the director asks of a player. */
export interface MusicPlayback {
  /** Crossfade to `track`; `null` fades to silence. The track already selected is left alone. */
  setTrack(track: MusicTrack | null): void;
  /** Retry playback the browser blocked before the first user gesture. */
  unlock(): void;
  /** Retire finished fade-outs; call once per frame. */
  tick(): void;
  dispose(): void;
}

export interface MusicPlayerOptions {
  readonly createElement?: (url: string) => HTMLAudioElement;
  /** Seconds on the clock fades are scheduled against; defaults to the audio context's. */
  readonly clock?: () => number;
  readonly config?: MusicConfig;
}

interface Voice {
  readonly trackId: string;
  readonly element: HTMLAudioElement;
  readonly source: MediaElementAudioSourceNode;
  readonly gain: GainNode;
  /** Gain once faded in. */
  readonly level: number;
  /** Gain while no fade runs. */
  held: number;
  fade: Fade | null;
  /** `play()` was refused and has not been retried yet. */
  blocked: boolean;
}

const defaultCreateElement = (url: string): HTMLAudioElement => new Audio(url);

export class MusicPlayer implements MusicPlayback {
  private readonly createElement: (url: string) => HTMLAudioElement;
  private readonly clock: () => number;
  private readonly config: MusicConfig;
  private current: Voice | null = null;
  private readonly fadingOut: Voice[] = [];
  private disposed = false;

  constructor(private readonly output: MusicOutput, options: MusicPlayerOptions = {}) {
    this.createElement = options.createElement ?? defaultCreateElement;
    this.clock = options.clock ?? (() => this.output.context?.currentTime ?? 0);
    this.config = options.config ?? MUSIC_CONFIG;
  }

  setTrack(track: MusicTrack | null): void {
    if (this.disposed || !this.output.context) return;
    if ((track?.id ?? null) === (this.current?.trackId ?? null)) return;
    const outgoing = this.current;
    this.current = null;
    if (outgoing) this.retire(outgoing, track ? this.config.crossfadeS : this.config.fadeOutS);
    if (track) this.current = this.start(track, this.output.context, outgoing ? this.config.crossfadeS : this.config.fadeInS);
  }

  unlock(): void {
    if (this.current?.blocked) this.play(this.current);
  }

  tick(): void {
    if (this.fadingOut.length === 0) return;
    const now = this.clock();
    for (let i = this.fadingOut.length - 1; i >= 0; i--) {
      const voice = this.fadingOut[i]!;
      if (!voice.fade || now >= voice.fade.startS + voice.fade.durationS) {
        this.fadingOut.splice(i, 1);
        this.release(voice);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.current) this.release(this.current);
    this.current = null;
    for (const voice of this.fadingOut) this.release(voice);
    this.fadingOut.length = 0;
  }

  private start(track: MusicTrack, ctx: AudioContext, fadeS: number): Voice | null {
    let element: HTMLAudioElement | null = null;
    try {
      element = this.createElement(`${this.config.assetBase}${track.file}${this.config.fileExtension}`);
      element.loop = track.loop ?? true;
      element.preload = 'auto';
      const source = ctx.createMediaElementSource(element);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.output.busInput('music'));
      const voice: Voice = { trackId: track.id, element, source, gain, level: dbToGain(track.gainDb ?? 0), held: 0, fade: null, blocked: false };
      this.fadeTo(voice, voice.level, fadeS);
      this.play(voice);
      return voice;
    } catch {
      element?.pause();
      return null;
    }
  }

  private play(voice: Voice): void {
    voice.blocked = false;
    voice.element.play().catch(() => {
      voice.blocked = true;
    });
  }

  private fadeTo(voice: Voice, to: number, durationS: number): void {
    const startS = this.clock();
    const from = voice.fade ? fadeLevelAt(voice.fade, startS) : voice.held;
    if (durationS <= 0) {
      voice.fade = null;
      voice.held = to;
      jumpTo(voice.gain.gain, to, startS);
      return;
    }
    voice.fade = { from, to, startS, durationS };
    scheduleFade(voice.gain.gain, voice.fade, this.config.curvePoints);
  }

  private retire(voice: Voice, durationS: number): void {
    if (voice.blocked) {
      this.release(voice);
      return;
    }
    this.fadeTo(voice, 0, durationS);
    this.fadingOut.push(voice);
  }

  private release(voice: Voice): void {
    voice.blocked = false;
    voice.element.pause();
    voice.element.removeAttribute('src');
    voice.element.load();
    voice.source.disconnect();
    voice.gain.disconnect();
  }
}
