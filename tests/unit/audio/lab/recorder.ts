// BlastSimulator2026 — Recording player for the lab tests
// An AudioPlayer that writes down every call, can refuse plays, and gives out
// loop handles whose levels can be read back.

import type { AudioPlayer, Listener, LoopHandle, LoopOptions, PlayOptions, SoundHandle } from '../../../../src/audio/AudioPlayer.js';
import type { LoopId, OneShotId, SoundBus } from '../../../../src/audio/SoundCatalog.js';

export interface RecordedPlay {
  readonly id: OneShotId;
  readonly opts: PlayOptions | undefined;
}

export interface RecordedLevel {
  readonly level: number;
  readonly rampS: number | undefined;
}

export class LabRecorder implements AudioPlayer {
  ready = true;
  readonly plays: RecordedPlay[] = [];
  readonly ducks: Array<{ bus: SoundBus; amountDb: number; holdS: number; releaseS: number }> = [];
  readonly levels = new Map<LoopId, RecordedLevel[]>();
  readonly listeners: Listener[] = [];
  /** Ids this player refuses (play returns null). */
  readonly refuse = new Set<string>();

  play(id: OneShotId, opts?: PlayOptions): SoundHandle | null {
    this.plays.push({ id, opts });
    return this.refuse.has(id) ? null : { stop: () => undefined };
  }

  loop(id: LoopId, opts?: LoopOptions): LoopHandle {
    const log = this.levels.get(id) ?? [];
    this.levels.set(id, log);
    if (opts?.level !== undefined) log.push({ level: opts.level, rampS: opts.rampS });
    return {
      stop: () => { log.push({ level: 0, rampS: undefined }); },
      setLevel: (level, rampS) => { log.push({ level, rampS }); },
    };
  }

  duck(bus: SoundBus, amountDb: number, holdS: number, releaseS: number): void {
    this.ducks.push({ bus, amountDb, holdS, releaseS });
  }

  setListener(listener: Listener): void {
    this.listeners.push(listener);
  }

  lastLevel(id: LoopId): number | undefined {
    return this.levels.get(id)?.at(-1)?.level;
  }
}
