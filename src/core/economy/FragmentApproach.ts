// BlastSimulator2026 — Walkable approach cell for a boulder fragment
//
// Stub (issue #484): the NavGrid cell a vehicle must reach to load or break
// a fragment. Mirrors BuildingApproach.ts's findBuildingApproachCell pattern
// for fragments instead of buildings.

import type { FragmentData } from '../mining/BlastExecution.js';

/** The NavGrid cell a vehicle must reach to load or break `fragment`. */
export function fragmentApproachCell(_fragment: FragmentData): { x: number; z: number } {
  throw new Error('not implemented');
}
