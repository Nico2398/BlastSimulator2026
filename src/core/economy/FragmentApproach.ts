// BlastSimulator2026 — Where a vehicle stands to load or break a fragment
//
// Rubble blocks the nav grid over the whole footprint of each rock
// (`fragmentFootprintCells`), for every mover: a truck does not drive over a
// muck pile, it parks beside the rock it loads, the way a building is docked
// from its ring (BuildingApproach.ts). Both HaulingTask.ts (loading) and
// BoulderBreaking.ts (breaking) call this one function so the two workflows
// can never drift onto different rules.
//
// The candidates are the cells touching the rock's footprint that are open
// ground, free of other rubble and of other vehicles. A rock buried in the
// middle of a pile has none until the rocks around it are hauled: a pile is
// worked from its edge.

import type { FragmentData } from '../mining/BlastExecution.js';
import type { GameState } from '../state/GameState.js';
import { fragmentRingCells } from '../nav/FragmentFootprint.js';
import type { NavCell } from '../nav/NavGrid.js';
import { NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { vehicleReachesCell } from '../engine/ReachCache.js';
import { FRAGMENT_APPROACH_MAX_STEP_M, FRAGMENT_APPROACH_REACH_CELLS } from '../config/balance.js';

/**
 * The open cells beside `fragment` a vehicle can stand on to work it: traversable,
 * under no rubble. Every candidate without a nav grid is the rock's own cell.
 */
export function fragmentApproachCandidates(fragment: FragmentData, state: Pick<GameState, 'navGrid'>): Array<{ x: number; z: number; ring: number }> {
  const nav = state.navGrid;
  if (!nav) return [{ x: Math.round(fragment.position.x), z: Math.round(fragment.position.z), ring: 0 }];
  // The ground under the rock: its own cell's surface, when the grid models terrain.
  const ground = nav.cellAt(Math.round(fragment.position.x), Math.round(fragment.position.z))?.surfaceY;
  const ring = fragmentRingCells(fragment, FRAGMENT_APPROACH_REACH_CELLS);
  const ground1 = new Set(ring.filter(c => c.ring === 1 && isGround(nav.cellAt(c.x, c.z))).map(c => `${c.x},${c.z}`));
  return ring.filter(c => {
    const cell = nav.cellAt(c.x, c.z);
    if (!isGround(cell) || (cell.fragmentOccupancy ?? 0) > 0) return false;
    // An arm reaches over rubble, not through a wall: past the nearest ring, a neighbour in it must be ground.
    if (c.ring > 1 && !NEIGHBOUR_OFFSETS_8.some(([dx, dz]) => ground1.has(`${c.x + dx},${c.z + dz}`))) return false;
    return ground === undefined || cell.surfaceY === undefined || Math.abs(cell.surfaceY - ground) <= FRAGMENT_APPROACH_MAX_STEP_M;
  });
}

function isGround(cell: NavCell | undefined): cell is NavCell {
  return cell !== undefined && cell.type !== 'blocked' && cell.type !== 'void';
}

/**
 * The cell a vehicle drives to in order to load or break `fragment`: the
 * candidate beside it (`fragmentApproachCandidates`) that no other vehicle and
 * no worker on foot holds, preferring one the vehicle `excludeVehicleId` can drive to, then the
 * ring nearest the rock, then the cell nearest that vehicle (else nearest the rock). Null when the rock has no free side —
 * buried in its pile, or boxed in by parked vehicles — and the order waits.
 * Without `state` (or a nav grid) the rock's own rounded cell, the nominal
 * target probes and ghosts use.
 */
export function fragmentApproachCell(
  fragment: FragmentData,
  state?: GameState,
  excludeVehicleId?: number,
): { x: number; z: number } | null {
  const own = { x: Math.round(fragment.position.x), z: Math.round(fragment.position.z) };
  if (!state || !state.navGrid) return own;

  const vehicle = excludeVehicleId === undefined ? undefined : state.vehicles.vehicles.find(v => v.id === excludeVehicleId);
  const driverIds = new Set(vehicle?.occupantIds ?? []);
  const free = fragmentApproachCandidates(fragment, state)
    .filter(c => !isCellOccupiedByOtherVehicle(state, c.x, c.z, excludeVehicleId) && !isCellHeldByOtherWorker(state, c.x, c.z, driverIds));
  if (free.length === 0) return null;
  const reached = vehicle ? free.filter(c => vehicleReachesCell(state, vehicle, c.x, c.z)) : [];
  const pool = reached.length > 0 ? reached : free;
  const from = vehicle ? { x: vehicle.x, z: vehicle.z } : fragment.position;

  let best = pool[0]!;
  let bestDistSq = Infinity;
  for (const c of pool) {
    const distSq = (c.x - from.x) ** 2 + (c.z - from.z) ** 2;
    if (c.ring < best.ring || (c.ring === best.ring && distSq < bestDistSq)) {
      bestDistSq = distSq;
      best = c;
    }
  }
  return { x: best.x, z: best.z };
}

/** A worker standing on the cell (on foot, not the vehicle's own crew): the truck would stop short of them. */
function isCellHeldByOtherWorker(state: GameState, x: number, z: number, crew: ReadonlySet<number>): boolean {
  return state.employees.employees.some(e => e.alive && !crew.has(e.id) && e.locomotion?.kind !== 'mounted'
    && Math.round(e.x) === x && Math.round(e.z) === z);
}

function isCellOccupiedByOtherVehicle(
  state: GameState,
  x: number,
  z: number,
  excludeVehicleId?: number,
): boolean {
  return state.vehicles.vehicles.some(v => v.id !== excludeVehicleId && Math.round(v.x) === x && Math.round(v.z) === z);
}
