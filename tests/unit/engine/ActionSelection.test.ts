// BlastSimulator2026 — Unit tests: cost-based action selection (#549)
//
// estimateActionCost / resolveActionCost / selectBestActionForEmployee are the
// three exported pieces of the cost-based dispatch: a cheap octile-heuristic
// ranking pass (estimateActionCost), a real findPath-backed cost for the top
// few ranked candidates (resolveActionCost), and the combined picker
// (selectBestActionForEmployee) that ranks then resolves up to
// ACTION_SELECTION_MAX_PATH_ATTEMPTS candidates, returning the first
// reachable one.
//
// computeActionWorkTicks / resolveRestNeedKey get their own direct coverage
// below too (#549 code review finding: they need their own tests per
// .claude/rules/core-purity.md, not just transitive coverage through
// EmployeeDispatch.test.ts's tickEmployees tests).

import { describe, it, expect, vi } from 'vitest';
import {
  estimateActionCost,
  resolveActionCost,
  selectBestActionForEmployee,
  computeActionWorkTicks,
  resolveRestNeedKey,
  canReleaseStrandedOnFootAction,
  findStarvedActionForEmployee,
  cellsToTravelTicks,
  isActionPastStuckBackoff,
} from '../../../src/core/engine/ActionSelection.js';
import * as PathfindingModule from '../../../src/core/nav/Pathfinding.js';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { createEmployeeState, hireEmployee, killEmployee, assignSkill, getLivingEmployees, type Employee, type SkillCategory } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { purchaseVehicle, getVehicleDefByTier, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { Random } from '../../../src/core/math/Random.js';
import { ACTION_SELECTION_MAX_PATH_ATTEMPTS, AGENT_WALK_SPEED, BASE_TASK_DURATION_TICKS, NEED_REST_DURATIONS, LIVING_QUARTERS_WELLBEING_MULTIPLIERS, ACTION_STARVATION_TICK_THRESHOLD, ACTION_STUCK_BACKOFF_TICKS } from '../../../src/core/config/balance.js';
import { getNeedMultiplier } from '../../../src/core/entities/EmployeeNeeds.js';
import { getLivingQuartersWellbeingMultiplier } from '../../../src/core/entities/BuildingWellbeing.js';
import { computeRampSegmentDurationTicks } from '../../../src/core/mining/Ramp.js';
import { computeLevelVolume } from '../../../src/core/mining/LevelGround.js';
import { VoxelGrid, setVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';

// ── NavGrid helpers (mirrors tests/unit/nav/Pathfinding.test.ts) ───────────

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

/** Block an entire column (every row) — an impassable vertical wall at world x. */
function blockColumn(grid: NavGrid, x: number): void {
  for (let z = 0; z < grid.height; z++) {
    grid.cells[z]![x] = makeCell('blocked');
  }
}

/** A walkable cell carrying a `surfaceY`, so the climb-limit gate (#953) actually applies
 * to it. Also seeds `climbY` (the integer field production climb-gating actually reads,
 * #1149) to the same value — this hand-built fixture has no real voxel grid to derive a
 * separate integer index from. */
function makeCellWithSurfaceY(surfaceY: number): NavCell {
  return { ...makeCell('walkable'), surfaceY, climbY: surfaceY };
}

/**
 * Flat NavGrid at `surfaceY: 0` everywhere, except every (x, z) in
 * `craterCells` sunk to `surfaceY: craterY` — deep enough below the slope
 * limit (NAV_MAX_SLOPE_RATIO) that stepping between a crater cell and any
 * surrounding flat cell is climb-illegal, while every crater cell stays
 * climb-legal relative to its crater neighbours (same `craterY`). Mirrors a
 * fresh blast crater's own walled-off interior (#953).
 */
function makeGridWithCraterPocket(
  width: number,
  height: number,
  craterCells: ReadonlySet<string>,
  craterY = -18, // 18m below the surrounding surface — far beyond NAV_MAX_SLOPE_RATIO (~0.577/m)
): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push(makeCellWithSurfaceY(craterCells.has(`${x},${z}`) ? craterY : 0));
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
}

// ── PendingAction / Employee helpers ────────────────────────────────────────

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
    queuedAtTick: overrides.queuedAtTick ?? 0,
    ...overrides,
  };
}

function makeState(width = 30, height = 30): GameState {
  const state = createGame({ seed: 42 });
  state.navGrid = makeFlatGrid(width, height);
  return state;
}

function makeEmployee(state: GameState, x = 0, z = 0): Employee {
  const rng = new Random(42);
  const { employee } = hireEmployee(state.employees, 'driller', rng, x, z);
  return employee;
}

// ═══════════════════════════════════════════════════════════════════════════
// estimateActionCost
// ═══════════════════════════════════════════════════════════════════════════

describe('estimateActionCost', () => {
  it('a farther target estimates a strictly higher cost than a nearer one (happy path)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    const near = makeAction({ id: 1, targetX: 3, targetZ: 0 });
    const far = makeAction({ id: 2, targetX: 20, targetZ: 0 });

    const nearCost = estimateActionCost(state, emp, near);
    const farCost = estimateActionCost(state, emp, far);

    expect(Number.isFinite(nearCost)).toBe(true);
    expect(Number.isFinite(farCost)).toBe(true);
    expect(farCost).toBeGreaterThan(nearCost);
  });

  it('an employee already standing on the target still estimates a positive cost (work duration only, boundary: zero distance)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 5, 5);
    const action = makeAction({ id: 1, targetX: 5, targetZ: 5 });

    const cost = estimateActionCost(state, emp, action);

    expect(cost).toBeGreaterThan(0);
  });

  it('is a cheap heuristic that ignores walls — an unreachable-but-geometrically-close target still estimates lower than a reachable-but-far one', () => {
    const state = makeState();
    blockColumn(state.navGrid!, 1); // isolates x >= 2 from the employee at x = 0
    const emp = makeEmployee(state, 0, 0);
    const closeUnreachable = makeAction({ id: 1, targetX: 2, targetZ: 0 });
    const farReachable = makeAction({ id: 2, targetX: 0, targetZ: 20 });

    // estimateActionCost is explicitly the pre-pathfinding heuristic pass —
    // it must not itself run reachability checks (that's resolveActionCost's
    // job), so geometric proximity alone determines its ranking.
    expect(estimateActionCost(state, emp, closeUnreachable))
      .toBeLessThan(estimateActionCost(state, emp, farReachable));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveActionCost
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveActionCost', () => {
  it('returns a positive totalTicks for a reachable target (happy path)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    const action = makeAction({ id: 1, targetX: 5, targetZ: 5 });

    const result = resolveActionCost(state, emp, action);

    expect(result).not.toBeNull();
    expect(result!.totalTicks).toBeGreaterThan(0);
  });

  it('an employee already at the target still returns a positive totalTicks — work duration alone, no travel (boundary: zero distance)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 7, 7);
    const action = makeAction({ id: 1, targetX: 7, targetZ: 7 });

    const result = resolveActionCost(state, emp, action);

    expect(result).not.toBeNull();
    expect(result!.totalTicks).toBeGreaterThan(0);
  });

  it('returns null for a genuinely unreachable target (rejection)', () => {
    const state = makeState();
    blockColumn(state.navGrid!, 1); // isolates x >= 2 from the employee at x = 0
    const emp = makeEmployee(state, 0, 0);
    const action = makeAction({ id: 1, targetX: 5, targetZ: 5 });

    const result = resolveActionCost(state, emp, action);

    expect(result).toBeNull();
  });

  it('returns null when an employee is boxed in by fragment occupancy on every neighbour cell, even though a vehicle-ignoring path would succeed (#954 follow-up fix)', () => {
    // Reproduces the #954 livelock's actual mechanism: before this fix,
    // resolveActionCost always called findPath with avoidVehicles: false, so
    // it reported a target "reachable" for an employee whose REAL foot travel
    // (tickEmployeeMovement's own avoidVehicles: true) can never get there —
    // letting a permanently fragment-trapped employee claim (and re-claim,
    // forever, once EntityMovementTick's #938 stuck-abandon mechanism handed
    // it back to the pool) an action no other, genuinely reachable employee
    // ever got a chance at. Confirmed live via tutorial-playthrough.json's own
    // freight_warehouse order: the employee standing on it after a blast was
    // boxed in on all 8 neighbour cells by fragment occupancy and
    // monopolized the claim for 400+ ticks.
    const state = makeState(10, 10);
    const emp = makeEmployee(state, 5, 5);
    const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of offsets) {
      state.navGrid!.addFragmentOccupant(5 + dx!, 5 + dz!);
    }
    const action = makeAction({ id: 1, targetX: 8, targetZ: 8 });

    const result = resolveActionCost(state, emp, action);

    expect(result).toBeNull();
  });

  it('still resolves a real cost when the DESTINATION itself is occupied (boarding a vehicle standing on it — matches tickEmployeeMovement’s own exemption, boundary)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    const action = makeAction({ id: 1, targetX: 5, targetZ: 5 });
    state.navGrid!.addFragmentOccupant(5, 5); // the target cell itself, not a cell along the route

    const result = resolveActionCost(state, emp, action);

    expect(result).not.toBeNull();
    expect(result!.totalTicks).toBeGreaterThan(0);
  });

  it('returns null for a target outside state.navGrid\'s bounds, rather than a cost computed against findPath\'s silently clamped-to-grid endpoint (#1109)', () => {
    // 30×30 grid (makeState default). A target far past the grid's edge
    // would, under plain findPath, silently clamp onto the grid's last cell
    // and still report found:true — resolveActionCost must not let that
    // masquerade as a real, reachable cost.
    const state = makeState(30, 30);
    const emp = makeEmployee(state, 0, 0);
    const action = makeAction({ id: 1, targetX: 500, targetZ: 500 });

    const plainPath = PathfindingModule.findPath(state.navGrid!, {
      agentId: emp.id,
      fromX: emp.x,
      fromZ: emp.z,
      toX: action.targetX,
      toZ: action.targetZ,
      avoidVehicles: false,
    });
    expect(plainPath.found).toBe(true); // findPath itself still clamps silently

    const result = resolveActionCost(state, emp, action);

    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveActionCost — vehicle-gated walk target (resolveVehicleGatedWalkTarget)
//
// Every case above uses requiredVehicleRole: null, so resolveVehicleGatedWalkTarget's
// only real branch — redirect the reachability check to the reserved vehicle's
// own position rather than the action's own targetX/targetZ — was never
// exercised. These pin that branch directly: the employee's real foot-walk
// goes to the vehicle (promoteVehicleGatedAction/requestBoardVehicle), never
// straight to the action's own cargo target, so reachability must be judged
// against the vehicle's position in both directions — blocked when the walk
// to the vehicle is blocked even though the action's own target is clear, and
// reachable when the walk to the vehicle is clear even though the action's
// own target is blocked.
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveActionCost — vehicle-gated action (requiredVehicleRole set)', () => {
  it('resolves against the reserved vehicle\'s position, not the action\'s own target: blocked when the path to the vehicle is blocked even though the path to the target is clear', () => {
    const state = makeState(30, 30);
    const emp = makeEmployee(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 20, 0);
    const action = makeAction({
      id: 1,
      requiredVehicleRole: 'debris_hauler',
      targetX: 3,
      targetZ: 3, // reachable on the employee's own side of the wall
    });
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    blockColumn(state.navGrid!, 10); // isolates the vehicle (x=20) from the employee (x=0)

    const result = resolveActionCost(state, emp, action);

    expect(result).toBeNull();
  });

  it('resolves against the reserved vehicle\'s position, not the action\'s own target: still null when the walk to the vehicle is clear but the drive from it to the target is blocked (#1090: whole-route reachability, not walk-to-vehicle-only)', () => {
    // #1090: resolveActionCost now delegates to planItinerary, whose
    // estTotalTicks sums the WHOLE route (walk-to-vehicle, then drive to the
    // target), replacing the deleted resolveVehicleGatedWalkTarget's
    // walk-only reachability judgment. A wall isolating the target from the
    // vehicle blocks the drive leg exactly as it would block a direct walk,
    // so this must resolve to null now — the pre-#1090 walk-only check would
    // have wrongly reported "reachable" here.
    const state = makeState(30, 30);
    const emp = makeEmployee(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 5);
    const action = makeAction({
      id: 1,
      requiredVehicleRole: 'debris_hauler',
      targetX: 25,
      targetZ: 25, // isolated from the employee AND the vehicle by the wall below
    });
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    blockColumn(state.navGrid!, 10); // isolates the action's own target (x=25) from both the employee and the vehicle (x=0)

    const result = resolveActionCost(state, emp, action);

    expect(result).toBeNull();
  });

  it('plans a zero-length first leg when the employee already holds the reserved vehicle\'s driverId and locomotion (continuity case) — reachable even though a fresh walk-to-vehicle route is walled off, since no walk is needed', () => {
    const state = makeState(30, 30);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 20, 0);
    const emp = makeEmployee(state, vehicle.x, vehicle.z); // I2: mounted employee sits at their vehicle's position
    const action = makeAction({
      id: 1,
      requiredVehicleRole: 'debris_hauler',
      targetX: 25,
      targetZ: 3, // same side of the wall as the vehicle (x=20) — only the drive leg matters
    });
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    vehicle.occupantIds = [emp.id];
    emp.locomotion = { kind: 'mounted', vehicleId: vehicle.id }; // I1: mount truth is Locomotion, not driverId alone
    blockColumn(state.navGrid!, 10); // would block a fresh walk to the vehicle, but continuity plans no such leg

    const result = resolveActionCost(state, emp, action);

    // Reachable: continuity (planItinerary dropping the zero-length first
    // leg) means the only leg left is the drive from the vehicle's own
    // position (20,0) to the action's target (25,3), never crossing the
    // wall.
    expect(result).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// estimateActionCost / resolveActionCost — cost delegates to planItinerary
// (#1090, vehicle-fleet migration phase 4)
//
// resolveVehicleGatedWalkTarget's own walk-only calculation (above) is
// replaced: both functions now sum whatever planItinerary itself returns for
// the employee's whole route — walk-to-vehicle at walking speed PLUS
// drive-to-target at the vehicle's own (tiered) speed for a vehicle-gated
// action, not just the walk leg. Continuity (a mounted employee's cost
// beating an on-foot candidate's) becomes an emergent property of that same
// cost ranking — planning a zero-length first leg for an already-mounted
// employee — rather than a bolted-on mechanism (VehicleContinuity.ts,
// deleted).
// ═══════════════════════════════════════════════════════════════════════════

describe('estimateActionCost / resolveActionCost — vehicle-gated cost delegates to planItinerary (#1090)', () => {
  it("includes the drive leg's own ticks (vehicle speed), not just the walk-to-vehicle leg", () => {
    const state = makeState(60, 60);
    const emp = makeEmployee(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 10, 0);
    const action = makeAction({ id: 1, requiredVehicleRole: 'debris_hauler', targetX: 10, targetZ: 40 });
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    state.pendingActions.push(action);

    const workTicks = computeActionWorkTicks(state, emp, action);
    // The formula resolveVehicleGatedWalkTarget's old walk-only calculation
    // used: travel ticks to the vehicle alone, ignoring the drive leg
    // entirely — this is the baseline a correct fix must exceed.
    const walkOnlyTravelTicks = cellsToTravelTicks(
      PathfindingModule.octileHeuristic(emp.x, emp.z, vehicle.x, vehicle.z),
      AGENT_WALK_SPEED,
    );
    const walkOnlyTotal = walkOnlyTravelTicks + workTicks;

    const estimated = estimateActionCost(state, emp, action);
    const resolved = resolveActionCost(state, emp, action);

    expect(resolved).not.toBeNull();
    // Strictly greater than a walk-only calculation — the drive leg's own
    // ticks (at the vehicle's own speed, not walking speed) are missing from
    // the old formula and must now be included.
    expect(estimated).toBeGreaterThan(walkOnlyTotal);
    expect(resolved!.totalTicks).toBeGreaterThan(walkOnlyTotal);

    // Roughly matches walk_ticks + drive_ticks + work_ticks, within the
    // planner's own formula (planItinerary sums exactly these three parts —
    // see PlanItinerary.ts's own estTotalTicks computation).
    const def = getVehicleDefByTier('debris_hauler', 1);
    const driveTicks = cellsToTravelTicks(
      PathfindingModule.octileHeuristic(vehicle.x, vehicle.z, action.targetX, action.targetZ),
      def.speed,
    );
    const expectedTotal = walkOnlyTravelTicks + driveTicks + workTicks;
    expect(resolved!.totalTicks).toBeCloseTo(expectedTotal, 5);
  });

  it("a mounted employee's cost for a same-role vehicle-gated action is strictly lower than an equally-placed on-foot employee's cost (continuity-by-ranking, not by special-cased mechanism)", () => {
    const state = makeState(60, 60);
    // The mounted employee's own vehicle sits exactly at their position (mount
    // invariant) — a single-seat vehicle already occupied by `mounted`, so the
    // on-foot employee (starting at the SAME position, per the scenario) must
    // instead reach a second, separate, free vehicle of the same role sitting
    // farther away, then drive a longer remaining distance from there to the
    // target — a genuine extra cost, not an artifact of how the two are
    // placed relative to each other.
    const { vehicle: mountedVehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    purchaseVehicle(state.vehicles, 'debris_hauler', 5, 15); // a second, separate, free vehicle
    const mounted = makeEmployee(state, 5, 5);
    assignSkill(state.employees, mounted.id, ROLE_LICENCE_REQUIRED.debris_hauler, 1);
    mountedVehicle.occupantIds = [mounted.id];
    mounted.locomotion = { kind: 'mounted', vehicleId: mountedVehicle.id };

    const onFoot = makeEmployee(state, 5, 5);
    assignSkill(state.employees, onFoot.id, ROLE_LICENCE_REQUIRED.debris_hauler, 1);

    // Straight line along z, on the opposite side from otherFreeVehicle, so
    // driving from otherFreeVehicle's position costs strictly MORE than
    // driving from mountedVehicle's position — the on-foot employee's route
    // is worse on both legs, not just the walk.
    const action = makeAction({ id: 1, requiredVehicleRole: 'debris_hauler', targetX: 5, targetZ: -35 });
    state.pendingActions.push(action);

    const mountedCost = estimateActionCost(state, mounted, action);
    const onFootCost = estimateActionCost(state, onFoot, action);

    expect(mountedCost).toBeLessThan(onFootCost);
  });

  it('returns Infinity (never throws, never NaN) when no free vehicle of the required role exists anywhere', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    assignSkill(state.employees, emp.id, ROLE_LICENCE_REQUIRED.debris_hauler, 1);
    const action = makeAction({ id: 1, requiredVehicleRole: 'debris_hauler', targetX: 20, targetZ: 20 });
    state.pendingActions.push(action);
    // No vehicle purchased at all — nothing for findFreeVehicleForRole to find.

    let cost = -1;
    expect(() => { cost = estimateActionCost(state, emp, action); }).not.toThrow();

    expect(cost).toBe(Infinity);
    expect(Number.isNaN(cost)).toBe(false);
  });

  it('resolveActionCost returns null (not throwing) when planItinerary cannot reach the target — preserves "stays queued, retried next tick"', () => {
    const state = makeState(30, 30);
    blockColumn(state.navGrid!, 15); // isolates the target side from the employee+vehicle side
    const emp = makeEmployee(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);
    const action = makeAction({ id: 1, requiredVehicleRole: 'debris_hauler', targetX: 25, targetZ: 0 });
    reserveVehicle(state.vehicles, vehicle.id, action.id);
    state.pendingActions.push(action);

    let result: { totalTicks: number } | null = null;
    expect(() => { result = resolveActionCost(state, emp, action); }).not.toThrow();

    expect(result).toBeNull();
  });

  // Regression guard for the #954 occupancy livelock, now at the
  // planItinerary delegation boundary (#1090) — the VEHICLE-occupancy case,
  // mirrored against "returns null when an employee is boxed in by fragment
  // occupancy..." above. #1090's own implementation threads a single
  // `avoidVehicles` flag straight through to `findExactPath`
  // (`estimateLegDistance`'s own doc comment), and that flag's underlying
  // cell check (`isCellOccupied`, NavGrid.ts) treats vehicle- and
  // fragment-occupancy as one combined obstacle everywhere `avoidVehicles` is
  // consulted — deliberately, since a drive leg's own `avoidVehicles: false`
  // must be free to route onto a FRAGMENT's cell too (driving up to haul or
  // break it), not just a vehicle's. Splitting the two into independently
  // controllable obstacles would have to thread a second flag through every
  // `PathfindingRequest` call site rather than a change scoped to this
  // planner, and `isDestinationOccupied`'s own doc comment holds the
  // invariant a narrower fix must not break: resolveActionCost and an
  // employee's own real foot travel (Locomotion.ts) "must agree" on
  // reachability — an employee genuinely boxed in by parked vehicles on
  // every neighbour cell is exactly as stuck in real movement (which applies
  // this same combined avoidVehicles check) as this cost estimate correctly
  // reports here. EntityMovementTick.ts's own stuck-abandon mechanism (#938)
  // is what recovers an employee from a genuine livelock like this one, not
  // a cost estimate that quietly disagrees with what the simulation would
  // actually do.
  it('returns null for an employee boxed in by VEHICLE occupancy on every neighbour cell, same as real foot travel would be stuck (#954, #1090)', () => {
    const state = makeState(10, 10);
    const emp = makeEmployee(state, 5, 5);
    const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of offsets) {
      state.navGrid!.cells[5 + dz!]![5 + dx!]!.vehicleOccupied = true;
    }
    const action = makeAction({ id: 1, targetX: 8, targetZ: 8 }); // unoccupied destination
    state.pendingActions.push(action);

    const result = resolveActionCost(state, emp, action);

    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// cells -> ticks conversion consistency (#614)
//
// distance / AGENT_WALK_SPEED is computed twice in this file today: once
// inside estimateTravelTicks (octileHeuristic-based) and once inline inside
// resolveActionCost (path.totalCost-based). Both are meant to route through
// the same cellsToTravelTicks(cells) helper so a future change to the
// conversion cannot drift between the two call sites unnoticed. These tests
// isolate each branch's travel component (total cost minus
// computeActionWorkTicks, which is identical and already directly tested
// above) and pin it to distance / AGENT_WALK_SPEED, and to each other.
// ═══════════════════════════════════════════════════════════════════════════

describe('cells -> ticks conversion consistency (#614)', () => {
  it('heuristic-based (estimateActionCost) and pathfinding-based (resolveActionCost) travel components agree with each other and with distance / AGENT_WALK_SPEED (happy path)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    // Straight line along x on a flat, fully-walkable grid: octileHeuristic
    // and a real findPath's totalCost both reduce to the raw cell distance
    // (no diagonal component, every cell's moveCost is 1.0), so both branches
    // must agree on a single known distance.
    const distance = 10;
    const action = makeAction({ id: 1, targetX: distance, targetZ: 0 });
    const expectedTravelTicks = distance / AGENT_WALK_SPEED;

    const workTicks = computeActionWorkTicks(state, emp, action);

    const heuristicTravelTicks = estimateActionCost(state, emp, action) - workTicks;

    const resolved = resolveActionCost(state, emp, action);
    expect(resolved).not.toBeNull();
    const pathTravelTicks = resolved!.totalTicks - workTicks;

    expect(heuristicTravelTicks).toBeCloseTo(expectedTravelTicks, 10);
    expect(pathTravelTicks).toBeCloseTo(expectedTravelTicks, 10);
    expect(heuristicTravelTicks).toBeCloseTo(pathTravelTicks, 10);
  });

  it('employee already standing on the target — travel component is exactly zero for both branches (boundary: zero distance)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 5, 5);
    const action = makeAction({ id: 1, targetX: 5, targetZ: 5 });

    const workTicks = computeActionWorkTicks(state, emp, action);

    const heuristicTravelTicks = estimateActionCost(state, emp, action) - workTicks;

    const resolved = resolveActionCost(state, emp, action);
    expect(resolved).not.toBeNull();
    const pathTravelTicks = resolved!.totalTicks - workTicks;

    expect(heuristicTravelTicks).toBe(0);
    expect(pathTravelTicks).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// selectBestActionForEmployee
// ═══════════════════════════════════════════════════════════════════════════

describe('selectBestActionForEmployee', () => {
  it('nearest-of-three candidates wins, not first-in-array order', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);

    // Deliberately out of distance order in the array — id 30 (farthest) first,
    // id 10 (nearest) last — so a naive "first match" implementation would
    // pick the wrong one.
    const far = makeAction({ id: 30, targetX: 20, targetZ: 0 });
    const mid = makeAction({ id: 20, targetX: 10, targetZ: 0 });
    const near = makeAction({ id: 10, targetX: 3, targetZ: 0 });

    const result = selectBestActionForEmployee(state, emp, [far, mid, near]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(10);
  });

  it('a closer-but-unreachable target loses to a farther-but-reachable one', () => {
    const state = makeState();
    blockColumn(state.navGrid!, 1); // isolates x >= 2 from the employee at x = 0
    const emp = makeEmployee(state, 0, 0);

    const closeUnreachable = makeAction({ id: 1, targetX: 2, targetZ: 0 });
    const farReachable = makeAction({ id: 2, targetX: 0, targetZ: 15 });

    const result = selectBestActionForEmployee(state, emp, [closeUnreachable, farReachable]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(2);
  });

  it('proficiency changes which action is cheapest when raw distances tie', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    // Master-level blasting (fast), Rookie-level geology (slow) — same base
    // task duration, same distance, so only the proficiency multiplier
    // differs between the two candidates' total cost.
    assignSkill(state.employees, emp.id, 'blasting', 5);
    assignSkill(state.employees, emp.id, 'geology', 1);

    const cheapSkill = makeAction({ id: 1, targetX: 10, targetZ: 0, requiredSkill: 'blasting' });
    const expensiveSkill = makeAction({ id: 2, targetX: 10, targetZ: 0, requiredSkill: 'geology' });

    const result = selectBestActionForEmployee(state, emp, [expensiveSkill, cheapSkill]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(1);
  });

  it('ties are broken by lowest action id, deterministically', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);

    // Identical target, identical skill requirement (null) — costs must tie.
    const higherId = makeAction({ id: 99, targetX: 6, targetZ: 6 });
    const lowerId = makeAction({ id: 5, targetX: 6, targetZ: 6 });

    // Array order deliberately does not match id order.
    const result = selectBestActionForEmployee(state, emp, [higherId, lowerId]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(5);
  });

  it('returns null for an empty candidate pool (boundary)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);

    const result = selectBestActionForEmployee(state, emp, []);

    expect(result).toBeNull();
  });

  it('returns null when every candidate is unreachable (rejection)', () => {
    const state = makeState();
    blockColumn(state.navGrid!, 1);
    const emp = makeEmployee(state, 0, 0);

    const a = makeAction({ id: 1, targetX: 5, targetZ: 0 });
    const b = makeAction({ id: 2, targetX: 5, targetZ: 5 });

    const result = selectBestActionForEmployee(state, emp, [a, b]);

    expect(result).toBeNull();
  });

  // ── isClaimable fallthrough (#552) ─────────────────────────────────────
  //
  // hauling-gate scenario stall: the nearest debris item needed a vehicle
  // role nobody had free. Without this fallthrough, selectBestActionForEmployee
  // returned null (idle) the moment the top-ranked candidate failed the
  // caller's isClaimable gate, instead of trying the next-cheapest one.

  it('an unclaimable nearer candidate is skipped in favor of a claimable farther one (#552 fallthrough)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);

    const nearUnclaimable = makeAction({ id: 1, targetX: 2, targetZ: 0 });
    const farClaimable = makeAction({ id: 2, targetX: 15, targetZ: 0 });

    // Simulates "no free vehicle of the right role" for the nearer candidate.
    const isClaimable = (action: PendingAction): boolean => action.id !== nearUnclaimable.id;

    const result = selectBestActionForEmployee(state, emp, [nearUnclaimable, farClaimable], isClaimable);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(farClaimable.id);
  });

  it('does not skip past a claimable top-ranked candidate just because isClaimable is supplied', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);

    const near = makeAction({ id: 1, targetX: 2, targetZ: 0 });
    const far = makeAction({ id: 2, targetX: 15, targetZ: 0 });

    // Both claimable — the predicate must not cause a needless fallthrough
    // past a perfectly fine, cheaper top candidate.
    const isClaimable = (): boolean => true;

    const result = selectBestActionForEmployee(state, emp, [near, far], isClaimable);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(near.id);
  });

  it('returns null when every candidate within budget is unclaimable, even though all are reachable', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);

    const a = makeAction({ id: 1, targetX: 2, targetZ: 0 });
    const b = makeAction({ id: 2, targetX: 15, targetZ: 0 });

    const result = selectBestActionForEmployee(state, emp, [a, b], () => false);

    expect(result).toBeNull();
  });

  it('a provably-unreachable near candidate cluster is screened out before consuming any path-attempt budget, so a farther reachable candidate is still found (#953)', () => {
    const state = makeState(30, 40);
    blockColumn(state.navGrid!, 1); // isolates x >= 2 from the employee at x = 0
    const emp = makeEmployee(state, 0, 0);

    // More than ACTION_SELECTION_MAX_PATH_ATTEMPTS candidates geometrically
    // very close (heuristic-nearest) but entirely walled off from the
    // employee — selectBestActionForEmployee's own climb/impassable-aware
    // reachable-set pre-filter (#953) proves every one of these unreachable
    // in one flood fill and skips them without spending a real findPath
    // attempt on any of them, so they can never starve a farther, genuinely
    // reachable candidate the way an unbounded ranking pass alone would.
    expect(ACTION_SELECTION_MAX_PATH_ATTEMPTS).toBe(5);
    const nearUnreachable: PendingAction[] = [];
    for (let i = 1; i <= 5; i++) {
      nearUnreachable.push(makeAction({ id: i, targetX: 2, targetZ: i }));
    }
    // Reachable, but ranked 6th by the heuristic — far beyond the budget.
    const farReachable = makeAction({ id: 6, targetX: 0, targetZ: 25 });

    const result = selectBestActionForEmployee(state, emp, [...nearUnreachable, farReachable]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(6);
  });

  // ── isClaimable pre-filter starvation (#611) ───────────────────────────
  //
  // #552's fallthrough only skips an unclaimable candidate WITHIN the
  // bounded top-N loop via `continue` — that `continue` still consumes one
  // of the ACTION_SELECTION_MAX_PATH_ATTEMPTS attempts. A backlog of more
  // than ACTION_SELECTION_MAX_PATH_ATTEMPTS unclaimable candidates, all
  // ranked ahead of a genuinely claimable one, therefore burns the entire
  // budget on candidates that can never succeed and never even reaches the
  // claimable candidate. The fix pre-filters by isClaimable BEFORE ranking,
  // so the budget is spent only on already-claimable candidates.

  it('an unclaimable backlog larger than the attempt budget does not starve a farther claimable candidate (#611)', () => {
    const state = makeState(40, 40);
    const emp = makeEmployee(state, 0, 0);

    const QUALIFIED_ID = 100;

    // ACTION_SELECTION_MAX_PATH_ATTEMPTS + 3 = 8 cheap candidates, all ranked
    // ahead of the qualified one, all unclaimable.
    expect(ACTION_SELECTION_MAX_PATH_ATTEMPTS).toBe(5);
    const unclaimableBacklog: PendingAction[] = [];
    for (let i = 1; i <= ACTION_SELECTION_MAX_PATH_ATTEMPTS + 3; i++) {
      unclaimableBacklog.push(makeAction({ id: i, targetX: 1 + i, targetZ: 0 }));
    }

    // Farther (higher estimated cost) than every backlog candidate, but
    // reachable AND claimable.
    const qualified = makeAction({ id: QUALIFIED_ID, targetX: 30, targetZ: 0 });

    const isClaimable = (action: PendingAction): boolean => action.id === QUALIFIED_ID;

    const result = selectBestActionForEmployee(
      state, emp, [...unclaimableBacklog, qualified], isClaimable,
    );

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(QUALIFIED_ID);
  });

  it('bounds real-cost resolution to ACTION_SELECTION_MAX_PATH_ATTEMPTS spent on claimable candidates, never wasted on an unclaimable backlog (#611)', () => {
    const state = makeState(30, 60);
    blockColumn(state.navGrid!, 15); // isolates x >= 16 from the employee at x = 0
    const emp = makeEmployee(state, 0, 0);

    // 10 unclaimable candidates, cheapest-ranked of the whole pool — a
    // caller-side gate (e.g. EmployeeDispatchSteps.ts's vehicle-availability check)
    // rejects every one of them, well past the attempt budget.
    const unclaimable: PendingAction[] = [];
    for (let i = 1; i <= 10; i++) {
      unclaimable.push(makeAction({ id: i, targetX: 1 + i, targetZ: 0 }));
    }

    // Claimable-but-unreachable candidates (behind the wall at x = 15),
    // ranked (by cost) ahead of the one claimable-and-reachable candidate
    // below within the claimable subset. The climb/impassable-aware
    // reachable-set pre-filter (#953) proves every one of these unreachable
    // without spending a real findPath attempt, so — unlike a plain ranking
    // budget — a cluster of these larger than the attempt budget still can't
    // starve the claimable-and-reachable candidate below.
    const claimableUnreachable: PendingAction[] = [];
    for (let i = 0; i < ACTION_SELECTION_MAX_PATH_ATTEMPTS; i++) {
      claimableUnreachable.push(makeAction({ id: 21 + i, targetX: 16 + i, targetZ: 0 }));
    }

    // Claimable and reachable (near side of the wall), but far higher cost
    // (via z-distance) than every claimable-unreachable candidate above —
    // ranked last within the claimable subset.
    const claimableReachable = makeAction({ id: 30, targetX: 10, targetZ: 50 });

    const claimableIds = new Set<number>([...claimableUnreachable.map(c => c.id), claimableReachable.id]);
    const isClaimable = (action: PendingAction): boolean => claimableIds.has(action.id);

    // resolveActionCost's real-cost resolution goes through findExactPath
    // (#1109), not findPath directly, so that's the call this spy must
    // observe — spying on findPath itself would miss it, since findExactPath
    // calls findPath as an internal same-module reference vi.spyOn can't
    // intercept.
    const exactPathSpy = vi.spyOn(PathfindingModule, 'findExactPath');

    const result = selectBestActionForEmployee(
      state, emp, [...unclaimable, ...claimableUnreachable, claimableReachable], isClaimable,
    );

    // The claimable-but-unreachable candidates are screened out for free, so
    // the claimable-and-reachable one is still found despite being ranked
    // last within the claimable subset — proven to apply to the CLAIMABLE
    // subset specifically, not just the raw candidate list.
    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(30);
    // The unclaimable backlog (cheaper-ranked than everything claimable)
    // must never consume a real-cost resolution, and neither must any of the
    // provably-unreachable claimableUnreachable candidates: exactly one real
    // findExactPath call happens, against the one candidate that was ever
    // going to resolve. Old (buggy) code burns the whole budget's
    // `continue`s on the 10 unclaimable candidates (cheaper-ranked than the
    // whole claimable subset) and never calls findExactPath at all.
    expect(exactPathSpy.mock.calls.length).toBeGreaterThan(0);
    expect(exactPathSpy.mock.calls.length).toBeLessThanOrEqual(ACTION_SELECTION_MAX_PATH_ATTEMPTS);

    exactPathSpy.mockRestore();
  });

  // ── Climb-limit pocket starvation (#953) ───────────────────────────────
  //
  // A fresh blast crater's own interior sinks well below the slope limit
  // (NAV_MAX_SLOPE_RATIO) relative to the surrounding surface, so every step in or out of it is
  // climb-illegal (Pathfinding.ts's isStepClimbable) even though the
  // crater's own cells are all mutually climb-legal with each other — a
  // candidate deep inside one has plenty of climb-legal neighbours immediately
  // around it, so a single-hop adjacency check alone can't tell it's cut off.
  // Only actual connectivity to the requesting employee does.

  it('a climb-isolated crater pocket does not starve a farther, genuinely reachable candidate (#953)', () => {
    const state = makeState(30, 40);
    const craterCells = new Set<string>();
    for (let z = 0; z <= 6; z++) craterCells.add(`2,${z}`); // 7 cells >> ACTION_SELECTION_MAX_PATH_ATTEMPTS (5)
    state.navGrid = makeGridWithCraterPocket(30, 40, craterCells);
    const emp = makeEmployee(state, 0, 0);

    // Cheapest-ranked by raw distance, but every one sits inside the
    // climb-isolated crater pocket — none reachable from the employee.
    const nearUnreachable: PendingAction[] = [];
    for (let z = 0; z <= 6; z++) {
      nearUnreachable.push(makeAction({ id: z + 1, targetX: 2, targetZ: z }));
    }
    // Reachable (flat ground, no crater), but ranked well beyond the budget
    // by raw distance.
    const farReachable = makeAction({ id: 100, targetX: 0, targetZ: 25 });

    // See the #611 test above: resolveActionCost's real resolution goes
    // through findExactPath, so the spy targets that, not findPath itself.
    const exactPathSpy = vi.spyOn(PathfindingModule, 'findExactPath');

    const result = selectBestActionForEmployee(state, emp, [...nearUnreachable, farReachable]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(100);
    // Every crater candidate is screened out by the climb-aware reachable-set
    // pre-filter without spending a real findExactPath attempt — only the one
    // genuinely reachable candidate ever reaches resolveActionCost.
    expect(exactPathSpy.mock.calls.length).toBe(1);

    exactPathSpy.mockRestore();
  });

  it('an employee standing inside the same climb-isolated pocket as a candidate can still be dispatched to it (#953)', () => {
    const state = makeState(30, 40);
    const craterCells = new Set<string>();
    for (let z = 0; z <= 6; z++) craterCells.add(`2,${z}`);
    state.navGrid = makeGridWithCraterPocket(30, 40, craterCells);
    // Employee already inside the crater pocket, not outside it.
    const emp = makeEmployee(state, 2, 0);

    const inPocket = makeAction({ id: 1, targetX: 2, targetZ: 3 });

    const result = selectBestActionForEmployee(state, emp, [inPocket]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeActionWorkTicks / resolveRestNeedKey
//
// Direct unit coverage for these two ActionSelection.ts exports, not already
// exercised transitively through EmployeeDispatch.test.ts's tickEmployees tests (#549 code
// review finding). Follows the fixture/helper conventions already established
// in tests/unit/engine/TaskDispatch.test.ts (makeGame/addQualifiedEmployee
// shape).
// ═══════════════════════════════════════════════════════════════════════════

const SEED = 42;

/** Return a GameState whose EmployeeState is pre-populated from a fresh createEmployeeState(). */
function makeGame(): GameState {
  const state = createGame({ seed: SEED });
  state.employees = createEmployeeState();
  return state;
}

/** Add an employee with a specific skill/proficiency and no other qualifications. */
function addQualifiedEmployee(
  state: GameState,
  skill: SkillCategory,
  level: 1 | 2 | 3 | 4 | 5 = 1,
): Employee {
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driller', rng);
  employee.qualifications = [];
  assignSkill(state.employees, employee.id, skill, level);
  return employee;
}

/** Build a minimal PendingAction object with sane defaults. */
function makeWorkAction(overrides: Partial<PendingAction>): PendingAction {
  return {
    id: overrides.id ?? 1,
    type: overrides.type ?? 'general_work',
    requiredSkill: overrides.requiredSkill === undefined ? 'blasting' : overrides.requiredSkill,
    requiredVehicleRole: overrides.requiredVehicleRole ?? null,
    targetX: overrides.targetX ?? 0,
    targetZ: overrides.targetZ ?? 0,
    targetY: overrides.targetY ?? 0,
    payload: overrides.payload ?? {},
    targetEmployeeId: overrides.targetEmployeeId ?? null,
    status: overrides.status ?? 'queued',
    holderId: overrides.holderId ?? null,
    queuedAtTick: overrides.queuedAtTick ?? 0,
  };
}

describe('computeActionWorkTicks (#549)', () => {
  it('happy path: non-rest action with no durationTicks override scales BASE_TASK_DURATION_TICKS by proficiency and need/living-quarters multipliers', () => {
    const state = makeGame();
    // Rookie (level 1) proficiency, full needs (fatigue = 100 → needMult 1.0),
    // no living_quarters building present (lqMult = LIVING_QUARTERS_WELLBEING_MULTIPLIERS.absent = 0.85).
    // ticks = max(1, ceil(20 * 1.00 / (1.0 * 0.85 * 1))) = ceil(23.529...) = 24
    const employee = addQualifiedEmployee(state, 'blasting', 1);
    const action = makeWorkAction({ type: 'general_work', requiredSkill: 'blasting' });

    const ticks = computeActionWorkTicks(state, employee, action);

    expect(ticks).toBe(24);
  });

  it('scales down for a higher proficiency level (level 2, ×0.85) with the same need/living-quarters conditions', () => {
    const state = makeGame();
    // ticks = max(1, ceil(20 * 0.85 / (1.0 * 0.85 * 1))) = ceil(20) = 20
    const employee = addQualifiedEmployee(state, 'blasting', 2);
    const action = makeWorkAction({ type: 'general_work', requiredSkill: 'blasting' });

    const ticks = computeActionWorkTicks(state, employee, action);

    expect(ticks).toBe(20);
  });

  it('a payload.durationTicks override on a non-rest action bypasses the proficiency/need formula entirely', () => {
    const state = makeGame();
    const employee = addQualifiedEmployee(state, 'geology', 1);
    const action = makeWorkAction({ type: 'survey', requiredSkill: 'geology', payload: { durationTicks: 7 } });

    const ticks = computeActionWorkTicks(state, employee, action);

    expect(ticks).toBe(7);
  });

  it("rest action: payload.restDuration overrides everything else, regardless of needKey", () => {
    const state = makeGame();
    const employee = addQualifiedEmployee(state, 'blasting', 1);
    const action = makeWorkAction({
      type: 'rest',
      requiredSkill: null,
      payload: { restDuration: 15, needKey: 'fatigue' },
    });

    const ticks = computeActionWorkTicks(state, employee, action);

    expect(ticks).toBe(15);
  });

  it('rest action: with no restDuration override, falls back to NEED_REST_DURATIONS[needKey]', () => {
    const state = makeGame();
    const employee = addQualifiedEmployee(state, 'blasting', 1);
    const action = makeWorkAction({
      type: 'rest',
      requiredSkill: null,
      payload: { needKey: 'fatigue' },
    });

    const ticks = computeActionWorkTicks(state, employee, action);

    expect(ticks).toBe(NEED_REST_DURATIONS.fatigue);
  });

  it('rest action: with no restDuration override and no recognizable needKey, falls back to BASE_TASK_DURATION_TICKS', () => {
    const state = makeGame();
    const employee = addQualifiedEmployee(state, 'blasting', 1);
    // No needKey at all — the Bunkhouse Tier 2+ shift-cycle rest shape
    // (forceShiftRestIfNeeded, ForceShiftRest.ts), which never routes through here
    // in practice but exercises the documented fallback branch directly.
    const action = makeWorkAction({
      type: 'rest',
      requiredSkill: null,
      payload: {},
    });

    const ticks = computeActionWorkTicks(state, employee, action);

    expect(ticks).toBe(BASE_TASK_DURATION_TICKS);
  });

  it('does not apply the living-quarters overcapacity penalty from a corpse still counted in the raw headcount (#592)', () => {
    const state = makeGame();
    // Tier 1 living_quarters — 20-bed capacity (BUILDING_DEFS).
    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const rng = new Random(SEED);
    const { employee: testSubject } = hireEmployee(state.employees, 'driller', rng);
    for (let i = 0; i < 19; i++) {
      hireEmployee(state.employees, 'driller', rng);
    }
    // One more hire, then killed — the raw (alive+dead) headcount is now 21,
    // over the 20-bed capacity, but the LIVING headcount is still exactly 20
    // (at capacity, not over it). computeActionWorkTicks must pass the LIVING
    // count into getLivingQuartersWellbeingMultiplier, not
    // state.employees.employees.length.
    const { employee: corpse } = hireEmployee(state.employees, 'driller', rng);
    killEmployee(state.employees, corpse.id);
    expect(state.employees.employees).toHaveLength(21);

    const action = makeWorkAction({ type: 'general_work', requiredSkill: 'blasting' });
    const ticks = computeActionWorkTicks(state, testSubject, action);

    // Non-overcapacity tier-1 multiplier (0.90):
    // ceil(20 * 1.00 / (1.0 * 0.90 * 1)) = 23. The overcapacity-buggy value
    // (raw 21 > 20 beds, penalty applied, multiplier 0.80) would instead
    // compute ceil(20 / 0.80) = 25.
    const expectedTicks = Math.max(1, Math.ceil(BASE_TASK_DURATION_TICKS / LIVING_QUARTERS_WELLBEING_MULTIPLIERS.t1));
    expect(ticks).toBe(expectedTicks);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeActionWorkTicks — dig_ramp_segment duration scaling (#924)
//
// The dig_ramp_segment branch is still a stub (skeleton commit 262802c):
// it always uses the stale action.payload.cells.length as voxel count, always
// ignores the employee's driving.excavator proficiency, and always ignores
// `grid` entirely. These tests assert the intended fix — live voxel count via
// `grid`, and the same proficiency/needMultiplier/lqMultiplier threading
// every other branch of computeActionWorkTicks already does (see the branch
// right below dig_ramp_segment in ActionSelection.ts) — so they fail against
// today's stub and must pass once #924 lands.
// ═══════════════════════════════════════════════════════════════════════════

function makeRampCells(n: number): { x: number; y: number; z: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0 }));
}

function makeRampSegmentAction(cells: { x: number; y: number; z: number }[]): PendingAction {
  return makeWorkAction({
    type: 'dig_ramp_segment',
    requiredSkill: 'driving.excavator',
    payload: { rampId: 1, segmentIndex: 0, cells, region: null, segmentCost: 0 },
  });
}

/** Fresh solid VoxelGrid, large enough to hold every cell makeRampCells(n) produces. */
function makeSolidGridForCells(cells: { x: number; y: number; z: number }[]): VoxelGrid {
  const grid = new VoxelGrid(Math.max(20, cells.length + 2), 5, 5);
  for (const cell of cells) {
    grid.setVoxel(cell.x, cell.y, cell.z, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0, oreDensities: {}, fractureModifier: 1.0,
    });
  }
  return grid;
}

describe('computeActionWorkTicks — dig_ramp_segment scaling (#924)', () => {
  const CELL_COUNT = 800; // baseTicks = 800 / (RAMP_DIG_VOXELS_PER_TICK_TIER1 * tier1 workRate) = 100, exactly.

  it('a level-5 driving.excavator digger gets measurably fewer ticks than a level-1 digger for the same segment', () => {
    const state = makeGame();
    const rookie = addQualifiedEmployee(state, 'driving.excavator', 1);
    const master = addQualifiedEmployee(state, 'driving.excavator', 5);
    const action = makeRampSegmentAction(makeRampCells(CELL_COUNT));

    const rookieTicks = computeActionWorkTicks(state, rookie, action);
    const masterTicks = computeActionWorkTicks(state, master, action);

    // Must fail against the #924 stub, which always resolves both to the same
    // value (proficiency ignored for dig_ramp_segment).
    expect(masterTicks).toBeLessThan(rookieTicks);

    // Exact figures — same computeTaskDuration formula every other branch of
    // computeActionWorkTicks already uses (needMult=1.0: freshly hired,
    // full needs; lqMult=absent since no living_quarters exists in makeGame()).
    const needMult = getNeedMultiplier(rookie);
    const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, getLivingEmployees(state.employees.employees).length);
    expect(rookieTicks).toBe(computeRampSegmentDurationTicks(CELL_COUNT, 1, 1, needMult, lqMult));
    expect(masterTicks).toBe(computeRampSegmentDurationTicks(CELL_COUNT, 1, 5, needMult, lqMult));
  });

  it('a starving digger gets measurably more ticks than a rested digger, same proficiency and segment', () => {
    const state = makeGame();
    const rested = addQualifiedEmployee(state, 'driving.excavator', 1);
    const starving = addQualifiedEmployee(state, 'driving.excavator', 1);
    starving.fatigue = 0; // well under NEED_THRESHOLDS.fatigue.critical
    const action = makeRampSegmentAction(makeRampCells(CELL_COUNT));

    const restedTicks = computeActionWorkTicks(state, rested, action);
    const starvingTicks = computeActionWorkTicks(state, starving, action);

    // Must fail against the #924 stub, which always resolves both to the
    // same value (employee needs ignored for dig_ramp_segment).
    expect(starvingTicks).toBeGreaterThan(restedTicks);

    const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, getLivingEmployees(state.employees.employees).length);
    expect(restedTicks).toBe(computeRampSegmentDurationTicks(CELL_COUNT, 1, 1, getNeedMultiplier(rested), lqMult));
    expect(starvingTicks).toBe(computeRampSegmentDurationTicks(CELL_COUNT, 1, 1, getNeedMultiplier(starving), lqMult));
  });

  it('a grid with some of the segment\'s own cells already cleared produces fewer ticks than the same segment with every cell still solid', () => {
    const state = makeGame();
    const employee = addQualifiedEmployee(state, 'driving.excavator', 1);
    const cells = makeRampCells(10);
    const action = makeRampSegmentAction(cells);

    const grid = makeSolidGridForCells(cells);
    // Half the segment's own cells already cleared in the live grid — e.g. an
    // overlapping blast or ramp carved them between order time (when
    // payload.cells was captured) and now.
    for (const cell of cells.slice(0, 5)) {
      grid.clearVoxel(cell.x, cell.y, cell.z);
    }

    const ticksWithPartlyCleared = computeActionWorkTicks(state, employee, action, grid);
    const ticksWithNoGrid = computeActionWorkTicks(state, employee, action);

    // Must fail against the #924 stub, which ignores `grid` entirely and
    // always returns the stale cells.length-based duration for both calls.
    expect(ticksWithPartlyCleared).toBeLessThan(ticksWithNoGrid);

    const needMult = getNeedMultiplier(employee);
    const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, getLivingEmployees(state.employees.employees).length);
    expect(ticksWithPartlyCleared).toBe(computeRampSegmentDurationTicks(5, 1, 1, needMult, lqMult));
    expect(ticksWithNoGrid).toBe(computeRampSegmentDurationTicks(10, 1, 1, needMult, lqMult));
  });

  it('passing a grid where every segment cell is still solid matches the stale no-grid fallback (regression guard — currently PASSES, since the stub ignores grid either way)', () => {
    const state = makeGame();
    const employee = addQualifiedEmployee(state, 'driving.excavator', 3);
    const cells = makeRampCells(16);
    const action = makeRampSegmentAction(cells);

    const grid = makeSolidGridForCells(cells);

    const ticksWithFullGrid = computeActionWorkTicks(state, employee, action, grid);
    const ticksWithNoGrid = computeActionWorkTicks(state, employee, action);

    // A grid where nothing was externally cleared must resolve to the same
    // voxel count (and therefore the same ticks) as omitting the grid
    // entirely — true both before #924 (grid ignored outright) and after
    // (live count == stale count when nothing diverged).
    expect(ticksWithFullGrid).toBe(ticksWithNoGrid);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeActionWorkTicks — level_ground duration scaling (#1144 review
// finding 5)
//
// Mirrors the dig_ramp_segment coverage immediately above: the 'level_ground'
// branch re-derives the live continuous volume via computeLevelVolume when a
// grid is supplied, and falls back to the stale payload.columns.length
// otherwise — this had zero direct test coverage before this diff.
// ═══════════════════════════════════════════════════════════════════════════

/** Columns for a `level_ground` action payload, one per x in [0, n). */
function makeLevelColumns(n: number): { x: number; z: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, z: 0 }));
}

function makeLevelGroundAction(columns: { x: number; z: number }[], targetY: number): PendingAction {
  return makeWorkAction({
    type: 'level_ground',
    requiredSkill: 'driving.excavator',
    payload: { rect: null, targetY, columns, region: null, orderCost: 0, footprint: [] },
  });
}

/** A flat VoxelGrid where every column in `columns` has its surface set to `height`. */
function makeLevelGridForColumns(columns: { x: number; z: number }[], height: number): VoxelGrid {
  const grid = new VoxelGrid(Math.max(20, columns.length + 2), 20, 5);
  const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1.0 }] });
  for (const { x, z } of columns) {
    setVoxelColumnSurfaceHeight(grid, x, z, height, compId);
  }
  return grid;
}

describe('computeActionWorkTicks — level_ground scaling (#1144 review finding 5)', () => {
  const TARGET_Y = 5;
  const COLUMN_COUNT = 100;
  const COLUMN_HEIGHT = TARGET_Y + 8; // each column carries 8 voxels of volume above TARGET_Y

  it('with a live grid, the live volume re-estimate via computeLevelVolume is used, not the stale column count', () => {
    const state = makeGame();
    const employee = addQualifiedEmployee(state, 'driving.excavator', 1);
    // columns.length (100) != total volume (100 * 8 = 800) — the two must
    // resolve to measurably different tick counts for this test to prove
    // the live-grid path is actually taken rather than falling back.
    const columns = makeLevelColumns(COLUMN_COUNT);
    const action = makeLevelGroundAction(columns, TARGET_Y);
    const grid = makeLevelGridForColumns(columns, COLUMN_HEIGHT);

    const ticksWithGrid = computeActionWorkTicks(state, employee, action, grid);

    const needMult = getNeedMultiplier(employee);
    const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, getLivingEmployees(state.employees.employees).length);
    const expectedVolume = Math.ceil(computeLevelVolume(grid, columns, TARGET_Y));
    expect(expectedVolume).toBe(800); // sanity: the live re-estimate, not columns.length (100)
    expect(ticksWithGrid).toBe(computeRampSegmentDurationTicks(expectedVolume, 1, 1, needMult, lqMult));
    expect(ticksWithGrid).not.toBe(computeRampSegmentDurationTicks(columns.length, 1, 1, needMult, lqMult));
  });

  it('without a live grid, falls back to payload.columns.length', () => {
    const state = makeGame();
    const employee = addQualifiedEmployee(state, 'driving.excavator', 1);
    const columns = makeLevelColumns(COLUMN_COUNT);
    const action = makeLevelGroundAction(columns, TARGET_Y);

    const ticksWithNoGrid = computeActionWorkTicks(state, employee, action);

    const needMult = getNeedMultiplier(employee);
    const lqMult = getLivingQuartersWellbeingMultiplier(state.buildings, getLivingEmployees(state.employees.employees).length);
    expect(ticksWithNoGrid).toBe(computeRampSegmentDurationTicks(columns.length, 1, 1, needMult, lqMult));
  });
});

describe('resolveRestNeedKey (#549)', () => {
  it('returns "fatigue" when payload.needKey is "fatigue"', () => {
    expect(resolveRestNeedKey({ needKey: 'fatigue' })).toBe('fatigue');
  });

  // #928: hunger/breakNeed removed from NeedKey — a payload naming either
  // (e.g. surviving from a pre-#928 code path, or a stale save mid-migration)
  // must resolve to null rather than being echoed back as a no-longer-valid
  // NeedKey.
  it('returns null when payload.needKey is "hunger" (removed gauge, #928)', () => {
    expect(resolveRestNeedKey({ needKey: 'hunger' })).toBeNull();
  });

  it('returns null when payload.needKey is "breakNeed" (removed gauge, #928)', () => {
    expect(resolveRestNeedKey({ needKey: 'breakNeed' })).toBeNull();
  });

  it('returns null for an unrecognized needKey value', () => {
    expect(resolveRestNeedKey({ needKey: 'thirst' })).toBeNull();
  });

  it('returns null when payload carries no needKey at all (shift-cycle rest shape)', () => {
    expect(resolveRestNeedKey({ triggeredBy: 'shift_cycle' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// findStarvedActionForEmployee (#1000, #1060)
//
// Finds a queued, unclaimed, on-foot (requiredVehicleRole === null) action
// that has waited at least ACTION_STARVATION_TICK_THRESHOLD ticks since it
// was queued (PendingAction.queuedAtTick), so it can win dispatch over
// same-role vehicle continuity. #1060 makes queuedAtTick required and drops
// the `?? state.tickCount` fallback that used to make an unstamped action's
// age always read 0 (never starved) — these tests exercise the threshold
// boundary directly against a real queuedAtTick value.
// ═══════════════════════════════════════════════════════════════════════════

describe('findStarvedActionForEmployee (#1000, #1060)', () => {
  it('reports a queued, unclaimed, on-foot action as starved once it has waited exactly ACTION_STARVATION_TICK_THRESHOLD ticks (happy path)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    const action = makeAction({ id: 1, targetX: 3, targetZ: 0, queuedAtTick: 0 });
    state.pendingActions.push(action);
    state.tickCount = ACTION_STARVATION_TICK_THRESHOLD;

    const result = findStarvedActionForEmployee(state, emp);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(action.id);
  });

  it('does not report the same action as starved one tick short of the threshold (boundary)', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    const action = makeAction({ id: 1, targetX: 3, targetZ: 0, queuedAtTick: 0 });
    state.pendingActions.push(action);
    state.tickCount = ACTION_STARVATION_TICK_THRESHOLD - 1;

    const result = findStarvedActionForEmployee(state, emp);

    expect(result).toBeNull();
  });

  // ── stuck-abandon backoff filter (#1130) ─────────────────────────────────
  //
  // A vehicle that just abandoned this action as stuck stamps
  // stuckBackoffUntilTick — findStarvedActionForEmployee must never hand the
  // identical action straight back out during that window, even though it is
  // otherwise starved, unclaimed, and on-foot-eligible.

  it('does not report an action still inside its stuckBackoffUntilTick window as starved, even though every other starvation condition holds', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    const action = makeAction({
      id: 1, targetX: 3, targetZ: 0, queuedAtTick: 0,
      stuckBackoffUntilTick: ACTION_STARVATION_TICK_THRESHOLD + 5,
    });
    state.pendingActions.push(action);
    state.tickCount = ACTION_STARVATION_TICK_THRESHOLD;

    const result = findStarvedActionForEmployee(state, emp);

    expect(result).toBeNull();
  });

  it('reports the same action as starved again once its stuckBackoffUntilTick has passed', () => {
    const state = makeState();
    const emp = makeEmployee(state, 0, 0);
    const action = makeAction({
      id: 1, targetX: 3, targetZ: 0, queuedAtTick: 0,
      stuckBackoffUntilTick: ACTION_STARVATION_TICK_THRESHOLD,
    });
    state.pendingActions.push(action);
    state.tickCount = ACTION_STARVATION_TICK_THRESHOLD;

    const result = findStarvedActionForEmployee(state, emp);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(action.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isActionPastStuckBackoff (#1130)
//
// PendingAction.stuckBackoffUntilTick is stamped by interruptActiveAction
// when a vehicle abandons an action as stuck (options.forceOpenPool), so the
// exact same action isn't reclaimed by the next dispatch pass an instant
// later. isActionPastStuckBackoff is the single predicate every claim-
// eligibility filter (EmployeeDispatchSteps.ts's claimActionsTargetedAtEmployee/
// claimOnePoolCandidate, and findStarvedActionForEmployee above) ANDs itself
// against.
// ═══════════════════════════════════════════════════════════════════════════

describe('isActionPastStuckBackoff (#1130)', () => {
  it('returns true when stuckBackoffUntilTick is undefined — never had a backoff (happy path)', () => {
    const state = makeState();
    const action = makeAction({ id: 1 });
    expect(action.stuckBackoffUntilTick).toBeUndefined();

    expect(isActionPastStuckBackoff(state, action)).toBe(true);
  });

  it('returns true when stuckBackoffUntilTick is null — never had a backoff', () => {
    const state = makeState();
    const action = makeAction({ id: 1, stuckBackoffUntilTick: null });

    expect(isActionPastStuckBackoff(state, action)).toBe(true);
  });

  it('returns false while state.tickCount is still short of stuckBackoffUntilTick (boundary: one tick short)', () => {
    const state = makeState();
    state.tickCount = 100;
    const action = makeAction({ id: 1, stuckBackoffUntilTick: 101 });

    expect(isActionPastStuckBackoff(state, action)).toBe(false);
  });

  it('returns true once state.tickCount reaches stuckBackoffUntilTick exactly (boundary)', () => {
    const state = makeState();
    state.tickCount = 101;
    const action = makeAction({ id: 1, stuckBackoffUntilTick: 101 });

    expect(isActionPastStuckBackoff(state, action)).toBe(true);
  });

  it('returns true well past stuckBackoffUntilTick', () => {
    const state = makeState();
    state.tickCount = 500;
    const action = makeAction({ id: 1, stuckBackoffUntilTick: 101 });

    expect(isActionPastStuckBackoff(state, action)).toBe(true);
  });

  it('reflects ACTION_STUCK_BACKOFF_TICKS-scaled windows realistically: still backed off just under the configured window, past it just after', () => {
    const state = makeState();
    const stampedAtTick = 1000;
    const action = makeAction({ id: 1, stuckBackoffUntilTick: stampedAtTick + ACTION_STUCK_BACKOFF_TICKS });

    state.tickCount = stampedAtTick + ACTION_STUCK_BACKOFF_TICKS - 1;
    expect(isActionPastStuckBackoff(state, action)).toBe(false);

    state.tickCount = stampedAtTick + ACTION_STUCK_BACKOFF_TICKS;
    expect(isActionPastStuckBackoff(state, action)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// canReleaseStrandedOnFootAction (#1025)
//
// An employee fatigue-frozen at a fractional position gets clampToGrid'd onto
// a discrete cell; if a building footprint later claims that exact cell, the
// employee's own current cell reads 'blocked'/'void' to isImpassable and every
// findPath call from it fails forever. When the stranded action sits only in
// that employee's own taskQueue (never promoted to active), no other employee
// can steal it either — a permanent deadlock. canReleaseStrandedOnFootAction
// is the on-foot mirror of VehicleReservation.ts's
// canReassignStrandedReservation: true only when the holder genuinely cannot
// reach the action anymore AND a different alive/idle/qualified employee
// exists to hand it to.
// ═══════════════════════════════════════════════════════════════════════════

describe('canReleaseStrandedOnFootAction (#1025)', () => {
  it('returns false for a vehicle-gated action (requiredVehicleRole !== null) — governed by canReassignStrandedReservation only', () => {
    const state = makeState(10, 10);
    const holder = makeEmployee(state, 5, 5);
    // Box the holder in on every neighbour so it would otherwise read
    // unreachable, to isolate the requiredVehicleRole check from reachability.
    const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of offsets) {
      state.navGrid!.addFragmentOccupant(5 + dx!, 5 + dz!);
    }
    const action = makeAction({ id: 1, requiredVehicleRole: 'debris_hauler', targetX: 8, targetZ: 8, holderId: holder.id, status: 'assigned' });
    // A different idle employee, so the "nothing to hand it to" branch can't
    // be the reason this returns false.
    makeEmployee(state, 0, 0);

    expect(canReleaseStrandedOnFootAction(state, holder, action)).toBe(false);
  });

  it('returns false when the holder can still reach the action (resolveActionCost resolves) — never released out from under a holder who can still do it', () => {
    const state = makeState(10, 10);
    const holder = makeEmployee(state, 5, 5);
    const action = makeAction({ id: 1, requiredVehicleRole: null, targetX: 6, targetZ: 6, holderId: holder.id, status: 'assigned' });
    makeEmployee(state, 0, 0); // a qualified idle alternative exists, but must not matter here

    expect(resolveActionCost(state, holder, action)).not.toBeNull();
    expect(canReleaseStrandedOnFootAction(state, holder, action)).toBe(false);
  });

  it('returns false when no other alive, idle, qualified employee exists to hand the action to', () => {
    const state = makeState(10, 10);
    const holder = makeEmployee(state, 5, 5);
    const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of offsets) {
      state.navGrid!.addFragmentOccupant(5 + dx!, 5 + dz!);
    }
    const action = makeAction({ id: 1, requiredVehicleRole: null, targetX: 8, targetZ: 8, holderId: holder.id, status: 'assigned' });
    // Solo roster — holder is the only employee at all.
    expect(state.employees.employees).toHaveLength(1);

    expect(canReleaseStrandedOnFootAction(state, holder, action)).toBe(false);
  });

  it('returns true when the action is on-foot, unreachable by the holder, and another alive/idle/qualified employee exists (happy path — #1025 deadlock)', () => {
    const state = makeState(10, 10);
    const holder = makeEmployee(state, 5, 5);
    const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of offsets) {
      state.navGrid!.addFragmentOccupant(5 + dx!, 5 + dz!);
    }
    const action = makeAction({ id: 1, requiredVehicleRole: null, targetX: 8, targetZ: 8, holderId: holder.id, status: 'assigned' });
    const rescuer = makeEmployee(state, 0, 0);
    expect(rescuer.activeActionId).toBeNull();
    expect(rescuer.restTicksRemaining).toBeNull();

    expect(resolveActionCost(state, holder, action)).toBeNull();
    expect(canReleaseStrandedOnFootAction(state, holder, action)).toBe(true);
  });

  it('returns true only when the alternative employee actually holds the required skill, false when the only other employee is unqualified', () => {
    const state = makeState(10, 10);
    const holder = makeEmployee(state, 5, 5);
    assignSkill(state.employees, holder.id, 'blasting', 3);
    const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of offsets) {
      state.navGrid!.addFragmentOccupant(5 + dx!, 5 + dz!);
    }
    const action = makeAction({ id: 1, requiredVehicleRole: null, requiredSkill: 'blasting', targetX: 8, targetZ: 8, holderId: holder.id, status: 'assigned' });
    const unqualified = makeEmployee(state, 0, 0);
    unqualified.qualifications = [];

    expect(canReleaseStrandedOnFootAction(state, holder, action)).toBe(false);

    assignSkill(state.employees, unqualified.id, 'blasting', 1);
    expect(canReleaseStrandedOnFootAction(state, holder, action)).toBe(true);
  });

  it('returns false when no other alive employee is idle (an otherwise-qualified candidate is mid-task)', () => {
    const state = makeState(10, 10);
    const holder = makeEmployee(state, 5, 5);
    const offsets = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of offsets) {
      state.navGrid!.addFragmentOccupant(5 + dx!, 5 + dz!);
    }
    const action = makeAction({ id: 1, requiredVehicleRole: null, targetX: 8, targetZ: 8, holderId: holder.id, status: 'assigned' });
    const busy = makeEmployee(state, 0, 0);
    busy.activeActionId = 999; // mid-task — not a rescue candidate

    expect(canReleaseStrandedOnFootAction(state, holder, action)).toBe(false);
  });

  it('returns false when state.navGrid is null — reachability can never be evaluated, so never a spurious release', () => {
    const state = makeState(10, 10);
    const holder = makeEmployee(state, 5, 5);
    const action = makeAction({ id: 1, requiredVehicleRole: null, targetX: 8, targetZ: 8, holderId: holder.id, status: 'assigned' });
    makeEmployee(state, 0, 0); // otherwise a valid rescue candidate
    state.navGrid = null;

    // resolveActionCost falls back to a non-null straight-line cost when
    // navGrid is null, so `resolveActionCost(...) !== null` alone would
    // already be true here — proving the dedicated
    // `if (state.navGrid === null) return false` guard is what produces the
    // `false` below, not a side effect of the reachability check.
    expect(resolveActionCost(state, holder, action)).not.toBeNull();
    expect(canReleaseStrandedOnFootAction(state, holder, action)).toBe(false);
  });
});
