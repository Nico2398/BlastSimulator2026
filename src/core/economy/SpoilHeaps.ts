// BlastSimulator2026 — Spoil heaps (#1530)
// Barren fragments are dumped on a spoil heap instead of a freight warehouse.

import type { Building } from '../entities/Building.js';
import { spoilHeapRoomKg } from '../entities/Building.js';
import { ORE_GRADE_SCALE_DEFAULT, SPOIL_BARREN_ORE_FRACTION_THRESHOLD, BARREN_OVERFLOW_STORED_SHARE } from '../config/balance.js';
import { oreGradeScaleOf, scaledGradeThreshold } from './OreGrade.js';

/** Where a hauled fragment is delivered. */
export type HaulDestination = 'warehouse' | 'spoil_heap';

/**
 * Whether a fragment's ore densities make it barren: summed density at or below
 * SPOIL_BARREN_ORE_FRACTION_THRESHOLD x `gradeScale` (empty = barren). Decides haul destination
 * and which rock rubble may take (a filter: only barren fragments qualify).
 */
export function isBarrenFragment(oreDensities: Readonly<Record<string, number>>, gradeScale = ORE_GRADE_SCALE_DEFAULT): boolean {
  let total = 0;
  for (const d of Object.values(oreDensities)) total += d;
  return total <= scaledGradeThreshold(SPOIL_BARREN_ORE_FRACTION_THRESHOLD, gradeScale);
}

/** Destination for a fragment, by its ore densities. */
export function haulDestinationOf(fragment: { oreDensities: Readonly<Record<string, number>> }, gradeScale = ORE_GRADE_SCALE_DEFAULT): HaulDestination {
  return isBarrenFragment(fragment.oreDensities, gradeScale) ? 'spoil_heap' : 'warehouse';
}

/** Re-exported: the room helper lives with the building (entities layer) so BuildingWarehouse needs no economy import. */
export { spoilHeapRoomKg };

/** Room (kg) left across every spoil heap in the given buildings. */
export function totalSpoilRoomKg(buildings: readonly Pick<Building, 'type' | 'tier' | 'storedSpoilKg'>[]): number {
  let total = 0;
  for (const b of buildings) total += spoilHeapRoomKg(b);
  return total;
}

/** Total barren rock (kg) stored across the given buildings' spoil heaps. */
export function totalSpoilKg(buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[]): number {
  let total = 0;
  for (const b of buildings) {
    if (b.type === 'spoil_heap') total += b.storedSpoilKg ?? 0;
  }
  return total;
}

/** Fragment shape needed to tell stored barren rock from stored ore. */
export interface StoredFragmentLike {
  state: string;
  fragment: { mass: number; oreDensities: Readonly<Record<string, number>> };
}

/** True for a fragment held in storage whose ore densities make it barren. */
export function isStoredBarren(f: StoredFragmentLike, gradeScale = ORE_GRADE_SCALE_DEFAULT): boolean {
  return f.state === 'stored' && isBarrenFragment(f.fragment.oreDensities, gradeScale);
}

/** Mass (kg) of stored fragments that are barren (isStoredBarren). */
export function barrenStoredMassKg(fragments: readonly StoredFragmentLike[], gradeScale = ORE_GRADE_SCALE_DEFAULT): number {
  let total = 0;
  for (const f of fragments) {
    if (isStoredBarren(f, gradeScale)) total += f.fragment.mass;
  }
  return total;
}

/** Barren rock a rubble_disposal contract can draw on: stored barren fragments plus every heap's rock. Ore-bearing stock is never rubble (#1871). */
export function rubbleStockKg(fragments: readonly StoredFragmentLike[], buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[], gradeScale = ORE_GRADE_SCALE_DEFAULT): number {
  return barrenStoredMassKg(fragments, gradeScale) + totalSpoilKg(buildings);
}

/** rubbleStockKg for any state slice carrying logistics and buildings (GameState fits). */
export function stateRubbleStockKg(
  state: { logistics: { fragments: readonly StoredFragmentLike[] }; buildings: { buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[] }; world?: { oreGradeScale?: number } | null },
): number {
  return rubbleStockKg(state.logistics.fragments, state.buildings.buildings, oreGradeScaleOf(state.world));
}

/**
 * Barren kg held in storage when barren rock is at least BARREN_OVERFLOW_STORED_SHARE of the stored mass,
 * totalSpoilRoomKg(buildings) <= 0 and storedMassKg > 0; otherwise 0.
 */
export function barrenOverflowKg(
  fragments: readonly StoredFragmentLike[],
  storedMassKg: number,
  buildings: readonly Pick<Building, 'type' | 'tier' | 'storedSpoilKg'>[],
  gradeScale = ORE_GRADE_SCALE_DEFAULT,
): number {
  if (storedMassKg <= 0 || totalSpoilRoomKg(buildings) > 0) return 0;
  const barren = barrenStoredMassKg(fragments, gradeScale);
  return barren >= BARREN_OVERFLOW_STORED_SHARE * storedMassKg ? barren : 0;
}

/** barrenOverflowKg for any state slice carrying logistics and buildings (GameState fits). */
export function stateBarrenOverflowKg(
  state: { logistics: { fragments: readonly StoredFragmentLike[]; storedMassKg: number }; buildings: { buildings: readonly Pick<Building, 'type' | 'tier' | 'storedSpoilKg'>[] }; world?: { oreGradeScale?: number } | null },
): number {
  return barrenOverflowKg(state.logistics.fragments, state.logistics.storedMassKg, state.buildings.buildings, oreGradeScaleOf(state.world));
}

/** Remove up to `amountKg` of barren rock from the heaps, in building order; returns the kg removed. */
export function drawSpoilKg(buildings: readonly Pick<Building, 'type' | 'storedSpoilKg'>[], amountKg: number): number {
  let remaining = amountKg;
  for (const b of buildings) {
    if (remaining <= 0) break;
    if (b.type !== 'spoil_heap') continue;
    const take = Math.min(remaining, b.storedSpoilKg ?? 0);
    if (take <= 0) continue;
    b.storedSpoilKg = (b.storedSpoilKg ?? 0) - take;
    remaining -= take;
  }
  return amountKg - remaining;
}

/** Add `amountKg` of barren rock to a heap building (the counterpart of drawSpoilKg). */
export function creditSpoilKg(heap: Pick<Building, 'storedSpoilKg'>, amountKg: number): void {
  heap.storedSpoilKg = (heap.storedSpoilKg ?? 0) + amountKg;
}

/**
 * Credit `amountKg` of barren rock to the first spoil heap (building order) whose room, net of
 * `reservedKg` (in-transit mass already promised to a heap, keyed by building id), holds all of it.
 * Returns false, crediting nothing, when no heap has that much room.
 */
export function creditSpoilHeaps(
  buildings: readonly (Pick<Building, 'type' | 'tier' | 'storedSpoilKg'> & { id?: number })[],
  amountKg: number,
  reservedKg: ReadonlyMap<number, number> = new Map(),
): boolean {
  const heap = buildings.find(b =>
    b.type === 'spoil_heap'
    && spoilHeapRoomKg(b) - (b.id === undefined ? 0 : reservedKg.get(b.id) ?? 0) >= amountKg);
  if (!heap) return false;
  creditSpoilKg(heap, amountKg);
  return true;
}
