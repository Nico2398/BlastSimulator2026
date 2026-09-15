// BlastSimulator2026 — completeVehicleGatedActionIfApplicable, the shared
// vehicle-gated completion path (#552/#1000/#1002), proven identical across
// the two kinds of vehicle-gated action (#1085):
//
//   - timer-driven (drill_hole, dig_ramp_segment, level_ground): completes
//     via tickTaskProgress's employee-timer countdown, resolved in
//     src/console/commands/tickTaskCompletion.ts;
//   - phase-driven (haul_debris, fragment_debris): completes via a vehicle's
//     own drive/deliver phase, resolved in ArrivalGate's completion pass
//     (tick.ts), which already calls this shared function directly.
//
// This function itself does not distinguish the two — it only reads
// `action.requiredVehicleRole`. Its own body (starvation override, taskQueue
// vehicle release, continuity fast path, boolean return contract) was
// already correct before #1085 (fixed by #1000/#1002); #1085's own bug is
// that tickTaskCompletion.ts never calls this function for the timer-driven
// completion path at all — it hand-rolls tryContinueVehicleGatedAction +
// releaseVehicleOnCompletion instead, so a timer-driven completion never
// runs findStarvedActionForEmployee. That regression is proven by
// tests/integration/vehicles.integration.test.ts's own #1085 case (through
// the console, exercising tickTaskCompletion.ts itself); this file instead
// parametrizes EmployeeDispatch.test.ts's own #1000 fixture over BOTH action
// kinds directly against completeVehicleGatedActionIfApplicable, proving the
// shared codepath treats them identically — it does not re-derive or
// duplicate that suite's own describe blocks.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED, type VehicleRole } from '../../../src/core/entities/Vehicle.js';
import { completeVehicleGatedActionIfApplicable } from '../../../src/core/engine/VehicleContinuity.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { ACTION_STARVATION_TICK_THRESHOLD } from '../../../src/core/config/balance.js';

const SEED = 42;
const STARVED_AT_TICK = 1000;

interface VehicleGatedActionKind {
  label: string;
  actionType: PendingAction['type'];
  role: VehicleRole;
  /**
   * Extra fixture setup a follow-up action of this type needs to pass its
   * own type's claim-eligibility gate (isRampSegmentClaimable for
   * dig_ramp_segment — true by default with no rampId/segmentIndex payload;
   * isHaulOrFragmentActionClaimable for haul_debris — requires a tracked
   * on-ground fragment). Returns the payload the follow-up PendingAction
   * itself should carry.
   */
  backlogPayload: (state: GameState, fragmentId: number) => Record<string, unknown>;
  /**
   * Extra one-time world setup this action kind's continuity promotion
   * needs before it can actually start driving (promoteVehicleGatedAction ->
   * startVehicleGatedFragmentWork -> requestHaulFragment requires an active
   * freight_warehouse depot for haul_debris; dig_ramp_segment needs nothing).
   */
  setup?: (state: GameState) => void;
}

// Timer-driven: reached today via tickTaskCompletion.ts's hand-rolled
// (buggy, #1085) branch rather than this shared function.
const TIMER_DRIVEN: VehicleGatedActionKind = {
  label: 'timer-driven (dig_ramp_segment/rock_digger)',
  actionType: 'dig_ramp_segment',
  role: 'rock_digger',
  backlogPayload: () => ({}),
};

// Phase-driven: already reached via this shared function, through
// ArrivalGate's completion pass (#552/#1000/#1002).
const PHASE_DRIVEN: VehicleGatedActionKind = {
  label: 'phase-driven (haul_debris/debris_hauler)',
  actionType: 'haul_debris',
  role: 'debris_hauler',
  setup: (state) => {
    // A minimal, already-built, active freight_warehouse — requestHaulFragment
    // (HaulingTask.ts) refuses to start hauling with no active depot.
    state.buildings.buildings.push({
      id: state.buildings.nextId++,
      type: 'freight_warehouse',
      tier: 1,
      x: 0, z: 0,
      hp: 100,
      active: true,
    });
  },
  backlogPayload: (state, fragmentId) => {
    state.logistics.fragments.push({
      fragment: {
        id: fragmentId,
        position: { x: 2, y: 0, z: 0 },
        volume: 0.3,
        mass: 5,
        rockId: 'cruite',
        oreDensities: {},
        initialVelocity: { x: 0, y: 0, z: 0 },
        isProjection: false,
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        shapeSeed: 1,
      },
      state: 'on_ground',
      vehicleId: null,
    });
    return { fragmentId };
  },
};

/**
 * A driver mid-vehicle-chain on `kind.role`, having just finished
 * `completedAction` (id 1): a same-role backlog action (id 2, open,
 * reachable, no skill required) and an on-foot starved candidate (id 3,
 * queued, unclaimed, no skill/target-employee restriction, queuedAtTick set
 * exactly at ACTION_STARVATION_TICK_THRESHOLD) both sit in the pool.
 * Mirrors EmployeeDispatch.test.ts's own #1000 makeFixture, parametrized
 * over the completing action's type/role instead of hardcoding debris_hauler.
 */
function makeFixture(kind: VehicleGatedActionKind) {
  const state = createGame({ seed: SEED });
  state.tickCount = STARVED_AT_TICK;
  kind.setup?.(state);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
  assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED[kind.role], 1);

  const { vehicle } = purchaseVehicle(state.vehicles, kind.role, 0, 0);
  vehicle.driverId = employee.id;

  const completedAction: PendingAction = {
    id: 1,
    type: kind.actionType,
    requiredSkill: null,
    requiredVehicleRole: kind.role,
    targetX: 0, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'in_progress',
    holderId: employee.id,
    queuedAtTick: 0,
  };
  vehicle.reservedForActionId = completedAction.id;
  employee.activeActionId = completedAction.id;

  const sameRoleBacklog: PendingAction = {
    id: 2,
    type: kind.actionType,
    requiredSkill: null,
    requiredVehicleRole: kind.role,
    targetX: 2, targetZ: 0, targetY: 0,
    payload: kind.backlogPayload(state, 2),
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    queuedAtTick: 0,
  };

  const starvedCandidate: PendingAction = {
    id: 3,
    type: 'place_building',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 4, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    queuedAtTick: STARVED_AT_TICK - ACTION_STARVATION_TICK_THRESHOLD,
  };

  state.pendingActions.push(completedAction, sameRoleBacklog, starvedCandidate);

  return { state, employee, vehicle, completedAction, sameRoleBacklog, starvedCandidate };
}

describe.each([TIMER_DRIVEN, PHASE_DRIVEN])(
  'completeVehicleGatedActionIfApplicable — $label',
  (kind) => {
    it('a long-starved unclaimed on-foot action wins dispatch over same-role vehicle continuity (starvation override, #1000)', () => {
      const { state, employee, vehicle, sameRoleBacklog, starvedCandidate } = makeFixture(kind);

      const result = completeVehicleGatedActionIfApplicable(state, employee, 1);

      expect(result).toBe(true);
      expect(employee.activeActionId).toBe(starvedCandidate.id);
      const landedStarved = state.pendingActions.find(a => a.id === starvedCandidate.id)!;
      expect(landedStarved.status).toBe('assigned');
      expect(landedStarved.holderId).toBe(employee.id);

      // The employee dismounts — the vehicle is fully released, not carried
      // over onto the starved (on-foot) action.
      expect(vehicle.reservedForActionId).toBeNull();
      expect(vehicle.driverId).toBeNull();

      // The same-role backlog candidate that lost out stays open for someone
      // else — it must not be silently claimed or discarded.
      expect(state.pendingActions.find(a => a.id === sameRoleBacklog.id)!.status).toBe('queued');
    });

    it('releases a taskQueue-held same-role vehicle reservation in the starvation branch (releaseUnboardedTaskQueueVehicleReservations, #1002)', () => {
      const { state, employee, starvedCandidate } = makeFixture(kind);

      // Already reserved one pool action ahead (reserveOnePoolActionAhead, a
      // prior tick): claimed, sitting in employee.taskQueue, with its own
      // vehicle reserved but never boarded.
      const { vehicle: queuedVehicle } = purchaseVehicle(state.vehicles, kind.role, 8, 0);
      const queuedFollowUp: PendingAction = {
        id: 4,
        type: kind.actionType,
        requiredSkill: null,
        requiredVehicleRole: kind.role,
        targetX: 8, targetZ: 0, targetY: 0,
        payload: kind.backlogPayload(state, 4),
        targetEmployeeId: null,
        status: 'assigned',
        holderId: employee.id,
        queuedAtTick: 0,
      };
      queuedVehicle.reservedForActionId = queuedFollowUp.id;
      employee.taskQueue = [queuedFollowUp.id];
      state.pendingActions.push(queuedFollowUp);

      const result = completeVehicleGatedActionIfApplicable(state, employee, 1);

      expect(result).toBe(true);
      expect(employee.activeActionId).toBe(starvedCandidate.id);

      // The taskQueue-held follow-up is no longer on employee's own queue,
      // and is fully back in the open pool — not left reserved-but-idle.
      expect(employee.taskQueue).not.toContain(queuedFollowUp.id);
      const releasedFollowUp = state.pendingActions.find(a => a.id === queuedFollowUp.id)!;
      expect(releasedFollowUp.status).toBe('queued');
      expect(releasedFollowUp.holderId).toBeNull();
      expect(queuedVehicle.reservedForActionId).toBeNull();
    });

    it('continues to the next queued same-role vehicle-gated action when nothing is starved (tryContinueVehicleGatedAction)', () => {
      const { state, employee, vehicle, sameRoleBacklog, starvedCandidate } = makeFixture(kind);
      // One tick short of the starvation threshold — the override must not fire.
      starvedCandidate.queuedAtTick = STARVED_AT_TICK - (ACTION_STARVATION_TICK_THRESHOLD - 1);

      const result = completeVehicleGatedActionIfApplicable(state, employee, 1);

      expect(result).toBe(true);
      expect(employee.activeActionId).toBe(sameRoleBacklog.id);
      const landedBacklog = state.pendingActions.find(a => a.id === sameRoleBacklog.id)!;
      expect(landedBacklog.status).toBe('assigned');
      expect(landedBacklog.holderId).toBe(employee.id);

      // Continuity keeps the driver mounted on the same vehicle — carried
      // over, not released/dismounted.
      expect(vehicle.driverId).toBe(employee.id);
      expect(vehicle.reservedForActionId).toBe(sameRoleBacklog.id);

      const untouchedStarved = state.pendingActions.find(a => a.id === starvedCandidate.id)!;
      expect(untouchedStarved.status).toBe('queued');
      expect(untouchedStarved.holderId).toBeNull();
    });

    it('returns true for a resolvable vehicle-gated actionId', () => {
      const { state, employee } = makeFixture(kind);
      expect(completeVehicleGatedActionIfApplicable(state, employee, 1)).toBe(true);
    });
  },
);

describe('completeVehicleGatedActionIfApplicable — boolean return contract (#1085)', () => {
  it('returns false when actionId does not resolve to any PendingAction', () => {
    const { state, employee } = makeFixture(TIMER_DRIVEN);
    expect(completeVehicleGatedActionIfApplicable(state, employee, 999999)).toBe(false);
  });

  it('returns false when actionId resolves to a PendingAction with requiredVehicleRole === null', () => {
    const { state, employee } = makeFixture(TIMER_DRIVEN);
    const onFootAction: PendingAction = {
      id: 5,
      type: 'place_building',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'in_progress',
      holderId: employee.id,
      queuedAtTick: 0,
    };
    state.pendingActions.push(onFootAction);

    expect(completeVehicleGatedActionIfApplicable(state, employee, onFootAction.id)).toBe(false);
    // No side effects — the on-foot action and the employee's own active
    // action are both left untouched.
    expect(employee.activeActionId).toBe(1);
    expect(state.pendingActions.find(a => a.id === onFootAction.id)!.status).toBe('in_progress');
  });
});
