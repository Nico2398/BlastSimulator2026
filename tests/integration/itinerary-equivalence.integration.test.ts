// BlastSimulator2026 — planItinerary/simulation equivalence (#1088)
//
// planItinerary('exact') is meant to become the single source of truth for
// how long a vehicle-gated journey takes — the same number the action-cost
// estimator ranks candidates by and the number the executor actually spends
// walking-and-driving. This suite proves the two stay in agreement: at the
// tick an employee claims a vehicle-gated PendingAction, plan the itinerary,
// then let the REAL, untouched production tick pipeline (TickPipeline.ts's
// runTick, exactly what the console's `tick` command and the renderer's game
// loop both call) drive the employee through the same journey, and compare
// the ticks each one took.
//
// planItinerary is not wired into the tick pipeline yet (phase 3a) — this
// suite plans an itinerary directly, then drives the real pipeline through
// the same journey to prove the two numbers agree.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../src/core/state/GameState.js';
import { Random } from '../../src/core/math/Random.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { hireEmployee, assignSkill } from '../../src/core/entities/Employee.js';
import { purchaseVehicle, ROLE_LICENCE_REQUIRED, type VehicleRole } from '../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell, type NavCellType } from '../../src/core/nav/NavGrid.js';
import { planItinerary } from '../../src/core/engine/PlanItinerary.js';
import { runTick } from '../../src/core/engine/TickPipeline.js';

/**
 * Max ticks the simulation's actual travel time may diverge from
 * planItinerary('exact')'s estTotalTicks (minus workTicks) for the same
 * journey. Two sources of slack: (1) each leg's estTicks is a continuous
 * quotient (distance/speed) while the simulation advances in whole ticks,
 * so each leg can round up by +1 tick; (2) the board->drive handoff starts
 * driving the tick AFTER boarding completes, not the same tick, adding one
 * more tick at the leg boundary. A 2-leg itinerary has 2 rounding slots + 1
 * handoff slot = 3.
 */
const ITINERARY_EQUIVALENCE_TOLERANCE_TICKS = 3;

/** Upper bound on how many ticks the harness will drive the simulation before giving up on a case — well past any journey these fixtures set up. */
const MAX_HARNESS_TICKS = 400;

const GRID_WIDTH = 60;
const GRID_HEIGHT = 20;

// ── NavGrid helpers (mirrors tests/unit/engine/PlanItinerary.test.ts) ──────

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

function buildOpenGrid(): NavGrid {
  return makeFlatGrid(GRID_WIDTH, GRID_HEIGHT);
}

/** Wall at x=10, rows z:0..8 blocked, leaving z:9..14 as the only crossing — forces a non-straight real path from any (x<10) start to any (x>10) target. */
function buildObstacleGrid(): NavGrid {
  const grid = makeFlatGrid(30, 15);
  blockColumnRange(grid, 10, 0, 8);
  return grid;
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

interface ItineraryEquivalenceCase {
  label: string;
  role: VehicleRole;
  employeeStart: { x: number; z: number };
  vehicleStart: { x: number; z: number };
  targetX: number;
  targetZ: number;
  /** Employee starts already mounted (boarded) in the reserved vehicle, at the vehicle's own position. */
  alreadyMounted?: boolean;
  /** Defaults to an open, fully-walkable grid — override for the obstacle case. */
  gridFactory?: () => NavGrid;
}

/**
 * Builds one case's GameState — hires and licenses one employee, purchases
 * one vehicle of `role`, optionally boards the employee onto it, and queues
 * one vehicle-gated PendingAction — then drives the REAL production tick
 * pipeline (runTick) forward: records planItinerary('exact')'s own estimate
 * at the tick the employee claims the action, then keeps ticking until the
 * claimed action's work timer starts (employee.taskTicksRemaining becomes
 * non-null), recording how many ticks the simulation itself actually spent
 * travelling. Returns both figures for the caller to compare.
 */
function measureItineraryEquivalence(seed: number, c: ItineraryEquivalenceCase): {
  plannedTravelTicks: number;
  actualTravelTicks: number;
} {
  const state: GameState = createGame({ seed });
  state.navGrid = (c.gridFactory ?? buildOpenGrid)();

  const rng = new Random(seed);
  const { employee } = hireEmployee(state.employees, 'driller', rng, c.employeeStart.x, c.employeeStart.z);
  assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED[c.role], 1);

  const { vehicle } = purchaseVehicle(state.vehicles, c.role, c.vehicleStart.x, c.vehicleStart.z);

  if (c.alreadyMounted) {
    employee.x = vehicle.x;
    employee.z = vehicle.z;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    vehicle.driverId = employee.id;
    vehicle.occupantIds = [employee.id];
  }

  const action = makeAction({ id: 1, requiredVehicleRole: c.role, targetX: c.targetX, targetZ: c.targetZ });
  state.pendingActions.push(action);

  const tickRng = new Random(seed + 1);
  const emitter = new EventEmitter();

  let tickAtPlan: number | null = null;
  let plannedTravelTicks: number | null = null;

  for (let i = 0; i < MAX_HARNESS_TICKS; i++) {
    runTick(state, null, tickRng, emitter, { checkInvariants: true });

    if (tickAtPlan === null && employee.activeActionId === action.id) {
      tickAtPlan = state.tickCount;
      const itinerary = planItinerary(state, employee, { kind: 'work', actionId: action.id }, 'exact');
      expect(itinerary).not.toBeNull();
      plannedTravelTicks = itinerary!.estTotalTicks - itinerary!.workTicks;
    }

    if (tickAtPlan !== null && employee.taskTicksRemaining !== null) {
      return { plannedTravelTicks: plannedTravelTicks!, actualTravelTicks: state.tickCount - tickAtPlan };
    }
  }

  throw new Error(`${c.label}: simulation never reached the claimed action's work timer within ${MAX_HARNESS_TICKS} ticks`);
}

function expectEquivalent(seed: number, c: ItineraryEquivalenceCase): void {
  const { plannedTravelTicks, actualTravelTicks } = measureItineraryEquivalence(seed, c);
  expect(Math.abs(plannedTravelTicks - actualTravelTicks)).toBeLessThanOrEqual(ITINERARY_EQUIVALENCE_TOLERANCE_TICKS);
}

describe('planItinerary / simulation equivalence (#1088)', () => {
  it('drill_rig, on foot, near', () => {
    expectEquivalent(101, {
      label: 'drill_rig-on_foot-near',
      role: 'drill_rig',
      employeeStart: { x: 0, z: 0 },
      vehicleStart: { x: 4, z: 0 },
      targetX: 10, targetZ: 0,
    });
  });

  it('drill_rig, on foot, far', () => {
    expectEquivalent(102, {
      label: 'drill_rig-on_foot-far',
      role: 'drill_rig',
      employeeStart: { x: 0, z: 0 },
      vehicleStart: { x: 20, z: 5 },
      targetX: 45, targetZ: 10,
    });
  });

  it('debris_hauler, on foot, near', () => {
    expectEquivalent(103, {
      label: 'debris_hauler-on_foot-near',
      role: 'debris_hauler',
      employeeStart: { x: 2, z: 2 },
      vehicleStart: { x: 6, z: 2 },
      targetX: 15, targetZ: 2,
    });
  });

  it('rock_digger, already mounted, near', () => {
    expectEquivalent(104, {
      label: 'rock_digger-mounted-near',
      role: 'rock_digger',
      employeeStart: { x: 30, z: 10 },
      vehicleStart: { x: 30, z: 10 },
      targetX: 35, targetZ: 10,
      alreadyMounted: true,
    });
  });

  it('rock_fragmenter, on foot, far', () => {
    expectEquivalent(105, {
      label: 'rock_fragmenter-on_foot-far',
      role: 'rock_fragmenter',
      employeeStart: { x: 0, z: 15 },
      vehicleStart: { x: 25, z: 15 },
      targetX: 55, targetZ: 15,
    });
  });

  it('building_destroyer, on foot, near', () => {
    expectEquivalent(106, {
      label: 'building_destroyer-on_foot-near',
      role: 'building_destroyer',
      employeeStart: { x: 5, z: 5 },
      vehicleStart: { x: 8, z: 5 },
      targetX: 12, targetZ: 5,
    });
  });

  it('debris_hauler, already mounted, far', () => {
    expectEquivalent(107, {
      label: 'debris_hauler-mounted-far',
      role: 'debris_hauler',
      employeeStart: { x: 10, z: 18 },
      vehicleStart: { x: 10, z: 18 },
      targetX: 58, targetZ: 18,
      alreadyMounted: true,
    });
  });

  it('drill_rig, on foot, obstacle forcing a non-straight path', () => {
    expectEquivalent(108, {
      label: 'drill_rig-on_foot-obstacle',
      role: 'drill_rig',
      employeeStart: { x: 0, z: 0 },
      vehicleStart: { x: 15, z: 0 },
      targetX: 25, targetZ: 0,
      gridFactory: buildObstacleGrid,
    });
  });
});
