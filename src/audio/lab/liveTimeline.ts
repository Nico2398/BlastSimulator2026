// BlastSimulator2026 — Live timeline runner
// Plays a mix scenario (or a stretch of one) in real time on the lab page: each
// `update` books the events that start within the next step on the audio clock,
// like a director does with its lookahead. Loop events that start beds are undone
// on stop, so a scenario never leaves a bed running.

import type { AudioPlayer, LoopHandle } from '../AudioPlayer.js';
import type { LoopId } from '../SoundCatalog.js';
import { dispatchMixEvent, DispatchTally } from './mixDispatch.js';
import type { MixEvent } from './mixTypes.js';
import { TimelineCursor } from './timeline.js';

interface LiveTimelineOptions {
  readonly player: AudioPlayer;
  readonly events: readonly MixEvent[];
  /** The run ends this long after it started (s); events beyond are ignored. */
  readonly durationS: number;
  /** Events are booked this far ahead of their moment (s). */
  readonly lookaheadS: number;
  /** Beds fade out over this long when the run ends (s). */
  readonly releaseS: number;
  readonly onFinished?: () => void;
}

export class LiveTimeline {
  private readonly cursor: TimelineCursor;
  private readonly beds = new Map<LoopId, LoopHandle>();
  private startedAtS: number | null = null;
  readonly tally = new DispatchTally();

  constructor(private readonly o: LiveTimelineOptions) {
    this.cursor = new TimelineCursor(o.events.filter(event => event.t < o.durationS));
  }

  get running(): boolean { return this.startedAtS !== null; }

  /** Begin at wall-clock `nowS` (seconds, any monotonic clock). */
  start(nowS: number): void {
    this.startedAtS = nowS;
    this.update(nowS);
  }

  /** Book what is due; call every step with the same clock as `start`. Ends the run when the duration is over. */
  update(nowS: number): void {
    if (this.startedAtS === null) return;
    const elapsed = nowS - this.startedAtS;
    for (const event of this.cursor.take(elapsed + this.o.lookaheadS)) {
      const outcome = dispatchMixEvent(this.o.player, event, event.t - elapsed);
      this.tally.record(outcome);
      if (event.kind === 'loop' && outcome.bed) this.beds.set(event.id, outcome.bed);
    }
    if (elapsed >= this.o.durationS) this.finish();
  }

  /** Stop now: beds fade out, nothing more is booked. */
  stop(): void {
    if (this.startedAtS !== null) this.finish();
  }

  private finish(): void {
    this.startedAtS = null;
    for (const bed of this.beds.values()) bed.setLevel(0, this.o.releaseS);
    this.beds.clear();
    this.o.onFinished?.();
  }
}
