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
} from '../../../src/core/engine/ActionSelection.js';
import * as PathfindingModule from '../../../src/core/nav/Pathfinding.js';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { createEmployeeState, hireEmployee, killEmployee, assignSkill, getLivingEmployees, type Employee, type SkillCategory } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { Random } from '../../../src/core/math/Random.js';
import { ACTION_SELECTION_MAX_PATH_ATTEMPTS, AGENT_WALK_SPEED, BASE_TASK_DURATION_TICKS, NAV_MAX_CLIMB_HEIGHT, NEED_REST_DURATIONS, LIVING_QUARTERS_WELLBEING_MULTIPLIERS } from '../../../src/core/config/balance.js';
import { getNeedMultiplier } from '../../../src/core/entities/EmployeeNeeds.js';
import { getLivingQuartersWellbeingMultiplier } from '../../../src/core/entities/BuildingWellbeing.js';
import { computeRampSegmentDurationTicks } from '../../../src/core/mining/Ramp.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

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

/** A walkable cell carrying a `surfaceY`, so the climb-limit gate (#953) actually applies to it. */
function makeCellWithSurfaceY(surfaceY: number): NavCell {
  return { ...makeCell('walkable'), surfaceY };
}

/**
 * Flat NavGrid at `surfaceY: 0` everywhere, except every (x, z) in
 * `craterCells` sunk to `surfaceY: craterY` — deep enough below
 * `NAV_MAX_CLIMB_HEIGHT` that stepping between a crater cell and any
 * surrounding flat cell is climb-illegal, while every crater cell stays
 * climb-legal relative to its crater neighbours (same `craterY`). Mirrors a
 * fresh blast crater's own walled-off interior (#953).
 */
function makeGridWithCraterPocket(
  width: number,
  height: number,
  craterCells: ReadonlySet<string>,
  craterY = -(NAV_MAX_CLIMB_HEIGHT + 8),
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

    const findPathSpy = vi.spyOn(PathfindingModule, 'findPath');

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
    // findPath call happens, against the one candidate that was ever going
    // to resolve. Old (buggy) code burns the whole budget's `continue`s on
    // the 10 unclaimable candidates (cheaper-ranked than the whole claimable
    // subset) and never calls findPath at all.
    expect(findPathSpy.mock.calls.length).toBeGreaterThan(0);
    expect(findPathSpy.mock.calls.length).toBeLessThanOrEqual(ACTION_SELECTION_MAX_PATH_ATTEMPTS);

    findPathSpy.mockRestore();
  });

  // ── Climb-limit pocket starvation (#953) ───────────────────────────────
  //
  // A fresh blast crater's own interior sinks well below NAV_MAX_CLIMB_HEIGHT
  // relative to the surrounding surface, so every step in or out of it is
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

    const findPathSpy = vi.spyOn(PathfindingModule, 'findPath');

    const result = selectBestActionForEmployee(state, emp, [...nearUnreachable, farReachable]);

    expect(result).not.toBeNull();
    expect(result!.action.id).toBe(100);
    // Every crater candidate is screened out by the climb-aware reachable-set
    // pre-filter without spending a real findPath attempt — only the one
    // genuinely reachable candidate ever reaches resolveActionCost.
    expect(findPathSpy.mock.calls.length).toBe(1);

    findPathSpy.mockRestore();
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
