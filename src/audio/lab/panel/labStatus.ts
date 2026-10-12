// BlastSimulator2026 — Lab status line
// What the page header says about the live audio: context state, engine readiness,
// sounds playing and how the asset load went.

export interface LabStatus {
  readonly contextState: string;
  readonly ready: boolean;
  readonly voices: number;
  readonly peakVoices: number;
  /** Assets decoded or rendered so far, and how many were expected. */
  readonly loaded: number;
  readonly expected: number;
  readonly failed: readonly string[];
}

export function formatStatus(status: LabStatus): string {
  const assets = `${status.loaded}/${status.expected} assets loaded`;
  const failures = status.failed.length > 0 ? `, ${status.failed.length} FAILED` : '';
  return [
    `context: ${status.contextState}`,
    `engine: ${status.ready ? 'ready' : 'loading'}`,
    `voices: ${status.voices} (peak ${status.peakVoices})`,
    `${assets}${failures}`,
  ].join(' · ');
}
