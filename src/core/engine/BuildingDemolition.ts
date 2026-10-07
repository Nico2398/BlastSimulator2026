// BlastSimulator2026 — Building demolition as a queued building_destroyer action (#1392).

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Building } from '../entities/Building.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

/** Payload of a pending 'demolish_building' action. */
export interface DemolishBuildingActionPayload {
  buildingId: number;
  cost: number;
  durationTicks: number;
  footprint: ReadonlyArray<readonly [number, number]>;
  /** Place-building order to queue once the demolition finishes (upgrade/move), or null. */
  rebuildOrderId: number | null;
}

export interface DemolitionOptions {
  cost: number;
  rebuildOrderId: number | null;
  approach: { x: number; z: number };
  targetY: number;
}

/** Result of a finished demolition. */
export interface DemolitionOutcome {
  buildingId: number;
  /** Id of the queued rebuild action, when a rebuild order was attached. */
  rebuildActionId: number | null;
}

/** Queue a demolish_building pending action for `building`; returns the action id. */
export function queueDemolition(_state: GameState, _building: Building, _opts: DemolitionOptions): number {
  // TODO: implement
  return undefined as unknown as number;
}

/** True when a demolish_building action for `buildingId` is already pending or in progress. */
export function isDemolitionOrdered(_state: GameState, _buildingId: number): boolean {
  // TODO: implement
  return undefined as unknown as boolean;
}

/** Remove the building, release occupants, refresh logistics, emit occupancy, queue any rebuild. */
export function completeDemolition(
  _state: GameState,
  _grid: VoxelGrid,
  _emitter: EventEmitter,
  _payload: DemolishBuildingActionPayload,
): DemolitionOutcome {
  // TODO: implement
  return undefined as unknown as DemolitionOutcome;
}
