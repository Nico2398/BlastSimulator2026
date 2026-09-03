// BlastSimulator2026 — Tests for findSafeEvacuationCell / evacuateZone
// (src/core/engine/Evacuation.ts, #557).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { findSafeEvacuationCell, evacuateZone, isMidEvacuationWalk } from '../../../src/core/engine/Evacuation.js';
import { isEvacuationHoldActive } from '../../../src/core/engine/EvacuationHold.js';
import { isInZone, type ZoneBounds } from '../../../src/core/entities/Zone.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';
import { EVACUATION_CLEARANCE_M } from '../../../src/core/config/balance.js';

const EVACUATION_SEED = 42;

/** A flat, fully solid, fully walkable size×1×size NavGrid — every column passable. */
function flatWalkableGrid(size: number): NavGrid {
  const vg = new VoxelGrid(size, 1, size);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      vg.setVoxel(x, 0, z, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0,
        oreDensities: {},
        fractureModifier: 1.0,
      });
    }
  }
  return NavGrid.buildNavGrid(vg, [], []);
}

describe('findSafeEvacuationCell', () => {
  it('finds a navigable cell clear of the zone by EVACUATION_CLEARANCE_M, reachable from inside it', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const dest = findSafeEvacuationCell(state, 15, 15, zone);

    expect(dest).not.toBeNull();
    // Not merely outside the zone box — clear of it by the full clearance margin.
    const clearedZone: ZoneBounds = {
      x1: zone.x1 - EVACUATION_CLEARANCE_M, z1: zone.z1 - EVACUATION_CLEARANCE_M,
      x2: zone.x2 + EVACUATION_CLEARANCE_M, z2: zone.z2 + EVACUATION_CLEARANCE_M,
    };
    expect(isInZone(dest!.x, dest!.z, clearedZone)).toBe(false);
    // Within the grid the entity can actually be routed across.
    expect(state.navGrid!.containsCell(dest!.x, dest!.z)).toBe(true);
  });

  it('starting exactly on the zone boundary still finds a cell clear of it', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const dest = findSafeEvacuationCell(state, zone.x1, zone.z1, zone);

    expect(dest).not.toBeNull();
    expect(isInZone(dest!.x, dest!.z, zone)).toBe(false);
  });

  it('returns null when no cell in the grid can clear the zone by the required margin', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    // A grid barely bigger than the zone itself, padded by less than the
    // clearance margin on every side — nowhere in the covered box can
    // satisfy EVACUATION_CLEARANCE_M.
    state.navGrid = flatWalkableGrid(22);
    const zone: ZoneBounds = { x1: -100, z1: -100, x2: 100, z2: 100 };

    expect(findSafeEvacuationCell(state, 10, 10, zone)).toBeNull();
  });

  it('returns null with no NavGrid to route across', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = null;
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    expect(findSafeEvacuationCell(state, 15, 15, zone)).toBeNull();
  });
});

describe('evacuateZone', () => {
  it('orders every employee and vehicle inside the zone to a safe destination, without teleporting them', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 15, 15);
    hireEmployee(state.employees, 'driller', rng, 35, 35); // outside the zone
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 12, 12);

    const beforeEmployeeX = employee.x;
    const beforeVehicleX = vehicle.x;

    const result = evacuateZone(state, zone);

    // Not teleported: same-call positions are unchanged.
    expect(employee.x).toBe(beforeEmployeeX);
    expect(vehicle.x).toBe(beforeVehicleX);

    // Routed out instead.
    expect(employee.destinationX).not.toBeNull();
    expect(isInZone(employee.destinationX!, employee.destinationZ!, zone)).toBe(false);
    expect(vehicle.task).toBe('moving');
    expect(isInZone(vehicle.targetX, vehicle.targetZ, zone)).toBe(false);

    expect(result.orderedEmployeeIds).toContain(employee.id);
    expect(result.orderedVehicleIds).toContain(vehicle.id);
    expect(result.strandedEmployeeIds).toEqual([]);
    expect(result.strandedVehicleIds).toEqual([]);
  });

  it('leaves entities already outside the zone alone', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 35, 35);

    const result = evacuateZone(state, zone);

    expect(result.orderedEmployeeIds).not.toContain(employee.id);
    expect(employee.destinationX).toBeNull();
  });

  it('an empty zone evacuates nothing', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const result = evacuateZone(state, zone);

    expect(result.orderedEmployeeIds).toEqual([]);
    expect(result.orderedVehicleIds).toEqual([]);
    expect(result.strandedEmployeeIds).toEqual([]);
    expect(result.strandedVehicleIds).toEqual([]);
  });

  it('strands an entity no safe cell can be found for, and leaves it exactly where it stands', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    // Grid too small for anywhere to clear the (much larger) zone.
    state.navGrid = flatWalkableGrid(22);
    const zone: ZoneBounds = { x1: -100, z1: -100, x2: 100, z2: 100 };

    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 10, 10);
    const beforeX = employee.x;
    const beforeZ = employee.z;

    const result = evacuateZone(state, zone);

    expect(employee.x).toBe(beforeX);
    expect(employee.z).toBe(beforeZ);
    expect(employee.destinationX).toBeNull();
    expect(result.strandedEmployeeIds).toContain(employee.id);
    expect(result.orderedEmployeeIds).not.toContain(employee.id);
  });
});

describe('isMidEvacuationWalk (#557 review)', () => {
  function makeEmployee(activeActionId: number | null, destinationX: number | null) {
    const employees = createGame({ seed: EVACUATION_SEED }).employees;
    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(employees, 'driller', rng);
    employee.activeActionId = activeActionId;
    employee.destinationX = destinationX;
    return employee;
  }

  it('true for an employee walking a direct evacuation order — no active action, a destination set', () => {
    expect(isMidEvacuationWalk(makeEmployee(null, 40))).toBe(true);
  });

  it('false for an employee walking a normal claimed task — activeActionId set even with a destination', () => {
    expect(isMidEvacuationWalk(makeEmployee(5, 40))).toBe(false);
  });

  it('false for a genuinely idle employee — no active action and no destination (boundary)', () => {
    expect(isMidEvacuationWalk(makeEmployee(null, null))).toBe(false);
  });
});

// isEvacuationHoldActive/clearResolvedEvacuationHolds/discardStaleRestAction/
// releaseInZoneTaskQueueEntries moved to EvacuationHold.ts (#557 follow-up
// file-size split) — their own tests moved to EvacuationHold.test.ts.
// evacuateZone's own use of the latter two is covered below.

describe('evacuateZone — stale rest targets and taskQueue entries (#557 follow-up)', () => {
  const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

  function makeAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
    return {
      type: 'general_work',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      ...overrides,
    };
  }

  it('discards an active rest action whose target is inside the zone, instead of leaving it as a reclaimable hold', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    state.zone.activeZone = zone;
    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 15, 15); // inside the zone
    const restAction = makeAction({
      id: 1, type: 'rest', targetX: 12, targetZ: 12, targetEmployeeId: employee.id,
      holderId: employee.id, status: 'assigned',
    });
    state.pendingActions.push(restAction);
    employee.activeActionId = restAction.id;
    employee.pendingRestDuration = 4;
    employee.pendingRestNeedKey = 'fatigue';

    evacuateZone(state, zone);

    // Gone outright — not sitting 'queued'/hold-marked, waiting to be reclaimed
    // with the same stale, still-in-zone target.
    expect(state.pendingActions.find(a => a.id === 1)).toBeUndefined();
    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.pendingRestNeedKey).toBeNull();
    // Sent on the real evacuation walk instead, like any other in-zone employee.
    expect(employee.destinationX).not.toBeNull();
    expect(isInZone(employee.destinationX!, employee.destinationZ!, zone)).toBe(false);
  });

  it('releases an in-zone taskQueue entry to the open pool, evacuation-held, instead of leaving it silently claimable', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    state.zone.activeZone = zone;
    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 15, 15); // inside the zone
    const queuedWork = makeAction({
      id: 1, type: 'dig_ramp_segment', targetX: 16, targetZ: 16, targetEmployeeId: null,
      holderId: employee.id, status: 'assigned',
    });
    state.pendingActions.push(queuedWork);
    employee.taskQueue = [queuedWork.id];
    // No activeActionId — this employee is idle-but-for-the-taskQueue-claim, the
    // exact shape claimActionsTargetedAtEmployee leaves a busy-at-claim-time
    // employee in.

    evacuateZone(state, zone);

    expect(employee.taskQueue).toEqual([]);
    const stored = state.pendingActions.find(a => a.id === 1)!;
    expect(stored.status).toBe('queued');
    expect(stored.holderId).toBeNull();
    expect(isEvacuationHoldActive(state, stored)).toBe(true);
  });
});
