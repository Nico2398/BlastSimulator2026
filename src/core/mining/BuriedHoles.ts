// BlastSimulator2026 — Planned drill holes buried under on-ground rubble (#1937)

import { isProgressionSite, type GameState, type PendingAction } from '../state/GameState.js';
import { findById } from '../state/IdIndex.js';
import type { TrackedFragment } from '../economy/Logistics.js';
import { sealedFragmentIdsOf } from '../economy/HaulDispatch.js';

/** Footprint of a rubble fragment on the XZ plane (centre plus half-extents, in cells). */
interface FragmentFootprint { x: number; z: number; halfX: number; halfZ: number }

/** Set of grid cells (packed by `cellKey`) covered by on-ground rubble. */
type BuriedCellIndex = ReadonlySet<number>;

const CELL_OFFSET = 1 << 20;
const CELL_STRIDE = 1 << 21;

/** Packs a cell coordinate pair into one numeric key. */
export function cellKey(x: number, z: number): number {
  return (x + CELL_OFFSET) * CELL_STRIDE + (z + CELL_OFFSET);
}

/** Cells (Math.round, as the nav grid, inclusive) a footprint covers, passed to `visit`. */
function forEachCoveredCell(f: FragmentFootprint, visit: (key: number) => void): void {
  const x1 = Math.round(f.x + f.halfX);
  const z1 = Math.round(f.z + f.halfZ);
  for (let cx = Math.round(f.x - f.halfX); cx <= x1; cx++) {
    for (let cz = Math.round(f.z - f.halfZ); cz <= z1; cz++) visit(cellKey(cx, cz));
  }
}

/** Indexes every cell covered by the given fragment footprints. */
export function buildBuriedCellIndex(footprints: Iterable<FragmentFootprint>): BuriedCellIndex {
  const cells = new Set<number>();
  for (const f of footprints) forEachCoveredCell(f, key => cells.add(key));
  return cells;
}

/** True when the cell containing (x, z) is covered by rubble. */
export function isCellBuried(index: BuriedCellIndex, x: number, z: number): boolean {
  return index.has(cellKey(Math.round(x), Math.round(z)));
}

/** Ids of the holes whose cell is covered by rubble. */
export function buriedHoleIds(index: BuriedCellIndex, holes: ReadonlyArray<{ id: string; x: number; z: number }>): Set<string> {
  const ids = new Set<string>();
  if (index.size === 0) return ids;
  for (const h of holes) if (isCellBuried(index, h.x, h.z)) ids.add(h.id);
  return ids;
}

function footprintOf(tracked: TrackedFragment): FragmentFootprint {
  const { position, halfExtents } = tracked.fragment;
  return { x: position.x, z: position.z, halfX: halfExtents?.x ?? 0, halfZ: halfExtents?.z ?? 0 };
}

function isHaulableRubble(tracked: TrackedFragment, sealed: ReadonlySet<number> | undefined): boolean {
  return tracked.state === 'on_ground' && !(sealed?.has(tracked.fragment.id) ?? false);
}

interface TickCache<T> { tick: number; count: number; value: T; sealed?: ReadonlySet<number> | undefined }
const rubbleCache = new WeakMap<GameState, TickCache<BuriedCellIndex>>();
const holeCellCache = new WeakMap<GameState, TickCache<ReadonlySet<number>>>();

/**
 * Rubble cell index, built once per tick (and per fragment count / dispatch pass) for a state.
 * Only haulable rubble counts: a fragment sealed under intact rock gets no haul order (#1774),
 * so burying a hole under it would never clear.
 */
function rubbleIndexOf(state: GameState): BuriedCellIndex {
  const fragments = state.logistics.fragments;
  const sealed = sealedFragmentIdsOf(state);
  const hit = rubbleCache.get(state);
  if (hit !== undefined && hit.tick === state.tickCount && hit.count === fragments.length && hit.sealed === sealed) return hit.value;
  const value = buildBuriedCellIndex(fragments.filter(f => isHaulableRubble(f, sealed)).map(footprintOf));
  rubbleCache.set(state, { tick: state.tickCount, count: fragments.length, value, sealed });
  return value;
}

/** Cells of the planned holes, cached per tick like the rubble index. */
function plannedHoleCellsOf(state: GameState): ReadonlySet<number> {
  const holes = state.plannedDrillHoles;
  const hit = holeCellCache.get(state);
  if (hit !== undefined && hit.tick === state.tickCount && hit.count === holes.length) return hit.value;
  const value = new Set(holes.map(h => cellKey(Math.round(h.x), Math.round(h.z))));
  holeCellCache.set(state, { tick: state.tickCount, count: holes.length, value });
  return value;
}

/** Ids of planned holes buried under on-ground rubble; empty off progression sites. */
export function buriedHolesOf(state: GameState): Set<string> {
  if (!isProgressionSite(state) || state.plannedDrillHoles.length === 0) return new Set<string>();
  return buriedHoleIds(rubbleIndexOf(state), state.plannedDrillHoles);
}

/** True when the planned hole `holeId` is buried under on-ground rubble. */
export function isHoleBuried(state: GameState, holeId: string): boolean {
  if (!isProgressionSite(state)) return false;
  const hole = state.plannedDrillHoles.find(h => h.id === holeId);
  return hole !== undefined && isCellBuried(rubbleIndexOf(state), hole.x, hole.z);
}

/** True when the cell containing (x, z) lies under on-ground rubble; false off progression sites. O(1) per query. */
function isCellUnderRubble(state: GameState, x: number, z: number): boolean {
  return isProgressionSite(state) && state.plannedDrillHoles.length > 0 && isCellBuried(rubbleIndexOf(state), x, z);
}

/** True for a queued drill_hole order whose planned hole lies under on-ground rubble (#1937). */
export function isDrillHoleBuried(state: GameState, action: PendingAction): boolean {
  if (action.type !== 'drill_hole' || action.status !== 'queued') return false;
  const { x, z } = action.payload;
  return typeof x === 'number' && typeof z === 'number' && isCellUnderRubble(state, x, z);
}

/** True when `tracked` is on the ground and covers at least one planned hole; false off progression sites. */
export function trackedBuriesPlannedHole(state: GameState, tracked: TrackedFragment): boolean {
  if (!isHaulableRubble(tracked, sealedFragmentIdsOf(state)) || !isProgressionSite(state) || state.plannedDrillHoles.length === 0) return false;
  const holeCells = plannedHoleCellsOf(state);
  let buries = false;
  forEachCoveredCell(footprintOf(tracked), key => { if (holeCells.has(key)) buries = true; });
  return buries;
}

const fragmentIdOf = (tracked: TrackedFragment): number => tracked.fragment.id;

/** True when the on-ground fragment `fragmentId` covers at least one planned hole. */
export function fragmentBuriesPlannedHole(state: GameState, fragmentId: number): boolean {
  const tracked = findById(state.logistics.fragments, fragmentIdOf, fragmentId);
  return tracked !== undefined && trackedBuriesPlannedHole(state, tracked);
}
