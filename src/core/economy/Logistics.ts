// BlastSimulator2026 — Fragment storage and logistics
// Tracks fragments through lifecycle: on_ground → in_transit → stored/sold/disposed.

import type { FragmentData } from '../mining/BlastExecution.js';
import { accumulateOreMass, clampCollectedOre, decrementCollectedOre, oreContributionKg } from '../mining/BlastOreReport.js';
import type { NavGrid } from '../nav/NavGrid.js';
import { t } from '../i18n/I18n.js';
import type { WarehouseSite } from '../entities/BuildingWarehouse.js';
import { pickWarehouse, warehouseFreeKg, warehouseUsedKgMap } from './FreightWarehouses.js';
import { creditSpoilHeaps, totalSpoilRoomKg, drawSpoilKg, haulDestinationOf, isStoredBarren, rubbleStockKg } from './SpoilHeaps.js';
import type { Building } from '../entities/Building.js';
import { scale } from '../math/Vec3.js';
import { FRAGMENT_SPLIT_EPSILON_KG, INITIAL_STORAGE_CAPACITY_KG } from '../config/balance.js';

// ── Fragment states ──

export type FragmentState = 'on_ground' | 'in_transit' | 'stored';

export interface TrackedFragment {
  fragment: FragmentData;
  state: FragmentState;
  /** Vehicle ID that picked up the fragment (if in_transit). */
  vehicleId: string | null;
  /** Freight warehouse this fragment is reserved for (in_transit) or stored in; null on the ground. */
  warehouseId: number | null;
}

// ── Logistics state ──

export interface LogisticsState {
  fragments: TrackedFragment[];
  /** Max storage capacity in kg. */
  storageCapacityKg: number;
  /** Current stored mass in kg. */
  storedMassKg: number;
  /** Next unused fragment id; ids stay unique across blasts. */
  nextFragmentId: number;
}

export function createLogisticsState(storageCapacityKg: number = INITIAL_STORAGE_CAPACITY_KG): LogisticsState {
  return {
    fragments: [],
    storageCapacityKg,
    storedMassKg: 0,
    nextFragmentId: 0,
  };
}

/** Reserve `count` consecutive fragment ids; returns the first id of the block. */
export function reserveFragmentIds(state: LogisticsState, count: number): number {
  const first = state.nextFragmentId;
  state.nextFragmentId += count;
  return first;
}

// ── Operations ──

/**
 * Add fragments from a blast result to the ground. `navGrid`, when provided,
 * registers each fragment's cell as an occupant via NavGrid.addFragmentOccupant
 * (#954) so foot pathfinding treats it as impassable.
 */
export function addBlastFragments(state: LogisticsState, fragments: FragmentData[], navGrid: NavGrid | null = null): void {
  for (const f of fragments) {
    state.fragments.push({
      fragment: f,
      state: 'on_ground',
      vehicleId: null,
      warehouseId: null,
    });
    navGrid?.addFragmentOccupant(Math.round(f.position.x), Math.round(f.position.z));
  }
}

/**
 * Pick up a fragment with a vehicle and reserve room for it in the nearest
 * freight warehouse (from the vehicle's position) that can hold it. A barren
 * fragment reserves the nearest of `heapSites` with room for it instead (#1530, #1892).
 * Returns false when no suitable site has room (or none exist).
 */
export function pickupFragment(
  state: LogisticsState,
  fragmentId: number,
  vehicleId: string,
  sites: readonly WarehouseSite[],
  vehicleX: number,
  vehicleZ: number,
  heapSites: readonly WarehouseSite[] = [],
): boolean {
  const tracked = state.fragments.find(
    f => f.fragment.id === fragmentId && f.state === 'on_ground',
  );
  if (!tracked) return false;

  const site = pickWarehouse(
    state,
    haulDestinationOf(tracked.fragment) === 'spoil_heap' ? heapSites : sites,
    vehicleX, vehicleZ, tracked.fragment.mass,
  );
  if (!site) return false;

  tracked.state = 'in_transit';
  tracked.vehicleId = vehicleId;
  tracked.warehouseId = site.id;
  return true;
}

/**
 * Deliver a fragment to a freight warehouse: the one reserved at pickup if it
 * still exists and has room, else the nearest (to `atX`,`atZ`) with room.
 * Returns false without mutating anything when none can take it.
 */
export function deliverToDepot(
  state: LogisticsState,
  fragmentId: number,
  collectedOre: Record<string, number> | undefined,
  sites: readonly WarehouseSite[],
  atX: number,
  atZ: number,
): boolean {
  const tracked = findInTransitFragment(state, fragmentId);
  if (!tracked) return false;

  const reserved = sites.find(s => s.id === tracked.warehouseId);
  // The fragment's own reservation is already counted in warehouseFreeKg.
  const target = reserved && warehouseFreeKg(state, reserved) >= 0
    ? reserved
    : pickWarehouse(state, sites, atX, atZ, tracked.fragment.mass);
  if (!target) return false;

  tracked.state = 'stored';
  tracked.vehicleId = null;
  tracked.warehouseId = target.id;
  state.storedMassKg += tracked.fragment.mass;

  // Accumulate ore mass into collectedOre when provided
  if (collectedOre) {
    accumulateOreMass(collectedOre, tracked.fragment.volume, tracked.fragment.oreDensities);
  }

  return true;
}

/**
 * Dump a barren in-transit fragment on a spoil heap: the one reserved at
 * pickup if it still exists, else the nearest to (`atX`,`atZ`). The fragment
 * leaves logistics entirely — storedMassKg and collectedOre are untouched
 * (heaps are not freight storage). Returns the heap and mass dumped so the
 * caller can credit the heap building (logistics never imports buildings),
 * or null without mutating anything when no heap has room for it (#1530, #1892).
 */
export function deliverToSpoilHeap(
  state: LogisticsState,
  fragmentId: number,
  heapSites: readonly WarehouseSite[],
  atX: number,
  atZ: number,
): { heapId: number; massKg: number } | null {
  const tracked = findInTransitFragment(state, fragmentId);
  if (!tracked || haulDestinationOf(tracked.fragment) !== 'spoil_heap') return null;

  // The fragment's own reservation is already counted in warehouseFreeKg.
  const reserved = heapSites.find(s => s.id === tracked.warehouseId);
  const target = reserved && warehouseFreeKg(state, reserved) >= 0
    ? reserved
    : pickWarehouse(state, heapSites, atX, atZ, tracked.fragment.mass);
  if (!target) return null;

  state.fragments.splice(state.fragments.indexOf(tracked), 1);
  return { heapId: target.id, massKg: tracked.fragment.mass };
}

/** Mass/volume/ore content removed from storage by a sale or a partial split. */
type RemovedFragmentMass = { mass: number; volume: number; oreDensities: Record<string, number> };

/** Find a fragment currently in storage by id, or undefined when absent/not stored. */
function findStoredFragment(state: LogisticsState, fragmentId: number): TrackedFragment | undefined {
  return state.fragments.find(f => f.fragment.id === fragmentId && f.state === 'stored');
}

/** Find a fragment currently in transit by id, or undefined when absent/not in transit. */
export function findInTransitFragment(state: LogisticsState, fragmentId: number): TrackedFragment | undefined {
  return state.fragments.find(f => f.fragment.id === fragmentId && f.state === 'in_transit');
}

/**
 * Sell a stored fragment. Returns the mass sold (for contract fulfillment).
 * Removes the fragment from logistics.
 */
export function sellFragment(
  state: LogisticsState,
  fragmentId: number,
): RemovedFragmentMass | null {
  const idx = state.fragments.findIndex(
    f => f.fragment.id === fragmentId && f.state === 'stored',
  );
  if (idx < 0) return null;

  const tracked = state.fragments[idx]!;
  state.storedMassKg -= tracked.fragment.mass;
  state.fragments.splice(idx, 1);

  return {
    mass: tracked.fragment.mass,
    volume: tracked.fragment.volume,
    oreDensities: tracked.fragment.oreDensities,
  };
}

/**
 * Shrink a stored fragment in place by the removed mass and volume: scales
 * halfExtents by the cube root of the remaining volume ratio and debits
 * state.storedMassKg.
 */
function shrinkStoredFragment(
  state: LogisticsState,
  fragment: FragmentData,
  removedMassKg: number,
  removedVolume: number,
): void {
  const oldVolume = fragment.volume;
  fragment.mass -= removedMassKg;
  fragment.volume -= removedVolume;
  fragment.halfExtents = scale(fragment.halfExtents, Math.cbrt(fragment.volume / oldVolume));
  state.storedMassKg -= removedMassKg;
}

/**
 * Split a stored fragment's mass, removing `massToRemoveKg` from it and leaving
 * the remainder in storage (as a smaller fragment covering the same ore
 * densities). Returns the removed mass/volume/oreDensities, or null when the
 * fragment is not found, not stored, or `massToRemoveKg` is not strictly
 * between 0 and the fragment's mass (use `sellFragment` to remove the whole
 * fragment instead).
 */
export function splitStoredFragmentMass(
  state: LogisticsState,
  fragmentId: number,
  massToRemoveKg: number,
): RemovedFragmentMass | null {
  if (!Number.isFinite(massToRemoveKg) || massToRemoveKg <= 0) return null;

  const tracked = findStoredFragment(state, fragmentId);
  if (!tracked) return null;

  const fragment = tracked.fragment;
  if (massToRemoveKg >= fragment.mass) return null;

  const fraction = massToRemoveKg / fragment.mass;
  const removedVolume = fragment.volume * fraction;
  const removedOreDensities = { ...fragment.oreDensities };

  shrinkStoredFragment(state, fragment, massToRemoveKg, removedVolume);

  return {
    mass: massToRemoveKg,
    volume: removedVolume,
    oreDensities: removedOreDensities,
  };
}

/**
 * Remove only `oreId` (up to `oreKg`) from one stored fragment, leaving every
 * other ore in it at its exact kg. The ore's share of volume and mass is
 * d / max(1, sum of densities), so mixed fragments whose densities sum past 1
 * still deliver exactly the requested kg. Shrinks the fragment's volume and mass,
 * reduces state.storedMassKg by the removed mass, and removes a pure-ore
 * fully-sold fragment via sellFragment. Returns the ore kg, mass and volume
 * actually removed, or null when the fragment is not stored, lacks the ore,
 * or oreKg is non-finite or <= 0.
 */
export function extractOreFromFragment(
  state: LogisticsState,
  fragmentId: number,
  oreId: string,
  oreKg: number,
): { oreKg: number; mass: number; volume: number } | null {
  if (!Number.isFinite(oreKg) || oreKg <= 0) return null;
  const tracked = findStoredFragment(state, fragmentId);
  if (!tracked) return null;

  const fragment = tracked.fragment;
  const d = fragment.oreDensities[oreId] ?? 0;
  const volume = fragment.volume;
  const contribution = oreContributionKg(volume, d);
  if (d <= 0 || !(contribution > 0)) return null;

  const f = Math.min(1, Math.max(0, oreKg / contribution));
  // Physical share of the fragment this ore occupies: densities can sum past 1,
  // in which case volume V*d would overshoot V, so normalise by max(1, sum).
  const densitySum = Object.values(fragment.oreDensities).reduce((a, b) => a + Math.max(0, b), 0);
  const share = d / Math.max(1, densitySum);
  const removedVolume = volume * share * f;
  const removedMass = fragment.mass * share * f;
  const newVolume = volume - removedVolume;
  const removedOreKg = contribution * f;

  const othersPresent = Object.entries(fragment.oreDensities).some(([id, dens]) => id !== oreId && dens > 0);
  const leftoverMass = fragment.mass - removedMass;
  if (!othersPresent && (newVolume <= 0 || leftoverMass <= FRAGMENT_SPLIT_EPSILON_KG)) {
    const sold = sellFragment(state, fragmentId);
    if (!sold) return null;
    return { oreKg: removedOreKg, mass: sold.mass, volume: sold.volume };
  }
  if (!(newVolume > 0)) return null;

  const ratio = volume / newVolume;
  const densities: Record<string, number> = {};
  for (const [id, dens] of Object.entries(fragment.oreDensities)) {
    const next = id === oreId ? dens * (1 - f) * ratio : dens * ratio;
    if (next > 0) densities[id] = next;
  }
  fragment.oreDensities = densities;
  shrinkStoredFragment(state, fragment, removedMass, removedVolume);

  return { oreKg: removedOreKg, mass: removedMass, volume: removedVolume };
}

/**
 * Consume up to `amountKg` of `materialId` ore from warehouse-stored fragments,
 * oldest-first, until the requested amount is covered. An ore sale removes only
 * that ore from each fragment it touches (via extractOreFromFragment); other
 * ores in the same fragments stay stored and in collectedOre. Only
 * collectedOre[materialId] is decremented, by the exact kg extracted.
 * materialId === '' (rubble_disposal) consumes barren rock only: the spoil
 * heaps first (#1530), then barren stored fragments oldest-first. Ore-bearing
 * fragments and their collectedOre are never touched (#1871); a barren
 * fragment's trace ore still debits the ledger. `buildings` is where the
 * heaps are. After an ore sale (and before it, for legacy leftovers) barren
 * stored rock is released to the first heap (releaseBarrenStoredFragments,
 * #1690); with no heap, or no room on one, it stays stored.
 */
export function consumeStoredOre(
  state: LogisticsState,
  collectedOre: Record<string, number>,
  materialId: string,
  amountKg: number,
  buildings: readonly Pick<Building, 'type' | 'tier' | 'storedSpoilKg'>[],
): { success: boolean; consumedKg: number; error?: string } {
  if (!Number.isFinite(amountKg) || amountKg <= 0) {
    return {
      success: false,
      consumedKg: 0,
      error: t('logistics.invalid_amount', { amount: amountKg }),
    };
  }

  if (materialId !== '') {
    // Legacy leftovers and heaps built after the rock was stored (#1690).
    releaseBarrenStoredFragments(state, collectedOre, buildings);
    const available = collectedOre[materialId] ?? 0;
    if (amountKg > available) {
      return {
        success: false,
        consumedKg: 0,
        error: t('logistics.insufficient_stock', { material: materialId, available: available.toFixed(1), requested: amountKg.toFixed(1) }),
      };
    }

    // Oldest-first stored fragments containing this ore.
    const storedIds = state.fragments
      .filter(f => f.state === 'stored' && (f.fragment.oreDensities[materialId] ?? 0) > 0)
      .map(f => f.fragment.id);

    let tally = 0;
    for (const id of storedIds) {
      if (tally >= amountKg) break;
      const tracked = findStoredFragment(state, id);
      if (!tracked) continue;

      const remaining = amountKg - tally;
      const contribution = oreContributionKg(
        tracked.fragment.volume,
        tracked.fragment.oreDensities[materialId] ?? 0,
      );
      const take = remaining >= contribution - FRAGMENT_SPLIT_EPSILON_KG ? contribution : remaining;
      const extracted = extractOreFromFragment(state, id, materialId, take);
      if (!extracted) continue;
      collectedOre[materialId] = (collectedOre[materialId] ?? 0) - extracted.oreKg;
      tally += extracted.oreKg;
    }

    // The rock left after the sale is spoil: it leaves storage for the heap (#1690).
    releaseBarrenStoredFragments(state, collectedOre, buildings);
    return { success: true, consumedKg: Math.min(tally, amountKg) };
  }

  // Rubble: barren rock only (ore below the spoil-heap threshold) — heaps, then
  // barren stored fragments oldest-first. Ore-bearing rock is never scrapped as
  // cheap rubble (#1871).
  const available = rubbleStockKg(state.fragments, buildings);
  if (amountKg > available) {
    return {
      success: false,
      consumedKg: 0,
      error: t('logistics.insufficient_rubble', { available: available.toFixed(1), requested: amountKg.toFixed(1) }),
    };
  }

  const fromHeaps = drawSpoilKg(buildings, amountKg);
  const storageKg = amountKg - fromHeaps;

  const storedIds = state.fragments
    .filter(isStoredBarren)
    .map(f => f.fragment.id);

  let removedMass = 0;
  for (const id of storedIds) {
    if (removedMass >= storageKg) break;
    const tracked = findStoredFragment(state, id);
    if (!tracked) continue;

    const remaining = storageKg - removedMass;
    const contribution = tracked.fragment.mass;

    // Trace ore in a barren fragment must leave the collectedOre ledger too,
    // else a LATER ore_sale could be accepted against stock that is gone (#959).
    if (remaining >= contribution - FRAGMENT_SPLIT_EPSILON_KG) {
      const sold = sellFragment(state, id);
      if (!sold) continue;
      decrementCollectedOre(collectedOre, sold);
      removedMass += sold.mass;
    } else {
      const split = splitStoredFragmentMass(state, id, remaining);
      if (!split) continue;
      decrementCollectedOre(collectedOre, split);
      removedMass += remaining;
      break;
    }
  }

  return { success: true, consumedKg: Math.min(fromHeaps + removedMass, amountKg) };
}

/**
 * Synchronise logistics storage capacity with the freight warehouse total.
 * Call after building placement or demolition to keep capacity in sync.
 */
export function syncLogisticsCapacity(
  state: LogisticsState,
  capacityKg: number,
): void {
  state.storageCapacityKg = capacityKg;
}

// ── Queries ──

export interface FragmentCounts {
  onGround: number;
  inTransit: number;
  stored: number;
  total: number;
}

/** Get fragment counts by state. */
export function getFragmentCounts(state: LogisticsState): FragmentCounts {
  let onGround = 0, inTransit = 0, stored = 0;
  for (const f of state.fragments) {
    if (f.state === 'on_ground') onGround++;
    else if (f.state === 'in_transit') inTransit++;
    else stored++;
  }
  return { onGround, inTransit, stored, total: state.fragments.length };
}

/** Fragment data of every fragment lying on the ground, in tracking order (#1868). */
export function onGroundFragmentData(logistics: Pick<LogisticsState, 'fragments'>): FragmentData[] {
  return logistics.fragments.filter(f => f.state === 'on_ground').map(f => f.fragment);
}

/** Free storage room in kg (capacity minus stored and in-transit mass) (#1369, #1370). */
export function storageRoomKg(state: LogisticsState): number {
  return state.storageCapacityKg - state.storedMassKg - inTransitMassKg(state);
}

/** Total ore mass across all materials in `collectedOre`, in kg. */
export function totalCollectedOreKg(collectedOre: Record<string, number>): number {
  return Object.values(collectedOre).reduce((sum, kg) => sum + kg, 0);
}

/**
 * Inverse of pickupFragment: returns an in-transit fragment to the ground,
 * clearing its vehicle association. Used when a vehicle's haul is aborted
 * mid-flight (forced rest, cancellation, driver death) so cargo already
 * picked up is not permanently lost.
 *
 * @param navGrid - when provided, re-registers the fragment as a nav-grid
 *   occupant at its recorded position (mirrors addBlastFragments' occupancy
 *   registration).
 * @param dropPosition - when provided, relocates the fragment here instead of
 *   leaving it at its stale pre-pickup position (#974 follow-up: a haul
 *   interrupted on its 'to_depot' leg, after loading, has already covered
 *   real ground toward the depot — snapping the cargo back to where the
 *   original blast placed it discards that entire distance, and a fatigue
 *   policy short-cycling work/rest faster than one full haul leg can complete
 *   (e.g. `set_policy mode:continuous`'s WORK_DURATION_TICKS=6 cadence)
 *   otherwise resets the same haul to zero progress every cycle forever —
 *   direct-traced via tutorial-interactive.json's/tutorial-steps-visual.json's
 *   contract-deliver step, where fragment 32/similar never converged on
 *   delivery across 400+ ticks of repeated interrupt-and-restart. Callers
 *   pass the vehicle's own current position so the cargo lands wherever the
 *   vehicle actually was, preserving whatever ground it had already covered.
 * @returns true if a matching in_transit fragment was found and reverted;
 *   false if no such fragment exists (no mutation in that case).
 */
export function returnFragmentToGround(
  state: LogisticsState,
  fragmentId: number,
  navGrid?: NavGrid | null,
  dropPosition?: { x: number; y: number; z: number },
): boolean {
  const tracked = findInTransitFragment(state, fragmentId);
  if (!tracked) return false;

  tracked.state = 'on_ground';
  tracked.vehicleId = null;
  tracked.warehouseId = null;

  if (dropPosition) {
    tracked.fragment.position = dropPosition;
  }

  if (navGrid) {
    navGrid.addFragmentOccupant(
      Math.round(tracked.fragment.position.x),
      Math.round(tracked.fragment.position.z),
    );
  }

  return true;
}

function massKgByState(state: LogisticsState, fragmentState: 'in_transit' | 'on_ground'): number {
  let total = 0;
  for (const f of state.fragments) {
    if (f.state === fragmentState) total += f.fragment.mass;
  }
  return total;
}

/** Total mass (kg) of fragments currently in transit (#1370). */
export function inTransitMassKg(state: LogisticsState): number {
  return massKgByState(state, 'in_transit');
}

/** Total mass of fragments lying on the ground (not in transit, not stored), in kg. */
export function onGroundMassKg(state: LogisticsState): number {
  return massKgByState(state, 'on_ground');
}

/**
 * Move stored barren fragments (isStoredBarren) out of state.fragments onto the
 * first spoil heap with room for each, oldest first: debits storedMassKg and any
 * residual ore (decrementCollectedOre), credits the heap. A fragment no heap has
 * room for stays stored (#1892). Returns kg released; no heap => 0.
 */
export function releaseBarrenStoredFragments(
  state: LogisticsState,
  collectedOre: Record<string, number>,
  buildings: readonly (Pick<Building, 'type' | 'tier' | 'storedSpoilKg'> & { id?: number })[],
): number {
  if (totalSpoilRoomKg(buildings) <= 0) return 0; // no heap, or every heap full: the rock stays stored
  const reservedKg = warehouseUsedKgMap(state); // in-flight hauls hold room on a heap too
  const released = new Set<TrackedFragment>();
  let releasedKg = 0;
  for (const tracked of state.fragments.filter(isStoredBarren)) {
    if (!creditSpoilHeaps(buildings, tracked.fragment.mass, reservedKg)) continue;
    decrementCollectedOre(collectedOre, tracked.fragment);
    releasedKg += tracked.fragment.mass;
    released.add(tracked);
  }
  if (released.size === 0) return 0;
  clampCollectedOre(collectedOre);
  state.fragments = state.fragments.filter(f => !released.has(f));
  state.storedMassKg = Math.max(0, state.storedMassKg - releasedKg);
  return releasedKg;
}
