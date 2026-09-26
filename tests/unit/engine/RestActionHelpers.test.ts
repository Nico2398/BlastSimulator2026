// BlastSimulator2026 — Tests for deductRestCost (relocated from
// GameLoop.test.ts, #759).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { defineZone } from '../../../src/core/entities/Zone.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import {
  deductRestCost, findNearestBuildingOfType, completeRestForEmployee, beginRestTravel,
  createRestPendingAction, isMidClaimedTaskExecution, restRoundTripWorthwhile, resolveRestDestination,
  resolveBuildingApproach, isRestBuildingFull, resolveRestBuildingId,
} from '../../../src/core/engine/RestActionHelpers.js';
import { getBuildingPeopleCapacity } from '../../../src/core/entities/Building.js';
import {
  NEED_REST_COSTS, NEED_REST_NO_BUILDING_CAP, MAX_NEED_GAUGE,
  BUILDING_REPLENISH_RATES, NEED_REST_DURATIONS, AGENT_WALK_SPEED,
} from '../../../src/core/config/balance.js';

const DEDUCT_SEED = 42;

/** Flat, fully walkable NavGrid of the given size — mirrors the identical
 * helper in EmployeeDispatchSteps.test.ts. */
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

// #928: hunger and breakNeed (and their non-zero NEED_REST_COSTS entries)
// were removed — fatigue, the sole surviving gauge, has always cost 0
// (NEED_REST_COSTS.fatigue = 0). deductRestCost's non-zero-cost branch
// (the multiplication and the addExpense call) is unreachable through the
// real NeedKey type now — there is no gauge left to exercise it with. What
// remains testable is the zero-cost path itself: a fatigue rest visit
// deducts nothing and records no finance transaction, matching the "NO cash
// deduction from a fatigue rest visit" behavior the needs-cost-visual
// scenario also pins down.
describe('deductRestCost', () => {
  // ── Test 1: Boundary: fatigue visit deducts 0 from cash ──
  it('deducts 0 from cash for fatigue (no cost)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    const deducted = deductRestCost(state, 'fatigue');

    expect(state.cash).toBe(5000);
    expect(deducted).toBe(0);
    expect(deducted).toBe(NEED_REST_COSTS.fatigue);
  });

  // ── Test 2: Boundary: already-negative cash is left untouched, not reset to 0 ──
  it('does not reset already-negative cash back up to 0 (a prior bankruptcy-territory balance is not erased)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = -48870;

    const deducted = deductRestCost(state, 'fatigue');

    expect(state.cash).toBe(-48870);
    expect(deducted).toBe(0);
  });

  // ── Test 3: Boundary: fatigue (0 cost) records no expense (addExpense no-ops on amount <= 0) ──
  it('records no finance transaction for fatigue (zero-cost visit)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    deductRestCost(state, 'fatigue');

    expect(state.finances.transactions.find(t => t.category === 'needs')).toBeUndefined();
  });
});

// #1060: createRestPendingAction stamps queuedAtTick with the current
// state.tickCount at creation time — read by ActionSelection.ts's
// findStarvedActionForEmployee to measure how long a queued, unclaimed,
// on-foot rest action has waited before it wins dispatch over vehicle
// continuity (#1000). Must read live state.tickCount, not a hardcoded
// constant, so a rest action created later in the game starves at the right
// tick rather than always reading age 0.
describe('createRestPendingAction', () => {
  it('stamps queuedAtTick with state.tickCount at creation (happy path — tickCount 0)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    expect(state.tickCount).toBe(0);

    const result = createRestPendingAction(state, {
      targetX: 5, targetZ: 5, targetEmployeeId: null, payload: {},
    });

    expect(result.queuedAtTick).toBe(0);
    expect(result.queuedAtTick).toBe(state.tickCount);
  });

  it('reads live state.tickCount rather than a hardcoded constant (boundary — non-zero tick)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.tickCount = 456;

    const result = createRestPendingAction(state, {
      targetX: 5, targetZ: 5, targetEmployeeId: null, payload: {},
    });

    expect(result.queuedAtTick).toBe(456);
    expect(result.queuedAtTick).toBe(state.tickCount);
  });
});

describe('findNearestBuildingOfType — active-zone exclusion (#557)', () => {
  it('excludes a building sitting inside a still-occupied zone, picking a farther one outside instead', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const rng = new Random(DEDUCT_SEED);
    // Closer, but inside the zone about to be defined below.
    const inside = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(inside.success).toBe(true);
    // Farther, outside the zone.
    const outside = placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);
    expect(outside.success).toBe(true);

    defineZone(state.zone, { x1: 0, z1: 0, x2: 10, z2: 10 });
    hireEmployee(state.employees, 'driller', rng, 5, 5); // keeps the zone occupied -> not clear

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found?.id).toBe(outside.building!.id);
  });

  it('stops excluding once the zone reports clear — the nearer, in-zone building is eligible again (boundary)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const inside = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(inside.success).toBe(true);
    placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);

    defineZone(state.zone, { x1: 0, z1: 0, x2: 10, z2: 10 });
    // No employees/vehicles at all -> the zone is trivially clear.

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found?.id).toBe(inside.building!.id);
  });

  it('keeps excluding once the zone reports clear of occupants, while a live blast plan still overlaps it (#557 follow-up)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const inside = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(inside.success).toBe(true);
    const outside = placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);
    expect(outside.success).toBe(true);

    defineZone(state.zone, { x1: 0, z1: 0, x2: 10, z2: 10 });
    // No employees/vehicles at all -> occupancy alone would say "clear" —
    // but a charged, un-fired blast plan squarely inside the same footprint
    // means it genuinely is not safe to route anyone back here yet.
    state.drillHoles.push({ id: 'H1', x: 5, z: 5, depth: 6, diameter: 0.089 });

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found?.id).toBe(outside.building!.id);
  });

  it('applies no exclusion at all when no zone has ever been defined (rejection — nothing to exclude)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const near = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(near.success).toBe(true);

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found?.id).toBe(near.building!.id);
  });

  // #1204: a living_quarters at (or over) capacity is skipped by the search —
  // mirrors isSchoolFull's own exclusion for the training building (#1203) —
  // so a resting employee is routed to the next nearest building with an
  // actual free bed, rather than walking to one that will refuse them on
  // arrival.
  it('skips a full living quarters and returns the next nearest one with a free bed (#1204)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const near = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);
    expect(near.success).toBe(true);
    near.building!.occupantIds = Array.from(
      { length: getBuildingPeopleCapacity('living_quarters', 1) },
      (_, i) => -(i + 1), // synthetic ids — only the count matters here
    );
    const far = placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100, 1);
    expect(far.success).toBe(true);

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found?.id).toBe(far.building!.id);
  });

  it('returns null when every living quarters is full (#1204)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    const only = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);
    expect(only.success).toBe(true);
    only.building!.occupantIds = Array.from(
      { length: getBuildingPeopleCapacity('living_quarters', 1) },
      (_, i) => -(i + 1),
    );

    const found = findNearestBuildingOfType(state, 'living_quarters', 0, 0);

    expect(found).toBeNull();
  });
});

// #1204: isRestBuildingFull gates the rest flow's "is there room to walk in"
// check the same way isSchoolFull (EmployeeTraining.ts) gates enrolment
// (#1203) — occupantIds already inside PLUS everyone already walking there
// (pendingRestDuration !== null, targeting this building via their active
// rest action's own payload.buildingId) must together reach capacity before
// the building counts as full, so two rest walks claimed the same tick can
// never together overshoot it even though neither has arrived yet.
describe('isRestBuildingFull (#1204)', () => {
  const SEED = 42;

  /** A rest PendingAction naming `buildingId`, self-claimed by `employeeId`, with the employee mid-walk (pendingRestDuration set). */
  function pushWalkingRestAction(state: ReturnType<typeof createGame>, employeeId: number, actionId: number, buildingId: number): void {
    state.pendingActions.push({
      id: actionId, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { buildingId, needKey: 'fatigue', restDuration: 8 },
      targetEmployeeId: employeeId, status: 'assigned', holderId: employeeId, queuedAtTick: 0,
    });
  }

  it('false when occupancy plus in-flight walkers is below capacity', () => {
    const state = createGame({ seed: SEED });
    const placed = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);
    expect(placed.success).toBe(true);
    const building = placed.building!;
    const capacity = getBuildingPeopleCapacity('living_quarters', 1);
    building.occupantIds = Array.from({ length: capacity - 1 }, (_, i) => -(i + 1));

    expect(isRestBuildingFull(state, building)).toBe(false);
  });

  it('true when occupancy plus in-flight walkers exactly reaches capacity (boundary)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const placed = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);
    expect(placed.success).toBe(true);
    const building = placed.building!;
    const capacity = getBuildingPeopleCapacity('living_quarters', 1);
    building.occupantIds = Array.from({ length: capacity - 1 }, (_, i) => -(i + 1));

    const { employee: walker } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    walker.pendingRestDuration = 8;
    walker.activeActionId = 900;
    pushWalkingRestAction(state, walker.id, 900, building.id);

    expect(isRestBuildingFull(state, building)).toBe(true);
  });

  it('does not count a walker whose active rest action names a DIFFERENT building (boundary)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const placed = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);
    expect(placed.success).toBe(true);
    const other = placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100, 1);
    expect(other.success).toBe(true);
    const building = placed.building!;
    const capacity = getBuildingPeopleCapacity('living_quarters', 1);
    building.occupantIds = Array.from({ length: capacity - 1 }, (_, i) => -(i + 1));

    const { employee: walker } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    walker.pendingRestDuration = 8;
    walker.activeActionId = 901;
    pushWalkingRestAction(state, walker.id, 901, other.building!.id); // walking to the OTHER building

    expect(isRestBuildingFull(state, building)).toBe(false);
  });

  it('does not count a walker who has already arrived (pendingRestDuration null) even if their prior action still names this building (rejection)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const placed = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);
    expect(placed.success).toBe(true);
    const building = placed.building!;
    const capacity = getBuildingPeopleCapacity('living_quarters', 1);
    building.occupantIds = Array.from({ length: capacity - 1 }, (_, i) => -(i + 1));

    const { employee: arrived } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    arrived.pendingRestDuration = null; // already arrived — no longer "in flight"
    arrived.restTicksRemaining = 5;
    arrived.activeActionId = 902;
    pushWalkingRestAction(state, arrived.id, 902, building.id);

    expect(isRestBuildingFull(state, building)).toBe(false);
  });
});

// #1204: resolveRestBuildingId mirrors the equivalent payload-carried
// buildingId lookup #1203 added for the training flow.
describe('resolveRestBuildingId (#1204)', () => {
  it('returns the numeric buildingId when present', () => {
    expect(resolveRestBuildingId({ buildingId: 42 })).toBe(42);
  });

  it('returns undefined when the payload carries no buildingId key (boundary — no-building rest)', () => {
    expect(resolveRestBuildingId({})).toBeUndefined();
  });

  it('returns undefined when buildingId is present but not a number (rejection — malformed payload)', () => {
    expect(resolveRestBuildingId({ buildingId: 'not-a-number' })).toBeUndefined();
  });
});

// #945: completeRestForEmployee's with-building path used to apply
// BUILDING_REPLENISH_RATES.fatigue[tier] once per tick of NEED_REST_DURATIONS
// (a flat, tier-scaled total), rather than landing the gauge at the fixed
// ceiling MAX_NEED_GAUGE (100) the way the no-building path already does via
// NEED_REST_NO_BUILDING_CAP. At Tier 1 (rate 8 × duration 8 = 64), a rest
// starting from 25 fatigue lands at ~89, not 100 — the driver in the
// tutorial box-cut repro (#945) never leaves a rest fully rested, so it
// re-triggers a proactive/collapse rest again a few ticks later, forcing
// repeated dismount/reboard cycles on whatever vehicle it was driving.
// Tier 2 (rate 14) and Tier 3 (rate 20) already reach 100 through
// replenishNeed's own internal Math.min(100, ...) clamp before the loop of 8
// iterations finishes, so only Tier 1 is actually under — but the fix (set
// emp[needKey] = MAX_NEED_GAUGE directly) must land all three tiers at
// exactly 100, not above.
describe('completeRestForEmployee (#945 — with-building rest lands exactly at MAX_NEED_GAUGE, every tier)', () => {
  const SEED = 42;

  it('Tier 1 living_quarters rest leaves fatigue at MAX_NEED_GAUGE (100), not the ~89 the old per-tick-rate accumulation produced', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(MAX_NEED_GAUGE);
  });

  it('Tier 2 living_quarters rest lands exactly at MAX_NEED_GAUGE, not above it', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;

    state.buildings.unlockedTiers.living_quarters = 3; // tier 2+ requires research unlock
    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 2);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(MAX_NEED_GAUGE);
  });

  it('Tier 3 living_quarters rest lands exactly at MAX_NEED_GAUGE, not above it', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;

    state.buildings.unlockedTiers.living_quarters = 3;
    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 3);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(MAX_NEED_GAUGE);
  });

  it('an employee already at MAX_NEED_GAUGE stays there after a building rest (boundary — no overshoot)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = MAX_NEED_GAUGE;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(MAX_NEED_GAUGE);
  });

  it('no-building rest still caps at NEED_REST_NO_BUILDING_CAP (70) — unchanged regression', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;
    // No living_quarters placed at all.

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(NEED_REST_NO_BUILDING_CAP);
  });

  it('no-building rest leaves a gauge already above the cap alone, rather than pulling it down (boundary — unchanged regression)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 90; // already above NEED_REST_NO_BUILDING_CAP (70)

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.fatigue).toBe(90);
  });

  it('clears collapsing/restTicksRemaining/restNeedKey/activeActionId after a building rest completes (unchanged regression)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;
    employee.collapsing = true;
    employee.restTicksRemaining = 3;
    employee.restNeedKey = 'fatigue';
    employee.activeActionId = 777;

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100, 1);

    completeRestForEmployee(state, employee, 'fatigue');

    expect(employee.collapsing).toBe(false);
    expect(employee.restTicksRemaining).toBeNull();
    expect(employee.restNeedKey).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });

  // #1204: a buildingId naming a building that has since been demolished
  // must not crash completion — it degrades to the same no-building capped
  // path used when no living_quarters exists at all, even though a DIFFERENT
  // living_quarters happens to be nearest the employee's own position. Proves
  // completeRestForEmployee resolves the named building itself rather than
  // falling back to a nearest-by-position search the instant the id fails to
  // resolve.
  it('a buildingId resolving to a demolished/nonexistent building falls back to the no-building degraded path rather than crashing (#1204)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.fatigue = 25;

    // A DIFFERENT, still-active living_quarters right at the employee's own
    // position — a nearest-by-position fallback would find this one and
    // grant a full restore; the named (missing) building must win instead.
    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100, 1);
    expect(state.buildings.buildings.some(b => b.id === 999)).toBe(false);

    expect(() => completeRestForEmployee(state, employee, 'fatigue', 999)).not.toThrow();

    expect(employee.fatigue).toBe(NEED_REST_NO_BUILDING_CAP);
  });
});

// beginRestWalk (#1013) was retired in favor of beginRestTravel (#1118),
// which routes rest travel through moveTo/planItinerary instead of writing
// destinationX/destinationZ directly — see RestActionHelpers.ts's own doc
// comment on beginRestTravel. Its test coverage moved with it; a dedicated
// beginRestTravel suite belongs wherever #1118 adds it.

// #1062: shared soft-threshold guard — true only once the employee has
// physically arrived at, and is actively ticking down, an already-claimed
// action; walking toward one (taskTicksRemaining still null) does not count.
describe('isMidClaimedTaskExecution (#1062)', () => {
  const SEED = 42;

  it('is true when taskTicksRemaining is a non-null number (arrived, mid-execution)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.taskTicksRemaining = 4;

    expect(isMidClaimedTaskExecution(employee)).toBe(true);
  });

  it('is false when taskTicksRemaining is null (not yet arrived, or nothing claimed)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.taskTicksRemaining = null;

    expect(isMidClaimedTaskExecution(employee)).toBe(false);
  });

  it('boundary: is true even when taskTicksRemaining is 0 (last tick of execution, still a number)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.taskTicksRemaining = 0;

    expect(isMidClaimedTaskExecution(employee)).toBe(true);
  });
});

// #1118: beginRestTravel replaces beginRestWalk at every rest-dispatch call
// site (NeedRestoration.ts's tickNeedRestoration/tickCollapse,
// ForceShiftRest.ts's finishForceRest, EmployeeDispatchSteps.ts's
// promoteActionToActive) so a mounted employee sent to rest routes through
// moveTo (MoveTo.ts) — which already builds a {kind:'reposition', x, z} goal
// that PlanItinerary.ts's existing mount-continuity check picks up for a
// mounted employee for free — instead of writing destinationX/Z directly and
// leaving the vehicle behind (I2_mounted_position_mismatch). Falls back to
// the old direct-write behavior only when moveTo itself fails (unreachable
// target).
describe('beginRestTravel (#1118)', () => {
  const SEED = 42;

  it('mounted employee, reachable target: installs an itinerary drive leg to (x, z), stays mounted, sets pendingActionType "rest", and destinationX/Z mirror the installed itinerary\'s current leg', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    beginRestTravel(state, employee, 12, 34);

    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    expect(legs.length).toBeGreaterThan(0);
    const driveLeg = legs[legs.length - 1]!;
    expect(driveLeg.mode).toBe('drive');
    expect(driveLeg.vehicleId).toBe(vehicle.id);
    expect(driveLeg.destX).toBe(12);
    expect(driveLeg.destZ).toBe(34);
    expect(employee.pendingActionType).toBe('rest');
    // #1178: destinationX/Z are a READ-ONLY MIRROR of the itinerary's current
    // leg (never a second, independently-writable movement source) — moveTo
    // succeeded, so no legacy fallback write ever ran, but the mirror itself
    // now reflects legs[0], not null.
    expect(employee.destinationX).toBe(legs[0]!.destX);
    expect(employee.destinationZ).toBe(legs[0]!.destZ);
  });

  // #1122: resting is an action like any other (building, drilling, ...) —
  // an employee travelling to rest has no reason to keep reserving their
  // vehicle for the whole rest, only for the travel. The installed
  // itinerary's final leg must alight on arrival (mirroring the evacuation
  // drop-off mechanism, Zone.ts's clearZone, via MoveTo's alightOnArrival),
  // so the vehicle is freed the instant travel completes rather than staying
  // reserved for the entire rest duration with nobody aboard.
  it('mounted employee, reachable target: the installed itinerary\'s final leg alights on arrival, freeing the vehicle once travel completes (#1122)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    beginRestTravel(state, employee, 12, 34);

    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    expect(legs.length).toBeGreaterThan(0);
    const finalLeg = legs[legs.length - 1]!;
    // Before the fix, RestActionHelpers.ts's beginRestTravel never calls
    // alightOnArrival, so this leg's onArrive stays {kind:'none'} — the
    // vehicle would remain reserved for the whole rest, not just the travel.
    expect(finalLeg.onArrive).toEqual({ kind: 'alight' });
  });

  // #1178 (single-mover unification): beginRestTravel now calls
  // moveTo(state, emp.id, {x, z}, { allowUnreachable: true }) unconditionally
  // for both on-foot AND mounted employees — no more separate legacy branch.
  // A mounted employee whose rest target is unreachable right now retries
  // through the drive leg's own continuity (same vehicle they're already in)
  // instead of falling back to a direct destinationX/Z write.
  it('mounted employee, unreachable target (no route on a built navGrid): installs a retrying DRIVE itinerary (continuity), not a legacy destinationX/Z write; pendingActionType "rest"', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const grid = makeFlatNavGrid(30, 10);
    blockColumn(grid, 15); // seals off everything east of x=15 from (0,0)
    state.navGrid = grid;

    beginRestTravel(state, employee, 20, 5);

    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    expect(legs.every(l => l.mode === 'drive')).toBe(true);
    const lastLeg = legs[legs.length - 1]!;
    expect(lastLeg.vehicleId).toBe(vehicle.id);
    expect(lastLeg.destX).toBe(20);
    expect(lastLeg.destZ).toBe(5);
    expect(employee.destinationX).toBe(legs[0]!.destX);
    expect(employee.destinationZ).toBe(legs[0]!.destZ);
    expect(employee.pendingActionType).toBe('rest');
  });

  // #1178: on-foot rest now installs a foot itinerary via moveTo, exactly
  // like the mounted case above — no more legacy destinationX/Z write for
  // either mount state. beginRestTravel always passes allowUnreachable: true,
  // and under that option buildFootOnlyItinerary never returns null, so this
  // always succeeds even before a NavGrid exists.
  it('on-foot employee, reachable target: installs a foot itinerary via moveTo, not a legacy direct destinationX/Z write; pendingActionType "rest"', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });

    beginRestTravel(state, employee, 8, 9);

    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    expect(legs.length).toBeGreaterThan(0);
    const lastLeg = legs[legs.length - 1]!;
    expect(lastLeg.mode).toBe('foot');
    expect(lastLeg.destX).toBe(8);
    expect(lastLeg.destZ).toBe(9);
    expect(employee.destinationX).toBe(legs[0]!.destX);
    expect(employee.destinationZ).toBe(legs[0]!.destZ);
    expect(employee.pendingActionType).toBe('rest');
  });

  it('resting in place (target equals current position): no crash, pendingActionType "rest" set', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 5, 5);

    expect(() => beginRestTravel(state, employee, 5, 5)).not.toThrow();

    expect(employee.pendingActionType).toBe('rest');
  });

  // #1122: a mounted employee whose own vehicle still has a `queued`,
  // same-role follow-up only they could claim (hasClaimableSameRoleFollowUp,
  // VehicleReservation.ts) keeps mount continuity through the WHOLE rest,
  // instead of alighting on arrival like the general case above — see
  // beginRestTravel's own doc comment for why. Every other test in this
  // describe block sets up a state with no queued pending actions at all, so
  // none of them exercise this branch.
  it('mounted employee with a still-queued, same-role follow-up only they could claim: keeps mount continuity — final leg stays {kind:"none"}, not alighted', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    // Untargeted queued drill_hole action of the same role (drill_rig) — the
    // only employee who could ever claim it (nobody else is set up here),
    // matching hasQueuedActionForVehicleRole's own claimability test.
    state.pendingActions.push({
      id: 900, type: 'drill_hole', requiredSkill: null, requiredVehicleRole: 'drill_rig',
      targetX: 5, targetZ: 5, targetY: 0, payload: {},
      targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
    });

    beginRestTravel(state, employee, 12, 34);

    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    const finalLeg = legs[legs.length - 1]!;
    expect(finalLeg.mode).toBe('drive');
    expect(finalLeg.onArrive).toEqual({ kind: 'none' });
    expect(employee.pendingActionType).toBe('rest');
  });

  // #1204: when a buildingId is given, the walk must route through
  // moveTo(state, emp.id, {buildingId}, opts) — the same {kind:'enter_building'}
  // arrival step #1202/#1203 already give the training walk — rather than a
  // plain x/z reposition ending in {kind:'none'}, so the employee disappears
  // inside the living_quarters instead of resting visibly on its ring.
  it('called with a buildingId naming a real, existing living_quarters: routes through the {buildingId} moveTo path — final leg is enter_building, not a plain reposition (#1204)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const placed = placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100, 1);
    expect(placed.success).toBe(true);
    const building = placed.building!;

    beginRestTravel(state, employee, building.x, building.z, building.id);

    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    expect(legs.length).toBeGreaterThan(0);
    const lastLeg = legs[legs.length - 1]!;
    expect(lastLeg.onArrive).toEqual({ kind: 'enter_building', buildingId: building.id });
    expect(employee.pendingActionType).toBe('rest');
  });

  // #1204: a buildingId that no longer resolves to any building (demolished
  // between claim and dispatch) must not crash the walk — it degrades to the
  // ordinary x/z reposition the no-buildingId case already uses, exactly like
  // the pre-#1204 behavior for every call.
  it('called with a buildingId that resolves to no existing building: falls back to a plain x/z walk instead of throwing (#1204)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    expect(state.buildings.buildings.some(b => b.id === 999)).toBe(false);

    expect(() => beginRestTravel(state, employee, 8, 9, 999)).not.toThrow();

    expect(employee.itinerary).not.toBeNull();
    const legs = employee.itinerary!.legs;
    const lastLeg = legs[legs.length - 1]!;
    expect(lastLeg.destX).toBe(8);
    expect(lastLeg.destZ).toBe(9);
    expect(employee.pendingActionType).toBe('rest');
  });
});

// #1170: a forced rest whose round trip costs more fatigue (as ticks
// travelled, at whatever speed the employee makes the trip — NEED_DRAIN_RATES
// .fatigue.traveling is 1/tick, so ticks and fatigue cost are numerically
// identical today) than the destination building can recover is never worth
// taking — see RestActionHelpers.ts's own doc comment on
// restRoundTripWorthwhile. maxRecovery for a given tier is
// BUILDING_REPLENISH_RATES.fatigue[tier] * NEED_REST_DURATIONS.fatigue: 64 at
// tier 1, 160 at tier 3.
describe('restRoundTripWorthwhile (#1170)', () => {
  const SEED = 42;
  const TIER1_MAX_RECOVERY = BUILDING_REPLENISH_RATES.fatigue[1] * NEED_REST_DURATIONS.fatigue;
  const TIER3_MAX_RECOVERY = BUILDING_REPLENISH_RATES.fatigue[3] * NEED_REST_DURATIONS.fatigue;

  it('happy path: a short reachable route to a tier-1 building is worthwhile', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    employee.fatigue = 0; // full headroom to recover — isolates the travel-cost/tier arithmetic
    state.navGrid = makeFlatNavGrid(20, 10);
    const placed = placeBuilding(state.buildings, 'living_quarters', 90, 10, 100, 100, 1);
    expect(placed.success).toBe(true);

    const result = restRoundTripWorthwhile(state, employee, placed.building!, 5, 5);

    expect(result).toBe(true);
  });

  it('boundary: travelCost === maxRecovery exactly is still worthwhile (tie goes to taking the rest)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    employee.fatigue = 0; // full headroom — the tie is against the tier's own recovery cap, not headroom
    // On foot at AGENT_WALK_SPEED (2 cells/tick): a straight 64-cell one-way
    // route round-trips at 2*64/2 = 64 ticks == BUILDING_REPLENISH_RATES
    // .fatigue[1] (8) * NEED_REST_DURATIONS.fatigue (8) = 64 exactly.
    expect(AGENT_WALK_SPEED).toBe(2);
    expect(TIER1_MAX_RECOVERY).toBe(64);
    state.navGrid = makeFlatNavGrid(70, 10);
    const placed = placeBuilding(state.buildings, 'living_quarters', 90, 90, 100, 100, 1);
    expect(placed.success).toBe(true);

    const result = restRoundTripWorthwhile(state, employee, placed.building!, 64, 5);

    expect(result).toBe(true);
  });

  it('rejection: a route long enough that travelCost exceeds maxRecovery is not worthwhile', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    state.navGrid = makeFlatNavGrid(50, 10);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 5); // tier 1, speed 1
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const placed = placeBuilding(state.buildings, 'living_quarters', 90, 90, 100, 100, 1);
    expect(placed.success).toBe(true);

    // One-way 40 cells at speed 1: round trip = 2*40/1 = 80 > 64.
    const result = restRoundTripWorthwhile(state, employee, placed.building!, 40, 5);

    expect(result).toBe(false);
  });

  it('building === null is always worthwhile regardless of distance', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    state.navGrid = makeFlatNavGrid(200, 10);

    const result = restRoundTripWorthwhile(state, employee, null, 199, 5);

    expect(result).toBe(true);
  });

  it('mounted (speed 1) vs on-foot (speed 2) over the identical route distance: mounted is not worthwhile, on-foot is', () => {
    const buildFixture = () => {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);
      const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
      employee.fatigue = 0; // full headroom — this compares travel cost against the tier cap, not headroom
      state.navGrid = makeFlatNavGrid(50, 10);
      const placed = placeBuilding(state.buildings, 'living_quarters', 90, 90, 100, 100, 1);
      expect(placed.success).toBe(true);
      return { state, employee, building: placed.building! };
    };

    const mountedFixture = buildFixture();
    const { vehicle } = purchaseVehicle(mountedFixture.state.vehicles, 'drill_rig', 0, 5);
    vehicle.occupantIds = [mountedFixture.employee.id];
    mountedFixture.employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    expect(restRoundTripWorthwhile(mountedFixture.state, mountedFixture.employee, mountedFixture.building, 40, 5)).toBe(false);

    const onFootFixture = buildFixture();
    expect(onFootFixture.employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(restRoundTripWorthwhile(onFootFixture.state, onFootFixture.employee, onFootFixture.building, 40, 5)).toBe(true);
  });

  it('unreachable target (blocked route on a built NavGrid) is always worthwhile', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    const grid = makeFlatNavGrid(50, 10);
    blockColumn(grid, 15);
    state.navGrid = grid;
    const placed = placeBuilding(state.buildings, 'living_quarters', 90, 90, 100, 100, 1);
    expect(placed.success).toBe(true);

    const result = restRoundTripWorthwhile(state, employee, placed.building!, 40, 5);

    expect(result).toBe(true);
  });

  it('no NavGrid at all (state.navGrid === null) is always worthwhile', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    expect(state.navGrid).toBeNull();
    const placed = placeBuilding(state.buildings, 'living_quarters', 90, 90, 100, 100, 1);
    expect(placed.success).toBe(true);

    const result = restRoundTripWorthwhile(state, employee, placed.building!, 200, 5);

    expect(result).toBe(true);
  });

  it('tier boundary: an unaffordable round trip to a tier-1 building becomes affordable to a tier-3 building at the identical distance', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    employee.fatigue = 0; // full headroom (100) — enough to clear tier 3's cap for this distance
    state.navGrid = makeFlatNavGrid(50, 10);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 5);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    // Round trip = 80 ticks (40 cells one-way at speed 1) — exceeds tier 1's
    // 64 max recovery, but not tier 3's 160 (headroom, at MAX_NEED_GAUGE 100, is
    // the binding cap here since it's below 160 — still comfortably above 80).
    expect(TIER3_MAX_RECOVERY).toBeGreaterThan(80);

    const tier1 = placeBuilding(state.buildings, 'living_quarters', 90, 5, 100, 100, 1);
    expect(tier1.success).toBe(true);
    expect(restRoundTripWorthwhile(state, employee, tier1.building!, 40, 5)).toBe(false);

    state.buildings.unlockedTiers.living_quarters = 3;
    const tier3 = placeBuilding(state.buildings, 'living_quarters', 5, 90, 100, 100, 3);
    expect(tier3.success).toBe(true);
    expect(restRoundTripWorthwhile(state, employee, tier3.building!, 40, 5)).toBe(true);
  });
});

// #1170: resolveRestDestination consolidates the nearest-living-quarters +
// approach-cell + worthwhile-round-trip resolution shared by both
// ForceShiftRest.ts entry points.
describe('resolveRestDestination (#1170)', () => {
  const SEED = 42;

  it('a reachable, worthwhile living quarters resolves worthwhile: true with the matching approach coords/buildingId', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    employee.fatigue = 0; // full headroom to recover
    state.navGrid = makeFlatNavGrid(30, 20);
    const placed = placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100, 1);
    expect(placed.success).toBe(true);
    const building = placed.building!;
    const expectedApproach = resolveBuildingApproach(state, building, employee.x, employee.z);

    const result = resolveRestDestination(state, employee);

    expect(result.worthwhile).toBe(true);
    expect(result.buildingId).toBe(building.id);
    expect(result.targetX).toBe(expectedApproach.x);
    expect(result.targetZ).toBe(expectedApproach.z);
  });

  it('the only living quarters is far enough that the round trip is not worthwhile', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 5);
    state.navGrid = makeFlatNavGrid(90, 20);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 5); // speed 1
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const placed = placeBuilding(state.buildings, 'living_quarters', 80, 5, 100, 100, 1);
    expect(placed.success).toBe(true);
    const building = placed.building!;
    const expectedApproach = resolveBuildingApproach(state, building, employee.x, employee.z);

    const result = resolveRestDestination(state, employee);

    expect(result.worthwhile).toBe(false);
    expect(result.buildingId).toBe(building.id);
    expect(result.targetX).toBe(expectedApproach.x);
    expect(result.targetZ).toBe(expectedApproach.z);
  });
});
