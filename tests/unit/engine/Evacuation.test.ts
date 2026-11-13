// BlastSimulator2026 — Tests for findSafeEvacuationCell / evacuateZone
// (src/core/engine/Evacuation.ts, #557).

import { setFreightRoom, sitesOf } from "../../helpers/freightWarehouse.js";
import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { findSafeEvacuationCell, evacuateZone, isMidEvacuationWalk } from '../../../src/core/engine/Evacuation.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { isEvacuationHoldActive, liftSpentZone } from '../../../src/core/engine/EvacuationHold.js';
import { tickEmployees } from '../../../src/core/engine/EmployeeDispatch.js';
import { isInZone, evacuationCellKey, type ZoneBounds } from '../../../src/core/entities/Zone.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { purchaseVehicle, getVehicleReservation, resolveVehicleDriver } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { Random } from '../../../src/core/math/Random.js';
import { EVACUATION_CLEARANCE_M, ACTION_STARVATION_TICK_THRESHOLD } from '../../../src/core/config/balance.js';
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

  it('for a vehicle on a progression site, picks a cell the vehicle can drive to, not one only a walker reaches (#2045)', () => {
    // West of x = 8 the ground stands 0.5 m higher along the whole map: a step a walker takes and a 20-degree vehicle
    // does not. The zone's nearest edge, from (12, 15), lies past that step.
    const state = createGame({ seed: EVACUATION_SEED });
    state.grade = createGradeState();
    const cells: NavCell[][] = [];
    for (let z = 0; z < 40; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < 40; x++) {
        const surfaceY = x < 8 ? 0.5 : 0;
        row.push({ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false, clearance: 2, surfaceY, climbY: surfaceY });
      }
      cells.push(row);
    }
    state.navGrid = new NavGrid(40, 40, cells);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 12, 15);

    const onFoot = findSafeEvacuationCell(state, 12, 15, zone)!;
    const driven = findSafeEvacuationCell(state, 12, 15, zone, vehicle)!;

    expect(onFoot.x).toBeLessThan(8);
    expect(driven).not.toBeNull();
    expect(driven.x).toBeGreaterThanOrEqual(8);
    expect(isInZone(driven.x, driven.z, zone)).toBe(false);
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

  it('false for an idle employee on an occupancy return trip — no claim, so rest and dispatch may take it (#1379)', () => {
    const employee = makeEmployee(null, 40);
    employee.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 40, destZ: 7, arrival: 'exact',
        onArrive: { kind: 'none' }, estTicks: 10, returnTrip: true,
      }],
      goal: { kind: 'reposition', x: 40, z: 7 }, workTicks: 0, estTotalTicks: 10,
    } as typeof employee.itinerary;
    expect(isMidEvacuationWalk(employee)).toBe(false);
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
    origin: { x: 0, y: 0, z: 0 },
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
    setFreightRoom(state, 5000); // fresh state holds 0 kg until a warehouse syncs capacity (#1369)
    state.navGrid = flatWalkableGrid(40);
    setFreightRoom(state, 5000);
    addBlastFragments(state.logistics, [makeCargoFragment(1, 850)]);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 15, 15);
    pickupFragment(state.logistics, 1, String(vehicle.id), sitesOf(state), 0, 0);
    // #1089: a real, co-located, mounted driver — see the first describe
    // block's own comment on why a dangling driverId no longer works.
    const { employee: driver1 } = hireEmployee(state.employees, 'driller', new Random(EVACUATION_SEED), vehicle.x, vehicle.z);
    vehicle.occupantIds = [driver1.id];
    driver1.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const action = makeFragmentGatedAction({ id: 501, holderId: driver1.id, payload: { fragmentId: 1 } });
    state.pendingActions.push(action);
    driver1.activeActionId = action.id;
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    vehicle.cargo = [{ fragmentId: 1, massKg: 850 }];

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
    expect(vehicle.cargo).toEqual([{ fragmentId: 1, massKg: 850 }]);

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
    expect(vehicle.cargo).toEqual([]);

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
    expect(vehicle.cargo).toEqual([]);

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
    expect(vehicle.cargo).toEqual([]);
    const drivenBy4 = resolveVehicleDriver(vehicle, state.employees.employees);
    expect(isInZone(drivenBy4!.itinerary!.legs[0]!.destX, drivenBy4!.itinerary!.legs[0]!.destZ, zone)).toBe(false);
  });
});


// ── #2230: shorter trips, no shared cells, destinations that hold, no re-entry ────────────────────────────────

/** Where an employee's current itinerary ends, or null without one. */
function itineraryEnd(employee: Employee): { x: number; z: number } | null {
  const legs = employee.itinerary?.legs;
  if (!legs || legs.length === 0) return null;
  const last = legs[legs.length - 1]!;
  return { x: last.destX, z: last.destZ };
}

function cellKeyOf(point: { x: number; z: number }): string {
  return evacuationCellKey(point.x, point.z);
}

/** Replaces the cells of a flat grid with blocked ones. */
function blockCells(grid: NavGrid, cells: Array<[number, number]>): void {
  for (const [x, z] of cells) {
    grid.cells[z]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
  }
}

/**
 * findSafeEvacuationCell with the contract's sixth parameter (#2230): the skeleton's declaration may lag behind it, so the
 * avoid-cell calls go through this typed alias.
 */
const findSafeAvoiding = findSafeEvacuationCell as (
  state: ReturnType<typeof createGame>, fromX: number, fromZ: number, zone: ZoneBounds,
  vehicle?: Vehicle, avoidCells?: ReadonlySet<string>,
) => { x: number; z: number } | null;

describe('findSafeEvacuationCell avoidCells (#2230, C4)', () => {
  const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

  it('skips a cell whose key is in avoidCells and returns another one clear of the zone', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const first = findSafeEvacuationCell(state, 16, 15, zone)!;

    const next = findSafeAvoiding(state, 16, 15, zone, undefined, new Set([cellKeyOf(first)]));

    expect(next).not.toBeNull();
    expect(cellKeyOf(next!)).not.toBe(cellKeyOf(first));
    expect(isInZone(next!.x, next!.z, {
      x1: zone.x1 - EVACUATION_CLEARANCE_M, z1: zone.z1 - EVACUATION_CLEARANCE_M,
      x2: zone.x2 + EVACUATION_CLEARANCE_M, z2: zone.z2 + EVACUATION_CLEARANCE_M,
    })).toBe(false);
  });

  it('an empty avoidCells set changes nothing', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);

    expect(findSafeAvoiding(state, 16, 15, zone, undefined, new Set())).toEqual(findSafeEvacuationCell(state, 16, 15, zone));
  });

  it('keeps skipping as more cells are avoided: every answer is a distinct cell', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const avoid = new Set<string>();
    const keys: string[] = [];

    for (let i = 0; i < 5; i++) {
      const dest = findSafeAvoiding(state, 16, 15, zone, undefined, avoid);
      expect(dest).not.toBeNull();
      keys.push(cellKeyOf(dest!));
      avoid.add(cellKeyOf(dest!));
    }

    expect(new Set(keys).size).toBe(5);
  });

  it('returns null when every cell of the map is avoided', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const everything = new Set<string>();
    for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) everything.add(evacuationCellKey(x, z));

    expect(findSafeAvoiding(state, 16, 15, zone, undefined, everything)).toBeNull();
  });

  it('avoids the cell for a vehicle being driven out as well', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 16, 15);
    const first = findSafeEvacuationCell(state, 16, 15, zone, vehicle)!;

    const next = findSafeAvoiding(state, 16, 15, zone, vehicle, new Set([cellKeyOf(first)]));

    expect(next).not.toBeNull();
    expect(cellKeyOf(next!)).not.toBe(cellKeyOf(first));
  });
});

describe('findSafeEvacuationCell stays on the near side of the zone (#2230, C5)', () => {
  // A wide zone on a 60 x 60 map: from (30, 12) the nearest way out is north, 2 m from the edge, to (30, 4).
  const zone: ZoneBounds = { x1: 10, z1: 10, x2: 50, z2: 30 };
  const clearedZone: ZoneBounds = {
    x1: zone.x1 - EVACUATION_CLEARANCE_M, z1: zone.z1 - EVACUATION_CLEARANCE_M,
    x2: zone.x2 + EVACUATION_CLEARANCE_M, z2: zone.z2 + EVACUATION_CLEARANCE_M,
  };
  const FROM = { x: 30, z: 12 };
  /** The far side of the zone is 24 m away; a short trip stays well inside this. */
  const SHORT_TRIP_M = 12;

  function distanceFrom(dest: { x: number; z: number }): number {
    return Math.hypot(dest.x - FROM.x, dest.z - FROM.z);
  }

  it('baseline: the nearest edge is used when its projection is free', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(60);

    const dest = findSafeEvacuationCell(state, FROM.x, FROM.z, zone)!;

    expect(dest.z).toBeLessThan(zone.z1);
    expect(distanceFrom(dest)).toBeLessThanOrEqual(SHORT_TRIP_M);
  });

  it('a blocked projection is replaced by a cell beside it along the same edge, not one across the zone', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(60);
    blockCells(state.navGrid, [[30, 4]]);

    const dest = findSafeEvacuationCell(state, FROM.x, FROM.z, zone)!;

    expect(dest).not.toBeNull();
    expect(isInZone(dest.x, dest.z, clearedZone)).toBe(false);
    expect(dest.z).toBeLessThan(zone.z1);
    expect(distanceFrom(dest)).toBeLessThanOrEqual(SHORT_TRIP_M);
  });

  it('a wall of blocked cells along the edge is skirted, still on the near side', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(60);
    blockCells(state.navGrid, [[28, 4], [29, 4], [30, 4], [31, 4], [32, 4]]);

    const dest = findSafeEvacuationCell(state, FROM.x, FROM.z, zone)!;

    expect(dest).not.toBeNull();
    expect(dest.z).toBeLessThan(zone.z1);
    expect(distanceFrom(dest)).toBeLessThanOrEqual(SHORT_TRIP_M);
  });

  it('an avoided projection is replaced by a cell beside it along the same edge, not one across the zone', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(60);
    const first = findSafeEvacuationCell(state, FROM.x, FROM.z, zone)!;

    const dest = findSafeAvoiding(state, FROM.x, FROM.z, zone, undefined, new Set([cellKeyOf(first)]))!;

    expect(dest).not.toBeNull();
    expect(cellKeyOf(dest)).not.toBe(cellKeyOf(first));
    expect(dest.z).toBeLessThan(zone.z1);
    expect(distanceFrom(dest)).toBeLessThanOrEqual(SHORT_TRIP_M);
  });

  it('a projection past the map edge falls to the next nearest edge, a short trip along the zone', () => {
    // East of (55, 20) the projection (62, 20) is off the 60-wide map; north and south are each 10 m away.
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(60);
    const eastZone: ZoneBounds = { x1: 10, z1: 10, x2: 56, z2: 30 };

    const dest = findSafeEvacuationCell(state, 55, 20, eastZone)!;

    expect(dest).not.toBeNull();
    expect(state.navGrid.containsCell(dest.x, dest.z)).toBe(true);
    expect(Math.hypot(dest.x - 55, dest.z - 20)).toBeLessThanOrEqual(SHORT_TRIP_M + 4);
  });

  it('still returns null when nothing clear of the zone is reachable at all', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(22);

    expect(findSafeEvacuationCell(state, 10, 10, { x1: -100, z1: -100, x2: 100, z2: 100 })).toBeNull();
  });
});

describe('evacuateZone hands out distinct destinations and holds them (#2230, C3, C4)', () => {
  const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

  function crewAt(state: ReturnType<typeof createGame>, positions: Array<[number, number]>): Employee[] {
    const rng = new Random(EVACUATION_SEED);
    return positions.map(([x, z]) => hireEmployee(state.employees, 'driller', rng, x, z).employee);
  }

  it('sends employees standing side by side in the zone to pairwise distinct cells', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const crew = crewAt(state, [[16, 15], [17, 15], [16, 14], [17, 16]]);

    const result = evacuateZone(state, zone);

    for (const e of crew) expect(result.orderedEmployeeIds).toContain(e.id);
    const keys = crew.map(e => cellKeyOf(itineraryEnd(e)!));
    expect(new Set(keys).size).toBe(crew.length);
    for (const e of crew) expect(isInZone(itineraryEnd(e)!.x, itineraryEnd(e)!.z, zone)).toBe(false);
  });

  it('gives a walker and a driven vehicle leaving from the same spot different cells', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const rng = new Random(EVACUATION_SEED);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 16, 15);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, vehicle.x, vehicle.z);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const { employee: walker } = hireEmployee(state.employees, 'driller', rng, 16, 15);

    const result = evacuateZone(state, zone);

    expect(result.orderedVehicleIds).toContain(vehicle.id);
    expect(result.orderedEmployeeIds).toContain(walker.id);
    expect(cellKeyOf(itineraryEnd(driver)!)).not.toBe(cellKeyOf(itineraryEnd(walker)!));
  });

  it('never sends an evacuee to the cell an employee outside the zone stands on', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const [bystander, walker] = crewAt(state, [[26, 15], [16, 15]]) as [Employee, Employee];

    evacuateZone(state, zone);

    expect(cellKeyOf(itineraryEnd(walker)!)).not.toBe(evacuationCellKey(bystander.x, bystander.z));
    expect(bystander.itinerary).toBeNull();
  });

  it('never sends an evacuee to the cell a parked vehicle stands on', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 26, 15);
    const [walker] = crewAt(state, [[16, 15]]) as [Employee];

    evacuateZone(state, zone);

    expect(cellKeyOf(itineraryEnd(walker)!)).not.toBe(evacuationCellKey(vehicle.x, vehicle.z));
  });

  it('a second order on the same zone leaves a walker mid-way to its cell on the very same walk', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const [walker] = crewAt(state, [[16, 15]]) as [Employee];
    evacuateZone(state, zone);
    tickLocomotion(state);
    const itinerary = walker.itinerary;
    const end = itineraryEnd(walker);

    const again = evacuateZone(state, zone);

    expect(again.orderedEmployeeIds).toContain(walker.id);
    expect(again.strandedEmployeeIds).not.toContain(walker.id);
    expect(walker.itinerary).toBe(itinerary);
    expect(itineraryEnd(walker)).toEqual(end);
  });

  it('a second order does not hand a newcomer the cell a kept walker is heading for', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const [early] = crewAt(state, [[16, 15]]) as [Employee];
    evacuateZone(state, zone);
    const keptEnd = itineraryEnd(early)!;
    const [late] = crewAt(state, [[16, 15]]) as [Employee];

    evacuateZone(state, zone);

    expect(itineraryEnd(early)).toEqual(keptEnd);
    expect(cellKeyOf(itineraryEnd(late)!)).not.toBe(cellKeyOf(keptEnd));
  });

  it('a stuck walker is given a new way out by a second order', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const [walker] = crewAt(state, [[16, 15]]) as [Employee];
    evacuateZone(state, zone);
    const itinerary = walker.itinerary;
    walker.isMoveStuck = true;
    walker.moveConsecutiveFailures = 10;

    const again = evacuateZone(state, zone);

    expect(again.orderedEmployeeIds).toContain(walker.id);
    expect(walker.itinerary).not.toBeNull();
    expect(walker.itinerary).not.toBe(itinerary);
  });
});

describe('evacuateZone does not send an evacuee back in for a driverless vehicle (#2230, C1)', () => {
  const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

  /**
   * `leaver` ('driver': truck and excavator licences) is ordered out of an empty zone by a first evacuation, walks to
   * (25, 15) and stands there. Then a driverless digger is left in the zone and the zone is evacuated again.
   */
  function reEvacuation(options: { relief: 'none' | 'idle' | 'resting' }) {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const rng = new Random(EVACUATION_SEED);
    const { employee: leaver } = hireEmployee(state.employees, 'driver', rng, 15, 15);
    const first = evacuateZone(state, zone);
    expect(first.orderedEmployeeIds).toContain(leaver.id);
    expect(state.zone.evacuatedEmployeeIds).toContain(leaver.id);
    // The leaver has walked out and stands outside.
    leaver.x = 25; leaver.z = 15;
    leaver.itinerary = null; leaver.destinationX = null; leaver.destinationZ = null;

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 15, 15);
    vehicle.occupantIds = [];
    let relief: Employee | null = null;
    if (options.relief !== 'none') {
      relief = hireEmployee(state.employees, 'driver', rng, 38, 38).employee;
      if (options.relief === 'resting') relief.restTicksRemaining = 30;
    }
    const second = evacuateZone(state, zone);
    return { state, leaver, relief, vehicle, second };
  }

  it('fetches the vehicle with another licensed driver who was never ordered out', () => {
    const { leaver, relief, vehicle, second } = reEvacuation({ relief: 'idle' });

    expect(relief!.pendingDriverVehicleId).toBe(vehicle.id);
    expect(leaver.pendingDriverVehicleId).toBeNull();
    expect(leaver.itinerary).toBeNull();
    expect(second.orderedVehicleIds).toContain(vehicle.id);
  });

  it('waits for a resting licensed driver rather than ordering the one who left', () => {
    const { leaver, vehicle, second } = reEvacuation({ relief: 'resting' });

    expect(second.awaitingRescuerVehicleIds).toContain(vehicle.id);
    expect(leaver.itinerary).toBeNull();
    expect(leaver.pendingDriverVehicleId).toBeNull();
  });

  it('still does not send the one who left when nobody else is licensed: the vehicle stays, stranded (#2259)', () => {
    const { leaver, vehicle, second } = reEvacuation({ relief: 'none' });

    expect(leaver.pendingDriverVehicleId).toBeNull();
    expect(second.orderedVehicleIds).not.toContain(vehicle.id);
    expect(second.strandedVehicleIds).toContain(vehicle.id);
  });
});

// ── #2259, C1: an evacuated worker claims no work inside a zone a live blast plan still threatens ─────────────────────
// The hold stamp only covers actions that existed when the order was given; an action created afterwards, or one a
// worker reaches through the open pool or the starvation path, walked the evacuee straight back in.

describe('an evacuated employee claims no in-zone work while a live blast plan threatens the zone (#2259, C1)', () => {
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
      queuedAtTick: 0,
      ...overrides,
    };
  }

  /**
   * An armed zone over (10..20, 10..20) with a live drill plan inside it. Two drillers stand outside: `evacuee` is
   * listed as evacuated, `bystander` never was. No action carries a hold stamp: they are all created after the order.
   */
  function armedZone() {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    state.zone.activeZone = zone;
    state.drillHoles.push({ id: 'H1', x: 15, z: 15, depth: 6, diameter: 0.089 });
    const rng = new Random(EVACUATION_SEED);
    const { employee: evacuee } = hireEmployee(state.employees, 'driller', rng, 30, 30);
    const { employee: bystander } = hireEmployee(state.employees, 'driller', rng, 31, 30);
    state.zone.evacuatedEmployeeIds = [evacuee.id];
    return { state, evacuee, bystander };
  }

  /** Dispatches `ticks` times with the bystander parked, so only the evacuee can claim. */
  function dispatchOnlyEvacuee(state: ReturnType<typeof armedZone>['state'], bystander: Employee, ticks = 1): void {
    bystander.restTicksRemaining = 100000;
    for (let i = 0; i < ticks; i++) tickEmployees(state);
  }

  it('does not claim an action targeted at it whose target lies in the zone', () => {
    const { state, evacuee, bystander } = armedZone();
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15, targetEmployeeId: evacuee.id });
    state.pendingActions.push(action);

    dispatchOnlyEvacuee(state, bystander);

    expect(action.status).toBe('queued');
    expect(action.holderId).toBeNull();
    expect(evacuee.activeActionId).toBeNull();
    expect(evacuee.taskQueue).toEqual([]);
  });

  it('does not claim an open-pool action whose target lies in the zone', () => {
    const { state, evacuee, bystander } = armedZone();
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15 });
    state.pendingActions.push(action);

    dispatchOnlyEvacuee(state, bystander);

    expect(action.status).toBe('queued');
    expect(action.holderId).toBeNull();
    expect(evacuee.activeActionId).toBeNull();
  });

  it('does not claim a starved in-zone pool action through the starvation promotion', () => {
    const { state, evacuee, bystander } = armedZone();
    state.tickCount = ACTION_STARVATION_TICK_THRESHOLD + 10;
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15, queuedAtTick: 0 });
    state.pendingActions.push(action);

    dispatchOnlyEvacuee(state, bystander);

    expect(action.status).toBe('queued');
    expect(evacuee.activeActionId).toBeNull();
    expect(evacuee.taskQueue).toEqual([]);
  });

  it('stays out over many ticks: the in-zone action is never claimed, and the worker never walks toward it', () => {
    const { state, evacuee, bystander } = armedZone();
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15 });
    state.pendingActions.push(action);
    const startX = evacuee.x;
    const startZ = evacuee.z;

    dispatchOnlyEvacuee(state, bystander, 60);

    expect(action.status).toBe('queued');
    expect(evacuee.x).toBe(startX);
    expect(evacuee.z).toBe(startZ);
  });

  it('picks work outside the zone instead, when the pool holds both', () => {
    const { state, evacuee, bystander } = armedZone();
    const inZone = makeAction({ id: 1, targetX: 15, targetZ: 15 });
    const outside = makeAction({ id: 2, targetX: 36, targetZ: 36 });
    state.pendingActions.push(inZone, outside);

    dispatchOnlyEvacuee(state, bystander);

    expect(inZone.status).toBe('queued');
    expect(outside.status).toBe('assigned');
    expect(outside.holderId).toBe(evacuee.id);
    expect(evacuee.activeActionId).toBe(2);
  });

  it('still claims an action targeted at it whose target is outside the zone', () => {
    const { state, evacuee, bystander } = armedZone();
    const action = makeAction({ id: 1, targetX: 36, targetZ: 36, targetEmployeeId: evacuee.id });
    state.pendingActions.push(action);

    dispatchOnlyEvacuee(state, bystander);

    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(evacuee.id);
  });

  it('an employee who was not evacuated claims the in-zone action as before', () => {
    const { state, evacuee, bystander } = armedZone();
    evacuee.restTicksRemaining = 100000;
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15 });
    state.pendingActions.push(action);

    tickEmployees(state);

    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(bystander.id);
  });

  it('an employee who was not evacuated claims an in-zone action targeted at it as before', () => {
    const { state, evacuee, bystander } = armedZone();
    evacuee.restTicksRemaining = 100000;
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15, targetEmployeeId: bystander.id });
    state.pendingActions.push(action);

    tickEmployees(state);

    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(bystander.id);
  });

  it('claims the in-zone pool action once the blast has fired and lifted the zone', () => {
    const { state, evacuee, bystander } = armedZone();
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15 });
    state.pendingActions.push(action);
    dispatchOnlyEvacuee(state, bystander);
    expect(action.status).toBe('queued');

    state.drillHoles = [];
    liftSpentZone(state);
    dispatchOnlyEvacuee(state, bystander);

    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(evacuee.id);
  });

  it('claims the in-zone targeted action once the blast has fired and lifted the zone', () => {
    const { state, evacuee, bystander } = armedZone();
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15, targetEmployeeId: evacuee.id });
    state.pendingActions.push(action);
    dispatchOnlyEvacuee(state, bystander);
    expect(action.status).toBe('queued');

    state.drillHoles = [];
    liftSpentZone(state);
    dispatchOnlyEvacuee(state, bystander);

    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(evacuee.id);
  });

  it('claims the in-zone action when the drill plan is gone though the zone is still drawn (no blast threatens it)', () => {
    const { state, evacuee, bystander } = armedZone();
    state.drillHoles = [];
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15 });
    state.pendingActions.push(action);

    dispatchOnlyEvacuee(state, bystander);

    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(evacuee.id);
  });

  it('claims the in-zone action when the live plan lies elsewhere and never overlaps the zone', () => {
    const { state, evacuee, bystander } = armedZone();
    state.drillHoles = [{ id: 'H9', x: 500, z: 500, depth: 6, diameter: 0.089 }];
    const action = makeAction({ id: 1, targetX: 15, targetZ: 15 });
    state.pendingActions.push(action);

    dispatchOnlyEvacuee(state, bystander);

    expect(action.status).toBe('assigned');
    expect(action.holderId).toBe(evacuee.id);
  });
});

// ── #2259, C2: one shortest route out; no shuttling ──────────────────────────────────────────────────────────────────

describe('an evacuated worker takes one route out and stays out until the shot (#2259, C2)', () => {
  const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

  it('walks out once, never claims the in-zone work created after the order, and is not re-ordered', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    state.zone.activeZone = zone;
    state.drillHoles.push({ id: 'H1', x: 15, z: 15, depth: 6, diameter: 0.089 });
    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 15, 15);

    const first = evacuateZone(state, zone);
    expect(first.orderedEmployeeIds).toContain(employee.id);
    // Work appears after the order: nothing carries a hold stamp.
    state.pendingActions.push({
      id: 1, type: 'general_work', requiredSkill: null, requiredVehicleRole: null,
      targetX: 15, targetZ: 15, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: state.tickCount,
    });

    let travelled = 0;
    let prevX = employee.x;
    let prevZ = employee.z;
    let leftZoneAt = -1;
    let backInZoneAfterLeaving = false;
    for (let t = 0; t < 400; t++) {
      state.tickCount++;
      tickEmployees(state);
      tickLocomotion(state);
      travelled += Math.hypot(employee.x - prevX, employee.z - prevZ);
      prevX = employee.x; prevZ = employee.z;
      const inside = isInZone(employee.x, employee.z, zone);
      if (!inside && leftZoneAt < 0) leftZoneAt = t;
      if (inside && leftZoneAt >= 0) backInZoneAfterLeaving = true;
    }

    expect(leftZoneAt).toBeGreaterThanOrEqual(0);
    expect(backInZoneAfterLeaving).toBe(false);
    expect(state.pendingActions.find(a => a.id === 1)!.status).toBe('queued');
    // One trip to the safe cell: the walk is no longer than the straight line to where the worker ended, plus slack
    // for the grid's eight-way steps. A walk out and back adds twice the distance.
    const direct = Math.hypot(employee.x - 15, employee.z - 15);
    expect(travelled).toBeLessThanOrEqual(direct * 1.5 + 2);
    expect(isInZone(employee.x, employee.z, zone)).toBe(false);
  });
});
