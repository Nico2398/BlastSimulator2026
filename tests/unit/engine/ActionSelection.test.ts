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
// GameLoop.ts's tickEmployees tests).

import { describe, it, expect } from 'vitest';
import {
  estimateActionCost,
  resolveActionCost,
  selectBestActionForEmployee,
  computeActionWorkTicks,
  resolveRestNeedKey,
} from '../../../src/core/engine/ActionSelection.js';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { createEmployeeState, hireEmployee, assignSkill, type Employee, type SkillCategory } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { ACTION_SELECTION_MAX_PATH_ATTEMPTS, BASE_TASK_DURATION_TICKS, NEED_REST_DURATIONS } from '../../../src/core/config/balance.js';

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

  it('never resolves a real path for more than ACTION_SELECTION_MAX_PATH_ATTEMPTS candidates — a reachable candidate ranked beyond the budget is never chosen', () => {
    const state = makeState(30, 40);
    blockColumn(state.navGrid!, 1); // isolates x >= 2 from the employee at x = 0
    const emp = makeEmployee(state, 0, 0);

    // 5 candidates geometrically very close (heuristic-nearest) but on the
    // unreachable side of the wall — these fill the entire path-attempt
    // budget (ACTION_SELECTION_MAX_PATH_ATTEMPTS = 5) before a real,
    // reachable candidate is ever tried.
    expect(ACTION_SELECTION_MAX_PATH_ATTEMPTS).toBe(5);
    const nearUnreachable: PendingAction[] = [];
    for (let i = 1; i <= 5; i++) {
      nearUnreachable.push(makeAction({ id: i, targetX: 2, targetZ: i }));
    }
    // Reachable, but ranked 6th by the heuristic — far beyond the budget.
    const farReachable = makeAction({ id: 6, targetX: 0, targetZ: 25 });

    const result = selectBestActionForEmployee(state, emp, [...nearUnreachable, farReachable]);

    // The budget is spent entirely on the 5 unreachable near candidates, so
    // the reachable one is never reached — cost control over correctness.
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeActionWorkTicks / resolveRestNeedKey
//
// Direct unit coverage for these two ActionSelection.ts exports, not already
// exercised transitively through GameLoop.ts's tickEmployees tests (#549 code
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
    // Rookie (level 1) proficiency, full needs (hunger/fatigue = 100 → needMult 1.0),
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
      payload: { restDuration: 15, needKey: 'hunger' },
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
    // (forceShiftRestIfNeeded, GameLoop.ts), which never routes through here
    // in practice but exercises the documented fallback branch directly.
    const action = makeWorkAction({
      type: 'rest',
      requiredSkill: null,
      payload: {},
    });

    const ticks = computeActionWorkTicks(state, employee, action);

    expect(ticks).toBe(BASE_TASK_DURATION_TICKS);
  });
});

describe('resolveRestNeedKey (#549)', () => {
  it('returns "hunger" when payload.needKey is "hunger"', () => {
    expect(resolveRestNeedKey({ needKey: 'hunger' })).toBe('hunger');
  });

  it('returns "fatigue" when payload.needKey is "fatigue"', () => {
    expect(resolveRestNeedKey({ needKey: 'fatigue' })).toBe('fatigue');
  });

  it('returns "breakNeed" when payload.needKey is "breakNeed"', () => {
    expect(resolveRestNeedKey({ needKey: 'breakNeed' })).toBe('breakNeed');
  });

  it('returns null for an unrecognized needKey value', () => {
    expect(resolveRestNeedKey({ needKey: 'thirst' })).toBeNull();
  });

  it('returns null when payload carries no needKey at all (shift-cycle rest shape)', () => {
    expect(resolveRestNeedKey({ triggeredBy: 'shift_cycle' })).toBeNull();
  });
});
