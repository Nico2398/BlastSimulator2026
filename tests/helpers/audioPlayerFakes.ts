// BlastSimulator2026 — The recording AudioPlayer used by every audio test that needs to see what was asked
// Captures plays (with their options, handle and clock stamp), beds with each level they were driven to,
// ducks and listeners, with no AudioContext. It can refuse a play or throw on one to prove callers survive.

import type { AudioPlayer, Listener, LoopHandle, LoopOptions, PlayOptions, SoundHandle } from '../../src/audio/AudioPlayer.js';
import type { LoopId, OneShotId, SoundBus } from '../../src/audio/SoundCatalog.js';

export interface PlayRecord {
  readonly id: OneShotId;
  /** The options with `{}` standing in for none, so a test can read a field without checking for undefined. */
  readonly opts: PlayOptions;
  /** The options exactly as passed: `undefined` when the caller sent none. */
  readonly passed: PlayOptions | undefined;
  readonly handle: RecordedHandle;
  /** Real clock time of the call, to check what was scheduled when. */
  readonly atS: number;
}

export interface DuckRecord {
  readonly bus: SoundBus;
  readonly amountDb: number;
  readonly holdS: number;
  readonly releaseS: number;
}

export interface LevelRecord {
  readonly level: number;
  readonly rampS: number | undefined;
}

export class RecordedHandle implements SoundHandle {
  readonly stops: Array<number | undefined> = [];
  stop(fadeS?: number): void {
    this.stops.push(fadeS);
  }
  get stopped(): boolean {
    return this.stops.length > 0;
  }
}

/** A bed's handle: every level sent to it in order, a stop being a send of level 0. */
export class RecordedLoop implements LoopHandle {
  readonly calls: LevelRecord[] = [];
  setLevel(level: number, rampS?: number): void {
    this.calls.push({ level, rampS });
  }
  stop(fadeS?: number): void {
    this.setLevel(0, fadeS);
  }
  /** The last level sent; a bed nobody drove is silent. */
  get level(): number {
    return this.calls[this.calls.length - 1]?.level ?? 0;
  }
}

export class RecordingPlayer implements AudioPlayer {
  ready = true;
  readonly plays: PlayRecord[] = [];
  readonly ducks: DuckRecord[] = [];
  readonly loops = new Map<LoopId, RecordedLoop>();
  readonly listeners: Listener[] = [];
  /** Ids this player refuses: play() records the request, then returns null. */
  readonly refuse = new Set<string>();
  /** Make play() throw before recording, to prove callers survive an audio fault. */
  throwOnPlay = false;
  /** Clock stamped on each play, set by tests. */
  now = (): number => 0;

  play(id: OneShotId, opts?: PlayOptions): SoundHandle | null {
    if (this.throwOnPlay) throw new Error('audio fault');
    const handle = new RecordedHandle();
    this.plays.push({ id, opts: opts ?? {}, passed: opts, handle, atS: this.now() });
    return this.refuse.has(id) ? null : handle;
  }

  /** One handle per bed id, so a test reads the whole history of a bed whoever asked for it. */
  loop(id: LoopId, opts: LoopOptions = {}): LoopHandle {
    const loop = this.bed(id);
    if (opts.level !== undefined) loop.setLevel(opts.level, opts.rampS);
    return loop;
  }

  duck(bus: SoundBus, amountDb: number, holdS: number, releaseS: number): void {
    this.ducks.push({ bus, amountDb, holdS, releaseS });
  }

  setListener(listener: Listener): void {
    this.listeners.push(listener);
  }

  /** Ids played, in order. */
  get ids(): OneShotId[] {
    return this.plays.map(p => p.id);
  }

  /** Each play as the caller sent it: the id and the options it passed, `undefined` for none. */
  get calls(): Array<{ id: OneShotId; opts: PlayOptions | undefined }> {
    return this.plays.map(p => ({ id: p.id, opts: p.passed }));
  }

  of(id: OneShotId): PlayRecord[] {
    return this.plays.filter(p => p.id === id);
  }

  /** The bed's recorder, created on first ask. */
  bed(id: LoopId): RecordedLoop {
    let loop = this.loops.get(id);
    if (!loop) {
      loop = new RecordedLoop();
      this.loops.set(id, loop);
    }
    return loop;
  }

  /** The last level sent to the bed, or undefined when it was never driven. */
  lastLevel(id: LoopId): number | undefined {
    return this.loops.get(id)?.calls.at(-1)?.level;
  }

  clear(): void {
    this.plays.length = 0;
    this.ducks.length = 0;
  }
}
