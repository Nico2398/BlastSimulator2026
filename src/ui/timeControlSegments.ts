// BlastSimulator2026 — Which time-control segment is lit (pause or a speed).

type TimeSegment = 'pause' | 1 | 2 | 4 | 8;

/** Segment to highlight for the given clock state, or null when none matches. */
export function activeTimeSegment(timeScale: number, isPaused: boolean): TimeSegment | null {
  if (isPaused) return 'pause';
  return timeScale === 1 || timeScale === 2 || timeScale === 4 || timeScale === 8 ? timeScale : null;
}
