// BlastSimulator2026 — Tests for findSafeEvacuationCell / evacuateZone
// (src/core/engine/Evacuation.ts, #557).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { findSafeEvacuationCell, evacuateZone, isMidEvacuationWalk } from '../../../src/core/engine/Evacuation.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { isEvacuationHoldActive } from '../../../src/core/engine/EvacuationHold.js';
import { isInZone, type ZoneBounds } from '../../../src/core/entities/Zone.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, getVehicleReservation, resolveVehicleDriver } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { Random } from '../../../src/core/math/Random.js';
import { EVACUATION_CLEARANCE_M } from '../../../src/core/config/balance.js';
import { addBlastFragments, pickupFragment } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

const EVACUATION_SEED = 42;

/** A flat, fully solid, fully walkable size×size NavGrid — every column passable. */
function flatWalkableGrid(size: number): NavGrid {
  const vg = new VoxelGrid(size, size);
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
    // #1089: moveTo(state, v.driverId, ...) now needs a real employee to
    // attach an itinerary to — a dangling driverId (the old model's
    // moveVehicle didn't care who, or whether anyone, held it) just fails
    // silently. Give it a real, co-located, mounted driver instead — this
    // test still proves the "ordered" path, not the #947 driver gate.
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, vehicle.x, vehicle.z);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const beforeEmployeeX = employee.x;
    const beforeVehicleX = vehicle.x;

    const result = evacuateZone(state, zone);

    // Not teleported: same-call positions are unchanged.
    expect(employee.x).toBe(beforeEmployeeX);
    expect(vehicle.x).toBe(beforeVehicleX);

    // Routed out instead.
    expect(employee.destinationX).not.toBeNull();
    expect(isInZone(employee.destinationX!, employee.destinationZ!, zone)).toBe(false);
    // #1089/#1138: evacuateZone only installs the itinerary — the drive
    // leg (read off the driving employee's own itinerary now, not a
    // vehicle-native task/targetX/targetZ) is written by tickLocomotion's
    // own drive-leg advance, not synchronously at plan time. One real tick
    // is what actually starts the drive.
    tickLocomotion(state);
    const evacDriver = resolveVehicleDriver(vehicle, state.employees.employees);
    expect(evacDriver?.itinerary).not.toBeNull();
    expect(isInZone(evacDriver!.itinerary!.legs[0]!.destX, evacDriver!.itinerary!.legs[0]!.destZ, zone)).toBe(false);

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

  it('strands a driverless vehicle standing in-zone, and a subsequent tickLocomotion tick leaves it exactly where it stands (#947)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 12, 12);
    vehicle.occupantIds = [];
    const beforeX = vehicle.x;
    const beforeZ = vehicle.z;

    const result = evacuateZone(state, zone);

    expect(result.strandedVehicleIds).toContain(vehicle.id);
    expect(result.orderedVehicleIds).not.toContain(vehicle.id);
    expect(vehicle.x).toBe(beforeX);
    expect(vehicle.z).toBe(beforeZ);

    // End-to-end: a driverless, stranded vehicle never actually moves on a
    // subsequent tick either, not just at the moment evacuateZone returns —
    // #1089: only an employee moves, and none is mounted here.
    tickLocomotion(state);

    expect(vehicle.x).toBe(beforeX);
    expect(vehicle.z).toBe(beforeZ);
  });

  it('a mixed zone orders employees out while stranding the driverless vehicle, in the same evacuateZone call (#947)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 15, 15);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 12, 12);
    vehicle.occupantIds = [];

    const result = evacuateZone(state, zone);

    expect(result.orderedEmployeeIds).toContain(employee.id);
    expect(employee.destinationX).not.toBeNull();
    expect(isInZone(employee.destinationX!, employee.destinationZ!, zone)).toBe(false);

    expect(result.strandedVehicleIds).toContain(vehicle.id);
    expect(result.orderedVehicleIds).not.toContain(vehicle.id);
  });
});

describe('evacuateZone — boards a driverless vehicle instead of stranding it outright (#1042)', () => {
  it('boards a qualified, reachable in-zone employee onto a driverless vehicle before evacuation completes', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 15, 15);
    vehicle.occupantIds = [];
    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 16, 16);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);

    const result = evacuateZone(state, zone);

    expect(result.strandedVehicleIds).not.toContain(vehicle.id);
    expect(employee.pendingDriverVehicleId).toBe(vehicle.id);
    expect(result.strandedEmployeeIds).not.toContain(employee.id);
  });

  it('strands a vehicle when no employee anywhere passes the real reachability check', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 15, 15);
    vehicle.occupantIds = [];
    // No employees hired at all — nobody anywhere the real reachability
    // check could ever accept.

    const result = evacuateZone(state, zone);

    expect(result.strandedVehicleIds).toContain(vehicle.id);
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
      queuedAtTick: overrides.queuedAtTick ?? 0,
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

// ── #994, updated for #1091's itinerary model: evacuateZone must resolve
// in-flight vehicle-gated fragment work (haul/break) the same way it resolves
// any other active action — through the per-employee interruptActiveAction
// loop above, not a dedicated abort call. That loop's own
// isCommittedToOwnCargo carry-over (releaseActionToOpenPool,
// TaskCancellation.ts) is what decides the fragment's fate now: a haul that
// already picked up its cargo (vehicle.payload set) survives evacuation with
// its reservation AND payload both intact, exactly like any other
// policy-driven interruption/pause — no dropping cargo to the ground purely
// because a blast zone opened up. A haul still mid-drive to the fragment (no
// cargo committed yet), or any break (which never sets `payload` at all), has
// nothing to preserve, so the ordinary claim-only release runs instead
// (Evacuation.ts's own doc comment above evacuateZone spells out why no
// separate vehicle-gated handling is needed any more).

function makeCargoFragment(id: number, mass = 850): FragmentData {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume: 0.3,
    mass,
    rockId: 'cruite',
    oreDensities: { dirtite: 0.3 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
}

/** Minimal vehicle-gated PendingAction fixture for the evacuation cases below. */
function makeFragmentGatedAction(overrides: Partial<PendingAction> & { id: number; holderId: number }): PendingAction {
  return {
    type: 'haul_debris',
    requiredSkill: null,
    requiredVehicleRole: 'debris_hauler',
    targetX: 0, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'in_progress',
    queuedAtTick: 0,
    ...overrides,
  };
}

describe('evacuateZone resolves in-flight vehicle-gated fragment work like any other interruption (#994, #1091)', () => {
  const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

  it('a vehicle mid-haul (to_depot, cargo already picked up) keeps its reservation and cargo intact instead of dropping it (#1091: isCommittedToOwnCargo carry-over)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    addBlastFragments(state.logistics, [makeCargoFragment(1, 850)]);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 15, 15);
    pickupFragment(state.logistics, 1, String(vehicle.id));
    // #1089: a real, co-located, mounted driver — see the first describe
    // block's own comment on why a dangling driverId no longer works.
    const { employee: driver1 } = hireEmployee(state.employees, 'driller', new Random(EVACUATION_SEED), vehicle.x, vehicle.z);
    vehicle.occupantIds = [driver1.id];
    driver1.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const action = makeFragmentGatedAction({ id: 501, holderId: driver1.id, payload: { fragmentId: 1 } });
    state.pendingActions.push(action);
    driver1.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    vehicle.payload = { fragmentId: 1, massKg: 850 };

    evacuateZone(state, zone);
    // #1089/#1138: the drive leg is read off the driving employee's own
    // itinerary, written by tickLocomotion's own drive-leg advance, not
    // synchronously at plan time — one real tick is what actually starts
    // the drive (see the sibling describe block above).
    tickLocomotion(state);

    // The cargo already loaded is not dropped — the fragment stays in_transit
    // on this same vehicle, and the reservation survives evacuation exactly
    // like any other policy-driven interruption (#1091).
    const cargo = state.logistics.fragments.find(f => f.fragment.id === 1)!;
    expect(cargo.state).toBe('in_transit');
    expect(cargo.vehicleId).toBe(String(vehicle.id));
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBe(action.id);
    expect(vehicle.payload).toEqual({ fragmentId: 1, massKg: 850 });

    // Vehicle is still ordered out of the zone like any other evacuee.
    const drivenBy1 = resolveVehicleDriver(vehicle, state.employees.employees);
    expect(isInZone(drivenBy1!.itinerary!.legs[0]!.destX, drivenBy1!.itinerary!.legs[0]!.destZ, zone)).toBe(false);
  });

  it('a vehicle mid-haul (to_fragment, cargo not yet picked up) releases the reservation with no fragment side effects', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    addBlastFragments(state.logistics, [makeCargoFragment(2, 850)]);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 15, 15);
    const { employee: driver2 } = hireEmployee(state.employees, 'driller', new Random(EVACUATION_SEED), vehicle.x, vehicle.z);
    vehicle.occupantIds = [driver2.id];
    driver2.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const action = makeFragmentGatedAction({ id: 502, holderId: driver2.id, payload: { fragmentId: 2 } });
    state.pendingActions.push(action);
    driver2.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);

    evacuateZone(state, zone);
    tickLocomotion(state);

    // No cargo committed yet — the ordinary claim-only release runs
    // (isCommittedToOwnCargo is false), unlike the cargo-loaded case above.
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicle.payload).toBeNull();

    // Nothing was carried — the fragment is untouched, still on the ground.
    const cargo = state.logistics.fragments.find(f => f.fragment.id === 2)!;
    expect(cargo.state).toBe('on_ground');
    expect(cargo.vehicleId).toBeNull();

    const drivenBy2 = resolveVehicleDriver(vehicle, state.employees.employees);
    expect(isInZone(drivenBy2!.itinerary!.legs[0]!.destX, drivenBy2!.itinerary!.legs[0]!.destZ, zone)).toBe(false);
  });

  it('a vehicle mid-break releases the reservation the same way — breaking never carries payload to begin with (behavior-preserving)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    addBlastFragments(state.logistics, [makeCargoFragment(3, 5000)]);

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_fragmenter', 15, 15);
    const { employee: driver3 } = hireEmployee(state.employees, 'driller', new Random(EVACUATION_SEED), vehicle.x, vehicle.z);
    vehicle.occupantIds = [driver3.id];
    driver3.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const action = makeFragmentGatedAction({
      id: 503, holderId: driver3.id, type: 'fragment_debris', requiredVehicleRole: 'rock_fragmenter', payload: { fragmentId: 3 },
    });
    state.pendingActions.push(action);
    driver3.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);

    evacuateZone(state, zone);
    tickLocomotion(state);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicle.payload).toBeNull();

    const drivenBy3 = resolveVehicleDriver(vehicle, state.employees.employees);
    expect(isInZone(drivenBy3!.itinerary!.legs[0]!.destX, drivenBy3!.itinerary!.legs[0]!.destZ, zone)).toBe(false);
  });

  it('a vehicle with no reservation at all is unaffected — no-op, no crash', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 15, 15);
    const { employee: driver4 } = hireEmployee(state.employees, 'driller', new Random(EVACUATION_SEED), vehicle.x, vehicle.z);
    vehicle.occupantIds = [driver4.id];
    driver4.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    expect(() => evacuateZone(state, zone)).not.toThrow();
    tickLocomotion(state);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicle.payload).toBeNull();
    const drivenBy4 = resolveVehicleDriver(vehicle, state.employees.employees);
    expect(isInZone(drivenBy4!.itinerary!.legs[0]!.destX, drivenBy4!.itinerary!.legs[0]!.destZ, zone)).toBe(false);
  });
});
