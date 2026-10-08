// BlastSimulator2026 — Building demolition as a queued building_destroyer action (#1392).

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Building } from '../entities/Building.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { destroyBuilding, getBuildingDef, getDefSize } from '../entities/Building.js';
import { computeDemolitionDurationTicks } from '../entities/DemolitionDuration.js';
import { getSurfaceY } from '../entities/BuildingPlacement.js';
import { findBuildingApproachCell } from '../nav/BuildingApproach.js';
import { dispatchPlaceBuildingAction } from './PlaceBuildingAction.js';
import type { DemolishBuildingActionPayload } from './DemolishPayload.js';
import { dispatchPendingAction } from './TaskDispatch.js';
import { releaseOccupantsOfRemovedBuildings } from './Mount.js';
import { addIncome } from '../economy/Finance.js';
import { refreshLogisticsCapacity, emitFootprintRegionChanged } from './BuildingTaskHelpers.js';

export type { DemolishBuildingActionPayload };

interface DemolitionOptions {
  cost: number;
  rebuildOrderId: number | null;
  approach: { x: number; z: number };
  targetY: number;
}

/** Result of a finished demolition. */
interface DemolitionOutcome {
  buildingId: number;
  /** Id of the queued rebuild action, when a rebuild order was attached. */
  rebuildActionId: number | null;
}

/** Queue a demolish_building pending action for `building`; returns the action id. */
export function queueDemolition(state: GameState, building: Building, opts: DemolitionOptions): number {
  const def = getBuildingDef(building.type, building.tier);
  const actionId = state.nextPendingActionId++;
  dispatchPendingAction(state, {
    id: actionId,
    type: 'demolish_building',
    requiredSkill: null,
    requiredVehicleRole: 'building_destroyer',
    targetX: opts.approach.x,
    targetZ: opts.approach.z,
    targetY: opts.targetY,
    payload: {
      buildingId: building.id,
      cost: opts.cost,
      durationTicks: computeDemolitionDurationTicks(def.footprint.length, building.tier, 1),
      footprint: def.footprint,
      rebuildOrderId: opts.rebuildOrderId,
    } satisfies DemolishBuildingActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });
  return actionId;
}

/** True when a demolish_building action for `buildingId` is already pending or in progress. */
export function isDemolitionOrdered(state: GameState, buildingId: number): boolean {
  return state.pendingActions.some(a => a.type === 'demolish_building' && a.payload['buildingId'] === buildingId);
}

/** Dispatch the place_building action reserved by an upgrade order, keeping its pre-claimed action id. */
function dispatchRebuild(state: GameState, grid: VoxelGrid | null, rebuildOrderId: number): number | null {
  const order = state.plannedBuildings.find(pb => pb.id === rebuildOrderId);
  if (!order) return null;
  const def = getBuildingDef(order.type, order.tier);
  const approach = findBuildingApproachCell(state.navGrid, { x: order.x, z: order.z }, def, order.x, order.z);
  dispatchPlaceBuildingAction(state, {
    actionId: order.actionId,
    buildingOrderId: order.id,
    tier: order.tier,
    cost: order.cost,
    footprint: def.footprint,
    approach,
    targetY: grid ? getSurfaceY(grid, approach.x, approach.z) : 0,
  });
  return order.actionId;
}

/**
 * Remove the building, release occupants, refresh logistics, emit occupancy, queue any rebuild.
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
    if (payload.rebuildOrderId !== null) {
      const idx = state.plannedBuildings.findIndex(pb => pb.id === payload.rebuildOrderId);
      if (idx !== -1) state.plannedBuildings.splice(idx, 1);
    }
    return { buildingId: payload.buildingId, rebuildActionId: null };
  }
  const { sizeX, sizeZ } = getDefSize(getBuildingDef(building.type, building.tier));
  destroyBuilding(state.buildings, building.id);
  releaseOccupantsOfRemovedBuildings(state, emitter);
  for (const loss of refreshLogisticsCapacity(state)) emitter.emit('logistics:warehouse_stock_lost', loss);
  if (grid) emitFootprintRegionChanged(emitter, grid, building.x, building.z, sizeX, sizeZ);
  const rebuildActionId = payload.rebuildOrderId !== null ? dispatchRebuild(state, grid, payload.rebuildOrderId) : null;
  return { buildingId: building.id, rebuildActionId };
}
