// BlastSimulator2026 — Queueing a ramp excavation order (#555, #1298)
// One place charges the order cost and queues one `dig_ramp_segment` action per
// segment, shared by a fresh ramp order and a widen order.

import type { GameState, PlannedRamp } from '../state/GameState.js';
import { dispatchPendingAction } from '../engine/TaskDispatch.js';
import { addExpense } from '../economy/Finance.js';
import type { RampDef, RampSegmentDef } from './Ramp.js';

/** Payload carried by a queued `dig_ramp_segment` PendingAction (#555). */
export interface RampSegmentActionPayload {
  rampId: number;
  segmentIndex: number;
  cells: { x: number; y: number; z: number; floorAdjustment?: number; fillTarget?: number }[];
  region: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  segmentCost: number;
}

/**
 * Charges `cost` in full at order time — the unspent remainder (unworked
 * segments' share) is refunded on cancel via actionOrderCost/cancelAction —
 * and queues the excavation. The cost is split evenly across segments so the
 * refundable total can never exceed what was charged. Returns the PlannedRamp id.
 */
export function queueRampOrder(
  state: GameState,
  def: RampDef,
  footprint: PlannedRamp['footprint'],
  segments: readonly RampSegmentDef[],
  cost: number,
  expenseLabel: string,
  widenOf?: number,
): number {
  state.cash -= cost;
  addExpense(state.finances, cost, 'construction', expenseLabel, state.tickCount);

  const rampId = state.nextPlannedRampId++;
  const plannedRamp: PlannedRamp = { id: rampId, def, footprint, segments: [] };
  if (widenOf !== undefined) plannedRamp.widenOf = widenOf;

  const segmentCost = cost / segments.length;
  for (const segment of segments) {
    const actionId = state.nextPendingActionId++;
    // skipQualificationCheck: an order must queue silently even when nobody on
    // the roster holds driving.excavator or a rock_digger yet (#555).
    dispatchPendingAction(state, {
      id: actionId,
      type: 'dig_ramp_segment',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX: segment.targetX,
      targetZ: segment.targetZ,
      targetY: segment.targetY,
      payload: {
        rampId, segmentIndex: segment.index, cells: segment.cells, region: segment.region, segmentCost,
      } satisfies RampSegmentActionPayload,
      targetEmployeeId: null,
    }, { skipQualificationCheck: true });

    plannedRamp.segments.push({
      index: segment.index, actionId, cells: segment.cells, region: segment.region, done: false, carvedCount: 0,
    });
  }

  state.plannedRamps.push(plannedRamp);
  return rampId;
}
