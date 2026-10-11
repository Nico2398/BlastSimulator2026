import type { BlastReport } from './BlastExecution.js';

/** Read-only view of the renderer's blast collapse playback, in rendered seconds. */
export interface BlastPlaybackSnapshot {
  /**
   * The report of the blast being played, null before any blast. A blast's
   * report reaches the state before the renderer starts playing it — a sliced
   * blast writes it frames ahead of its landing (#1603) — so a consumer waiting
   * on a report's own playback checks this first: until it matches, the
   * clock and `isPlaying` still describe the previous blast.
   */
  readonly report: BlastReport | null;
  readonly elapsedS: number;
  readonly durationS: number;
  readonly isPlaying: boolean;
}

/** Snapshot for "no playback running" (headless, no blast yet). */
export const IDLE_BLAST_PLAYBACK: BlastPlaybackSnapshot = { report: null, elapsedS: 0, durationS: 0, isPlaying: false };

/**
 * True once `report`'s own blast has played long enough for its report to
 * cover the scene: every fragment has come to rest and at least `minS` seconds
 * have been rendered, or `maxS` seconds have been rendered whatever is still
 * moving. A playback of any other blast — the previous one, or none yet — is
 * never due, however long it has run.
 */
export function isBlastReportDue(
  playback: BlastPlaybackSnapshot,
  report: BlastReport,
  minS: number,
  maxS: number,
): boolean {
  if (playback.report !== report) return false;
  return playback.elapsedS >= maxS || (!playback.isPlaying && playback.elapsedS >= minS);
}
