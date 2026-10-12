// BlastSimulator2026 — Recording AudioPlayer for interface-sound tests
// Captures every play() so tests assert on what a director asked for, with no AudioContext.

import type { AudioPlayer, LoopHandle, PlayOptions } from '../../../../src/audio/AudioPlayer.js';
import type { OneShotId } from '../../../../src/audio/SoundCatalog.js';

export interface PlayCall {
  readonly id: OneShotId;
  readonly opts: PlayOptions | undefined;
}

export class RecordingPlayer implements AudioPlayer {
  readonly ready = true;
  readonly calls: PlayCall[] = [];
  /** Make play() throw, to prove callers survive an audio fault. */
  throwOnPlay = false;

  play(id: OneShotId, opts?: PlayOptions): null {
    if (this.throwOnPlay) throw new Error('audio fault');
    this.calls.push({ id, opts });
    return null;
  }

  loop(): LoopHandle {
    return { stop: () => undefined, setLevel: () => undefined };
  }

  duck(): void {}
  setListener(): void {}

  get ids(): OneShotId[] { return this.calls.map(c => c.id); }

  clear(): void { this.calls.length = 0; }
}
