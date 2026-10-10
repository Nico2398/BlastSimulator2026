// BlastSimulator2026 — Tests for tickLocomotion
// (src/core/engine/Locomotion.ts, #1089 mount/itinerary rebuild phase 3b).
//
// tickLocomotion is the ONLY mover: it walks every alive employee's current
// itinerary leg (or, for an employee with no itinerary, the legacy
// destinationX/Z single foot leg) one tick's worth of movement, and — for a
// mounted employee — writes their vehicle's x/z from theirs. This is the sole
// place a vehicle's position ever changes (gameplay-vehicle-fleet skill,
// `vehicles` rule). tickVehicle/tickEmployeeMovement (EntityMovementTick.ts)
// still exist, so these tests exercise the NEW module directly rather than
// through the old tick pipeline.

import { describe, it, expect, vi } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, getVehicleDefByTier, ROLE_LICENCE_REQUIRED, vehicleDriverId, getVehicleReservation } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { AGENT_WALK_SPEED, AGENT_OCCUPANCY_WAIT_TICKS, MOVE_STUCK_ABANDON_TICKS, STUCK_MORALE_PENALTY, AGENT_FREE_CELL_SEARCH_MAX_RADIUS } from '../../../src/core/config/balance.js';
import { tickLocomotion, openMovementTrails, isStationaryBusyEmployee, respreadLegDestination } from '../../../src/core/engine/Locomotion.js';
import { rampFootprint } from '../../../src/core/mining/RampWidening.js';
import { moveTo } from '../../../src/core/engine/MoveTo.js';
import * as AgentAdvanceModule from '../../../src/core/nav/AgentAdvance.js';
import { NULL_ROUTE_COMMITMENT } from '../../../src/core/nav/AgentAdvance.js';
import { AgentOccupancy, type Occupant } from '../../../src/core/nav/AgentOccupancy.js';
import type { Itinerary } from '../../../src/core/engine/Itinerary.js';
import { detectTrafficJam } from '../../../src/core/events/EventEngine.js';
import { employeeWorkState } from '../../../src/core/engine/EmployeeDispatch.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';
import { planItinerary } from '../../../src/core/engine/PlanItinerary.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';

const SEED = 42;

/** Solid rock voxel — same fixture shape used throughout the existing movement suites. */
function solidVoxel() {
  return { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}

/** A fully walkable flat NavGrid, wide enough for long straight drives. */
function buildFlatNavGridState(sizeX: number, sizeZ: number): GameState {
  const state = createGame({ seed: SEED });
  const vg = new VoxelGrid(sizeX, sizeZ);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      vg.setVoxel(x, 0, z, solidVoxel());
    }
  }
  state.navGrid = NavGrid.buildNavGrid(vg, [], []);
  return state;
}

/**
 * RAMP_WIDTH-wide (3-row) horizontal corridor, walled by void on both sides
 * (z=0 and z=4). Clearance caps out at NAV_CLEARANCE_MAX_CELLS only on the
 * centre row (z=2, Chebyshev distance 2 from either wall); the two edge rows
 * (z=1, z=3) read clearance 1, below NAV_CLEARANCE_VEHICLE_CELLS — so despite
 * being physically 3 cells wide, a *vehicle* still has exactly one passable
 * lane (z=2) with no lateral bypass, same as the pre-#1154 single-row
 * corridor this replaces (#1154 requires clearance>=2 for a vehicle, which a
 * literal 1-wide corridor can never satisfy even to take a first step).
 */
function buildCorridorState(sizeX: number): GameState {
  const state = createGame({ seed: SEED });
  const vg = new VoxelGrid(sizeX, 5);
  for (let x = 0; x < sizeX; x++) {
    vg.setVoxel(x, 0, 1, solidVoxel());
    vg.setVoxel(x, 0, 2, solidVoxel());
    vg.setVoxel(x, 0, 3, solidVoxel());
  }
  state.navGrid = NavGrid.buildNavGrid(vg, [], []);
  return state;
}

/**
 * Two parallel vehicle-passable lanes (centred z=2 and z=8, each a
 * RAMP_WIDTH-wide 3-row corridor per buildCorridorState's reasoning), joined
 * only at their two ends (x=0..2 and x=sizeX-3..sizeX-1) by a solid bridge
 * spanning both lanes' full z-range. A blocker parked mid-way along the z=2
 * lane therefore still has a route around it — the long way via the z=8 lane
 * — but that route is several times longer than the direct one, so the
 * unconstrained shortest path always prefers to go straight through the
 * blocked cell. This is the chokepoint shape #1166's slope gate produces on
 * real terrain, reduced to its minimum. The 3-row lanes and 3-column bridges
 * (rather than the pre-#1154 single-cell corridor/connector) are the minimum
 * width a vehicle's NAV_CLEARANCE_VEHICLE_CELLS=2 requirement can actually
 * traverse — see buildCorridorState.
 */
function buildRingCorridorState(sizeX: number): GameState {
  const state = createGame({ seed: SEED });
  const vg = new VoxelGrid(sizeX, 11);
  for (let x = 0; x < sizeX; x++) {
    for (const z of [1, 2, 3, 7, 8, 9]) {
      vg.setVoxel(x, 0, z, solidVoxel());
    }
  }
  for (const xStart of [0, sizeX - 3]) {
    for (let dx = 0; dx < 3; dx++) {
      for (let z = 1; z <= 9; z++) {
        vg.setVoxel(xStart + dx, 0, z, solidVoxel());
      }
    }
  }
  state.navGrid = NavGrid.buildNavGrid(vg, [], []);
  return state;
}

/**
 * A directly-editable flat, fully-walkable NavGrid (mirrors the identical
 * helper in EmployeeDispatchSteps.test.ts/RestActionHelpers.test.ts) — unlike
 * buildFlatNavGridState above (VoxelGrid-derived), its cells can be walled
 * off and later reopened in place, which the #1178 retry tests below need.
 */
function makeFlatNavGrid(width: number, height: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
}

/** Impassable vertical wall spanning every row at world x. */
function blockColumn(grid: NavGrid, x: number): void {
  for (let z = 0; z < grid.height; z++) {
    grid.cells[z]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
  }
}

/** Reopens a column blockColumn previously sealed — the same cell shape makeFlatNavGrid seeds every other cell with. */
function openColumn(grid: NavGrid, x: number): void {
  for (let z = 0; z < grid.height; z++) {
    grid.cells[z]![x] = { type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false };
  }
}

/** Minimal 'general_work' PendingAction fixture, mirrors the `makeAction` shape used across the engine test suites. */
function makeGeneralWorkAction(id: number): PendingAction {
  return {
    id,
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 0, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    queuedAtTick: 0,
  };
}

/**
 * A genuinely one-cell-wide foot corridor (#1206), open into a small
 * 3-row room at each end so an occupancy-aware walker actually has
 * somewhere to step aside/wait rather than a single dead-end lane: rows
 * z=0 and z=2 are blocked for the mid-range columns given by
 * `corridorXRange`, leaving only z=1 walkable there, while every other
 * column (the two end "rooms") keeps all three rows open.
 */
function build1WideCorridorState(width: number, corridorXRange: [number, number]): GameState {
  const state = createGame({ seed: SEED });
  const grid = makeFlatNavGrid(width, 3);
  const [lo, hi] = corridorXRange;
  for (let x = lo; x <= hi; x++) {
    grid.cells[0]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
    grid.cells[2]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
  }
  state.navGrid = grid;
  return state;
}

/** `x,z` rounded to the nearest grid cell — the same convention Locomotion.ts's own isOccupiedByOtherVehicle uses. */
function cellKey(x: number, z: number): string {
  return `${Math.round(x)},${Math.round(z)}`;
}

/** Fails when any two of `agents` round onto the same grid cell right now. */
function expectNoSharedCells(agents: ReadonlyArray<{ id: number; x: number; z: number }>): void {
  const keys = agents.map(a => cellKey(a.x, a.z));
  expect(new Set(keys).size, `expected ${agents.length} distinct cells, got: ${JSON.stringify(agents.map(a => ({ id: a.id, x: a.x, z: a.z })))}`).toBe(keys.length);
}

/**
 * Blocks every terrain cell within Chebyshev distance `1..radius` of
 * (bx, bz) — except any cell listed in `exempt` — on a raw `NavGrid` built
 * via `makeFlatNavGrid` (locally-indexed, origin (0,0)). Used by #1278's
 * "blocker has no escape" fixtures to saturate a would-be relocation
 * target's own neighbourhood with impassable terrain instead of dozens of
 * hand-placed occupant fixtures: `findNearestFreeCell`'s ring search
 * (Locomotion.ts) treats a `'blocked'` cell exactly like an occupied one, so
 * this is an equivalent, far cheaper way to prove "nothing free nearby".
 */
function blockNeighbourhood(
  grid: NavGrid, bx: number, bz: number, radius: number, exempt: ReadonlyArray<{ x: number; z: number }> = [],
): void {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx === 0 && dz === 0) continue;
      const x = bx + dx;
      const z = bz + dz;
      if (exempt.some(e => e.x === x && e.z === z)) continue;
      if (x < 0 || z < 0 || x >= grid.width || z >= grid.height) continue;
      grid.cells[z]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
    }
  }
}

describe('tickLocomotion', () => {
  it('advances a mounted employee at the vehicle\'s tiered speed, not AGENT_WALK_SPEED, and the vehicle tracks the employee\'s position', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0, 1);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const speed = getVehicleDefByTier(vehicle.type, vehicle.tier).speed;
    expect(speed).not.toBe(AGENT_WALK_SPEED);

    employee.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 12, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: Math.ceil(12 / speed),
      }],
      goal: { kind: 'reposition', x: 12, z: 0 },
      workTicks: 0,
      estTotalTicks: Math.ceil(12 / speed),
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(employee.x).toBe(speed);
    expect(employee.z).toBe(0);
    expect(vehicle.x).toBe(employee.x);
    expect(vehicle.z).toBe(employee.z);
  });

  it('advances an on-foot employee with an itinerary foot leg at AGENT_WALK_SPEED', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    employee.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 12, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 6,
      }],
      goal: { kind: 'reposition', x: 12, z: 0 },
      workTicks: 0,
      estTotalTicks: 6,
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(employee.x).toBe(AGENT_WALK_SPEED);
    expect(employee.z).toBe(0);
  });

  // #1178 (single-mover unification): advanceLegacyFootWalk is deleted —
  // tickLocomotion has exactly one branch (`if (emp.itinerary !== null)`).
  // destinationX/destinationZ are now a READ-ONLY MIRROR of the itinerary's
  // current leg, written only by MoveTo.ts/Locomotion.ts/Mount.ts's alight()
  // — setting them alone, with no itinerary, is inert.
  it('never advances an employee with destinationX/Z set but itinerary === null — the legacy single foot leg is gone (#1178)', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.itinerary = null;
    employee.destinationX = 12;
    employee.destinationZ = 0;

    tickLocomotion(state);

    expect(employee.x).toBe(0);
    expect(employee.z).toBe(0);
    // The mirror fields themselves are untouched by this no-op tick — they
    // simply have no effect on movement any more.
    expect(employee.destinationX).toBe(12);
    expect(employee.destinationZ).toBe(0);
  });

  it('never changes an unoccupied vehicle\'s x/z across 10 ticks', () => {
    const state = buildFlatNavGridState(20, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.occupantIds = [];

    for (let i = 0; i < 10; i++) {
      tickLocomotion(state);
      expect(vehicle.x).toBe(5);
      expect(vehicle.z).toBe(5);
    }
  });

  // #1166: a parked vehicle sitting on a chokepoint — a cell the direct
  // route must cross, with a legal but far longer way around — used to
  // livelock the driver rather than send it the long way. handleOccupancyBlock
  // took a single step of the avoiding route and then dropped it, so the very
  // next tick's unconstrained findPath (drive legs pass avoidVehicles:false)
  // routed straight back at the blocker, blocked again, waited out the
  // threshold again, and stepped back onto the detour again, forever. Nothing
  // escalated: every reroute resets isMoveStuck/moveConsecutiveFailures, and
  // the intervening ticks are ordinary successful movement, so the
  // stuck-abandon path never fired and no event was emitted.
  it('applies a non-final leg\'s onArrive step (board) on arrival and continues the itinerary to the next leg', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    // A real board() call (unlike this file's other fixtures, which set
    // occupantIds/locomotion directly) enforces the role's licence.
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    // 1 cell away — well within a single tick's AGENT_WALK_SPEED (2).
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 1, 0);

    employee.itinerary = {
      legs: [
        {
          mode: 'foot', vehicleId: vehicle.id, destX: vehicle.x, destZ: vehicle.z,
          arrival: 'adjacent', onArrive: { kind: 'board', vehicleId: vehicle.id }, estTicks: 1,
        },
        {
          mode: 'drive', vehicleId: vehicle.id, destX: 10, destZ: 0,
          arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 9,
        },
      ],
      goal: { kind: 'reposition', x: 10, z: 0 },
      workTicks: 0,
      estTotalTicks: 10,
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(vehicle.occupantIds).toContain(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    // Itinerary continues — the drive leg is still pending, not abandoned.
    expect(employee.itinerary).not.toBeNull();
    expect(employee.itinerary!.legs).toHaveLength(1);
    expect(employee.itinerary!.legs[0]!.mode).toBe('drive');
  });

  it('clears the itinerary once the FINAL leg is reached', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    employee.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 1, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 1,
      }],
      goal: { kind: 'reposition', x: 1, z: 0 },
      workTicks: 0,
      estTotalTicks: 1,
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(employee.x).toBe(1);
    expect(employee.z).toBe(0);
    expect(employee.itinerary).toBeNull();
  });

  // #1203: a training enrolment's walk-in whose target school was demolished
  // while the employee was still en route must not strand pendingTrainingState
  // forever (isEnrolledInTraining reads it as "still enrolled", permanently
  // blocking rest and a future enrolment, with the fee never refunded).
  // Detected here — at the exact tick the `enter_building` arrival step
  // itself fails — rather than inferred after the fact from generic
  // position/locomotion fields (ArrivalGate.ts used to infer it there; that
  // inference could not tell a genuinely stranded employee from one still
  // mid-route and misfired on synthetic fixtures, so the detection moved to
  // this call site instead).
  it('cancels and refunds a training walk-in whose target school no longer exists when enter_building fails (#1203)', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    // Building id 999 deliberately absent from state.buildings.buildings —
    // demolished out from under this employee's walk.
    employee.pendingTrainingState = { buildingId: 999, skill: 'blasting', ticksRemaining: 50, fee: 500 };
    employee.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 1, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'enter_building', buildingId: 999 }, estTicks: 1,
      }],
      goal: { kind: 'reposition', x: 1, z: 0 },
      workTicks: 0,
      estTotalTicks: 1,
    } satisfies Itinerary;

    const result = tickLocomotion(state);

    expect(employee.pendingTrainingState).toBeNull();
    expect(employee.itinerary).toBeNull();
    expect(result.trainingCancelled).toHaveLength(1);
    expect(result.trainingCancelled[0]).toMatchObject({
      employeeId: employee.id,
      skill: 'blasting',
      buildingId: 999,
      refund: 500,
    });
  });

  // #1204: mirrors the #1203 training-demolition stranded-walk test above —
  // a rest walk's own enter_building arrival step can fail the exact same
  // way (the living_quarters demolished mid-walk, or filled by the time a
  // queued rest is promoted). Left uncleared, pendingRestDuration would strand
  // this employee "resting" forever (isMidCollapseOrForcedRest reads it as
  // still mid-rest, permanently excluding them from claimActionsTargetedAtEmployee)
  // with activeActionId still naming an action nothing will ever complete.
  // Unlike training, rest has no fee — no refund/event is expected here, only
  // the stale rest state and the stale pending action itself being cleared.
  it("clears rest state and discards the stale action when a rest walk's enter_building step fails — building demolished mid-walk (#1204)", () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    // Building id 999 deliberately absent from state.buildings.buildings —
    // demolished out from under this employee's rest walk.
    const actionId = state.nextPendingActionId++;
    const restAction: PendingAction = {
      id: actionId, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
      targetX: 1, targetZ: 0, targetY: 0,
      payload: { buildingId: 999, needKey: 'fatigue', restDuration: 8 },
      targetEmployeeId: employee.id, status: 'assigned', holderId: employee.id, queuedAtTick: 0,
    };
    state.pendingActions.push(restAction);
    employee.activeActionId = actionId;
    employee.pendingRestDuration = 8;
    employee.pendingRestNeedKey = 'fatigue';
    employee.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 1, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'enter_building', buildingId: 999 }, estTicks: 1,
      }],
      goal: { kind: 'reposition', x: 1, z: 0 },
      workTicks: 0,
      estTotalTicks: 1,
    } satisfies Itinerary;

    expect(() => tickLocomotion(state)).not.toThrow();

    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.pendingRestNeedKey).toBeNull();
    expect(employee.activeActionId).toBeNull();
    expect(employee.itinerary).toBeNull();
    expect(state.pendingActions.find(a => a.id === actionId)).toBeUndefined();
  });

  // #1178: with destinationX/Z now a read-only mirror rather than a second
  // movement source, "no itinerary" alone (regardless of destinationX/Z)
  // is the whole no-op condition — this boundary case (both null too) still
  // holds under the new contract.
  it('is a no-op for an employee with no itinerary at all (boundary)', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 3, 4);
    employee.itinerary = null;
    employee.destinationX = null;
    employee.destinationZ = null;

    expect(() => tickLocomotion(state)).not.toThrow();
    expect(employee.x).toBe(3);
    expect(employee.z).toBe(4);
  });
});

// #1091: driveVehicleTowardTarget (the old ad-hoc, itinerary-independent
// drive primitive) is deleted — no remaining caller needs a drive step
// outside the itinerary model any more. Its three behaviors here have real
// equivalents already covered elsewhere in this same file, through the
// itinerary/tickLocomotion path that is now the ONLY mover (this file's own
// header comment): a boarded vehicle advancing at its own tiered speed with
// the driver's position tracking it ("advances a mounted employee at the
// vehicle's tiered speed..." above), arrival exactly at the target leg
// destination ("clears the itinerary once the FINAL leg is reached" above),
// and an unoccupied vehicle never moving ("never changes an unoccupied
// vehicle's x/z across 10 ticks..." above). No replacement case was added
// here — deleting the low-level entry point removed the tests for it rather
// than the behavior itself.

// ── #1130: abandon on a period-2 oscillation, not just a failed replan ─────
//
// advanceAlongPath (AgentAdvance.ts) now reports isStuck: true on a tick
// whose final position exactly matches the mover's own position 2 ticks
// back (moveHistoryX/Z), even though a route WAS found this tick
// (pathFound: true) — a genuine A/B/A/B cycle near a terrain ridge that
// never trips the old `!path.found` stuck path. Both call sites in
// Locomotion.ts (the legacy foot-walk leg and the itinerary leg, on-foot or
// drive) must treat `!outcome.pathFound || outcome.isStuck` as the abandon
// condition, not `!outcome.pathFound` alone — mocked here at the
// advanceAlongPath boundary so the oscillation itself (AgentAdvance.ts's own
// concern, covered directly in tests/unit/nav/AgentAdvance.test.ts) doesn't
// have to be reproduced through a real NavGrid detour to prove Locomotion's
// own dispatch of the outcome.

describe('tickLocomotion — abandons on isStuck even when pathFound is true (#1130)', () => {
  /** An advanceAlongPath outcome shaped like a found-but-oscillating tick, already past the stuck grace window. */
  function oscillatingStuckOutcome(x: number, z: number): ReturnType<typeof AgentAdvanceModule.advanceAlongPath> {
    return {
      pathFound: true,
      x, z,
      consecutiveFailures: MOVE_STUCK_ABANDON_TICKS,
      isStuck: true,
      becameStuck: true,
      isPathComplete: false,
      committed: NULL_ROUTE_COMMITMENT,
      moveHistoryX: null,
      moveHistoryZ: null,
      trail: [],
    };
  }

  // #1178 (single-mover unification): advanceLegacyFootWalk is deleted, so
  // the old "legacy foot-walk leg (destinationX/Z, no itinerary)" abandon
  // case no longer exists as such — beginRestTravel/clearZone/
  // promoteActionToActive now all route an unreachable-at-claim-time target
  // through moveTo(..., { allowUnreachable: true }), which installs a
  // RETRYING itinerary instead of refusing. Unlike the #1130 oscillation
  // cases below (mocked at the advanceAlongPath boundary), this drives a
  // real, genuinely walled-off NavGrid end to end: the itinerary's own leg
  // re-resolves findPath every tick, gets pathFound: false every time the
  // wall stands, and the exact same stuck/abandon machinery
  // (MOVE_STUCK_ABANDON_TICKS, STUCK_MORALE_PENALTY) fires as it always has.
  it('#1178: moveTo(allowUnreachable) to a genuinely walled-off target installs a retrying itinerary that abandons at MOVE_STUCK_ABANDON_TICKS, with STUCK_MORALE_PENALTY applied per stuck tick', () => {
    const grid = makeFlatNavGrid(20, 5);
    blockColumn(grid, 10); // seals off x>=10 from the employee's spawn at x=0
    const state = createGame({ seed: SEED });
    state.navGrid = grid;
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    employee.activeActionId = 77;
    const action = { ...makeGeneralWorkAction(77), holderId: employee.id, status: 'assigned' as const };
    state.pendingActions.push(action);
    const startingMorale = employee.morale;

    const moveResult = moveTo(state, employee.id, { x: 15, z: 2 }, { allowUnreachable: true });
    expect(moveResult.success).toBe(true);
    expect(employee.itinerary).not.toBeNull();
    // destinationX/Z mirror the installed itinerary's current leg (#1178).
    expect(employee.destinationX).toBe(employee.itinerary!.legs[0]!.destX);
    expect(employee.destinationZ).toBe(employee.itinerary!.legs[0]!.destZ);

    const ticksBeforeAbandon = MOVE_STUCK_ABANDON_TICKS - 1;
    for (let i = 0; i < ticksBeforeAbandon; i++) {
      tickLocomotion(state);
    }
    // isMoveStuck flips true well before the abandon threshold (STUCK_THRESHOLD
    // is far smaller than MOVE_STUCK_ABANDON_TICKS), and STUCK_MORALE_PENALTY
    // is applied on every one of those failed ticks, not just once.
    expect(employee.isMoveStuck).toBe(true);
    expect(employee.morale).toBe(Math.max(0, startingMorale - ticksBeforeAbandon * STUCK_MORALE_PENALTY));
    // Never moved — the wall never opened.
    expect(employee.x).toBe(0);
    expect(employee.z).toBe(2);

    const result = tickLocomotion(state); // the MOVE_STUCK_ABANDON_TICKS-th failed tick

    // Abandon runs through interruptActiveAction, whose clearHolderWalkFields
    // (TaskCancellation.ts) unconditionally resets isMoveStuck/
    // moveConsecutiveFailures to their idle defaults — a freshly-released
    // employee is idle, not walking-stuck, exactly as the old legacy-walker
    // abandon path left them.
    expect(employee.isMoveStuck).toBe(false);
    expect(result.abandoned).toEqual(expect.arrayContaining([{ employeeId: employee.id, actionId: 77 }]));
    expect(employee.activeActionId).toBeNull();
    const stored = state.pendingActions.find(a => a.id === 77)!;
    expect(stored.status).toBe('queued');
    // The itinerary is cleared on abandon — the mirror follows it to null.
    expect(employee.itinerary).toBeNull();
    expect(employee.destinationX).toBeNull();
    expect(employee.destinationZ).toBeNull();
  });

  // #1178: the retry mechanic's whole point — a target unreachable AT CLAIM
  // TIME becomes reachable once the obstacle clears, and the SAME installed
  // itinerary (never replaced, never abandoned) walks it the rest of the way,
  // instead of the employee being permanently refused the journey up front.
  it('#1178: opening the wall before the abandon threshold lets the SAME itinerary complete instead of abandoning', () => {
    const grid = makeFlatNavGrid(20, 5);
    blockColumn(grid, 10);
    const state = createGame({ seed: SEED });
    state.navGrid = grid;
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 2);

    const moveResult = moveTo(state, employee.id, { x: 15, z: 2 }, { allowUnreachable: true });
    expect(moveResult.success).toBe(true);
    const installedItinerary = employee.itinerary;
    expect(installedItinerary).not.toBeNull();
    expect(employee.destinationX).toBe(installedItinerary!.legs[0]!.destX);
    expect(employee.destinationZ).toBe(installedItinerary!.legs[0]!.destZ);

    // Well short of the abandon threshold — the wall is still up the whole time.
    for (let i = 0; i < 10; i++) {
      tickLocomotion(state);
    }
    // Same itinerary object — never abandoned/replaced while merely blocked.
    expect(employee.itinerary).toBe(installedItinerary);
    expect(employee.moveConsecutiveFailures).toBeLessThan(MOVE_STUCK_ABANDON_TICKS);
    expect(employee.x).toBe(0);

    openColumn(grid, 10); // the way opens

    const MAX_TICKS = 60;
    let ticks = 0;
    while (ticks < MAX_TICKS && employee.itinerary !== null) {
      tickLocomotion(state);
      ticks++;
    }

    expect(employee.itinerary).toBeNull();
    expect(employee.x).toBe(15);
    expect(employee.z).toBe(2);
  });

  // #1178 follow-up (needs-drain-visual.json regression): a target outside
  // the NavGrid entirely — not walled off, genuinely off-grid — is a
  // DIFFERENT unreachable shape than the walled-off tests above.
  // findPath.clampToGrid (Pathfinding.ts) silently clamps such a target to
  // the nearest in-grid cell and returns pathFound: true for a route to that
  // clamp, so the agent walks there without ever failing a replan — but
  // isLegArrived's exact-match test against the leg's own (unclamped)
  // destX/destZ never agrees the leg is done, and the old
  // isMoveStuck/MOVE_STUCK_ABANDON_TICKS machinery only fires on a FAILED
  // path, never on a genuinely-found-but-short one. Before the fix, this
  // employee walked to the grid edge and then sat there forever: itinerary
  // never null, employeeWorkState stuck reading 'traveling' (EmployeeDispatch.ts)
  // for the rest of the run — confirmed live via needs-drain-visual.json's
  // own general_work dispatch to (150, 150) on a 64-wide map.
  it('#1178: moveTo(allowUnreachable) to a target outside the NavGrid entirely still arrives — snaps to the leg\'s own destination once its clamped route is exhausted', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 2);

    const moveResult = moveTo(state, employee.id, { x: 150, z: 2 }, { allowUnreachable: true });
    expect(moveResult.success).toBe(true);
    expect(employee.itinerary).not.toBeNull();
    expect(employee.destinationX).toBe(150);
    expect(employee.destinationZ).toBe(2);

    const MAX_TICKS = 30;
    let ticks = 0;
    while (ticks < MAX_TICKS && employee.itinerary !== null) {
      tickLocomotion(state);
      ticks++;
    }

    // Arrives at the leg's own literal (unclamped) destination — never
    // abandoned, never permanently parked at the grid edge (x=19).
    expect(employee.itinerary).toBeNull();
    expect(employee.destinationX).toBeNull();
    expect(employee.destinationZ).toBeNull();
    expect(employee.x).toBe(150);
    expect(employee.z).toBe(2);
    expect(employee.isMoveStuck).toBe(false);
  });

  it('itinerary drive leg: abandons and dismounts the driver exactly as a failed replan would, even though the route was genuinely found this tick', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.activeActionId = 88;
    const action = { ...makeGeneralWorkAction(88), holderId: driver.id, status: 'assigned' as const, requiredVehicleRole: 'rock_digger' as const };
    state.pendingActions.push(action);
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 12, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 6,
      }],
      goal: { kind: 'reposition', x: 12, z: 0 },
      workTicks: 0,
      estTotalTicks: 6,
    } satisfies Itinerary;

    const spy = vi.spyOn(AgentAdvanceModule, 'advanceAlongPath').mockReturnValue(oscillatingStuckOutcome(0, 0));

    const result = tickLocomotion(state);

    spy.mockRestore();

    // Same reset as the legacy foot-walk case above — clearHolderWalkFields
    // (via interruptActiveAction) and Locomotion.ts's own explicit
    // vehicle-side reset both zero isMoveStuck once the abandon actually
    // happens; only the reservation release/dismount below is the durable
    // observable outcome.
    expect(driver.isMoveStuck).toBe(false);
    expect(result.abandoned).toEqual(expect.arrayContaining([{ employeeId: driver.id, actionId: 88 }]));
    expect(driver.activeActionId).toBeNull();
    // Dismounted — the vehicle's driver reservation is released along with the abandon.
    expect(vehicleDriverId(vehicle)).toBeNull();
  });

  it('does not abandon when pathFound is true and isStuck is false — the ordinary, non-stuck advancing path is untouched', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.itinerary = null;
    employee.destinationX = 12;
    employee.destinationZ = 0;
    employee.activeActionId = 99;
    const action = { ...makeGeneralWorkAction(99), holderId: employee.id, status: 'assigned' as const };
    state.pendingActions.push(action);

    const spy = vi.spyOn(AgentAdvanceModule, 'advanceAlongPath').mockReturnValue({
      pathFound: true,
      x: AGENT_WALK_SPEED, z: 0,
      consecutiveFailures: 0,
      isStuck: false,
      becameStuck: false,
      isPathComplete: false,
      committed: NULL_ROUTE_COMMITMENT,
      moveHistoryX: 0,
      moveHistoryZ: 0,
      trail: [{ x: AGENT_WALK_SPEED, z: 0 }],
    });

    const result = tickLocomotion(state);

    spy.mockRestore();

    expect(employee.isMoveStuck).toBe(false);
    expect(result.abandoned).toEqual([]);
    expect(employee.activeActionId).toBe(99);
  });

  // #1154 fixer round: nextGridStep's "am I already standing on the path's
  // own first waypoint" check used Math.floor, but that waypoint (built from
  // advanceLeg's driveFromX/driveFromZ, NavGrid.clampX/clampZ) is always the
  // mover's ROUNDED cell. For any position whose fractional part is >= 0.5
  // (round and floor disagree — about half of every tick spent driving), the
  // mismatch misidentified the mover's own current cell as the "next step"
  // still ahead of it. A live vehicle merely parked on that current cell —
  // never actually in the way of the real next step — then read as
  // isOccupiedByOtherVehicle and blocked the drive leg outright, escalating
  // to a full reroute after AGENT_OCCUPANCY_WAIT_TICKS ticks of
  // phantom waiting. Reproduced live via hauling-gate.json: a drill_rig
  // routed around a building's clearance-insufficient ring happened to round
  // onto a parked debris_hauler's cell partway through, costing 20+ ticks to
  // a detour the real next step never needed.
  // #1201: writeVehiclePosition (Locomotion.ts) hardcodes isStationaryNow to
  // `false` on every drive step (TODO(#1138)) — it clears the vehicle's old
  // nav cell every tick but never marks the cell it stops on, so a parked or
  // working vehicle never sets NavCell.vehicleOccupied and pedestrians path
  // straight through it (regression of #954). The four tests below drive
  // that real, unfixed writeVehiclePosition end to end rather than mutating
  // NavCell.vehicleOccupied directly — each is expected to fail against
  // today's code and pass once #1201 lands.
  it('#1201: a drive leg arriving at its destination marks that cell vehicleOccupied, and the driver stays mounted', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const destX = 4;
    const destZ = 2;
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX, destZ,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 4,
      }],
      goal: { kind: 'reposition', x: destX, z: destZ },
      workTicks: 0,
      estTotalTicks: 4,
    } satisfies Itinerary;

    const MAX_TICKS = 20;
    let ticks = 0;
    while (ticks < MAX_TICKS && driver.itinerary !== null) {
      tickLocomotion(state);
      ticks++;
    }

    expect(driver.itinerary).toBeNull();
    expect(vehicle.x).toBe(destX);
    expect(vehicle.z).toBe(destZ);
    // Stopped, so its cell must now block pedestrian pathfinding.
    expect(state.navGrid!.cellAt(destX, destZ)!.vehicleOccupied).toBe(true);
    // Still mounted — arrival with onArrive:'none' never alights the driver.
    expect(vehicleDriverId(vehicle)).toBe(driver.id);
    expect(driver.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
  });

  it('#1201: driving away from a stopped, occupied cell frees it again', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const oldX = 4;
    const oldZ = 2;
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: oldX, destZ: oldZ,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 4,
      }],
      goal: { kind: 'reposition', x: oldX, z: oldZ },
      workTicks: 0,
      estTotalTicks: 4,
    } satisfies Itinerary;

    const MAX_TICKS = 20;
    let ticks = 0;
    while (ticks < MAX_TICKS && driver.itinerary !== null) {
      tickLocomotion(state);
      ticks++;
    }
    // Precondition: genuinely stopped and occupying its cell — fails today
    // since arrival never marks the cell (the same bug the previous test
    // covers), which is why this test fails too rather than trivially
    // passing on the departure check below.
    expect(state.navGrid!.cellAt(oldX, oldZ)!.vehicleOccupied).toBe(true);

    const moveResult = moveTo(state, driver.id, { x: 10, z: 2 }, { via: vehicle.id });
    expect(moveResult.success).toBe(true);

    tickLocomotion(state);

    expect(state.navGrid!.cellAt(oldX, oldZ)!.vehicleOccupied).toBe(false);
  });

  // #1201: mirrors "drives the long way around a vehicle parked on a
  // chokepoint..." above (~line 311), but for a FOOT leg detouring around a
  // genuinely-parked vehicle instead of a drive leg. The blocker here is a
  // real vehicle a driver actually drove to and stopped at — not a manually
  // mutated NavCell — so this exercises the same writeVehiclePosition path
  // as the two tests above: under today's bug the parked vehicle's cell is
  // never marked occupied, so the pedestrian walks straight through it in
  // the direct minimum number of ticks instead of detouring around it.
  it('#1201: a foot employee detours around a stopped, occupying vehicle parked on the direct route instead of walking through it', () => {
    const state = buildCorridorState(12);
    const rng = new Random(SEED);

    // Park a vehicle mid-corridor, directly on the straight-line route
    // between the foot employee's start and end — driven there and stopped
    // through the real locomotion tick, exactly like the test above.
    const { employee: parkedDriver } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    blocker.occupantIds = [parkedDriver.id];
    parkedDriver.locomotion = { kind: 'mounted', vehicleId: blocker.id };
    parkedDriver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: blocker.id, destX: 5, destZ: 2,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5,
      }],
      goal: { kind: 'reposition', x: 5, z: 2 },
      workTicks: 0,
      estTotalTicks: 5,
    } satisfies Itinerary;

    let parkTicks = 0;
    while (parkTicks < 20 && parkedDriver.itinerary !== null) {
      tickLocomotion(state);
      parkTicks++;
    }
    expect(blocker.x).toBe(5);
    expect(blocker.z).toBe(2);

    // Same row (z=2) as the parked blocker, not an adjacent one: with
    // 8-directional movement a walker approaching diagonally has a full free
    // row of lateral slack and can cross from z=3 to z=2 anywhere along x at
    // identical cost, so it never actually needs to touch (5,2) — no detour
    // is provable that way. Starting on the blocker's own row puts (5,2)
    // squarely on the only straight-line path, so bypassing it is the sole
    // way through.
    const { employee: walker } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const moveResult = moveTo(state, walker.id, { x: 11, z: 2 });
    expect(moveResult.success).toBe(true);

    const MAX_TICKS = 60;
    let ticks = 0;
    while (ticks < MAX_TICKS && walker.itinerary !== null) {
      tickLocomotion(state);
      ticks++;
    }

    expect(walker.itinerary).toBeNull();
    expect(walker.x).toBe(11);
    expect(walker.z).toBe(2);
    // Direct, unobstructed distance from (0,2) to (11,2) at AGENT_WALK_SPEED
    // — a detour around a genuinely occupied blocker must cost strictly more
    // ticks than this floor.
    const directTicks = Math.ceil(11 / AGENT_WALK_SPEED);
    expect(ticks).toBeGreaterThan(directTicks);
  });

  // #1201: isOccupiedByOtherVehicle (Locomotion.ts) compares exact float
  // positions (`v.x === x && v.z === z`) instead of rounded cells, so a
  // vehicle stopped at a fractional position never blocks another vehicle
  // from entering the grid cell its position rounds to.
  it('#1201: a driving vehicle does not advance onto a grid cell another vehicle occupies at a fractional position that rounds onto it', () => {
    const state = buildCorridorState(10);
    const rng = new Random(SEED);

    // Idle blocker sitting at a fractional position that rounds to (5, 2) —
    // no lane exists in this single-lane corridor for a driving vehicle to
    // go around it.
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 2);
    blocker.x = 5.3;
    blocker.z = 2;

    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 4, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 4, 2);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 9, destZ: 2,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5,
      }],
      goal: { kind: 'reposition', x: 9, z: 2 },
      workTicks: 0,
      estTotalTicks: 5,
    } satisfies Itinerary;

    tickLocomotion(state);

    // Never advanced onto the blocker's rounded cell (5, 2) — stayed put and
    // waited instead, exactly like the exact-position blocker case above.
    expect(vehicle.x).toBe(4);
    expect(vehicle.z).toBe(2);
  });

});

describe('tickLocomotion — walk trail across a tick batch (#1199)', () => {
  function driveItinerary(vehicleId: number, destX: number, speed: number): Itinerary {
    return {
      legs: [{
        mode: 'drive', vehicleId, destX, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: Math.ceil(destX / speed),
      }],
      goal: { kind: 'reposition', x: destX, z: 0 },
      workTicks: 0,
      estTotalTicks: Math.ceil(destX / speed),
    };
  }

  it('openMovementTrails anchors every alive employee and every vehicle at its current position', () => {
    const state = buildFlatNavGridState(20, 5);
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 3, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 2, 1);
    openMovementTrails(state);
    expect(employee.walkTrail).toEqual({ points: [{ x: 3, z: 1 }], relocated: false, hostMarkers: [] });
    expect(vehicle.walkTrail).toEqual({ points: [{ x: 5, z: 2 }], relocated: false, hostMarkers: [] });
  });

  it('records every tick of a drive on both the driver and the vehicle, ending at their position', () => {
    const state = buildFlatNavGridState(20, 5);
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0, 1);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const speed = getVehicleDefByTier(vehicle.type, vehicle.tier).speed;
    employee.itinerary = driveItinerary(vehicle.id, 12, speed);

    openMovementTrails(state);
    tickLocomotion(state);
    tickLocomotion(state);

    const trail = employee.walkTrail!;
    expect(trail.relocated).toBe(false);
    expect(trail.points[0]).toEqual({ x: 0, z: 0 });
    expect(trail.points.length).toBeGreaterThanOrEqual(3);
    expect(trail.points[trail.points.length - 1]).toEqual({ x: employee.x, z: employee.z });
    expect(vehicle.walkTrail).toEqual(trail);
  });

  it('flags a relocation that happened between two walks in the same batch', () => {
    const state = buildFlatNavGridState(20, 5);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 0, 0);
    expect(moveTo(state, employee.id, { x: 15, z: 0 }).success).toBe(true);

    openMovementTrails(state);
    tickLocomotion(state);
    employee.x = 5; // placed elsewhere — not a walk
    tickLocomotion(state);

    expect(employee.walkTrail!.relocated).toBe(true);
    expect(employee.walkTrail!.points[0]).toEqual({ x: 5, z: 0 });
  });

  it('records nothing when no batch is open', () => {
    const state = buildFlatNavGridState(20, 5);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 0, 0);
    expect(moveTo(state, employee.id, { x: 15, z: 0 }).success).toBe(true);
    tickLocomotion(state);
    expect(employee.walkTrail).toBeUndefined();
  });

  // #1588: boarding snaps the employee onto the vehicle's (fractional) position;
  // that snap is a recorded host transition, not a relocation.
  it('walk + board + drive in one batch yields an unrelocated trail with a board marker (#1588)', () => {
    const state = buildFlatNavGridState(24, 5);
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 4, 2, 1);
    vehicle.x = 4.4;
    vehicle.z = 2.3;
    const speed = getVehicleDefByTier(vehicle.type, vehicle.tier).speed;
    employee.itinerary = {
      legs: [
        { mode: 'foot', vehicleId: null, destX: 4.4, destZ: 2.3, arrival: 'adjacent', onArrive: { kind: 'board', vehicleId: vehicle.id }, estTicks: 6 },
        { mode: 'drive', vehicleId: vehicle.id, destX: 20, destZ: 2, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: Math.ceil(16 / speed) },
      ],
      goal: { kind: 'reposition', x: 20, z: 2 },
      workTicks: 0,
      estTotalTicks: 6 + Math.ceil(16 / speed),
    };

    openMovementTrails(state);
    for (let i = 0; i < 30; i++) tickLocomotion(state);

    const trail = employee.walkTrail!;
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(trail.relocated).toBe(false);
    const boards = trail.hostMarkers.filter(m => m.event === 'board');
    expect(boards).toHaveLength(1);
    expect(boards[0]!.hostKind).toBe('vehicle');
    expect(vehicle.walkTrail!.relocated).toBe(false);
  });

  it('a manual teleport mid-batch is still a relocation (#1588)', () => {
    const state = buildFlatNavGridState(20, 5);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 0, 0);
    expect(moveTo(state, employee.id, { x: 15, z: 0 }).success).toBe(true);
    openMovementTrails(state);
    tickLocomotion(state);
    employee.x = 9;
    employee.z = 3;
    tickLocomotion(state);
    expect(employee.walkTrail!.relocated).toBe(true);
    expect(employee.walkTrail!.hostMarkers).toEqual([]);
  });
});

// ── #1206: agent occupancy on foot — ground-cell reservation ──────────────
//
// AgentOccupancy.ts and Locomotion.ts's own `handleAgentOccupancyBlock`
// generalize the vehicle-only occupancy check to every agent, foot or
// vehicle: one ground cell holds at most one occupant. These tests exercise
// that behavior end to end through the real `tickLocomotion`/`moveTo` path —
// occupancy is unconditional, so no flag needs to be turned on here.
describe('tickLocomotion — agent occupancy on foot (#1206)', () => {
  it('two employees on crossing paths never share a cell across several ticks', () => {
    const state = buildFlatNavGridState(10, 8);
    const rng = new Random(SEED);

    // Distances chosen so that, under today's unprotected movement (no
    // occupancy check at all), both employees land exactly on the shared
    // crossing cell (4, 2) at the same tick (tick 2): each closes half of
    // an 8-cell gap to the crossing point at AGENT_WALK_SPEED (2/tick).
    const { employee: a } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { employee: b } = hireEmployee(state.employees, 'driller', rng, 4, 6);
    expect(moveTo(state, a.id, { x: 8, z: 2 }).success).toBe(true);
    expect(moveTo(state, b.id, { x: 4, z: 0 }).success).toBe(true);

    for (let i = 0; i < 6; i++) {
      tickLocomotion(state);
      expectNoSharedCells([a, b]);
    }
  });

  it('a head-on meeting in a one-cell-wide corridor resolves — both employees arrive, no permanent deadlock', () => {
    // x: 0-1 and 7-8 are 3-row rooms; x: 2-6 is the single-lane (z=1 only)
    // corridor. Distance 8 between the two employees' starting cells is
    // chosen for the same reason as the crossing-paths test above: under
    // today's unprotected movement they land on the exact same cell (4, 1)
    // at tick 2, deep inside the one-wide section.
    const state = build1WideCorridorState(9, [2, 6]);
    const rng = new Random(SEED);
    const { employee: a } = hireEmployee(state.employees, 'driller', rng, 0, 1);
    const { employee: b } = hireEmployee(state.employees, 'driller', rng, 8, 1);
    expect(moveTo(state, a.id, { x: 8, z: 1 }).success).toBe(true);
    expect(moveTo(state, b.id, { x: 0, z: 1 }).success).toBe(true);

    const MAX_TICKS = AGENT_OCCUPANCY_WAIT_TICKS * 4;
    let ticks = 0;
    while (ticks < MAX_TICKS && (a.itinerary !== null || b.itinerary !== null)) {
      tickLocomotion(state);
      expectNoSharedCells([a, b]);
      ticks++;
    }

    expect(a.itinerary).toBeNull();
    expect(b.itinerary).toBeNull();
    expect(a.x).toBe(8);
    expect(a.z).toBe(1);
    expect(b.x).toBe(0);
    expect(b.z).toBe(1);
  });

  it('four employees dispatched to the identical exact target cell end up on four distinct cells, none abandoned/stuck', () => {
    const state = buildFlatNavGridState(12, 12);
    const rng = new Random(SEED);

    const { employee: a } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    const { employee: b } = hireEmployee(state.employees, 'driller', rng, 10, 5);
    const { employee: c } = hireEmployee(state.employees, 'driller', rng, 5, 0);
    const { employee: d } = hireEmployee(state.employees, 'driller', rng, 5, 10);
    const crew = [a, b, c, d];

    for (const emp of crew) {
      expect(moveTo(state, emp.id, { x: 5, z: 5 }).success).toBe(true);
    }

    const MAX_TICKS = 40;
    for (let i = 0; i < MAX_TICKS; i++) {
      tickLocomotion(state);
    }

    for (const emp of crew) {
      expect(emp.isMoveStuck).toBe(false);
    }
    expectNoSharedCells(crew);
  });

  it('a two-cell tick stops before a held second cell instead of skipping over it', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    expect(moveTo(state, employee.id, { x: 10, z: 0 }).success).toBe(true);
    // A real, alive employee — tickLocomotion's own reconcileAgentOccupancy
    // sweep (run every tick before the movement loop) releases any occupant
    // that doesn't correspond to a real, alive employee/vehicle, so a merely
    // synthetic id here would be freed out from under this fixture before
    // the mover ever reaches it.
    const { employee: blockerEmployee } = hireEmployee(state.employees, 'driller', rng, 15, 0);

    // Pre-plant an occupant holding the cell two steps ahead of the mover
    // (AGENT_WALK_SPEED is 2 — a full tick's unobstructed hop would land
    // exactly here) directly via AgentOccupancy, constructed manually
    // rather than via rebuildAgentOccupancy so this test isolates the
    // single-hop stop from the rebuild path entirely.
    const occupancy = new AgentOccupancy();
    const blocker: Occupant = { kind: 'employee', id: blockerEmployee.id };
    expect(occupancy.tryMove(blocker, 2, 0)).toBe(true);
    state.agentOccupancy = occupancy;

    tickLocomotion(state);

    // Advanced exactly one cell — to (1, 0), the first, free cell — not two.
    expect(employee.x).toBe(1);
    expect(employee.z).toBe(0);
  });

  it('isolates handleAgentOccupancyBlock\'s tie-break sidestep: a mid-corridor blocker that is itself stuck yields to the higher-id agent', () => {
    // x: 4-10 is a genuinely one-cell-wide (z=1 only) corridor — the ONLY
    // lane through, so the reroute ladder step (step 1) can never find a
    // path avoiding the blocker's held cell and must fail, leaving the
    // tie-break sidestep (step 2) as the only way forward. The blocker
    // sits well short of the mover's own destination, so this is not the
    // destination-held case (step 3) either.
    const state = build1WideCorridorState(15, [4, 10]);
    const rng = new Random(SEED);

    // Hired first, so EmployeeDispatch's own ascending-id convention gives
    // it the LOWER id — handleAgentOccupancyBlock's tie-break has the
    // higher-id side always give way, so this is the one that must hold
    // its ground.
    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, 6, 1);
    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 5, 1);
    expect(mover.id).toBeGreaterThan(blocker.id);

    // The blocker is itself stuck — simply outwaiting it would deadlock
    // forever, which is exactly when the ladder is allowed to sidestep
    // rather than keep waiting.
    blocker.isMoveStuck = true;

    // The mover's own leg destination is far past the corridor's far end —
    // not the blocker's cell — so `destinationHeldByOther` reads false and
    // the reroute/sidestep steps stay live (never skipped to step 3).
    mover.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 14, destZ: 1,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 9,
      }],
      goal: { kind: 'reposition', x: 14, z: 1 },
      workTicks: 0,
      estTotalTicks: 9,
    } satisfies Itinerary;

    // Occupancy ledger built directly (mirrors this file's own "a two-cell
    // tick stops..." fixture above) so the mover is already sitting exactly
    // one cell short of the blocker's held cell, with the single lane ahead
    // occupied this very tick.
    const occupancy = new AgentOccupancy();
    const moverOccupant: Occupant = { kind: 'employee', id: mover.id };
    const blockerOccupant: Occupant = { kind: 'employee', id: blocker.id };
    expect(occupancy.tryMove(moverOccupant, 5, 1)).toBe(true);
    expect(occupancy.tryMove(blockerOccupant, 6, 1)).toBe(true);
    state.agentOccupancy = occupancy;

    // Run exactly up to AGENT_OCCUPANCY_WAIT_TICKS: every tick before this
    // one the mover's own hop onto (6, 1) is blocked and only the wait
    // counter advances; the ladder itself only fires once the counter
    // reaches the threshold.
    for (let i = 0; i < AGENT_OCCUPANCY_WAIT_TICKS; i++) {
      tickLocomotion(state);
    }

    // The mover gave way — moved off (5, 1) onto a different free cell —
    // while the blocker, untouched, still holds its own ground. Progress
    // was made (the mover is not left waiting or abandoned) and the
    // blocker was never displaced, which is the tie-break's whole point.
    expect(mover.isMoveStuck).toBe(false);
    expect(mover.x === 5 && mover.z === 1).toBe(false);
    expect(occupancy.cellOfOccupant(moverOccupant)).not.toEqual({ x: 5, z: 1 });
    expect(occupancy.holderOf(6, 1)).toEqual(blockerOccupant);
    expect(blocker.x).toBe(6);
    expect(blocker.z).toBe(1);
  });

  // #1263: a genuinely single-lane vehicle corridor (buildCorridorState —
  // clearance caps out at 2 only on the centre row, so a vehicle has exactly
  // one passable lane with no lateral bypass) with a PARKED, DRIVERLESS
  // vehicle sitting on an intermediate cell (never the leg's own destination)
  // used to have no way forward at all once agent occupancy is on: the
  // full-avoidance reroute (step 1) always fails (no bypass exists), the
  // tie-break sidestep (step 2) never fires (the blocker isn't itself stuck —
  // it's simply parked, nobody driving it), and destination-spreading (step
  // 3) is skipped too (the blocker doesn't sit on the destination). Every
  // return fell through to the stuck/abandon escalation, paying the full
  // AGENT_OCCUPANCY_WAIT_TICKS + MOVE_STUCK_ABANDON_TICKS +
  // ACTION_STUCK_BACKOFF_TICKS cost (confirmed live: economy-full-loop.json's
  // debris_hauler blocked by its own multi-role driver's parked
  // rock_fragmenter) before a fresh dispatch ever found a different,
  // reachable target — a recovery cost of ~90-150+ ticks that a tight
  // contract deadline (Contract.ts's rubble_disposal, rng.nextInt(30, 100))
  // can never fit inside. The new step 2.5 crosses a confirmed idle,
  // driverless blocker directly instead, resolving in a handful of ticks.
  it('crosses a parked, driverless vehicle blocking the corridor\'s only lane instead of paying the full stuck/abandon/backoff cost', () => {
    const state = buildCorridorState(6);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 5, destZ: 2,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5,
      }],
      goal: { kind: 'reposition', x: 5, z: 2 },
      workTicks: 0,
      estTotalTicks: 5,
    } satisfies Itinerary;

    // Stationary, driverless, unreserved blocker sitting on cell (2, 2) — an
    // intermediate step along the route, never the leg's own destination
    // (5, 2) — in the corridor's one and only vehicle-passable lane.
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 2);
    expect(vehicleDriverId(blocker)).toBeNull();
    expect(getVehicleReservation(state.vehicles, blocker.id)).toBeNull();

    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    // Comfortably fewer ticks than a single stuck/abandon/backoff cycle would
    // ever need (AGENT_OCCUPANCY_WAIT_TICKS + MOVE_STUCK_ABANDON_TICKS is
    // already well over this) — the crossing must resolve inside the
    // ordinary wait threshold plus a small margin for the drive itself, not
    // after paying the full ladder.
    const MAX_TICKS = AGENT_OCCUPANCY_WAIT_TICKS + 10;
    let ticks = 0;
    while (ticks < MAX_TICKS && driver.itinerary !== null) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
      ticks++;
    }

    expect(everAbandoned).toHaveLength(0);
    expect(driver.itinerary).toBeNull();
    expect(driver.isMoveStuck).toBe(false);
    expect(vehicle.x).toBe(5);
    expect(vehicle.z).toBe(2);
    // The blocker itself was crossed, not relocated — still parked exactly
    // where it started.
    expect(blocker.x).toBe(2);
    expect(blocker.z).toBe(2);
  });

  // #1283: a genuinely BUSY (working/resting) employee — not idle, not
  // isMoveStuck — parked mid-corridor deadlocks every other mover forever
  // once agent occupancy is on, the same shape #1263 fixed for a parked
  // vehicle blocker above: the full-avoidance reroute (step 1) always fails
  // (no bypass exists in this genuine single-file corridor), the tie-break
  // sidestep (step 2) never fires (the blocker isn't itself `isMoveStuck`),
  // an idle blocker's own relocation (#1278) never applies (this blocker is
  // busy, not idle), and the #1263 crossing fallback (step 2.5) only
  // recognizes a parked, DRIVERLESS VEHICLE occupant — never an employee
  // one. Every return falls through to the ordinary stuck escalation, and
  // (unlike #1263's vehicle case) nothing today ever resolves it: the
  // mover latches `isMoveStuck` once the wait threshold passes and stays
  // that way for the rest of this test's own bounded run. The fix
  // generalizes step 2.5 to also cross a busy employee blocker via the new
  // `isStationaryBusyEmployee` predicate (Locomotion.ts).
  it('crosses a busy employee blocking the corridor\'s only lane instead of deadlocking forever', () => {
    const state = build1WideCorridorState(9, [2, 6]);
    const rng = new Random(SEED);

    // Stationary, genuinely BUSY blocker sitting on cell (4, 1) — an
    // intermediate step along the route, never the mover's own destination
    // — in the corridor's one and only lane. An `activeActionId` alone is
    // enough for `employeeWorkState` to read 'working' (mirrors this
    // file's own "#1259" fixture below); no itinerary/destination/rest is
    // set, so it never moves on its own for the whole test.
    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, 4, 1);
    blocker.activeActionId = 777;
    expect(employeeWorkState(blocker)).toBe('working');
    expect(blocker.isMoveStuck).toBe(false);

    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 0, 1);
    expect(moveTo(state, mover.id, { x: 8, z: 1 }).success).toBe(true);

    // Comfortably inside a single AGENT_OCCUPANCY_WAIT_TICKS wait cycle —
    // nowhere near a full stuck/abandon cycle (MOVE_STUCK_ABANDON_TICKS is
    // 30): a failure here shows up as the mover never arriving (or
    // isMoveStuck latching true), never as an abandon within this bound.
    const MAX_TICKS = AGENT_OCCUPANCY_WAIT_TICKS + 15;
    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    let ticks = 0;
    while (ticks < MAX_TICKS && mover.itinerary !== null) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
      ticks++;
    }

    expect(everAbandoned).toHaveLength(0);
    expect(mover.itinerary).toBeNull();
    expect(mover.isMoveStuck).toBe(false);
    expect(mover.x).toBe(8);
    expect(mover.z).toBe(1);

    // The blocker itself was crossed, not relocated or disturbed — still
    // busy, exactly where it started, holding the same active action.
    expect(blocker.x).toBe(4);
    expect(blocker.z).toBe(1);
    expect(blocker.activeActionId).toBe(777);
    expect(employeeWorkState(blocker)).toBe('working');
  });

  it("#1259: destination-spreading onto the mover's own already-held cell still clears isMoveStuck instead of latching it from the wait leading up to it", () => {
    // A blocker parked exactly ON the mover's leg destination, with no
    // itinerary of its own — it never moves for the whole test, so
    // `destinationHeldByOther` reads true from the very first blocked tick
    // and handleAgentOccupancyBlock's ladder skips straight to step 3
    // (destination-spreading), never reaching the reroute/sidestep steps.
    const state = buildFlatNavGridState(5, 5);
    const rng = new Random(SEED);

    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, 2, 2);
    // #1278: relocateIdleDestinationBlocker now clears a genuinely idle
    // occupant off the destination cell before the ladder ever reaches
    // destination-spreading — a freshly hired employee reads idle by
    // `employeeWorkState`, which would resolve this block a different way
    // and never exercise the #1259 destination-spread-onto-self path this
    // test is actually about. Marking the blocker busy (an activeActionId
    // needs nothing more to exist than the field itself, per
    // `employeeWorkState`'s own field-only check) keeps it ineligible for
    // that relocation, exactly as it was for every tick of this test before
    // #1278 existed.
    blocker.activeActionId = 1;
    // One cell short of the blocker's held cell — findNearestFreeCell's own
    // ring search around the leg's destination (2, 2) reaches the mover's
    // own current cell (1, 2) at distance 1, the same distance as every
    // other free ring cell, and it is scanned first — so the spread
    // retargets the leg onto the exact cell the mover already stands on.
    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 1, 2);

    mover.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 2, destZ: 2,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 1,
      }],
      goal: { kind: 'reposition', x: 2, z: 2 },
      workTicks: 0,
      estTotalTicks: 1,
    } satisfies Itinerary;

    // AGENT_OCCUPANCY_WAIT_TICKS of passive waiting flips isMoveStuck true
    // (STUCK_THRESHOLD is far smaller) well before the ladder ever fires —
    // exactly the state a genuinely resolved mover must not stay latched
    // into. A couple more ticks let the spread actually retarget the leg and
    // the next tick's now-instant arrival (isLegArrived true before
    // advanceLeg is ever called, since the retargeted destination equals
    // the mover's own position) apply its arrival step.
    for (let i = 0; i < AGENT_OCCUPANCY_WAIT_TICKS + 2; i++) {
      tickLocomotion(state);
    }

    // The mover's own leg completed (onto its own held cell) instead of
    // ever genuinely being stuck — before #1259's fix, this loop's
    // isLegArrived-at-top-of-loop branch never ran advanceLeg for this
    // "already there" arrival, so isMoveStuck/moveConsecutiveFailures never
    // got the same reset an ordinary successful advance already receives,
    // and stayed latched from the wait above forever.
    expect(mover.isMoveStuck).toBe(false);
    expect(mover.moveConsecutiveFailures).toBe(0);
    // The blocker was never displaced — it held its ground the entire test,
    // which is exactly why the destination stayed held and the spread (not
    // a reroute around a mobile blocker) is what resolved this.
    expect(blocker.x).toBe(2);
    expect(blocker.z).toBe(2);
  });

  // #1274: a destination-spread (handleAgentOccupancyBlock's step 3) retargets
  // each blocked leg's destX/destZ onto a distinct free cell, so by the time
  // the wait crosses AGENT_OCCUPANCY_WAIT_TICKS the movers no longer share a
  // live destination. The jam detector (TrafficJams.ts) must still cluster
  // them on `Leg.originalDestX/originalDestZ`, the pre-spread target, and
  // fire before the spread fragments the queue.
  it('a genuinely unrelocatable anchor plus 3 satellite vehicles converging on its cell are detected as one jam on their original destination despite destination-spreads', () => {
    const state = buildFlatNavGridState(30, 30);
    const rng = new Random(SEED);
    // #1208: only a ramp-anchored jam raises the event; the cluster sits at a ramp head.
    const jamRampDef = { originX: 15, originZ: 15, direction: 'south' as const, length: 10, width: 3 as const, targetDepth: 5 };
    state.builtRamps.push({ id: 1, def: jamRampDef, width: 3, footprint: rampFootprint(jamRampDef, 3) });

    // The anchor: parked, mounted, no itinerary of its own — a permanent
    // obstacle squarely on every satellite's shared destination, never
    // relocatable by anything this test does.
    const { employee: anchorDriver } = hireEmployee(state.employees, 'driller', rng, 15, 15);
    const { vehicle: anchorVehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 15, 15);
    anchorVehicle.occupantIds = [anchorDriver.id];
    anchorDriver.locomotion = { kind: 'mounted', vehicleId: anchorVehicle.id };

    // Three satellites, each mounted, each driving straight at the anchor's
    // own cell (15, 15) — a destination that never frees up.
    const satellitePositions: Array<{ x: number; z: number }> = [
      { x: 13, z: 15 },
      { x: 16, z: 14 },
      { x: 15, z: 13 },
    ];
    satellitePositions.forEach(({ x, z }) => {
      const { employee: driver } = hireEmployee(state.employees, 'driller', rng, x, z);
      const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', x, z);
      vehicle.occupantIds = [driver.id];
      driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
      driver.itinerary = {
        legs: [{
          mode: 'drive', vehicleId: vehicle.id, destX: 15, destZ: 15,
          arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 3,
        }],
        goal: { kind: 'reposition', x: 15, z: 15 },
        workTicks: 0,
        estTotalTicks: 3,
      } satisfies Itinerary;
    });

    // The jam must fire on its own clustered waiting time, before the
    // occupancy ladder's destination-spread (AGENT_OCCUPANCY_WAIT_TICKS)
    // fragments the three satellites onto distinct destinations.
    for (let tick = 0; tick < 15 && state.events.pendingEvent === null; tick++) {
      tickLocomotion(state);
      detectTrafficJam(state.builtRamps, state.employees.employees, state.events, tick);
    }

    expect(state.events.pendingEvent).not.toBeNull();
    expect(state.events.pendingEvent?.eventId).toBe('traffic_jam');
  });
});

// ── #1278: destination-blocker relocation for IDLE occupants (agent
// occupancy) — generalizes the vehicle-only relocateDestinationBlocker to
// any idle occupant, foot or vehicle, squatting on another mover's exact
// leg destination, via the new (currently `throw`ing) exported stub
// `relocateIdleDestinationBlocker`. Every fixture below drives the real,
// already-exported entry point (tickLocomotion) exactly as this file's own
// existing occupancy suite above does — nothing here calls the stub
// directly. `relocateIdleDestinationBlocker` is also not wired into
// `handleAgentOccupancyBlock`'s ladder yet (skeleton phase): today, an idle
// employee/vehicle blocker sitting exactly on a destination is never
// relocated by anything, and (per `needsExactUnsharedCell`'s existing gate)
// an ordinary exact/none-onArrive leg instead falls back to the PRE-EXISTING
// destination-spread step, which frequently resolves by retargeting the
// REQUESTER's own leg onto the free cell closest to the destination — which,
// whenever the requester is already standing adjacent to the blocker (the
// common case once a block has been waited out), is the requester's own
// currently-held cell (see this file's own "#1259" fixture above). That
// self-spread is a real settlement, not a crash, so most fixtures below fail
// today via a clean, unmet expectation (the blocker never having moved, or
// the requester having settled one cell short of its real target) rather
// than via the stub's own thrown error.
describe('tickLocomotion — agent occupancy destination-blocker relocation (#1278)', () => {
  it('relocates an idle employee blocker off another mover\'s exact destination cell, letting the requester actually reach it', () => {
    const state = buildFlatNavGridState(10, 10);
    const rng = new Random(SEED);

    // Idle blocker: hireEmployee's own defaults already read 'idle' (no
    // active action, no itinerary, not resting/collapsing) — nothing further
    // is set on it.
    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, 4, 2);
    expect(employeeWorkState(blocker)).toBe('idle');

    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    expect(moveTo(state, mover.id, { x: 4, z: 2 }).success).toBe(true);

    // Well under MOVE_STUCK_ABANDON_TICKS (30): one AGENT_OCCUPANCY_WAIT_TICKS
    // wait, plus a handful of ticks for the ladder to actually resolve and the
    // mover to close the last cell.
    const TICK_BOUND = AGENT_OCCUPANCY_WAIT_TICKS + 10;
    expect(TICK_BOUND).toBeLessThan(MOVE_STUCK_ABANDON_TICKS);

    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    let relocatedAtTick: number | null = null;
    for (let i = 0; i < TICK_BOUND; i++) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
      if (relocatedAtTick === null && !(blocker.x === 4 && blocker.z === 2)) relocatedAtTick = i;
    }

    expect(relocatedAtTick, 'blocker never moved off (4,2)').not.toBeNull();
    expect(relocatedAtTick!).toBeLessThan(MOVE_STUCK_ABANDON_TICKS);
    // The requester actually reached the ORIGINAL destination, not a
    // consolation cell nearby — the blocker moved, not the requester's target.
    expect(state.agentOccupancy?.holderOf(4, 2)).toEqual({ kind: 'employee', id: mover.id });
    expect(mover.x).toBe(4);
    expect(mover.z).toBe(2);
    expect(everAbandoned).toHaveLength(0);
  });

  it('boundary: a blocker with no free cell anywhere in its own neighbourhood is left in place, and the requester still resolves via the existing destination-spread fallback (regression pin)', () => {
    // A raw, directly-editable NavGrid (mirrors this file's own
    // blockColumn/openColumn fixtures) so every cell in the blocker's own
    // AGENT_FREE_CELL_SEARCH_MAX_RADIUS neighbourhood can be sealed off,
    // except a single one-cell opening the requester approaches through.
    const grid = makeFlatNavGrid(21, 21);
    const blockerX = 10;
    const blockerZ = 10;
    const moverStart = { x: blockerX - 1, z: blockerZ }; // one cell west — the only opening
    blockNeighbourhood(grid, blockerX, blockerZ, AGENT_FREE_CELL_SEARCH_MAX_RADIUS, [moverStart]);

    const state = createGame({ seed: SEED });
    state.navGrid = grid;
    const rng = new Random(SEED);

    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, blockerX, blockerZ);
    expect(employeeWorkState(blocker)).toBe('idle');
    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, moverStart.x, moverStart.z);
    mover.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: blockerX, destZ: blockerZ,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 1,
      }],
      goal: { kind: 'reposition', x: blockerX, z: blockerZ },
      workTicks: 0,
      estTotalTicks: 1,
    } satisfies Itinerary;

    const TICK_BOUND = AGENT_OCCUPANCY_WAIT_TICKS + 10;
    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    for (let i = 0; i < TICK_BOUND; i++) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
    }

    // The blocker had nowhere to go — it never moved.
    expect(blocker.x).toBe(blockerX);
    expect(blocker.z).toBe(blockerZ);
    // No exception, no corrupted position.
    expect(Number.isNaN(blocker.x)).toBe(false);
    expect(Number.isNaN(blocker.z)).toBe(false);
    expect(Number.isNaN(mover.x)).toBe(false);
    expect(Number.isNaN(mover.z)).toBe(false);
    // The requester still resolved — via the pre-existing destination-spread
    // fallback settling onto its own already-held approach cell (the only
    // free-for-the-requester cell this fully-saturated neighbourhood has),
    // exactly as it would with today's code. Never abandoned, never left
    // permanently stuck.
    expect(everAbandoned).toHaveLength(0);
    expect(mover.isMoveStuck).toBe(false);
  });

  it('never relocates a busy blocker classified \'working\' — the requester resolves exactly as today\'s code already does (regression pin)', () => {
    const state = buildFlatNavGridState(10, 10);
    const rng = new Random(SEED);

    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, 4, 2);
    blocker.activeActionId = 555;
    blocker.taskTicksRemaining = 20;
    expect(employeeWorkState(blocker)).toBe('working');

    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    expect(moveTo(state, mover.id, { x: 4, z: 2 }).success).toBe(true);

    const TICK_BOUND = AGENT_OCCUPANCY_WAIT_TICKS + 10;
    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    for (let i = 0; i < TICK_BOUND; i++) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
    }

    expect(blocker.x).toBe(4);
    expect(blocker.z).toBe(2);
    expect(everAbandoned).toHaveLength(0);
    expect(mover.isMoveStuck).toBe(false);
  });

  it('never relocates a busy blocker classified \'traveling\' — the requester resolves exactly as today\'s code already does (regression pin)', () => {
    const state = buildFlatNavGridState(10, 10);
    const rng = new Random(SEED);

    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, 4, 2);
    // itinerary/pendingTaskDuration stay null — a 'traveling' classification
    // via the destinationX/Z mirror alone is enough (#1178: inert without an
    // itinerary, so this blocker genuinely never moves on its own).
    blocker.destinationX = 4;
    blocker.destinationZ = 2;
    expect(employeeWorkState(blocker)).toBe('traveling');

    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    expect(moveTo(state, mover.id, { x: 4, z: 2 }).success).toBe(true);

    const TICK_BOUND = AGENT_OCCUPANCY_WAIT_TICKS + 10;
    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    for (let i = 0; i < TICK_BOUND; i++) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
    }

    expect(blocker.x).toBe(4);
    expect(blocker.z).toBe(2);
    expect(everAbandoned).toHaveLength(0);
    expect(mover.isMoveStuck).toBe(false);
  });

  it('never relocates a busy blocker classified \'resting\' — the requester resolves exactly as today\'s code already does (regression pin)', () => {
    const state = buildFlatNavGridState(10, 10);
    const rng = new Random(SEED);

    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, 4, 2);
    blocker.restTicksRemaining = 20;
    expect(employeeWorkState(blocker)).toBe('resting');

    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    expect(moveTo(state, mover.id, { x: 4, z: 2 }).success).toBe(true);

    const TICK_BOUND = AGENT_OCCUPANCY_WAIT_TICKS + 10;
    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    for (let i = 0; i < TICK_BOUND; i++) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
    }

    expect(blocker.x).toBe(4);
    expect(blocker.z).toBe(2);
    expect(everAbandoned).toHaveLength(0);
    expect(mover.isMoveStuck).toBe(false);
  });

  it('never relocates a collapsing employee even though employeeWorkState still reads \'idle\' for it', () => {
    const state = buildFlatNavGridState(10, 10);
    const rng = new Random(SEED);

    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, 4, 2);
    blocker.collapsing = true;
    // employeeWorkState itself has no collapsing branch — it still reads
    // 'idle' here, which is exactly why relocateIdleDestinationBlocker must
    // check `collapsing` explicitly rather than relying on employeeWorkState
    // alone to exclude this employee.
    expect(employeeWorkState(blocker)).toBe('idle');

    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    expect(moveTo(state, mover.id, { x: 4, z: 2 }).success).toBe(true);

    const TICK_BOUND = AGENT_OCCUPANCY_WAIT_TICKS + 10;
    for (let i = 0; i < TICK_BOUND; i++) {
      tickLocomotion(state);
    }

    expect(blocker.x).toBe(4);
    expect(blocker.z).toBe(2);
  });

  it('vehicle parity: relocates an idle, driverless, unreserved vehicle blocker off a foot mover\'s exact destination, through handleAgentOccupancyBlock (not the vehicle-only handleOccupancyBlock)', () => {
    const state = buildFlatNavGridState(10, 10);
    const rng = new Random(SEED);

    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 4, 2);
    expect(vehicleDriverId(blocker)).toBeNull();
    expect(getVehicleReservation(state.vehicles, blocker.id)).toBeNull();

    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    expect(moveTo(state, mover.id, { x: 4, z: 2 }).success).toBe(true);

    const TICK_BOUND = AGENT_OCCUPANCY_WAIT_TICKS + 10;
    expect(TICK_BOUND).toBeLessThan(MOVE_STUCK_ABANDON_TICKS);

    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    let relocatedAtTick: number | null = null;
    for (let i = 0; i < TICK_BOUND; i++) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
      if (relocatedAtTick === null && !(blocker.x === 4 && blocker.z === 2)) relocatedAtTick = i;
    }

    expect(relocatedAtTick, 'vehicle blocker never moved off (4,2)').not.toBeNull();
    expect(relocatedAtTick!).toBeLessThan(MOVE_STUCK_ABANDON_TICKS);
    expect(mover.x).toBe(4);
    expect(mover.z).toBe(2);
    expect(everAbandoned).toHaveLength(0);
  });

  // ── #1278's own core reproduction: extreme density at 1m spacing ──────────

  /**
   * Builds a `size x size`, 1-unit-spaced block of target cells anchored at
   * (originX, originZ) and seeds an idle "finished" employee standing on
   * every cell whose grid offset (dx, dz) is listed in `occupiedOffsets` —
   * mirrors a finished driller crew left standing on the next hole (#1278's
   * own reproduction shape). Shared by the bounded-tick fairness test and the
   * radius-widening test below.
   */
  function seedDenseTargetGrid(
    state: GameState,
    rng: Random,
    originX: number,
    originZ: number,
    size: number,
    occupiedOffsets: ReadonlyArray<{ dx: number; dz: number }>,
  ) {
    const targets: Array<{ x: number; z: number }> = [];
    for (let dx = 0; dx < size; dx++) {
      for (let dz = 0; dz < size; dz++) {
        targets.push({ x: originX + dx, z: originZ + dz });
      }
    }
    const occupied = occupiedOffsets.map(({ dx, dz }) => hireEmployee(state.employees, 'driller', rng, originX + dx, originZ + dz).employee);
    return { targets, occupied };
  }

  it('bounded-tick fairness: N employees dispatched at a dense 1m-spacing grid all eventually reach their own distinct target, none abandoned, no two ever share a cell', () => {
    const state = buildFlatNavGridState(24, 24);
    const rng = new Random(SEED);

    const ORIGIN_X = 5;
    const ORIGIN_Z = 5;
    const SIZE = 4; // 16 one-unit-spaced target cells
    // 4 "finished drillers" already standing on 4 of the 16 holes.
    const finishedOffsets = [{ dx: 0, dz: 0 }, { dx: 3, dz: 0 }, { dx: 0, dz: 3 }, { dx: 3, dz: 3 }];
    const { targets, occupied: finished } = seedDenseTargetGrid(state, rng, ORIGIN_X, ORIGIN_Z, SIZE, finishedOffsets);
    for (const emp of finished) expect(employeeWorkState(emp)).toBe('idle');

    const finishedKeys = new Set(finished.map(e => cellKey(e.x, e.z)));
    const remainingTargets = targets.filter(t => !finishedKeys.has(cellKey(t.x, t.z)));
    expect(remainingTargets).toHaveLength(16 - finishedOffsets.length);

    // A ring of distinct starting cells just outside the dense block —
    // enough of them to give one to every remaining target.
    const ringCells: Array<{ x: number; z: number }> = [];
    for (let x = ORIGIN_X - 1; x <= ORIGIN_X + SIZE; x++) {
      ringCells.push({ x, z: ORIGIN_Z - 1 });
      ringCells.push({ x, z: ORIGIN_Z + SIZE });
    }
    for (let z = ORIGIN_Z; z < ORIGIN_Z + SIZE; z++) {
      ringCells.push({ x: ORIGIN_X - 1, z });
      ringCells.push({ x: ORIGIN_X + SIZE, z });
    }
    expect(ringCells.length).toBeGreaterThanOrEqual(remainingTargets.length);

    const movers = remainingTargets.map((target, i) => {
      const start = ringCells[i]!;
      const { employee } = hireEmployee(state.employees, 'driller', rng, start.x, start.z);
      expect(moveTo(state, employee.id, target).success).toBe(true);
      return { employee, target };
    });

    // Budget reasoning: the ring sits at most SIZE+1 (5) cells from its
    // nearest target at AGENT_WALK_SPEED (2/tick) — a handful of ticks of
    // direct travel. Layered on that, up to 12 movers may each need one full
    // AGENT_OCCUPANCY_WAIT_TICKS (10) wait before the ladder resolves their
    // own contest — a fully serialized worst case is nowhere near
    // 12 * (10 + a few), so 300 ticks is generous for genuine convergence
    // while staying far under a scenario where every mover instead paid a
    // full abandon-and-retry cycle (30-tick abandon threshold each) — that
    // failure mode cannot hide inside this budget.
    const TICK_BUDGET = 300;
    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    const allAgents = [...finished, ...movers.map(m => m.employee)];
    for (let i = 0; i < TICK_BUDGET; i++) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
      expectNoSharedCells(allAgents);
    }

    expect(everAbandoned).toHaveLength(0);
    for (const { employee, target } of movers) {
      expect(employee.itinerary, `employee #${employee.id} never arrived at (${target.x},${target.z})`).toBeNull();
      expect(employee.x).toBe(target.x);
      expect(employee.z).toBe(target.z);
    }
    for (const emp of finished) {
      expect(emp.isMoveStuck).toBe(false);
    }
  });

  it('radius widening in isolation: relocateIdleDestinationBlocker only succeeds because AGENT_FREE_CELL_SEARCH_MAX_RADIUS reaches past a fully-saturated radius-2 neighbourhood', () => {
    const state = buildFlatNavGridState(30, 30);
    const rng = new Random(SEED);

    const bx = 15;
    const bz = 15;
    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, bx, bz);
    expect(employeeWorkState(blocker)).toBe('idle');

    const moverStart = { x: bx - 1, z: bz };
    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, moverStart.x, moverStart.z);
    // Hand-built with an 'enter_building' onArrive (mirrors this file's own
    // #1203 fixture, buildingId 999 deliberately absent — irrelevant here
    // since the mover never actually arrives before the assertions run) so
    // `needsExactUnsharedCell` reads false and the PRE-EXISTING
    // destination-spread ladder step can never resolve this block by
    // retargeting the mover elsewhere. The only thing that can possibly
    // clear this block is relocateIdleDestinationBlocker itself — isolating
    // AGENT_FREE_CELL_SEARCH_MAX_RADIUS's own effect from the already-working
    // spread mechanism this file's other #1278 fixtures above exercise.
    mover.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: bx, destZ: bz,
        arrival: 'exact', onArrive: { kind: 'enter_building', buildingId: 999 }, estTicks: 1,
      }],
      goal: { kind: 'reposition', x: bx, z: bz },
      workTicks: 0,
      estTotalTicks: 1,
    } satisfies Itinerary;

    // Manual occupancy ledger (mirrors this file's own tie-break/two-cell
    // fixtures above): every cell within Chebyshev distance 1-2 of the
    // blocker is held by a real, alive filler employee — saturating the OLD,
    // pre-#1278 radius-2 bound entirely — except the mover's own held cell —
    // while radius 3-4 (AGENT_FREE_CELL_SEARCH_MAX_RADIUS) is left genuinely
    // open, unheld, unblocked terrain.
    const occupancy = new AgentOccupancy();
    const moverOccupant: Occupant = { kind: 'employee', id: mover.id };
    const blockerOccupant: Occupant = { kind: 'employee', id: blocker.id };
    expect(occupancy.tryMove(moverOccupant, moverStart.x, moverStart.z)).toBe(true);
    expect(occupancy.tryMove(blockerOccupant, bx, bz)).toBe(true);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue; // the blocker's own cell
        if (dx === -1 && dz === 0) continue; // the mover's own held cell
        const { employee: filler } = hireEmployee(state.employees, 'driller', rng, 0, 0);
        expect(occupancy.tryMove({ kind: 'employee', id: filler.id }, bx + dx, bz + dz)).toBe(true);
      }
    }
    state.agentOccupancy = occupancy;

    const TICK_BOUND = AGENT_OCCUPANCY_WAIT_TICKS + 10;
    for (let i = 0; i < TICK_BOUND; i++) {
      tickLocomotion(state);
    }

    expect(blocker.x === bx && blocker.z === bz, 'blocker never escaped the saturated radius-2 neighbourhood').toBe(false);
    const dist = Math.max(Math.abs(blocker.x - bx), Math.abs(blocker.z - bz));
    // Could only have landed at radius 3 or 4 — everything within radius 2
    // was deliberately left with nowhere free.
    expect(dist).toBeGreaterThanOrEqual(3);
    expect(dist).toBeLessThanOrEqual(AGENT_FREE_CELL_SEARCH_MAX_RADIUS);
    expect(Number.isNaN(blocker.x)).toBe(false);
    expect(Number.isNaN(blocker.z)).toBe(false);
  });
});

// ── #1283: crossing a busy (working/resting) EMPLOYEE blocker — dense-grid
// variant plus a non-regression pin. Generalizes the #1263 parked-vehicle
// crossing fallback (Locomotion.ts's step 2.5) to a second kind of
// stationary occupant: a genuinely busy employee sitting on the only route
// to a requester's destination, as opposed to an idle one (already
// relocated by #1278) or a parked vehicle (already crossed by #1263).
// Reproduces the real drill/charge grid's own multi-hole density (spacing
// <=4) as two isolated single-file access lanes rather than a literal open
// spacing-4 grid — flat, unwalled terrain 4 units between holes has ample
// room to route around a single stationary blocker and so never forces the
// "no alternate route" property this fix exists for; a deterministic
// single-lane shape (mirroring this file's own manual-construction fixtures
// above — "isolates ... tie-break sidestep", "radius widening in isolation")
// guarantees it instead.
describe('tickLocomotion — agent occupancy: crossing a busy employee blocker in a dense multi-hole grid (#1283)', () => {
  /**
   * Two isolated 1-wide corridor lanes stacked in z — rows 0-2 (lane at
   * z=1) and rows 4-6 (lane at z=5), each shaped exactly like
   * `build1WideCorridorState`'s own single lane, doubled — separated by a
   * fully-blocked row 3 spanning every column so neither lane's own
   * contest can ever leak into the other's via the shared end rooms (both
   * rooms keep all three of THEIR OWN rows open, but rows 0-2 never
   * connect to rows 4-6 once row 3 is sealed everywhere).
   */
  function buildTwoLaneCorridorState(width: number, corridorXRange: [number, number]): GameState {
    const state = createGame({ seed: SEED });
    const grid = makeFlatNavGrid(width, 7);
    const [lo, hi] = corridorXRange;
    for (let x = lo; x <= hi; x++) {
      grid.cells[0]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
      grid.cells[2]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
      grid.cells[4]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
      grid.cells[6]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
    }
    for (let x = 0; x < width; x++) {
      grid.cells[3]![x] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
    }
    state.navGrid = grid;
    return state;
  }

  it('a mix of idle and busy blockers across two simultaneous dense-grid-style lanes: crosses the busy one, converges with none abandoned, no two movers ever share a cell', () => {
    const state = buildTwoLaneCorridorState(9, [2, 6]);
    const rng = new Random(SEED);

    // Lane A (z=1): a busy employee, mid-drilling/charging — the #1283
    // case this fix targets.
    const { employee: busyBlocker } = hireEmployee(state.employees, 'driller', rng, 4, 1);
    busyBlocker.activeActionId = 111;
    expect(employeeWorkState(busyBlocker)).toBe('working');

    // Lane B (z=5): an idle, finished occupant — the #1278/#1263 case
    // already handled today, run concurrently to prove the new
    // busy-employee crossing doesn't regress the pre-existing idle-blocker
    // handling.
    const { employee: idleBlocker } = hireEmployee(state.employees, 'driller', rng, 4, 5);
    expect(employeeWorkState(idleBlocker)).toBe('idle');

    const { employee: moverA } = hireEmployee(state.employees, 'driller', rng, 0, 1);
    const { employee: moverB } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    expect(moveTo(state, moverA.id, { x: 8, z: 1 }).success).toBe(true);
    expect(moveTo(state, moverB.id, { x: 8, z: 5 }).success).toBe(true);

    // Budget reasoning: lane A (the busy blocker) crosses in a single
    // AGENT_OCCUPANCY_WAIT_TICKS wait, well inside a much smaller budget than
    // this. Lane B (the idle blocker) has no bypass either — a genuinely
    // single-file corridor from x=2 to x=6 — so each time moverB catches back
    // up to idleBlocker, `relocateIdleDestinationBlocker`'s corridor-blocker
    // fallback can only push idleBlocker one cell further down the SAME
    // corridor (the "nearest free cell" from a 1-wide lane is always the next
    // cell along it), never off it, and each push costs its own full
    // AGENT_OCCUPANCY_WAIT_TICKS wait before it fires. idleBlocker starts at
    // x=4 and needs pushing past x=6 (into the 3-row room at x=7) before it
    // can ever step off lane B's single row — 3 pushes, so up to
    // 3*AGENT_OCCUPANCY_WAIT_TICKS of pure wait on top of the ordinary walk
    // time, not the single-push budget a wide-open dense grid (where a
    // relocated blocker usually has somewhere sideways to go) needs.
    const MAX_TICKS = AGENT_OCCUPANCY_WAIT_TICKS * 5;
    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    let ticks = 0;
    while (ticks < MAX_TICKS && (moverA.itinerary !== null || moverB.itinerary !== null)) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
      // The busy blocker is deliberately excluded from this check: crossing
      // (unlike ordinary ledger-tracked occupancy) never claims the
      // blocker's own cell, so a mover's rounded position can momentarily
      // coincide with it mid-hop — exactly why this file's own #1263
      // crossing fixture above never checks shared cells against ITS
      // parked-vehicle blocker either. moverA/moverB/idleBlocker are all
      // real, ledger-tracked occupants for whom a shared cell would be a
      // genuine bug.
      expectNoSharedCells([moverA, moverB, idleBlocker]);
      ticks++;
    }

    expect(everAbandoned).toHaveLength(0);
    expect(moverA.itinerary).toBeNull();
    expect(moverA.x).toBe(8);
    expect(moverA.z).toBe(1);
    expect(moverA.isMoveStuck).toBe(false);
    expect(moverB.itinerary).toBeNull();
    expect(moverB.x).toBe(8);
    expect(moverB.z).toBe(5);
    expect(moverB.isMoveStuck).toBe(false);

    // The busy blocker was crossed, not disturbed.
    expect(busyBlocker.x).toBe(4);
    expect(busyBlocker.z).toBe(1);
    expect(busyBlocker.activeActionId).toBe(111);
    expect(employeeWorkState(busyBlocker)).toBe('working');
  });

  // Non-regression pin: at a looser spacing where a genuine bypass route
  // exists (buildRingCorridorState's own two-lane ring, joined at both
  // ends — #1166's chokepoint shape), a busy blocker must resolve via the
  // ordinary full-avoidance reroute (step 1) alone, never needing the new
  // crossing fallback at all. Must hold both before and after this issue's
  // fix — proves the new busy-employee crossing branch never fires when an
  // avoiding route already exists, so it cannot regress the
  // already-working case.
  it('regression: a busy blocker with a genuine bypass route resolves via reroute alone, unaffected by the new crossing fallback', () => {
    const state = buildRingCorridorState(12);
    const rng = new Random(SEED);

    const { employee: blocker } = hireEmployee(state.employees, 'driller', rng, 6, 2);
    blocker.activeActionId = 222;
    expect(employeeWorkState(blocker)).toBe('working');

    const { employee: mover } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    expect(moveTo(state, mover.id, { x: 11, z: 2 }).success).toBe(true);

    // Generous: the long way around (via the z=8 lane) costs several times
    // the direct route's own tick count, well beyond a single
    // AGENT_OCCUPANCY_WAIT_TICKS wait plus the reroute's own travel time —
    // still far short of MOVE_STUCK_ABANDON_TICKS, since this must resolve
    // via reroute alone, never the stuck/abandon escalation.
    const MAX_TICKS = AGENT_OCCUPANCY_WAIT_TICKS + 40;
    const everAbandoned: Array<{ employeeId: number; actionId: number | null }> = [];
    let ticks = 0;
    while (ticks < MAX_TICKS && mover.itinerary !== null) {
      everAbandoned.push(...tickLocomotion(state).abandoned);
      ticks++;
    }

    expect(everAbandoned).toHaveLength(0);
    expect(mover.itinerary).toBeNull();
    expect(mover.x).toBe(11);
    expect(mover.z).toBe(2);
    expect(mover.isMoveStuck).toBe(false);
    // Resolved via the long way around, not a crossing — the blocker was
    // never touched.
    expect(blocker.x).toBe(6);
    expect(blocker.z).toBe(2);
  });
});

// ── #1283: `isStationaryBusyEmployee` in isolation — the predicate
// `handleAgentOccupancyBlock`'s crossing fallback checks before treating a
// stationary employee occupant as safe to cross, alongside the existing
// `isIdleParkedVehicle`. Exported specifically so this can be tested
// directly, ahead of the crossing branch itself being wired to call it.
describe('isStationaryBusyEmployee', () => {
  it("is true for a busy employee ('working': an activeActionId alone is enough per employeeWorkState)", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 5;
    expect(employeeWorkState(employee)).toBe('working');
    expect(isStationaryBusyEmployee(employee)).toBe(true);
  });

  it("is true for a resting employee ('resting') too", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.restTicksRemaining = 10;
    expect(employeeWorkState(employee)).toBe('resting');
    expect(isStationaryBusyEmployee(employee)).toBe(true);
  });

  it('is false for a freshly hired, genuinely idle employee', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    expect(employeeWorkState(employee)).toBe('idle');
    expect(isStationaryBusyEmployee(employee)).toBe(false);
  });

  it('is false for a busy employee that is already isMoveStuck — the tie-break sidestep\'s own case, not this predicate\'s', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.activeActionId = 5;
    employee.isMoveStuck = true;
    expect(isStationaryBusyEmployee(employee)).toBe(false);
  });
});

describe('respreadLegDestination (#1208 reroute answer)', () => {
  function walkerWithLeg(overrides: Partial<Itinerary['legs'][number]> = {}) {
    const state = buildFlatNavGridState(20, 20);
    const rng = new Random(SEED);
    const { employee: holder } = hireEmployee(state.employees, 'driller', rng, 10, 10);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 3, 3);
    const occupancy = new AgentOccupancy();
    expect(occupancy.tryMove({ kind: 'employee', id: holder.id }, 10, 10)).toBe(true);
    state.agentOccupancy = occupancy;
    const leg = {
      mode: 'foot', vehicleId: null, destX: 10, destZ: 10, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5,
      ...overrides,
    } as Itinerary['legs'][number];
    employee.itinerary = { legs: [leg], goal: { kind: 'reposition', x: 10, z: 10 }, workTicks: 0, estTotalTicks: 5 } satisfies Itinerary;
    return { state, employee, leg };
  }

  it('retargets a held exact destination and records the original once', () => {
    const { state, employee, leg } = walkerWithLeg();
    respreadLegDestination(state, employee);
    expect([leg.destX, leg.destZ]).not.toEqual([10, 10]);
    expect([leg.originalDestX, leg.originalDestZ]).toEqual([10, 10]);
    respreadLegDestination(state, employee);
    expect([leg.originalDestX, leg.originalDestZ]).toEqual([10, 10]);
  });

  it('leaves adjacent, neverSpread and board legs untouched', () => {
    for (const overrides of [
      { arrival: 'adjacent' }, { neverSpread: true }, { onArrive: { kind: 'board', vehicleId: 1 } },
    ]) {
      const { state, employee, leg } = walkerWithLeg(overrides as Partial<Itinerary['legs'][number]>);
      respreadLegDestination(state, employee);
      expect([leg.destX, leg.destZ]).toEqual([10, 10]);
      expect(leg.originalDestX ?? null).toBeNull();
    }
  });

  it('does nothing without an itinerary', () => {
    const { state, employee } = walkerWithLeg();
    employee.itinerary = null;
    expect(() => respreadLegDestination(state, employee)).not.toThrow();
  });
});

describe('hole work never starts off the hole cell (#1291)', () => {
  // A charge_hole leg whose hole cell is held by a busy employee used to be
  // destination-spread onto a neighbour; ArrivalGate.ts then started the
  // charge there (only the itinerary emptying is checked), and the hole
  // landed charged at its own x/z — serviced from the wrong tile.
  function chargerAgainstBusyHolder() {
    const state = buildFlatNavGridState(20, 20);
    const rng = new Random(SEED);
    const { employee: holder } = hireEmployee(state.employees, 'driller', rng, 10, 10);
    holder.activeActionId = 999;
    holder.taskTicksRemaining = 500;
    const { employee: charger } = hireEmployee(state.employees, 'driller', rng, 3, 3);
    const action: PendingAction = {
      id: 1, type: 'charge_hole', requiredSkill: null, requiredVehicleRole: null,
      targetX: 10, targetZ: 10, targetY: 0, payload: { holeId: 'h1' }, targetEmployeeId: null,
      status: 'assigned', holderId: charger.id, queuedAtTick: 0,
    };
    state.pendingActions.push(action);
    charger.activeActionId = action.id;
    charger.pendingTaskDuration = 10;
    charger.itinerary = planItinerary(state, charger, { kind: 'work', actionId: action.id }, 'exact', { action });
    return { state, holder, charger };
  }

  it('waits rather than spreading onto a neighbour while a busy employee holds the hole cell', () => {
    const { state, charger } = chargerAgainstBusyHolder();
    for (let t = 0; t < MOVE_STUCK_ABANDON_TICKS + 20; t++) {
      tickLocomotion(state);
      const started = tickArrivalGate(state).taskStarted.includes(charger.id);
      expect(started, `charge started at ${charger.x},${charger.z} on tick ${t}`).toBe(false);
    }
  });

  it('charges from the hole cell itself once the holder goes idle and can be relocated', () => {
    const { state, holder, charger } = chargerAgainstBusyHolder();
    let startedAt: { x: number; z: number } | null = null;
    for (let t = 0; t < 100 && startedAt === null; t++) {
      if (t === AGENT_OCCUPANCY_WAIT_TICKS) {
        holder.activeActionId = null;
        holder.taskTicksRemaining = null;
      }
      tickLocomotion(state);
      if (tickArrivalGate(state).taskStarted.includes(charger.id)) startedAt = { x: charger.x, z: charger.z };
    }
    expect(startedAt).toEqual({ x: 10, z: 10 });
  });
});

describe('an on-foot work claim whose itinerary dies is released, not started in place (#1291 follow-up)', () => {
  // A charge_hole transport ride whose board leg is refused (its vehicle
  // moved away) used to leave the claim staged: ArrivalGate.ts read the
  // cleared itinerary as "arrived" and started charging wherever the
  // employee stood, with the ride's own vehicle reservation still held (I5).
  it('re-queues the action and releases the ride reservation when board() refuses', () => {
    const state = buildFlatNavGridState(30, 30);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED['debris_hauler'], 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);
    const action: PendingAction = {
      id: 1, type: 'charge_hole', requiredSkill: null, requiredVehicleRole: null,
      targetX: 25, targetZ: 0, targetY: 0, payload: { holeId: 'h1' }, targetEmployeeId: null,
      status: 'assigned', holderId: employee.id, queuedAtTick: 0,
    };
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    employee.pendingTaskDuration = 10;
    employee.itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact', { action });
    expect(employee.itinerary!.legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id });
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    vehicle.x = 2;
    vehicle.z = 10;

    let startedAt: { x: number; z: number } | null = null;
    for (let t = 0; t < 20 && employee.activeActionId !== null; t++) {
      tickLocomotion(state);
      if (tickArrivalGate(state).taskStarted.includes(employee.id)) startedAt = { x: employee.x, z: employee.z };
    }

    expect(startedAt).toBeNull();
    expect(employee.activeActionId).toBeNull();
    expect(employee.pendingTaskDuration).toBeNull();
    expect(action.status).toBe('queued');
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
  });
});
