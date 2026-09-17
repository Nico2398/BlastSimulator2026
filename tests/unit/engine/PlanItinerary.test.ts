// BlastSimulator2026 — Tests for PlanItinerary.ts (#1088)
//
// planItinerary is the pure, read-only planner that will eventually replace
// the scattered cost logic in ActionSelection.ts (resolveVehicleGatedWalkTarget,
// computeActionWorkTicks) and VehicleReservation.ts (findFreeVehicleForRole)
// with one ordered Itinerary both the action-cost estimator and the executor
// consume. Nothing wires it in yet (phase 3a, see gameplay-vehicle-fleet) —
// this suite exercises the planner in isolation.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED, getVehicleDefByTier, type VehicleRole } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { findPath } from '../../../src/core/nav/Pathfinding.js';
import { computeActionWorkTicks } from '../../../src/core/engine/ActionSelection.js';
import { planItinerary, estimateLegDistance, findCheapestTransportItinerary, type ResolvedGoal } from '../../../src/core/engine/PlanItinerary.js';
import type { Goal } from '../../../src/core/engine/Itinerary.js';
import { AGENT_WALK_SPEED } from '../../../src/core/config/balance.js';
import { octileHeuristic } from '../../../src/core/nav/Pathfinding.js';

const SEED = 42;

// ── NavGrid helpers (mirrors tests/unit/engine/ActionSelection.test.ts) ────

function makeCell(type: NavCellType): NavCell {
  const moveCost = type === 'blocked' || type === 'void' ? Infinity
    : type === 'ramp' ? 1.8
    : type === 'drill_hole' ? 5.0
    : 1.0;
  return { type, moveCost, benchLevel: 0, vehicleOccupied: false };
}

/** Flat, fully-walkable NavGrid of the given size. */
function makeFlatGrid(width: number, height: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) row.push(makeCell('walkable'));
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
}

/** Block one column across an inclusive z range — a wall forcing a detour. */
function blockColumnRange(grid: NavGrid, x: number, zMin: number, zMax: number): void {
  for (let z = zMin; z <= zMax; z++) {
    grid.cells[z]![x] = makeCell('blocked');
  }
}

/** A fresh game with an open, fully-walkable NavGrid — octile heuristic and real path cost agree here. */
function makeState(width = 30, height = 30): GameState {
  const state = createGame({ seed: SEED });
  state.navGrid = makeFlatGrid(width, height);
  return state;
}

/** Minimal PendingAction fixture, mirroring VehicleReservation.test.ts's makeAction. */
function makeAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
  return {
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 0,
    targetZ: 0,
    targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    queuedAtTick: 0,
    ...overrides,
  };
}

/** Hires a driller and grants them the driving licence for `role`. */
function hireLicensedDriller(state: GameState, role: VehicleRole, x = 0, z = 0): Employee {
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driller', rng, x, z);
  assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED[role], 1);
  return employee;
}

describe('planItinerary', () => {
  it('vehicle-gated goal, employee on foot: two legs (walk-and-board, then drive) whose ticks sum to estTotalTicks and match independently-computed distances (exact fidelity, open grid)', () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 0);
    const action = makeAction({ id: 1, requiredVehicleRole: 'drill_rig', targetX: 20, targetZ: 0 });
    state.pendingActions.push(action);

    const goal: Goal = { kind: 'work', actionId: action.id };
    const itinerary = planItinerary(state, employee, goal, 'exact');

    expect(itinerary).not.toBeNull();
    const legs = itinerary!.legs;
    expect(legs).toHaveLength(2);

    expect(legs[0]!.mode).toBe('foot');
    expect(legs[0]!.arrival).toBe('adjacent');
    expect(legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id });

    expect(legs[1]!.mode).toBe('drive');
    expect(legs[1]!.arrival).toBe('exact');
    expect(legs[1]!.onArrive).toEqual({ kind: 'none' });
    expect(legs[1]!.destX).toBe(action.targetX);
    expect(legs[1]!.destZ).toBe(action.targetZ);

    const walkPath = findPath(state.navGrid!, { agentId: employee.id, fromX: employee.x, fromZ: employee.z, toX: vehicle.x, toZ: vehicle.z, avoidVehicles: false });
    const drivePath = findPath(state.navGrid!, { agentId: employee.id, fromX: vehicle.x, fromZ: vehicle.z, toX: action.targetX, toZ: action.targetZ, avoidVehicles: false });
    expect(walkPath.found).toBe(true);
    expect(drivePath.found).toBe(true);

    const expectedWalkTicks = walkPath.totalCost / AGENT_WALK_SPEED;
    const expectedDriveTicks = drivePath.totalCost / getVehicleDefByTier('drill_rig', 1).speed;
    const expectedWorkTicks = computeActionWorkTicks(state, employee, action);

    expect(legs[0]!.estTicks).toBeCloseTo(expectedWalkTicks);
    expect(legs[1]!.estTicks).toBeCloseTo(expectedDriveTicks);
    expect(itinerary!.workTicks).toBeCloseTo(expectedWorkTicks);
    expect(itinerary!.estTotalTicks).toBeCloseTo(legs[0]!.estTicks + legs[1]!.estTicks + itinerary!.workTicks);
    expect(itinerary!.estTotalTicks).toBeCloseTo(expectedWalkTicks + expectedDriveTicks + expectedWorkTicks);
  });

  it('employee already mounted in the qualifying vehicle: single drive leg, strictly cheaper than walking-and-boarding first', () => {
    const walkState = makeState();
    const walkEmployee = hireLicensedDriller(walkState, 'drill_rig', 0, 0);
    purchaseVehicle(walkState.vehicles, 'drill_rig', 5, 0);
    const walkAction = makeAction({ id: 1, requiredVehicleRole: 'drill_rig', targetX: 20, targetZ: 0 });
    walkState.pendingActions.push(walkAction);
    const walkItinerary = planItinerary(walkState, walkEmployee, { kind: 'work', actionId: walkAction.id }, 'exact');
    expect(walkItinerary).not.toBeNull();

    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 0);
    const employee = hireLicensedDriller(state, 'drill_rig', vehicle.x, vehicle.z);
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    vehicle.occupantIds = [employee.id];
    const action = makeAction({ id: 1, requiredVehicleRole: 'drill_rig', targetX: 20, targetZ: 0 });
    state.pendingActions.push(action);

    const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact');

    expect(itinerary).not.toBeNull();
    expect(itinerary!.legs).toHaveLength(1);
    expect(itinerary!.legs[0]!.mode).toBe('drive');
    expect(itinerary!.estTotalTicks).toBeLessThan(walkItinerary!.estTotalTicks);
  });

  describe('unreachable goal returns null', () => {
    it('actionId not found among state.pendingActions', () => {
      const state = makeState();
      const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);

      const itinerary = planItinerary(state, employee, { kind: 'work', actionId: 999 }, 'exact');
      expect(itinerary).toBeNull();
    });

    it('vehicle-gated goal but no vehicle of the required role purchased at all', () => {
      const state = makeState();
      const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);
      const action = makeAction({ id: 1, requiredVehicleRole: 'drill_rig', targetX: 20, targetZ: 0 });
      state.pendingActions.push(action);
      // No purchaseVehicle call — the fleet is empty.

      const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact');
      expect(itinerary).toBeNull();
    });

    it('geometrically unreachable target: reposition goal boxed in by blocked cells on all 8 neighbours returns null (real findPath failure, not entity-resolution failure)', () => {
      const state = makeState();
      const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);

      // Box (12,7) in completely — every 8-directional neighbour is blocked,
      // so no A* path (nor the direct-line fast path) can ever step onto it,
      // even though the cell itself stays walkable and the grid is otherwise open.
      const targetX = 12;
      const targetZ = 7;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          state.navGrid!.cells[targetZ + dz]![targetX + dx] = makeCell('blocked');
        }
      }
      const walled = findPath(state.navGrid!, { agentId: employee.id, fromX: employee.x, fromZ: employee.z, toX: targetX, toZ: targetZ, avoidVehicles: false });
      expect(walled.found).toBe(false);

      const goal: Goal = { kind: 'reposition', x: targetX, z: targetZ };
      const itinerary = planItinerary(state, employee, goal, 'exact');
      expect(itinerary).toBeNull();
    });

    it('target outside the NavGrid\'s bounds: null rather than an itinerary costed against findPath\'s silently clamped-to-grid endpoint (#1109)', () => {
      // 30×30 grid (makeState default) — a reposition goal far past the east
      // edge would, under plain findPath, silently clamp onto the grid's last
      // column and still report found:true. estimateLegDistance must refuse
      // this via findExactPath instead of returning a distance computed
      // against that wrong, clamped cell.
      const state = makeState(30, 30);
      const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);

      const outOfBoundsX = 500;
      const outOfBoundsZ = 500;
      const plainPath = findPath(state.navGrid!, {
        agentId: employee.id,
        fromX: employee.x,
        fromZ: employee.z,
        toX: outOfBoundsX,
        toZ: outOfBoundsZ,
        avoidVehicles: false,
      });
      expect(plainPath.found).toBe(true); // findPath itself still clamps silently

      const goal: Goal = { kind: 'reposition', x: outOfBoundsX, z: outOfBoundsZ };
      const itinerary = planItinerary(state, employee, goal, 'exact');
      expect(itinerary).toBeNull();
    });
  });

  it('fidelity agreement: same leg structure for estimate vs exact, but estTicks differ where an obstacle forces a detour', () => {
    const width = 30;
    const height = 15;
    const state = createGame({ seed: SEED });
    const grid = makeFlatGrid(width, height);
    // Wall at x=10, rows z:0..8 blocked — leaves z:9..14 as the only crossing,
    // so the real path from (0,0) to the vehicle at (15,0) must detour south
    // and back, while octileHeuristic (estimate) only ever measures the
    // straight line and never sees the wall at all.
    blockColumnRange(grid, 10, 0, 8);
    state.navGrid = grid;

    const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);
    purchaseVehicle(state.vehicles, 'drill_rig', 15, 0);
    const action = makeAction({ id: 1, requiredVehicleRole: 'drill_rig', targetX: 25, targetZ: 0 });
    state.pendingActions.push(action);

    const goal: Goal = { kind: 'work', actionId: action.id };
    const estimateItinerary = planItinerary(state, employee, goal, 'estimate');
    const exactItinerary = planItinerary(state, employee, goal, 'exact');

    expect(estimateItinerary).not.toBeNull();
    expect(exactItinerary).not.toBeNull();

    const estLegs = estimateItinerary!.legs;
    const exactLegs = exactItinerary!.legs;
    expect(exactLegs).toHaveLength(estLegs.length);

    for (let i = 0; i < estLegs.length; i++) {
      expect(exactLegs[i]!.mode).toBe(estLegs[i]!.mode);
      expect(exactLegs[i]!.arrival).toBe(estLegs[i]!.arrival);
      expect(exactLegs[i]!.onArrive).toEqual(estLegs[i]!.onArrive);
      expect(exactLegs[i]!.vehicleId).toBe(estLegs[i]!.vehicleId);
      expect(exactLegs[i]!.destX).toBe(estLegs[i]!.destX);
      expect(exactLegs[i]!.destZ).toBe(estLegs[i]!.destZ);
    }

    // Leg 0 (walk to the vehicle) crosses the wall — the real (exact) path
    // must detour around it, so its cost is strictly higher than the
    // straight-line octile estimate for the same leg.
    expect(exactLegs[0]!.estTicks).toBeGreaterThan(estLegs[0]!.estTicks);
  });

  it('employee co-located with the vehicle but not mounted: foot leg still present with estTicks 0 (leg presence is driven by locomotion state, not distance)', () => {
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 0);
    const employee = hireLicensedDriller(state, 'drill_rig', vehicle.x, vehicle.z);
    // employee.locomotion stays { kind: 'on_foot' } — co-located, but never boarded.
    const action = makeAction({ id: 1, requiredVehicleRole: 'drill_rig', targetX: 20, targetZ: 0 });
    state.pendingActions.push(action);

    const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact');

    expect(itinerary).not.toBeNull();
    expect(itinerary!.legs).toHaveLength(2);
    expect(itinerary!.legs[0]!.mode).toBe('foot');
    expect(itinerary!.legs[0]!.estTicks).toBe(0);
  });

  it("'reposition' goal: single foot leg to the target coordinates, zero work ticks", () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);

    const goal: Goal = { kind: 'reposition', x: 12, z: 7 };
    const itinerary = planItinerary(state, employee, goal, 'exact');

    expect(itinerary).not.toBeNull();
    expect(itinerary!.legs).toHaveLength(1);
    expect(itinerary!.legs[0]!.mode).toBe('foot');
    expect(itinerary!.legs[0]!.destX).toBe(12);
    expect(itinerary!.legs[0]!.destZ).toBe(7);
    expect(itinerary!.workTicks).toBe(0);
  });

  it("'rest' goal referencing a buildingId absent from state.buildings.buildings returns null", () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);
    expect(state.buildings.buildings.some(b => b.id === 999)).toBe(false);

    const itinerary = planItinerary(state, employee, { kind: 'rest', buildingId: 999 }, 'exact');
    expect(itinerary).toBeNull();
  });

  it("'rest' goal resolving against a real, existing building: single foot leg to its x/z, zero work ticks (mirrors 'reposition', exercising resolveGoal's building lookup on the success path)", () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);
    const { success, building } = placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);
    expect(success).toBe(true);

    const goal: Goal = { kind: 'rest', buildingId: building!.id };
    const itinerary = planItinerary(state, employee, goal, 'exact');

    expect(itinerary).not.toBeNull();
    expect(itinerary!.legs).toHaveLength(1);
    expect(itinerary!.legs[0]!.mode).toBe('foot');
    expect(itinerary!.legs[0]!.arrival).toBe('exact');
    expect(itinerary!.legs[0]!.onArrive).toEqual({ kind: 'none' });
    expect(itinerary!.legs[0]!.destX).toBe(building!.x);
    expect(itinerary!.legs[0]!.destZ).toBe(building!.z);
    expect(itinerary!.workTicks).toBe(0);
  });

  it('employee not licensed for the required vehicle role returns null even though a free vehicle of that role exists (distinguishes "not licensed" from "no vehicle")', () => {
    const state = makeState();
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    // No assignSkill call — employee lacks the driving.drill_rig licence.
    purchaseVehicle(state.vehicles, 'drill_rig', 5, 0);
    const action = makeAction({ id: 1, requiredVehicleRole: 'drill_rig', targetX: 20, targetZ: 0 });
    state.pendingActions.push(action);

    const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact');
    expect(itinerary).toBeNull();
  });

  it("fidelity: 'exact' with state.navGrid still null falls back to the octile heuristic instead of throwing or returning null purely for lack of a NavGrid (mirrors resolveActionCost's own null-navGrid convention)", () => {
    const state = createGame({ seed: SEED }); // no makeState() — navGrid left at its createGame default.
    expect(state.navGrid).toBeNull();
    const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 0);
    const action = makeAction({ id: 1, requiredVehicleRole: 'drill_rig', targetX: 20, targetZ: 0 });
    state.pendingActions.push(action);

    const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact');

    expect(itinerary).not.toBeNull();
    expect(itinerary!.legs).toHaveLength(2);
    expect(itinerary!.legs[0]!.mode).toBe('foot');
    expect(itinerary!.legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id });
    expect(itinerary!.legs[1]!.mode).toBe('drive');
    expect(itinerary!.legs[1]!.destX).toBe(action.targetX);
    expect(itinerary!.legs[1]!.destZ).toBe(action.targetZ);
  });

  it('is pure: state is unchanged after planning a vehicle-gated itinerary (no mutation, no reservation side effect)', () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'drill_rig', 0, 0);
    purchaseVehicle(state.vehicles, 'drill_rig', 5, 0);
    const action = makeAction({ id: 1, requiredVehicleRole: 'drill_rig', targetX: 20, targetZ: 0 });
    state.pendingActions.push(action);

    const before = structuredClone(state);
    planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact');

    expect(state).toEqual(before);
  });
});

// ── transport planning (phase 7, #1093) ─────────────────────────────────────
// A non-vehicle-gated 'work' goal (requiredVehicleRole: null — general_work,
// survey, etc.) currently always plans a plain foot-only itinerary. Phase 7
// wires findCheapestTransportItinerary into planItinerary's own
// `role === null && via === undefined` branch (see that branch's own
// TODO(#1093 phase 7) comment in PlanItinerary.ts), so a distant such goal
// should instead compare walking against riding a free, licensed vehicle for
// most of the trip and pick whichever is cheaper — never for a vehicle whose
// speed can't beat AGENT_WALK_SPEED (rock_digger, speed 1), and never for
// 'reposition'/'rest' goals, which carry no actionId for
// findCheapestTransportItinerary to scope its comparison to. Both
// findCheapestTransportItinerary and buildTransportRideItinerary are current
// stubs that unconditionally return null (PlanItinerary.ts), so every
// assertion below that a ride itinerary exists is expected to fail at RED
// phase — not from an import/type error, from a real, named assertion.
describe('transport planning (phase 7, #1093)', () => {
  it('distant work goal with a free tier-1 debris hauler nearby: itinerary rides the hauler most of the way, alights near the target, finishes on foot, and beats walking outright', () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'debris_hauler', 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);
    const action = makeAction({ id: 1, targetX: 20, targetZ: 0 }); // requiredVehicleRole defaults to null — a plain on-foot goal
    state.pendingActions.push(action);
    const goal: Goal = { kind: 'work', actionId: action.id };

    const itinerary = planItinerary(state, employee, goal, 'exact');
    expect(itinerary).not.toBeNull();

    const driveLeg = itinerary!.legs.find(l => l.mode === 'drive');
    expect(driveLeg, `expected a drive leg riding the free hauler; got legs: ${JSON.stringify(itinerary!.legs)}`).toBeDefined();
    expect(driveLeg!.vehicleId).toBe(vehicle.id);
    // Fixed post-#1093 landing (buildings.integration.test.ts's #1000
    // starved-backlog regression): the drive leg now targets a real,
    // computed alight WAYPOINT with `arrival: 'exact'`, not the goal's own
    // target under a loose `arrival: 'adjacent'` tolerance. 'adjacent'
    // accepts distance <= 1 — including 0 — so a single fast tick could (and
    // did) overshoot straight onto the target cell itself; for a
    // `place_building` goal that cell becomes permanently NavGrid-blocked
    // the instant construction completes, stranding a vehicle parked there
    // for good (see PlanItinerary.ts's `resolveRideAlightPoint`/
    // `targetBecomesBlocked` doc comments).
    expect(driveLeg!.arrival).toBe('exact');
    expect(driveLeg!.onArrive).toEqual({ kind: 'alight', releaseVehicleForActionId: action.id });

    // Trailing foot leg finishes the last stretch into the exact target.
    const lastLeg = itinerary!.legs[itinerary!.legs.length - 1]!;
    expect(lastLeg.mode).toBe('foot');
    expect(lastLeg.arrival).toBe('exact');
    expect(lastLeg.destX).toBe(action.targetX);
    expect(lastLeg.destZ).toBe(action.targetZ);

    // Foot-only baseline for the identical goal/position: same setup, minus the vehicle.
    const footState = makeState();
    const footEmployee = hireLicensedDriller(footState, 'debris_hauler', 0, 0);
    const footAction = makeAction({ id: 1, targetX: 20, targetZ: 0 });
    footState.pendingActions.push(footAction);
    const footItinerary = planItinerary(footState, footEmployee, { kind: 'work', actionId: footAction.id }, 'exact');
    expect(footItinerary).not.toBeNull();
    expect(footItinerary!.legs.every(l => l.mode === 'foot')).toBe(true);

    expect(itinerary!.estTotalTicks).toBeLessThan(footItinerary!.estTotalTicks);
  });

  it('same goal, only a free rock digger available (speed 1): stays foot-only — a digger never beats walking speed 2', () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'rock_digger', 0, 0);
    purchaseVehicle(state.vehicles, 'rock_digger', 2, 0);
    const action = makeAction({ id: 1, targetX: 20, targetZ: 0 });
    state.pendingActions.push(action);

    const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact');

    expect(itinerary).not.toBeNull();
    expect(itinerary!.legs.some(l => l.mode === 'drive')).toBe(false);
    expect(itinerary!.legs.every(l => l.mode === 'foot')).toBe(true);
  });

  it('same goal, no free vehicle at all: foot-only itinerary, identical to today\'s behavior', () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'debris_hauler', 0, 0);
    // No purchaseVehicle call — the fleet is empty.
    const action = makeAction({ id: 1, targetX: 20, targetZ: 0 });
    state.pendingActions.push(action);

    const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact');

    expect(itinerary).not.toBeNull();
    expect(itinerary!.legs).toHaveLength(1);
    expect(itinerary!.legs[0]!.mode).toBe('foot');
  });

  it('purity: neither planItinerary nor findCheapestTransportItinerary reserves the candidate vehicle as a side effect of merely planning', () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'debris_hauler', 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);
    const action = makeAction({ id: 1, targetX: 20, targetZ: 0 });
    state.pendingActions.push(action);
    const goal: Goal = { kind: 'work', actionId: action.id };

    const beforePlan = structuredClone(state);
    planItinerary(state, employee, goal, 'exact');
    expect(state).toEqual(beforePlan);
    expect(vehicle.reservedForActionId).toBeNull();

    const resolved: ResolvedGoal = {
      targetX: action.targetX,
      targetZ: action.targetZ,
      requiredVehicleRole: null,
      workTicks: computeActionWorkTicks(state, employee, action),
      actionId: action.id,
    };
    const footDist = estimateLegDistance(state, 'exact', employee.id, employee.x, employee.z, action.targetX, action.targetZ, true)!;
    const footCost = footDist / AGENT_WALK_SPEED;

    const beforeFindCheapest = structuredClone(state);
    findCheapestTransportItinerary(state, employee, goal, 'exact', resolved, footCost);
    expect(state).toEqual(beforeFindCheapest);
    expect(vehicle.reservedForActionId).toBeNull();
  });

  it("'reposition' goal is unaffected by the flag: stays foot-only even with a free fast vehicle nearby", () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'debris_hauler', 0, 0);
    purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);

    const goal: Goal = { kind: 'reposition', x: 20, z: 0 };
    const itinerary = planItinerary(state, employee, goal, 'exact');

    expect(itinerary).not.toBeNull();
    expect(itinerary!.legs).toHaveLength(1);
    expect(itinerary!.legs[0]!.mode).toBe('foot');
  });

  it("'rest' goal is unaffected by the flag: stays foot-only even with a free fast vehicle nearby", () => {
    const state = makeState();
    const employee = hireLicensedDriller(state, 'debris_hauler', 0, 0);
    purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);
    const { success, building } = placeBuilding(state.buildings, 'living_quarters', 20, 0, 100, 100);
    expect(success).toBe(true);

    const goal: Goal = { kind: 'rest', buildingId: building!.id };
    const itinerary = planItinerary(state, employee, goal, 'exact');

    expect(itinerary).not.toBeNull();
    expect(itinerary!.legs).toHaveLength(1);
    expect(itinerary!.legs[0]!.mode).toBe('foot');
  });
});

// ── estimateLegDistance (#1128 — exported for TaskCancellation.ts's
// hasCloserIdleCandidate to reuse as its real distance oracle instead of a
// hand-rolled duplicate) ─────────────────────────────────────────────────
describe('estimateLegDistance', () => {
  it('exact fidelity, open grid: returns the real A* path cost for the given request, matching findPath\'s own totalCost', () => {
    const state = makeState(20, 20);
    const dist = estimateLegDistance(state, 'exact', 1, 0, 0, 10, 0, false);
    const path = findPath(state.navGrid!, { agentId: 1, fromX: 0, fromZ: 0, toX: 10, toZ: 0, avoidVehicles: false });
    expect(path.found).toBe(true);
    expect(dist).toBeCloseTo(path.totalCost);
  });

  it('estimate fidelity: returns the plain octile heuristic regardless of any NavGrid obstacle', () => {
    const state = makeState(20, 20);
    blockColumnRange(state.navGrid!, 5, 0, 19); // full wall an exact search would have to detour around
    const dist = estimateLegDistance(state, 'estimate', 1, 0, 0, 10, 0, false);
    expect(dist).toBe(octileHeuristic(0, 0, 10, 0));
  });

  it('exact fidelity with state.navGrid === null falls back to the octile heuristic (boundary — no grid built yet)', () => {
    const state = createGame({ seed: SEED });
    expect(state.navGrid).toBeNull();
    const dist = estimateLegDistance(state, 'exact', 1, 0, 0, 10, 0, false);
    expect(dist).toBe(octileHeuristic(0, 0, 10, 0));
  });

  it('exact fidelity: a target outside the NavGrid\'s bounds returns null rather than a distance against findPath\'s silently clamped endpoint (#1109)', () => {
    const state = makeState(30, 30);
    const plainPath = findPath(state.navGrid!, { agentId: 1, fromX: 0, fromZ: 0, toX: 500, toZ: 500, avoidVehicles: false });
    expect(plainPath.found).toBe(true); // findPath itself still clamps silently

    const dist = estimateLegDistance(state, 'exact', 1, 0, 0, 500, 500, false);
    expect(dist).toBeNull();
  });

  it('exact fidelity: a geometrically unreachable target (boxed in on all 8 neighbours) returns null (rejection)', () => {
    const state = makeState(20, 20);
    const targetX = 10, targetZ = 10;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        state.navGrid!.cells[targetZ + dz]![targetX + dx] = makeCell('blocked');
      }
    }
    const dist = estimateLegDistance(state, 'exact', 1, 0, 0, targetX, targetZ, false);
    expect(dist).toBeNull();
  });

  it('avoidVehicles true treats an occupied target as impassable (null); false lets a route reach the exact same cell', () => {
    const state = makeState(20, 20);
    state.navGrid!.cells[0]![10]!.vehicleOccupied = true;

    const blocked = estimateLegDistance(state, 'exact', 1, 0, 0, 10, 0, true);
    const allowed = estimateLegDistance(state, 'exact', 1, 0, 0, 10, 0, false);

    expect(blocked).toBeNull();
    expect(allowed).not.toBeNull();
  });
});
