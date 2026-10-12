// BlastSimulator2026 — Failure-proof playback
// Interface sounds ride on click handlers and command hooks; an audio fault must never break either.

import type { AudioPlayer, PlayOptions } from '../AudioPlayer.js';
import type { OneShotId } from '../SoundCatalog.js';

/** Play `id`, swallowing any error the player throws. */
export function safePlay(player: AudioPlayer, id: OneShotId, opts?: PlayOptions): void {
  try {
    player.play(id, opts);
  } catch {
    // Sound is decoration: a failed play is dropped, never surfaced.
  }
}
