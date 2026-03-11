// BlastSimulator2026 — Detonation sequence
// Assigns timing delays to each hole in a drill plan.

import type { DrillHole } from './DrillPlan.js';

/** Set a delay for a specific hole. */
export function setDelay(
  delays: Record<string, number>,
  holeId: string,
  delayMs: number,
): void {
  delays[holeId] = delayMs;
}

/**
 * Auto-generate a V-pattern sequence from the free face.
 * The free face is assumed to be at the minimum Z row.
 * Holes closer to the free face detonate first.
 * Within the same row, center holes fire before edges (V shape).
 */
export function autoVPattern(
  holes: readonly DrillHole[],
  delayStepMs: number,
): Record<string, number> {
  if (holes.length === 0) return {};

  // Group holes by row (z coordinate)
  const rows = new Map<number, DrillHole[]>();
  for (const hole of holes) {
    const row = rows.get(hole.z) ?? [];
    row.push(hole);
    rows.set(hole.z, row);
  }

  // Sort rows by z (ascending = closest to free face first)
  const sortedZs = [...rows.keys()].sort((a, b) => a - b);

  const delays: Record<string, number> = {};
  let rowDelay = 0;

  for (const z of sortedZs) {
    const row = rows.get(z)!;
    // Sort by x, find center
    row.sort((a, b) => a.x - b.x);
    const centerX = (row[0]!.x + row[row.length - 1]!.x) / 2;

    // Within row: center first, edges later (V pattern)
    const withDist = row.map(h => ({
      hole: h,
      distFromCenter: Math.abs(h.x - centerX),
    }));
    withDist.sort((a, b) => a.distFromCenter - b.distFromCenter);

    let intraDelay = 0;
    for (const { hole } of withDist) {
      delays[hole.id] = rowDelay + intraDelay;
      intraDelay += delayStepMs;
    }

    rowDelay += delayStepMs * row.length;
  }

  return delays;
}
