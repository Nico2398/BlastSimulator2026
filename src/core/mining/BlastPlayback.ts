/** Read-only view of the renderer's blast collapse playback, in rendered seconds. */
export interface BlastPlaybackSnapshot {
  readonly elapsedS: number;
  readonly durationS: number;
  readonly isPlaying: boolean;
}

/** Snapshot for "no playback running" (headless, no blast yet). */
export const IDLE_BLAST_PLAYBACK: BlastPlaybackSnapshot = { elapsedS: 0, durationS: 0, isPlaying: false };

/** True once playback has stopped and has rendered at least `floorS` seconds. */
export function isBlastPlaybackComplete(_playback: BlastPlaybackSnapshot, _floorS: number): boolean {
  // TODO: implement
  return false;
}
