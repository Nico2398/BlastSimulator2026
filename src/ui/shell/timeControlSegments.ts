// BlastSimulator2026 — Which time-control segment is lit (pause or a speed).

export type TimeSegment = 'pause' | 1 | 2 | 4 | 8;

/** Segment to highlight for the given clock state, or null when none matches. */
export function activeTimeSegment(_timeScale: number, _isPaused: boolean): TimeSegment | null {
  // TODO: implement
  return null;
}
