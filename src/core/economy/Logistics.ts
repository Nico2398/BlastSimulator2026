// BlastSimulator2026 — Fragment storage and logistics
// Tracks fragments through lifecycle: on_ground → in_transit → stored/sold/disposed.

import type { FragmentData } from '../mining/BlastExecution.js';
import { accumulateOreMass } from '../mining/BlastOreReport.js';

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

/** Add fragments from a blast result to the ground. */
export function addBlastFragments(state: LogisticsState, fragments: FragmentData[]): void {
  for (const f of fragments) {
    state.fragments.push({
      fragment: f,
      state: 'on_ground',
      vehicleId: null,
    });
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
  const tracked = state.fragments.find(
    f => f.fragment.id === fragmentId && f.state === 'in_transit',
  );
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

/**
 * Sell a stored fragment. Returns the mass sold (for contract fulfillment).
 * Removes the fragment from logistics.
 */
export function sellFragment(
  state: LogisticsState,
  fragmentId: number,
): { mass: number; volume: number; oreDensities: Record<string, number> } | null {
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
 * Consume up to `amountKg` of `materialId` ore from warehouse-stored fragments,
 * removing whole fragments (via sellFragment) until the requested amount is
 * covered, decrementing collectedOre[materialId] (and every other ore key each
 * removed fragment touches) by the exact ore-kg physically removed.
 * materialId === '' (rubble_disposal) consumes raw stored mass regardless of
 * ore content — any fragment, ore-bearing or not.
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
      const sold = sellFragment(state, id);
      if (!sold) continue;
      const acc: Record<string, number> = {};
      accumulateOreMass(acc, sold.volume, sold.oreDensities);
      for (const [oreId, kg] of Object.entries(acc)) {
        collectedOre[oreId] = (collectedOre[oreId] ?? 0) - kg;
      }
      tally += acc[materialId] ?? 0;
    }

    return { success: true, consumedKg: Math.min(tally, amountKg) };
  }

  // Rubble / no-ore materials: consume raw stored mass, any fragment, FIFO.
  const available = state.storedMassKg;
  if (amountKg > available) {
    return {
      success: false,
      consumedKg: 0,
      error: `Not enough stored material: ${available.toFixed(1)} kg available, ${amountKg.toFixed(1)} kg requested.`,
    };
  }

  const storedIds = state.fragments
    .filter(f => f.state === 'stored')
    .map(f => f.fragment.id);

  let removedMass = 0;
  for (const id of storedIds) {
    if (removedMass >= amountKg) break;
    const sold = sellFragment(state, id);
    if (!sold) continue;
    removedMass += sold.mass;
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
