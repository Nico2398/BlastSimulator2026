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
//
// The primary cell can itself be occupied by another vehicle — most notably
// a rock_fragmenter that just finished a BoulderBreaking task, which parks
// (idle, but still occupying per EntityMovementTick.ts's
// isCellOccupiedByOtherVehicle) on exactly the cell its sub-fragments spawn
// on. A second vehicle later dispatched to one of those sub-fragments would
// target that same occupied cell and — since an idle vehicle never leaves it
// on its own and TRAFFIC_JAM detection needs multiple queued vehicles —
// wait there forever (#484). When the primary cell is occupied, fall back to
// the nearest free walkable neighbour instead, mirroring how
// findBuildingApproachCell already resolves a blocked primary target to a
// walkable cell nearby.
import type { FragmentData } from '../mining/BlastExecution.js';
import type { GameState } from '../state/GameState.js';

/**
 * The NavGrid cell a vehicle must reach to load or break `fragment`.
 *
 * When `state` (and thus the live vehicle roster) is supplied and the
 * fragment's own cell is occupied by a vehicle other than `excludeVehicleId`,
 * returns the nearest free, walkable neighbouring cell instead — recomputed
 * every call, so it tracks the occupant moving away on a later tick. Falls
 * back to the primary cell when no free neighbour exists (caller's own
 * stuck-detection handles a genuinely unreachable target) or when `state` is
 * omitted (callers that only need the nominal cell, e.g. reachability probes
 * that don't care about a transient occupant).
 */
export function fragmentApproachCell(
  fragment: FragmentData,
  state?: GameState,
  excludeVehicleId?: number,
): { x: number; z: number } {
  const primary = {
    x: Math.round(fragment.position.x),
    z: Math.round(fragment.position.z),
  };

  if (!state) return primary;
  if (!isCellOccupiedByOtherVehicle(state, primary.x, primary.z, excludeVehicleId)) return primary;

  let best: { x: number; z: number } | null = null;
  let bestDistSq = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      const x = primary.x + dx;
      const z = primary.z + dz;

      if (state.navGrid) {
        const cell = state.navGrid.cellAt(x, z);
        if (!cell || cell.type === 'blocked' || cell.type === 'void') continue;
      }
      if (isCellOccupiedByOtherVehicle(state, x, z, excludeVehicleId)) continue;

      const distSq = dx * dx + dz * dz;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { x, z };
      }
    }
  }

  return best ?? primary;
}

function isCellOccupiedByOtherVehicle(
  state: GameState,
  x: number,
  z: number,
  excludeVehicleId?: number,
): boolean {
  return state.vehicles.vehicles.some(v => v.id !== excludeVehicleId && v.x === x && v.z === z);
}
