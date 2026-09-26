// BlastSimulator2026 — Walkable approach cell for a building
//
// Every footprint cell of a placed building — including its nominal
// entry/exit corners (BuildingDef.entryPoint/exitPoint, which are cosmetic
// door-marker offsets, not a walkability guarantee) — is classified
// 'blocked' by NavGrid.classifyCellType (buildings are solid obstacles).
// Any destination that resolves to a building's raw (x, z) can therefore
// never be reached: Pathfinding.findPath rejects an impassable goal outright,
// before A* even runs. This module finds the nearest *walkable* cell just
// outside the footprint instead, so arrival-gated actions that need an
// employee/vehicle to reach a building (rest, hauling delivery, shift-cycle
// sleep, #437) have an actually reachable target.

import type { NavGrid, NavCell } from './NavGrid.js';
import type { BuildingDef } from '../entities/Building.js';
import { getDefSize } from '../entities/Building.js';
import { isImpassable } from './Pathfinding.js';
import { findNearestNavigableCell, isTraversableCell, computeClimbReachableSet } from './NavGridReachability.js';

/**
 * The x/z every ring computation in this file actually reads off a
 * building — narrow enough that a PlannedBuilding (no hp/active/
 * occupantIds yet) satisfies it too, for the builder's own approach
 * target at order time (#1200).
 */
type FootprintAnchor = { x: number; z: number };

/** The inclusive bounds of the one-cell ring around a building's footprint bounding box. */
function ringBounds(building: FootprintAnchor, def: BuildingDef): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const { sizeX, sizeZ } = getDefSize(def);
  return { minX: building.x - 1, maxX: building.x + sizeX, minZ: building.z - 1, maxZ: building.z + sizeZ };
}

/** Whether (x, z) lies on the one-cell ring just outside a building's footprint bounding box. */
export function isOnBuildingRing(building: FootprintAnchor, def: BuildingDef, x: number, z: number): boolean {
  const { minX, maxX, minZ, maxZ } = ringBounds(building, def);
  if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
  return x === minX || x === maxX || z === minZ || z === maxZ;
}

/**
 * The ring cell closest to (fromX, fromZ) whose NavGrid cell passes
 * `accept`, or null when none does. Cells are visited in a fixed row order
 * and ties keep the first, so the answer is deterministic.
 */
function nearestRingCell(
  navGrid: NavGrid,
  building: FootprintAnchor,
  def: BuildingDef,
  fromX: number,
  fromZ: number,
  accept: (x: number, z: number, cell: NavCell) => boolean,
): { x: number; z: number } | null {
  const { minX, maxX, minZ, maxZ } = ringBounds(building, def);
  let best: { x: number; z: number } | null = null;
  let bestDistSq = Infinity;
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      // Ring only — skip the footprint interior.
      const onRing = x === minX || x === maxX || z === minZ || z === maxZ;
      if (!onRing) continue;
      const cell = navGrid.cellAt(x, z);
      if (!cell || !accept(x, z, cell)) continue;
      const distSq = (x - fromX) ** 2 + (z - fromZ) ** 2;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { x, z };
      }
    }
  }
  return best;
}

/** True when a cell's own type makes it a candidate ring cell at all. */
function isRingCandidateType(cell: NavCell): boolean {
  return cell.type !== 'blocked' && cell.type !== 'void';
}

/**
 * Find the nearest walkable NavGrid cell on the ring immediately surrounding
 * a building's footprint, closest to (fromX, fromZ).
 *
 * Prefers a ring cell that is also actually connected to the map's main
 * navigable region over the merely nearest type-open one (#1200 finding). A
 * ring cell sits outside every footprint by construction, so its own type is
 * unaffected by a footprint that walls off the one route to it — several
 * orders queued back to back (or one order whose own footprint completes the
 * wall) can strand a type-open ring cell in an isolated pocket, and a
 * type-only check hands a builder a destination they can never actually
 * reach. Falls back to the plain type-only nearest cell when the
 * main-region check finds nothing (e.g. a fresh map with no other footprint
 * yet to make the distinction matter), and to the building's raw (x, z) when
 * no NavGrid is built yet (mirrors the rest of the movement pipeline's own
 * no-NavGrid direct-line fallback) or when nothing on the ring is walkable
 * at all (fully boxed in) — the caller's own stuck-detection already handles
 * an unreachable destination.
 */
export function findBuildingApproachCell(
  navGrid: NavGrid | null,
  building: FootprintAnchor,
  def: BuildingDef,
  fromX: number,
  fromZ: number,
): { x: number; z: number } {
  if (!navGrid) return { x: building.x, z: building.z };

  const mainAnchor = findNearestNavigableCell(navGrid, building.x, building.z);
  if (isTraversableCell(navGrid, mainAnchor.x, mainAnchor.z)) {
    const mainRegion = computeClimbReachableSet(navGrid, mainAnchor.x, mainAnchor.z);
    const reachable = nearestRingCell(navGrid, building, def, fromX, fromZ,
      (x, z, cell) => isRingCandidateType(cell) && mainRegion.has(x, z));
    if (reachable) return reachable;
  }

  const best = nearestRingCell(navGrid, building, def, fromX, fromZ, (_x, _z, cell) => isRingCandidateType(cell));
  return best ?? { x: building.x, z: building.z };
}

/**
 * True when an already-dispatched approach target (x, z) is no longer
 * reachable from the map's main navigable region — either built over
 * outright, or the route to it was sealed by a footprint placed since it
 * was picked.
 *
 * Deliberately narrower than "would findBuildingApproachCell pick something
 * else now": that recomputation prefers whichever connected ring cell is
 * nearest at call time, and a second nearby order can easily make a
 * different — but equally reachable — cell nearest now. Rerouting on every
 * such difference (rather than only a genuine stranding) repoints an
 * already-fine builder's walk on essentially every order placed while an
 * earlier one is still pending, which is ordinary multi-building
 * construction, not the sealed-pocket case #1200 targets (confirmed:
 * widespread tick/cash/death-count drift across full-level playthroughs that
 * queue several buildings, orchestrator investigation for #1200).
 */
export function isApproachCellStranded(
  navGrid: NavGrid,
  building: FootprintAnchor,
  x: number,
  z: number,
): boolean {
  if (!isTraversableCell(navGrid, x, z)) return true;
  const mainAnchor = findNearestNavigableCell(navGrid, building.x, building.z);
  if (!isTraversableCell(navGrid, mainAnchor.x, mainAnchor.z)) return false; // nothing to compare against
  const mainRegion = computeClimbReachableSet(navGrid, mainAnchor.x, mainAnchor.z);
  return !mainRegion.has(x, z);
}

/**
 * The free ring cell an employee leaving a building is put out on (#1202):
 * the one nearest (fromX, fromZ) — the cell they entered from — that a
 * walker can stand on right now (`isImpassable` with vehicles avoided, so a
 * vehicle parked on the ring or a debris pile is skipped). Falls back to
 * (fromX, fromZ) itself when no NavGrid is built yet or the whole ring is
 * taken: that cell was on the ring when they entered.
 */
export function findBuildingExitCell(
  navGrid: NavGrid | null,
  building: FootprintAnchor,
  def: BuildingDef,
  fromX: number,
  fromZ: number,
): { x: number; z: number } {
  if (!navGrid) return { x: fromX, z: fromZ };
  return nearestRingCell(navGrid, building, def, fromX, fromZ, (_x, _z, cell) => !isImpassable(cell, true))
    ?? { x: fromX, z: fromZ };
}
