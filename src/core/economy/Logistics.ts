// BlastSimulator2026 — Fragment storage and logistics
// Tracks fragments through lifecycle: on_ground → in_transit → stored/sold/disposed.

import type { FragmentData } from '../mining/BlastExecution.js';
import { accumulateOreMass } from '../mining/BlastOreReport.js';
import type { NavGrid } from '../nav/NavGrid.js';
import { scale } from '../math/Vec3.js';
import { FRAGMENT_SPLIT_EPSILON_KG } from '../config/balance.js';

// ── Fragment states ──

export type FragmentState = 'on_ground' | 'in_transit' | 'stored';

export interface TrackedFragment {
  fragment: FragmentData;
  state: FragmentState;
  /** Vehicle ID that picked up the fragment (if in_transit). */
  vehicleId: string | null;
}

// ── Logistics state ──

export interface LogisticsState {
  fragments: TrackedFragment[];
  /** Max storage capacity in kg. */
  storageCapacityKg: number;
  /** Current stored mass in kg. */
  storedMassKg: number;
}

export function createLogisticsState(storageCapacityKg: number = 5000): LogisticsState {
  return {
    fragments: [],
    storageCapacityKg,
    storedMassKg: 0,
  };
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
    });
    navGrid?.addFragmentOccupant(Math.round(f.position.x), Math.round(f.position.z));
  }
}

/** Pick up a fragment with a vehicle. Returns false if storage is full. */
export function pickupFragment(
  state: LogisticsState,
  fragmentId: number,
  vehicleId: string,
): boolean {
  const tracked = state.fragments.find(
    f => f.fragment.id === fragmentId && f.state === 'on_ground',
  );
  if (!tracked) return false;

  // Check if storage has room (fragments in transit will go to storage)
  if (state.storedMassKg + tracked.fragment.mass > state.storageCapacityKg) {
    return false; // No room
  }

  tracked.state = 'in_transit';
  tracked.vehicleId = vehicleId;
  return true;
}

/** Deliver a fragment to the storage depot. */
export function deliverToDepot(
  state: LogisticsState,
  fragmentId: number,
  collectedOre?: Record<string, number>,
): boolean {
  const tracked = findInTransitFragment(state, fragmentId);
  if (!tracked) return false;

  tracked.state = 'stored';
  tracked.vehicleId = null;
  state.storedMassKg += tracked.fragment.mass;

  // Accumulate ore mass into collectedOre when provided
  if (collectedOre) {
    accumulateOreMass(collectedOre, tracked.fragment.volume, tracked.fragment.oreDensities);
  }

  return true;
}

/** Mass/volume/ore content removed from storage by a sale or a partial split. */
type RemovedFragmentMass = { mass: number; volume: number; oreDensities: Record<string, number> };

/** Find a fragment currently in storage by id, or undefined when absent/not stored. */
function findStoredFragment(state: LogisticsState, fragmentId: number): TrackedFragment | undefined {
  return state.fragments.find(f => f.fragment.id === fragmentId && f.state === 'stored');
}

/** Find a fragment currently in transit by id, or undefined when absent/not in transit. */
function findInTransitFragment(state: LogisticsState, fragmentId: number): TrackedFragment | undefined {
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

  fragment.mass -= massToRemoveKg;
  fragment.volume -= removedVolume;
  const shrink = Math.cbrt(1 - fraction);
  fragment.halfExtents = scale(fragment.halfExtents, shrink);

  state.storedMassKg -= massToRemoveKg;

  return {
    mass: massToRemoveKg,
    volume: removedVolume,
    oreDensities: removedOreDensities,
  };
}

/**
 * Decrement `collectedOre` by the exact ore-kg carried in a just-sold
 * fragment (`sellFragment`'s return shape). Shared by both branches of
 * `consumeStoredOre` below — a materialId-specific sale and a rubble/no-ore
 * sale both need `collectedOre` to reflect a fragment leaving storage the
 * same way, they just differ in which fragments they pick to sell.
 * Returns the per-ore breakdown so a caller that needs the amount of one
 * specific ore removed (the materialId branch's own running tally) doesn't
 * have to recompute it.
 */
function decrementCollectedOre(
  collectedOre: Record<string, number>,
  sold: { volume: number; oreDensities: Record<string, number> },
): Record<string, number> {
  const acc: Record<string, number> = {};
  accumulateOreMass(acc, sold.volume, sold.oreDensities);
  for (const [oreId, kg] of Object.entries(acc)) {
    collectedOre[oreId] = (collectedOre[oreId] ?? 0) - kg;
  }
  return acc;
}

/**
 * Consume up to `amountKg` of `materialId` ore from warehouse-stored fragments,
 * oldest-first, until the requested amount is covered: a fragment whose full
 * contribution the request still needs is removed whole (via sellFragment),
 * and a fragment that only needs to give up part of its contribution is
 * shrunk in place (via splitStoredFragmentMass), decrementing
 * collectedOre[materialId] (and every other ore key each touched fragment
 * carries) by the exact ore-kg physically removed. materialId === ''
 * (rubble_disposal) consumes raw stored mass regardless of ore content — any
 * fragment, ore-bearing or not.
 */
export function consumeStoredOre(
  state: LogisticsState,
  collectedOre: Record<string, number>,
  materialId: string,
  amountKg: number,
): { success: boolean; consumedKg: number; error?: string } {
  if (!Number.isFinite(amountKg) || amountKg <= 0) {
    return {
      success: false,
      consumedKg: 0,
      error: `Invalid amount requested: ${amountKg}.`,
    };
  }

  if (materialId !== '') {
    const available = collectedOre[materialId] ?? 0;
    if (amountKg > available) {
      return {
        success: false,
        consumedKg: 0,
        error: `Not enough ${materialId} in storage: ${available.toFixed(1)} kg available, ${amountKg.toFixed(1)} kg requested.`,
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
      const probe: Record<string, number> = {};
      accumulateOreMass(probe, tracked.fragment.volume, tracked.fragment.oreDensities);
      const contribution = probe[materialId] ?? 0;

      if (remaining >= contribution - FRAGMENT_SPLIT_EPSILON_KG) {
        const sold = sellFragment(state, id);
        if (!sold) continue;
        const acc = decrementCollectedOre(collectedOre, sold);
        tally += acc[materialId] ?? 0;
      } else {
        const massSlice = remaining * (tracked.fragment.mass / contribution);
        const split = splitStoredFragmentMass(state, id, massSlice);
        if (!split) continue;
        decrementCollectedOre(collectedOre, split);
        tally += remaining;
        break;
      }
    }

    return { success: true, consumedKg: Math.min(tally, amountKg) };
  }

  // Rubble / no-ore materials: consume raw stored mass, any fragment. Barren
  // fragments (no ore content at all) go first, oldest-first within each
  // group, only reaching into ore-bearing fragments once barren stock runs
  // out — a rubble contract pays cents per kg where an ore_sale pays
  // dollars, so scrapping valuable ore-bearing rock as cheap rubble ahead of
  // genuinely worthless waste would squander it for no reason (#959).
  const available = state.storedMassKg;
  if (amountKg > available) {
    return {
      success: false,
      consumedKg: 0,
      error: `Not enough stored material: ${available.toFixed(1)} kg available, ${amountKg.toFixed(1)} kg requested.`,
    };
  }

  const stored = state.fragments.filter(f => f.state === 'stored');
  const isBarren = (f: TrackedFragment) => (
    Object.values(f.fragment.oreDensities).every(d => d <= 0)
  );
  const storedIds = [
    ...stored.filter(isBarren).map(f => f.fragment.id),
    ...stored.filter(f => !isBarren(f)).map(f => f.fragment.id),
  ];

  let removedMass = 0;
  for (const id of storedIds) {
    if (removedMass >= amountKg) break;
    const tracked = findStoredFragment(state, id);
    if (!tracked) continue;

    const remaining = amountKg - removedMass;
    const contribution = tracked.fragment.mass;

    // A rubble_disposal sale draws on every stored fragment regardless of ore
    // content, so it can consume an ore-bearing fragment same as any other.
    // Without decrementing collectedOre, the ledger stays stale — still
    // showing ore that is physically gone — so a LATER ore_sale contract can
    // be accepted against stock that no longer exists in storage, silently
    // under-deliver, and expire for a penalty instead of completing (#959).
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

  return { success: true, consumedKg: Math.min(removedMass, amountKg) };
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

/** Check if there's room to pick up more fragments. */
export function hasStorageRoom(state: LogisticsState, massKg: number): boolean {
  return state.storedMassKg + massKg <= state.storageCapacityKg;
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
