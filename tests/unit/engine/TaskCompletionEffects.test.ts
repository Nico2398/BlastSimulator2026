// BlastSimulator2026 — Unit tests: applyTaskCompletion (#1086)
//
// Core-owned relocation of tickTaskCompletion.ts's resolveTaskCompletion.
// runTick's own black-box tests and the pre-existing integration/scenario
// suites already exercise this indirectly; these tests call it directly per
// core-purity.md's "adding an exported function here means adding its unit
// test in the mirrored tests/unit/ path" convention.

import { describe, it, expect } from 'vitest';
import { applyTaskCompletion } from '../../../src/core/engine/TaskCompletionEffects.js';
import { createGame, type PendingAction, type PlannedRamp } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import type { TaskProgressResult } from '../../../src/core/engine/TaskProgress.js';

const SEED = 42;

function baseProgress(overrides: Partial<TaskProgressResult>): TaskProgressResult {
  return { completed: true, leveledUp: false, skill: null, levelUps: [], ...overrides };
}

describe('applyTaskCompletion — level_ground (#1009)', () => {
  it('carves the ordered cells and reports voxelsCleared', () => {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(3, 3, 3, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);

    const progress = baseProgress({
      actionType: 'level_ground',
      actionPayload: { cells: [{ x: 3, y: 3, z: 3 }], region: null },
    });

    const report = applyTaskCompletion(state, grid, employee, progress, new EventEmitter());

    expect(report.completed).toBe(true);
    expect(report.groundLevelled).toEqual({ voxelsCleared: 1 });
  });
});

describe('applyTaskCompletion — dig_ramp_segment ordering (#945)', () => {
  /**
   * A rock_digger driver mid-vehicle-chain, having just finished segment 0
   * of a 2-segment ramp, with segment 1 already queued open in the pool.
   * isRampSegmentClaimable (ActionSelection.ts) gates segment 1 on segment
   * 0's own tracker.done — so this fixture only lets the assertion below
   * distinguish "tracker.done set before the continuity lookup" from
   * "set after": the reversed order would leave segment 1 unclaimable and
   * dismount the driver instead of continuing them onto it.
   */
  function makeFixture() {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(10, 10, 10);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.rock_digger, 1);

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.driverId = employee.id;

    const segment0Action: PendingAction = {
      id: 10,
      type: 'dig_ramp_segment',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { rampId: 1, segmentIndex: 0, cells: [{ x: 1, y: 1, z: 1 }], region: null },
      targetEmployeeId: null,
      status: 'in_progress',
      holderId: employee.id,
      queuedAtTick: 0,
    };
    const segment1Action: PendingAction = {
      id: 11,
      type: 'dig_ramp_segment',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { rampId: 1, segmentIndex: 1, cells: [{ x: 1, y: 0, z: 1 }], region: null },
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    };
    state.pendingActions.push(segment0Action, segment1Action);

    vehicle.reservedForActionId = segment0Action.id;
    employee.activeActionId = segment0Action.id;

    const ramp: PlannedRamp = {
      id: 1,
      def: { originX: 0, originZ: 0, direction: 'north', length: 2, targetDepth: -2 },
      footprint: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
      segments: [
        { index: 0, actionId: segment0Action.id, cells: segment0Action.payload['cells'] as { x: number; y: number; z: number }[], region: null, done: false },
        { index: 1, actionId: segment1Action.id, cells: segment1Action.payload['cells'] as { x: number; y: number; z: number }[], region: null, done: false },
      ],
    };
    state.plannedRamps.push(ramp);

    return { state, grid, employee, vehicle, segment0Action, segment1Action, ramp };
  }

  it('marks the finished segment done before the vehicle-continuity lookup, so the driver continues onto the next segment', () => {
    const { state, grid, employee, segment0Action, segment1Action, ramp } = makeFixture();

    const progress = baseProgress({
      actionType: 'dig_ramp_segment',
      actionPayload: segment0Action.payload,
      actionId: segment0Action.id,
    });

    const report = applyTaskCompletion(state, grid, employee, progress, new EventEmitter());

    expect(ramp.segments[0]!.done).toBe(true);
    expect(report.rampSegment).toEqual({
      rampId: 1, segmentIndex: 0, voxelsCleared: 1, rampFullyDone: false,
    });

    // Continuity found segment 1 claimable (its predecessor is now done) and
    // promoted the driver onto it instead of dismounting.
    expect(employee.activeActionId).toBe(segment1Action.id);
    expect(state.pendingActions.find(a => a.id === segment1Action.id)!.status).toBe('assigned');
    expect(state.pendingActions.find(a => a.id === segment0Action.id)).toBeUndefined();
  });
});
