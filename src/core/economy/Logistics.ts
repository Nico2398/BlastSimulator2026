// BlastSimulator2026 — Fragment storage and logistics
// Tracks fragments through lifecycle: on_ground → in_transit → stored/sold/disposed.

import type { FragmentData } from '../mining/BlastExecution.js';

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
export function deliverToDepot(state: LogisticsState, fragmentId: number): boolean {
  const tracked = state.fragments.find(
    f => f.fragment.id === fragmentId && f.state === 'in_transit',
  );
  if (!tracked) return false;

  tracked.state = 'stored';
  tracked.vehicleId = null;
  state.storedMassKg += tracked.fragment.mass;
  return true;
}

/**
 * Sell a stored fragment. Returns the mass sold (for contract fulfillment).
 * Removes the fragment from logistics.
 */
export function sellFragment(
  state: LogisticsState,
  fragmentId: number,
): { mass: number; oreDensities: Record<string, number> } | null {
  const idx = state.fragments.findIndex(
    f => f.fragment.id === fragmentId && f.state === 'stored',
  );
  if (idx < 0) return null;

  const tracked = state.fragments[idx]!;
  state.storedMassKg -= tracked.fragment.mass;
  state.fragments.splice(idx, 1);

  return {
    mass: tracked.fragment.mass,
    oreDensities: tracked.fragment.oreDensities,
  };
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
