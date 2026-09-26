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
import type { Building, BuildingDef } from '../entities/Building.js';
import { getDefSize } from '../entities/Building.js';
import { isImpassable } from './Pathfinding.js';

/** The inclusive bounds of the one-cell ring around a building's footprint bounding box. */
function ringBounds(building: Building, def: BuildingDef): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const { sizeX, sizeZ } = getDefSize(def);
  return { minX: building.x - 1, maxX: building.x + sizeX, minZ: building.z - 1, maxZ: building.z + sizeZ };
}

/** Whether (x, z) lies on the one-cell ring just outside a building's footprint bounding box. */
export function isOnBuildingRing(building: Building, def: BuildingDef, x: number, z: number): boolean {
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
  building: Building,
  def: BuildingDef,
  fromX: number,
  fromZ: number,
  accept: (cell: NavCell) => boolean,
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
      if (!cell || !accept(cell)) continue;
      const distSq = (x - fromX) ** 2 + (z - fromZ) ** 2;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { x, z };
      }
    }
  }
  return best;
}

/**
 * Find the nearest walkable NavGrid cell on the ring immediately surrounding
 * a building's footprint, closest to (fromX, fromZ).
 *
 * Falls back to the building's raw (x, z) when no NavGrid is built yet
 * (mirrors the rest of the movement pipeline's own no-NavGrid direct-line
 * fallback) or when nothing on the ring is walkable (fully boxed in) — the
 * caller's own stuck-detection already handles an unreachable destination.
 */
export function findBuildingApproachCell(
  navGrid: NavGrid | null,
  building: Building,
  def: BuildingDef,
  fromX: number,
  fromZ: number,
): { x: number; z: number } {
  if (!navGrid) return { x: building.x, z: building.z };
  const best = nearestRingCell(navGrid, building, def, fromX, fromZ, cell => cell.type !== 'blocked' && cell.type !== 'void');
  return best ?? { x: building.x, z: building.z };
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
  building: Building,
  def: BuildingDef,
  fromX: number,
  fromZ: number,
): { x: number; z: number } {
  if (!navGrid) return { x: fromX, z: fromZ };
  return nearestRingCell(navGrid, building, def, fromX, fromZ, cell => !isImpassable(cell, true))
    ?? { x: fromX, z: fromZ };
}
