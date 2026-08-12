// BlastSimulator2026 — Unit tests: cost-based action selection (#549)
//
// estimateActionCost / resolveActionCost / selectBestActionForEmployee are the
// three exported pieces of the cost-based dispatch: a cheap octile-heuristic
// ranking pass (estimateActionCost), a real findPath-backed cost for the top
// few ranked candidates (resolveActionCost), and the combined picker
// (selectBestActionForEmployee) that ranks then resolves up to
// ACTION_SELECTION_MAX_PATH_ATTEMPTS candidates, returning the first
// reachable one. All three are stubs as of this branch (return
// `undefined as unknown as ...`) — every test below is Red until the
// implementer phase fills them in.

import { describe, it, expect } from 'vitest';
import {
  estimateActionCost,
  resolveActionCost,
  selectBestActionForEmployee,
} from '../../../src/core/engine/ActionSelection.js';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { hireEmployee, assignSkill, type Employee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { ACTION_SELECTION_MAX_PATH_ATTEMPTS } from '../../../src/core/config/balance.js';

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
