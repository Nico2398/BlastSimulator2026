// BlastSimulator2026 — Building demolition as a queued building_destroyer action (#1392).

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Building } from '../entities/Building.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { destroyBuilding, getBuildingDef, getDefSize } from '../entities/Building.js';
import { computeDemolitionDurationTicks } from '../entities/DemolitionDuration.js';
import type { DemolishBuildingActionPayload } from './DemolishPayload.js';
import { dispatchPendingAction } from './TaskDispatch.js';
import { releaseOccupantsOfRemovedBuildings } from './Mount.js';
import { addIncome } from '../economy/Finance.js';
import { refreshLogisticsCapacity, emitFootprintRegionChanged } from './BuildingTaskHelpers.js';

export type { DemolishBuildingActionPayload };

/** Vehicle role every demolition order requires. */
export const DEMOLITION_VEHICLE_ROLE = 'building_destroyer' as const;

interface DemolitionOptions {
  cost: number;
  approach: { x: number; z: number };
  targetY: number;
}

/** Result of a finished demolition. */
interface DemolitionOutcome {
  buildingId: number;
}

/** Queue a demolish_building pending action for `building`; returns the action id. */
export function queueDemolition(state: GameState, building: Building, opts: DemolitionOptions): number {
  const def = getBuildingDef(building.type, building.tier);
  const actionId = state.nextPendingActionId++;
  dispatchPendingAction(state, {
    id: actionId,
    type: 'demolish_building',
    requiredSkill: null,
    requiredVehicleRole: DEMOLITION_VEHICLE_ROLE,
    targetX: opts.approach.x,
    targetZ: opts.approach.z,
    targetY: opts.targetY,
    payload: {
      buildingId: building.id,
      cost: opts.cost,
      durationTicks: computeDemolitionDurationTicks(def.footprint.length, building.tier, 1),
      footprint: def.footprint,
    } satisfies DemolishBuildingActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });
  return actionId;
}

/** True when a demolish_building action for `buildingId` is already pending or in progress. */
export function isDemolitionOrdered(state: Pick<GameState, 'pendingActions'>, buildingId: number): boolean {
  return state.pendingActions.some(a => a.type === 'demolish_building' && a.payload['buildingId'] === buildingId);
}

/**
 * Remove the building, release occupants, refresh logistics, emit occupancy.
 * A building already gone is a no-op: the order cost is refunded and nothing throws.
 */
export function completeDemolition(
  state: GameState,
  grid: VoxelGrid | null,
  emitter: EventEmitter,
  payload: DemolishBuildingActionPayload,
): DemolitionOutcome {
  const building = state.buildings.buildings.find(b => b.id === payload.buildingId);
  if (!building) {
    state.cash += payload.cost;
    addIncome(state.finances, payload.cost, 'refund', `Demolition cancelled: building #${payload.buildingId} is gone`, state.tickCount);
    return { buildingId: payload.buildingId };
  }
  const { sizeX, sizeZ } = getDefSize(getBuildingDef(building.type, building.tier));
  destroyBuilding(state.buildings, building.id);
  releaseOccupantsOfRemovedBuildings(state, emitter);
  for (const loss of refreshLogisticsCapacity(state)) emitter.emit('logistics:warehouse_stock_lost', loss);
  if (grid) emitFootprintRegionChanged(emitter, grid, building.x, building.z, sizeX, sizeZ);
  return { buildingId: building.id };
}
