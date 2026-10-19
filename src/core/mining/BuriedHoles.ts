import type { GameState } from '../state/GameState.js';

/** Footprint of a rubble fragment on the XZ plane (centre plus half-extents, in cells). */
export interface FragmentFootprint { x: number; z: number; halfX: number; halfZ: number }

/** Set of grid cells (packed by `cellKey`) covered by on-ground rubble. */
export type BuriedCellIndex = ReadonlySet<number>;

/** Packs a cell coordinate pair into one numeric key. */
export function cellKey(_x: number, _z: number): number {
  // TODO: implement
  return 0;
}

/** Indexes every cell covered by the given fragment footprints. */
export function buildBuriedCellIndex(_footprints: Iterable<FragmentFootprint>): BuriedCellIndex {
  // TODO: implement
  return new Set<number>();
}

/** True when the cell containing (x, z) is covered by rubble. */
export function isCellBuried(_index: BuriedCellIndex, _x: number, _z: number): boolean {
  // TODO: implement
  return false;
}

/** Ids of the holes whose cell is covered by rubble. */
export function buriedHoleIds(_index: BuriedCellIndex, _holes: ReadonlyArray<{ id: string; x: number; z: number }>): Set<string> {
  // TODO: implement
  return new Set<string>();
}

/** Ids of planned holes buried under on-ground rubble; empty off progression sites. */
export function buriedHolesOf(_state: GameState): Set<string> {
  // TODO: implement
  return new Set<string>();
}

/** True when the planned hole `holeId` is buried under on-ground rubble. */
export function isHoleBuried(_state: GameState, _holeId: string): boolean {
  // TODO: implement
  return false;
}

/** True when the on-ground fragment `fragmentId` covers at least one planned hole. */
export function fragmentBuriesPlannedHole(_state: GameState, _fragmentId: number): boolean {
  // TODO: implement
  return false;
}
