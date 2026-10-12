// BlastSimulator2026 — Play log
// A decorator that records every sound the game asks its AudioPlayer for, then delegates untouched. Nobody can
// listen in a test run, so the browser smoke test (scripts/audio-smoke.ts) reads this log to prove the wiring:
// which cue the real UI clicks produce, which cues a scripted game intends. It also works on top of
// NULL_AUDIO_PLAYER, where nothing plays but the director and interface layers still call it.

import type { AudioPlayer, LoopHandle, LoopOptions, PlayOptions, SoundHandle, WorldPoint, Listener } from '../AudioPlayer.js';
import type { LoopId, OneShotId, SoundBus } from '../SoundCatalog.js';

type PlayRecordKind = 'play' | 'loop' | 'level' | 'duck';

/** One request to the player; plain data, so it survives JSON and Puppeteer's evaluate. */
export interface PlayRecord {
  /** Milliseconds since the log was created. */
  readonly atMs: number;
  readonly kind: PlayRecordKind;
  /** The sound id; for a duck, the bus being ducked. */
  readonly id: string;
  readonly bus?: SoundBus;
  readonly at?: WorldPoint;
  /** Level offset of a play, or the depth of a duck. */
  readonly gainDb?: number;
  readonly delayS?: number;
  readonly key?: string;
  /** Bed level of a loop request or a `setLevel` call. */
  readonly level?: number;
  /** The player refused a play (cooldown, voice budget, not loaded, null player). */
  readonly dropped?: true;
}

interface PlayLog {
  /** Oldest first; the same array for the life of the log, trimmed in place. */
  readonly records: PlayRecord[];
  push(record: PlayRecord): void;
  /** Milliseconds since the log was created. */
  elapsedMs(): number;
}

/** A log that keeps the newest `capacity` records. */
export function createPlayLog(capacity: number, now: () => number): PlayLog {
  const origin = now();
  const records: PlayRecord[] = [];
  return {
    records,
    push(record) {
      records.push(record);
      if (records.length > capacity) records.splice(0, records.length - capacity);
    },
    elapsedMs: () => Math.round(now() - origin),
  };
}

/** Only the defined options become fields: absent ones stay absent in the JSON. */
function playFields(opts: PlayOptions | undefined): Partial<Omit<PlayRecord, 'atMs' | 'kind' | 'id'>> {
  if (opts === undefined) return {};
  return {
    ...(opts.bus !== undefined && { bus: opts.bus }),
    ...(opts.at !== undefined && { at: { x: opts.at.x, z: opts.at.z } }),
    ...(opts.gainDb !== undefined && { gainDb: opts.gainDb }),
    ...(opts.delayS !== undefined && { delayS: opts.delayS }),
    ...(opts.key !== undefined && { key: opts.key }),
  };
}

function recordedHandle(log: PlayLog, id: string, inner: LoopHandle): LoopHandle {
  let lastLevel: number | undefined;
  return {
    stop: fadeS => { inner.stop(fadeS); },
    setLevel(level, rampS) {
      // A director may restate its level every frame; only a change is an event.
      if (level !== lastLevel) {
        lastLevel = level;
        log.push({ atMs: log.elapsedMs(), kind: 'level', id, level });
      }
      inner.setLevel(level, rampS);
    },
  };
}

/** Wrap `inner` so every play, loop, level change and duck lands in `log`. Listener updates are not recorded. */
export function recordAudioPlayer(inner: AudioPlayer, log: PlayLog): AudioPlayer {
  return {
    get ready() { return inner.ready; },
    play(id: OneShotId, opts?: PlayOptions): SoundHandle | null {
      const handle = inner.play(id, opts);
      log.push({ atMs: log.elapsedMs(), kind: 'play', id, ...playFields(opts), ...(handle === null && { dropped: true as const }) });
      return handle;
    },
    loop(id: LoopId, opts?: LoopOptions): LoopHandle {
      const handle = inner.loop(id, opts);
      log.push({ atMs: log.elapsedMs(), kind: 'loop', id, ...(opts?.level !== undefined && { level: opts.level }) });
      return recordedHandle(log, id, handle);
    },
    duck(bus: SoundBus, amountDb: number, holdS: number, releaseS: number): void {
      inner.duck(bus, amountDb, holdS, releaseS);
      log.push({ atMs: log.elapsedMs(), kind: 'duck', id: bus, bus, gainDb: amountDb });
    },
    setListener(listener: Listener): void { inner.setListener(listener); },
  };
}
