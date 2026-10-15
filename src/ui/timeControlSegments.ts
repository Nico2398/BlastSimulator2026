// BlastSimulator2026 — Which time-control segment is lit (pause or a speed).

import { isValidSpeed, type SpeedMultiplier } from '../core/engine/GameLoop.js';

type TimeSegment = 'pause' | SpeedMultiplier;

/** Segment to highlight for the given clock state, or null when none matches. */
export function activeTimeSegment(timeScale: number, isPaused: boolean): TimeSegment | null {
  if (isPaused) return 'pause';
  return isValidSpeed(timeScale) ? timeScale : null;
}
