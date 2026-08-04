// BlastSimulator2026 — What the muck pile looks like once a blast has settled
//
// The blast pipeline decides everything at detonation, which means the pile it
// leaves behind is inspectable without a renderer. This turns the fragment list
// into the handful of readings that say whether a blast worked: how big the rock
// is, how hard it was thrown, and — the one a picture makes obvious and a test
// otherwise cannot see — whether any of it came to rest in mid-air.
//
// Used by the state bridges in src/main.ts and src/console-api.ts so a browser
// harness and a headless run read the same numbers.

import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../world/VoxelGrid.js';
import { FLOATING_FRAGMENT_CLEARANCE } from '../config/balance.js';
import type { FragmentData } from './BlastExecution.js';

export interface Spread {
  min: number;
  median: number;
  p90: number;
  max: number;
}

export interface MuckPileSummary {
  fragments: number;
  /** Fragment volume in m³. */
  volume: Spread;
  /** Launch speed in m/s. */
  speed: Spread;
  /** Widest gap (metres) found under a settled fragment. */
  maxClearance: number;
  /** How many sit more than `FLOATING_FRAGMENT_CLEARANCE` above what holds them. */
  floating: number;
  /** Highest fragment, in world metres — a tower shows up here. */
  highestY: number;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function spread(sorted: readonly number[]): Spread {
  if (sorted.length === 0) return { min: 0, median: 0, p90: 0, max: 0 };
  const at = (p: number): number =>
    round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!);
  return { min: round(sorted[0]!), median: at(0.5), p90: at(0.9), max: round(sorted[sorted.length - 1]!) };
}

/**
 * How far every fragment sits above whatever is actually holding it up.
 *
 * Measuring against the terrain alone would be wrong: rock stacked in a muck
 * pile legitimately rests metres above the ground, on the rock beneath it. So
 * each column is walked from the bottom up, the top of the pile is carried
 * along, and each fragment is checked against that rather than against the
 * floor. A gap means nothing is under it and it is hanging in the air.
 *
 * Undersides and tops come from the bounding box, not the centre, so a boulder
 * half-buried in the pile reads as resting.
 */
export function fragmentClearances(
  fragments: readonly FragmentData[],
  grid: VoxelGrid,
): number[] {
  const byColumn = new Map<string, FragmentData[]>();
  for (const fragment of fragments) {
    const key = `${Math.floor(fragment.position.x)},${Math.floor(fragment.position.z)}`;
    const column = byColumn.get(key);
    if (column) column.push(fragment);
    else byColumn.set(key, [fragment]);
  }

  const clearances: number[] = [];
  for (const [key, column] of byColumn) {
    const [x, z] = key.split(',').map(Number) as [number, number];
    let pileTop = grid.containsColumn(x, z) ? computeVoxelColumnSurfaceY(grid, x, z) + 1 : 0;

    column.sort((a, b) => (a.position.y - a.halfExtents.y) - (b.position.y - b.halfExtents.y));
    for (const fragment of column) {
      const bottom = fragment.position.y - fragment.halfExtents.y;
      clearances.push(bottom - pileTop);
      pileTop = Math.max(pileTop, fragment.position.y + fragment.halfExtents.y);
    }
  }
  return clearances;
}

/** Summarise every fragment lying on the ground after a blast has settled. */
export function summariseMuckPile(
  fragments: readonly FragmentData[],
  grid: VoxelGrid,
): MuckPileSummary {
  const volumes: number[] = [];
  const speeds: number[] = [];
  let highestY = 0;

  for (const fragment of fragments) {
    volumes.push(fragment.volume);
    const v = fragment.initialVelocity;
    speeds.push(Math.hypot(v.x, v.y, v.z));
    if (fragment.position.y > highestY) highestY = fragment.position.y;
  }

  let maxClearance = 0;
  let floating = 0;
  for (const clearance of fragmentClearances(fragments, grid)) {
    if (clearance > maxClearance) maxClearance = clearance;
    if (clearance > FLOATING_FRAGMENT_CLEARANCE) floating++;
  }

  volumes.sort((a, b) => a - b);
  speeds.sort((a, b) => a - b);

  return {
    fragments: fragments.length,
    volume: spread(volumes),
    speed: spread(speeds),
    maxClearance: round(maxClearance),
    floating,
    highestY: round(highestY),
  };
}
