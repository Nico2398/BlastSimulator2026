// BlastSimulator2026 — Dispatch of a queued `place_building` action (#556, #1392).

import type { GameState } from '../state/GameState.js';
import type { BuildingTier } from '../entities/Building.js';
import { computeConstructionDurationTicks } from '../entities/ConstructionDuration.js';
import { dispatchPendingAction } from './TaskDispatch.js';

/** Payload carried by a queued `place_building` PendingAction (#556). */
export interface PlaceBuildingActionPayload {
  buildingOrderId: number;
  cost: number;
  footprint: ReadonlyArray<readonly [number, number]>;
  /** Base ticks; scaled by the worker's proficiency at claim time. */
  durationTicks: number;
}

interface PlaceBuildingDispatch {
  /** Pre-claimed pending-action id. */
  actionId: number;
  buildingOrderId: number;
  tier: BuildingTier;
  cost: number;
  footprint: ReadonlyArray<readonly [number, number]>;
  /** Builder's walk target: the footprint's approach-ring cell. */
  approach: { x: number; z: number };
  targetY: number;
}

/**
 * Queue the `place_building` action for a construction order. Needs no skill
 * and no vehicle, so it queues silently even with an empty roster.
 */
export function dispatchPlaceBuildingAction(state: GameState, d: PlaceBuildingDispatch): void {
  dispatchPendingAction(state, {
    id: d.actionId,
    type: 'place_building',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: d.approach.x,
    targetZ: d.approach.z,
    targetY: d.targetY,
    payload: {
      buildingOrderId: d.buildingOrderId,
      cost: d.cost,
      footprint: d.footprint,
      durationTicks: computeConstructionDurationTicks(d.tier),
    } satisfies PlaceBuildingActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });
}
