// BlastSimulator2026 — Arrival effects (#1091)
//
// Dispatch table for an itinerary leg's `{ kind: 'effect'; effectId: string }`
// ArrivalStep (Itinerary.ts) — fired by Locomotion.ts at the instant a leg's
// destination is reached, the same arrival-gated timing every other
// position-dependent action already uses (see the `vehicles` rule). Replaces
// HaulingTask.ts's tickHaulingProgress and BoulderBreaking.ts's
// tickBreakProgress, which used to drive the same three mutations themselves
// from a per-tick phase machine on `Vehicle` (haulingPhase/breakPhase) —
// PlanItinerary.ts's planFragmentTaskItinerary now plans the driving legs
// instead, and this file supplies only what happens on arrival.
//
// Effect ids are a closed catalog (ArrivalEffectId) rather than a raw string
// so the next one is a union member and a catalog entry, not a new branch
// somewhere else — see the "Extension without edit" principle.

import type { GameState } from '../state/GameState.js';
import type { Vehicle } from '../entities/Vehicle.js';
import type { EventEmitter } from '../state/EventEmitter.js';

/** Registered arrival effect ids an itinerary leg's `onArrive` may name. */
export type ArrivalEffectId = 'haul_load' | 'haul_unload' | 'boulder_split';

type ArrivalEffectHandler = (state: GameState, vehicle: Vehicle, emitter?: EventEmitter) => boolean;

/**
 * Fires when a debris_hauler's drive-to-fragment leg arrives: loads the
 * fragment named by the vehicle's active haul_debris action onto
 * `vehicle.payload`. Mirrors the old HaulingTask.ts tickHaulingProgress
 * 'to_fragment' arrival branch (pickupFragment + payload assignment), minus
 * the movement it used to also drive.
 */
export function applyHaulLoad(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): boolean {
  void state; void vehicle; void emitter;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Fires when a debris_hauler's drive-to-depot leg arrives: delivers
 * `vehicle.payload` into logistics/collectedOre and clears the payload.
 * Mirrors the old HaulingTask.ts tickHaulingProgress 'to_depot' arrival
 * branch (deliverToDepot + payload clear).
 */
export function applyHaulUnload(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): boolean {
  void state; void vehicle; void emitter;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Fires when a rock_fragmenter's drive-to-boulder leg arrives: splits the
 * oversized fragment named by the vehicle's active fragment_debris action
 * into sub-fragments in place. Mirrors the old BoulderBreaking.ts
 * tickBreakProgress body (fragmentBoulder + logistics splice), minus the
 * movement it used to also drive.
 */
export function applyBoulderSplit(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): boolean {
  void state; void vehicle; void emitter;
  // TODO: implement
  throw new Error('not implemented');
}

const ARRIVAL_EFFECTS: Record<ArrivalEffectId, ArrivalEffectHandler> = {
  haul_load: applyHaulLoad,
  haul_unload: applyHaulUnload,
  boulder_split: applyBoulderSplit,
};

/**
 * Dispatches an itinerary leg's `{ kind: 'effect' }` ArrivalStep by its
 * `effectId` to the catalog above — the one call site Locomotion.ts's
 * applyArrivalStep needs for the `step.kind === 'effect'` case (currently a
 * no-op there). Returns false for an `effectId` outside `ArrivalEffectId`
 * (should never happen — every effectId a planned itinerary carries comes
 * from this file's own union) or when the dispatched handler itself reports
 * failure (fragment gone, storage full, etc.) — mirroring `applyArrivalStep`'s
 * own false-on-failure contract for `board`.
 */
export function applyArrivalEffect(
  state: GameState,
  vehicle: Vehicle,
  effectId: string,
  emitter?: EventEmitter,
): boolean {
  void state; void vehicle; void effectId; void emitter; void ARRIVAL_EFFECTS;
  // TODO: implement
  throw new Error('not implemented');
}
