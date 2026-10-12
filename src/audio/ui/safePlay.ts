// BlastSimulator2026 — Failure-proof playback
// Interface sounds ride on click handlers and command hooks; an audio fault must never break either.

import type { AudioPlayer, PlayOptions } from '../AudioPlayer.js';
import type { OneShotId } from '../SoundCatalog.js';

/**
 * A reporter that logs the first fault it is given and drops the rest. A fenced audio fault must not break the
 * click that triggered it, but it must not vanish either (a TypeError here would otherwise stay invisible to the
 * smoke test); once is enough, a fault on a click path repeats on every click.
 */
export function createFaultReporter(prefix: string): (error: unknown) => void {
  let reported = false;
  return error => {
    if (reported) return;
    reported = true;
    console.error(`[${prefix}] audio fault (further faults of this kind are not logged):`, error);
  };
}

const reportPlayFault = createFaultReporter('safePlay');

/** Play `id`, swallowing (and logging once) any error the player throws. */
export function safePlay(player: AudioPlayer, id: OneShotId, opts?: PlayOptions): void {
  try {
    player.play(id, opts);
  } catch (error) {
    reportPlayFault(error);
  }
}
