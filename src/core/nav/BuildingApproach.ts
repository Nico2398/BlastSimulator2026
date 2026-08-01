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

import type { NavGrid } from './NavGrid.js';
import type { Building, BuildingDef } from '../entities/Building.js';
import { getDefSize } from '../entities/Building.js';

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

  const { sizeX, sizeZ } = getDefSize(def);
  const minX = building.x - 1;
  const maxX = building.x + sizeX;
  const minZ = building.z - 1;
  const maxZ = building.z + sizeZ;

  let best: { x: number; z: number } | null = null;
  let bestDistSq = Infinity;

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      // Ring only — skip the footprint interior (handled by the fallback).
      const onRing = x === minX || x === maxX || z === minZ || z === maxZ;
      if (!onRing) continue;
      if (x < 0 || z < 0 || x >= navGrid.width || z >= navGrid.height) continue;

      const cell = navGrid.cells[z]?.[x];
      if (!cell || cell.type === 'blocked' || cell.type === 'void') continue;

      const distSq = (x - fromX) ** 2 + (z - fromZ) ** 2;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { x, z };
      }
    }
  }

  return best ?? { x: building.x, z: building.z };
}
