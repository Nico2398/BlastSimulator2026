// BlastSimulator2026 — Mix event dispatch
// Hands one mix event to an AudioPlayer, the same calls a director makes. Shared by
// the live lab scheduler and the offline render, so both exercise the same path.

import type { AudioPlayer, LoopHandle } from '../AudioPlayer.js';
import type { MixEvent } from './mixTypes.js';

/** What happened to an event: a play that the player dropped is the only interesting outcome. */
interface DispatchOutcome {
  /** Sound id of a one-shot, or the loop id; empty for a duck. */
  readonly id: string;
  /** True for a one-shot the player refused (cooldown, voice cap, budget, not loaded, out of earshot). */
  readonly dropped: boolean;
  readonly isPlay: boolean;
  /** The bed a loop event acted on. */
  readonly bed?: LoopHandle;
}

/** Issue `event` to `player`; `delayS` is how long from now the event's moment is (one-shots start then). */
export function dispatchMixEvent(player: AudioPlayer, event: MixEvent, delayS: number): DispatchOutcome {
  switch (event.kind) {
    case 'play': {
      const handle = player.play(event.id, { ...event.opts, delayS: Math.max(0, delayS) });
      return { id: event.id, dropped: handle === null, isPlay: true };
    }
    case 'loop': {
      const bed = player.loop(event.id);
      bed.setLevel(event.level, event.rampS);
      return { id: event.id, dropped: false, isPlay: false, bed };
    }
    case 'duck':
      player.duck(event.bus, event.amountDb, event.holdS, event.releaseS);
      return { id: '', dropped: false, isPlay: false };
  }
}

/** Counts of requested and dropped one-shots, by sound id. */
export class DispatchTally {
  requested = 0;
  private readonly droppedById = new Map<string, number>();

  record(outcome: DispatchOutcome): void {
    if (!outcome.isPlay) return;
    this.requested++;
    if (outcome.dropped) this.droppedById.set(outcome.id, (this.droppedById.get(outcome.id) ?? 0) + 1);
  }

  get dropped(): number {
    let total = 0;
    for (const count of this.droppedById.values()) total += count;
    return total;
  }

  /** Plain object for the JSON report. */
  droppedByIdRecord(): Record<string, number> {
    return Object.fromEntries([...this.droppedById.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  }
}
