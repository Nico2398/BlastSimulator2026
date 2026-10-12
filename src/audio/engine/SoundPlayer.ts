// BlastSimulator2026 — Sound player
// The AudioPlayer implementation on top of a live AudioContext: picks a variant,
// jitters pitch and level, places the sound in space, builds the voice graph
//   source -> [lowpass -> pan when positional] -> gain -> bus   (+ gain -> send -> reverb)
// and arbitrates cooldowns, voice caps and priorities through the VoiceBudget.

import type { LoopHandle, LoopOptions, Listener, PlayOptions, SoundHandle, WorldPoint } from '../AudioPlayer.js';
import { NULL_AUDIO_PLAYER, type AudioPlayer } from '../AudioPlayer.js';
import type { LoopId, OneShotId, SoundBus, SoundDefinition, SynthRecipeId } from '../SoundCatalog.js';
import type { Random } from '../../core/math/Random.js';
import { SPATIAL_CONFIG, VOICE_CONFIG } from '../../core/config/audio/engine.js';
import { LoopBed } from './LoopBed.js';
import { computeSpatial, type SpatialResult } from './spatial.js';
import { centsToRate, clamp, dbToGain } from './units.js';
import { Voice } from './Voice.js';
import { VoiceBudget, type VoiceTicket } from './VoiceBudget.js';

/** The slice of the AudioManager a player needs: where voices plug in, and ducking. */
export interface PlayerMixer {
  busInput(bus: SoundBus): AudioNode;
  reverbInput(bus: SoundBus): AudioNode;
  duck(bus: SoundBus, amountDb: number, holdS: number, releaseS: number): void;
}

/** Decoded audio by name: sample files and rendered synth variants. */
export interface BufferLibrary {
  sample(name: string): AudioBuffer | undefined;
  synth(recipe: SynthRecipeId): readonly AudioBuffer[];
}

interface SoundPlayerOptions {
  readonly context: AudioContext;
  readonly mixer: PlayerMixer;
  readonly library: BufferLibrary;
  readonly random: Random;
  readonly catalog: Readonly<Record<string, SoundDefinition>>;
  /** Millisecond clock for cooldowns (real time, never ticks). */
  readonly now: () => number;
  /** What `ready` reports. */
  readonly isReady: () => boolean;
}

interface Candidate {
  readonly key: string;
  readonly buffer: AudioBuffer;
}

interface VoiceShape {
  readonly candidate: Candidate;
  readonly def: SoundDefinition;
  readonly bus: SoundBus;
  readonly gain: number;
  readonly rate: number;
  readonly spatial: SpatialResult | null;
  readonly loop: boolean;
  readonly startAt: number;
  readonly offset: number;
}

interface Reservation {
  readonly ticket: VoiceTicket;
  /** Filled in once the voice exists, so a steal can reach it. */
  readonly slot: { voice: Voice | null };
}

export class SoundPlayer implements AudioPlayer {
  private readonly budget: VoiceBudget;
  private readonly voices = new Set<Voice>();
  private readonly beds = new Map<LoopId, LoopBed>();
  private readonly lastPicked = new Map<string, string>();
  private listener: Listener | null = null;
  /** Real-time stamp (ms) before which beds are not re-armed again. */
  private nextRearmAt = 0;

  constructor(private readonly o: SoundPlayerOptions) {
    this.budget = new VoiceBudget(VOICE_CONFIG.globalVoiceCap, o.now, VOICE_CONFIG.cooldownSweepThreshold);
  }

  get ready(): boolean { return this.o.isReady(); }

  /** Called every frame while a level runs, so it also paces the bed re-arm (cheap: one clock read between re-arms). */
  setListener(listener: Listener): void {
    this.listener = listener;
    this.rearmBeds();
  }

  duck(bus: SoundBus, amountDb: number, holdS: number, releaseS: number): void {
    this.o.mixer.duck(bus, amountDb, holdS, releaseS);
  }

  play(id: OneShotId, opts: PlayOptions = {}): SoundHandle | null {
    const def = this.o.catalog[id];
    if (!def || def.loop) return null;
    const candidates = this.candidates(def);
    if (candidates.length === 0) return null;
    const spatial = this.spatialFor(def, opts.at);
    if (spatial && !spatial.audible) return null;
    const reservation = this.reserve(id, def, opts.key ?? id);
    if (!reservation) return null;

    const pitchCents = clamp(this.jitter(def.pitchJitterCents) + (opts.pitchCents ?? 0), -VOICE_CONFIG.maxPitchCents, VOICE_CONFIG.maxPitchCents);
    const gainDb = def.gainDb + this.jitter(def.gainJitterDb) + (opts.gainDb ?? 0);
    const voice = this.build(reservation, {
      candidate: this.choose(id, candidates),
      def,
      bus: opts.bus ?? def.bus,
      gain: dbToGain(gainDb) * (spatial?.gain ?? 1),
      rate: centsToRate(pitchCents),
      spatial,
      loop: false,
      startAt: this.o.context.currentTime + Math.max(0, opts.delayS ?? 0),
      offset: 0,
    });
    return voice && { stop: (fadeS = VOICE_CONFIG.defaultStopFadeS) => voice.stop(fadeS) };
  }

  loop(id: LoopId, opts: LoopOptions = {}): LoopHandle {
    let bed = this.beds.get(id);
    if (!bed) {
      const def = this.o.catalog[id];
      if (!def?.loop) return NULL_AUDIO_PLAYER.loop(id);
      bed = new LoopBed({
        clock: this.o.context,
        start: () => this.startBed(id, def),
        trim: dbToGain(def.gainDb),
        defaultRampS: VOICE_CONFIG.defaultLoopRampS,
        minFadeOutS: VOICE_CONFIG.minLoopRampS,
      });
      this.beds.set(id, bed);
    }
    if (opts.level !== undefined) bed.setLevel(opts.level, opts.rampS);
    return bed;
  }

  /** Retry beds that wanted to play but have no voice: their buffers did not exist yet, or the voice was stolen. */
  refreshLoops(): void {
    for (const bed of this.beds.values()) bed.refresh();
  }

  /** Re-arm beds that want to play but lost their voice (stolen at the voice cap), at most once per re-arm interval. */
  private rearmBeds(): void {
    const now = this.o.now();
    if (now < this.nextRearmAt) return;
    this.nextRearmAt = now + VOICE_CONFIG.loopRearmIntervalMs;
    this.refreshLoops();
  }

  /** Silence everything that is playing. */
  dispose(): void {
    for (const voice of [...this.voices]) voice.stop(VOICE_CONFIG.defaultStopFadeS);
    this.beds.clear();
  }

  private startBed(id: LoopId, def: SoundDefinition): Voice | null {
    const candidates = this.candidates(def);
    if (candidates.length === 0) return null;
    const reservation = this.reserve(id, def, id);
    if (!reservation) return null;
    const candidate = this.choose(id, candidates);
    return this.build(reservation, {
      candidate,
      def,
      bus: def.bus,
      gain: 0,
      rate: 1,
      spatial: null,
      loop: true,
      startAt: this.o.context.currentTime,
      offset: this.o.random.next() * candidate.buffer.duration,
    });
  }

  private spatialFor(def: SoundDefinition, at: WorldPoint | undefined): SpatialResult | null {
    if (!at || !def.spatial || !this.listener) return null;
    return computeSpatial(this.listener, at);
  }

  private jitter(range: number | undefined): number {
    return range ? this.o.random.nextFloat(-range, range) : 0;
  }

  private candidates(def: SoundDefinition): Candidate[] {
    const { source } = def;
    if (source.kind === 'synth') {
      return this.o.library.synth(source.recipe).map((buffer, index) => ({ key: String(index), buffer }));
    }
    return source.files.flatMap((file) => {
      const buffer = this.o.library.sample(file);
      return buffer ? [{ key: file, buffer }] : [];
    });
  }

  /** A random candidate that differs from the previous pick whenever there is a choice. */
  private choose(id: string, candidates: readonly Candidate[]): Candidate {
    const last = this.lastPicked.get(id);
    const pool = candidates.length > 1 ? candidates.filter(c => c.key !== last) : candidates;
    const picked = pool.length > 1 ? pool[this.o.random.nextInt(0, pool.length - 1)] : pool[0];
    if (!picked) throw new Error('no candidate');
    this.lastPicked.set(id, picked.key);
    return picked;
  }

  private reserve(id: string, def: SoundDefinition, key: string): Reservation | null {
    const slot: Reservation['slot'] = { voice: null };
    const ticket = this.budget.acquire(
      {
        sound: id,
        key,
        cooldownMs: def.cooldownMs ?? 0,
        maxVoices: def.maxVoices ?? Infinity,
        priority: def.priority,
      },
      () => slot.voice?.stop(VOICE_CONFIG.stealFadeS),
    );
    return ticket ? { ticket, slot } : null;
  }

  private build({ ticket, slot }: Reservation, shape: VoiceShape): Voice | null {
    const ctx = this.o.context;
    const nodes: AudioNode[] = [];
    try {
      const source = ctx.createBufferSource();
      source.buffer = shape.candidate.buffer;
      source.playbackRate.value = shape.rate;
      source.loop = shape.loop;
      nodes.push(source);

      let head: AudioNode = source;
      if (shape.spatial) {
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = shape.spatial.lowpassHz;
        lowpass.Q.value = SPATIAL_CONFIG.lowpassQ;
        const pan = ctx.createStereoPanner();
        pan.pan.value = shape.spatial.pan;
        head.connect(lowpass);
        lowpass.connect(pan);
        head = pan;
        nodes.push(lowpass, pan);
      }
      const gain = ctx.createGain();
      gain.gain.value = shape.gain;
      head.connect(gain);
      gain.connect(this.o.mixer.busInput(shape.bus));
      nodes.push(gain);

      const send = shape.def.reverbSend ?? 0;
      if (send > 0) {
        const sendGain = ctx.createGain();
        sendGain.gain.value = send;
        gain.connect(sendGain);
        sendGain.connect(this.o.mixer.reverbInput(shape.bus));
        nodes.push(sendGain);
      }

      const voice = new Voice(ctx, {
        source,
        gain,
        nodes,
        ticket,
        onFinish: () => { this.voices.delete(voice); },
      }, VOICE_CONFIG.stopMarginS);
      if (shape.loop) source.start(shape.startAt, shape.offset);
      else source.start(shape.startAt);
      slot.voice = voice;
      this.voices.add(voice);
      return voice;
    } catch {
      ticket.release();
      for (const node of nodes) node.disconnect();
      return null;
    }
  }
}
