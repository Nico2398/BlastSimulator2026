// BlastSimulator2026 — Walkable approach cell for a boulder fragment
//
// The NavGrid cell a vehicle must reach to load or break a fragment. Both
// HaulingTask.ts (loading) and BoulderBreaking.ts (breaking) call this one
// function so the two workflows can never drift onto different rules —
// unlike a building (see BuildingApproach.ts's findBuildingApproachCell,
// which targets a walkable ring cell adjacent to the building since the
// building's own tile is NavGrid-blocked), a fragment sits directly on a
// walkable tile, so the target is simply that tile: the fragment's own
// position, rounded to grid coordinates.

import type { FragmentData } from '../mining/BlastExecution.js';

/** The NavGrid cell a vehicle must reach to load or break `fragment`. */
export function fragmentApproachCell(fragment: FragmentData): { x: number; z: number } {
  return {
    x: Math.round(fragment.position.x),
    z: Math.round(fragment.position.z),
  };
}
