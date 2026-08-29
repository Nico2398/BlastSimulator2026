// BlastSimulator2026 — Tests for findSafeEvacuationCell / evacuateZone
// (src/core/engine/Evacuation.ts, #557).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  findSafeEvacuationCell, evacuateZone, isMidEvacuationWalk, isEvacuationHoldActive, clearResolvedEvacuationHolds,
} from '../../../src/core/engine/Evacuation.js';
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

describe('isEvacuationHoldActive / clearResolvedEvacuationHolds (#557 review)', () => {
  const holdZone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

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

  describe('isEvacuationHoldActive', () => {
    it('true when the action carries the hold marker and a living employee is still inside the zone', () => {
      const state = createGame({ seed: EVACUATION_SEED });
      state.zone.activeZone = holdZone;
      const rng = new Random(EVACUATION_SEED);
      hireEmployee(state.employees, 'driller', rng, 15, 15); // still inside the zone
      const action = makeAction({ id: 1, payload: { evacuationHold: true } });

      expect(isEvacuationHoldActive(state, action)).toBe(true);
    });

    it('false once the zone has genuinely cleared of living employees', () => {
      const state = createGame({ seed: EVACUATION_SEED });
      state.zone.activeZone = holdZone; // no employees at all -> trivially clear
      const action = makeAction({ id: 2, payload: { evacuationHold: true } });

      expect(isEvacuationHoldActive(state, action)).toBe(false);
    });

    it('false when the action carries no hold marker at all, even with the zone occupied (boundary)', () => {
      const state = createGame({ seed: EVACUATION_SEED });
      state.zone.activeZone = holdZone;
      const rng = new Random(EVACUATION_SEED);
      hireEmployee(state.employees, 'driller', rng, 15, 15);
      const action = makeAction({ id: 3, payload: {} });

      expect(isEvacuationHoldActive(state, action)).toBe(false);
    });

    it('false when no zone is active at all, even with the marker present (rejection)', () => {
      const state = createGame({ seed: EVACUATION_SEED });
      // state.zone.activeZone stays null — fresh game, nothing was ever evacuated.
      const action = makeAction({ id: 4, payload: { evacuationHold: true } });

      expect(isEvacuationHoldActive(state, action)).toBe(false);
    });

    it('never mutates the action payload — pure check', () => {
      const state = createGame({ seed: EVACUATION_SEED });
      state.zone.activeZone = holdZone; // no employees hired -> would read "clear"
      const payload = { evacuationHold: true };
      const action = makeAction({ id: 5, payload });

      isEvacuationHoldActive(state, action);

      expect(action.payload).toBe(payload); // same reference — never reassigned
      expect(action.payload['evacuationHold']).toBe(true);
    });
  });

  describe('clearResolvedEvacuationHolds', () => {
    it('strips the hold marker from every action once the zone has genuinely cleared, keeping the rest of the payload', () => {
      const state = createGame({ seed: EVACUATION_SEED });
      state.zone.activeZone = holdZone; // no employees hired -> trivially clear
      state.pendingActions.push(makeAction({ id: 1, payload: { evacuationHold: true, other: 'kept' } }));

      clearResolvedEvacuationHolds(state);

      const stored = state.pendingActions.find(a => a.id === 1)!;
      expect(stored.payload['evacuationHold']).toBeUndefined();
      expect(stored.payload['other']).toBe('kept');
    });

    it('leaves the marker in place while a living employee is still inside the zone (rejection)', () => {
      const state = createGame({ seed: EVACUATION_SEED });
      state.zone.activeZone = holdZone;
      const rng = new Random(EVACUATION_SEED);
      hireEmployee(state.employees, 'driller', rng, 15, 15); // still in zone
      state.pendingActions.push(makeAction({ id: 2, payload: { evacuationHold: true } }));

      clearResolvedEvacuationHolds(state);

      expect(state.pendingActions.find(a => a.id === 2)!.payload['evacuationHold']).toBe(true);
    });

    it('is a no-op with no active zone at all (boundary)', () => {
      const state = createGame({ seed: EVACUATION_SEED });
      state.pendingActions.push(makeAction({ id: 3, payload: { evacuationHold: true } }));

      clearResolvedEvacuationHolds(state);

      expect(state.pendingActions.find(a => a.id === 3)!.payload['evacuationHold']).toBe(true);
    });

    it('never re-arms on a later, unrelated re-entry into the same zone footprint — the marker stays stripped for good', () => {
      const state = createGame({ seed: EVACUATION_SEED });
      state.zone.activeZone = holdZone;
      state.pendingActions.push(makeAction({ id: 4, payload: { evacuationHold: true } }));

      clearResolvedEvacuationHolds(state); // zone genuinely clear right now -> strips it

      const rng = new Random(EVACUATION_SEED);
      hireEmployee(state.employees, 'driller', rng, 15, 15); // a LATER, unrelated re-entry into the same zone

      expect(isEvacuationHoldActive(state, state.pendingActions.find(a => a.id === 4)!)).toBe(false);
    });
  });
});
