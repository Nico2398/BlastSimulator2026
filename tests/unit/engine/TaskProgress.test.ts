// BlastSimulator2026 — Tests for tickTaskProgress: per-tick countdown,
// incremental XP, completion, and XP awards via computeTaskXpAwards
// (relocated from GameLoop.test.ts, #759).

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { tickTaskProgress } from '../../../src/core/engine/TaskProgress.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';
import { tickEmployeeMovement } from '../../../src/core/engine/EntityMovementTick.js';
import { tickEmployees } from '../../../src/core/engine/EmployeeDispatch.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { computeXpPerTick } from '../../../src/core/entities/EmployeeXpRules.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { XP_THRESHOLDS } from '../../../src/core/config/balance.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

/**
 * Rest/task timers are arrival-gated (#437): tickEmployees only queues
 * pendingRestDuration/pendingTaskDuration; ArrivalGate.tickArrivalGate
 * promotes them into restTicksRemaining/taskTicksRemaining once the
 * employee has actually walked to targetX/targetZ. Call after tickEmployees
 * in tests that build fixtures already co-located with their target (the
 * common case below, both at (0,0)) to resolve that walk in one step.
 */
function resolveArrival(state: GameState): void {
  tickEmployeeMovement(state);
  tickArrivalGate(state);
}


describe('tickTaskProgress — per-tick countdown, incremental XP, and completion (Ch.3 skill progression, issue #406)', () => {
  const SEED = 42;

  /**
   * Dispatch a 'blasting'-required task to `employeeId` and let tickEmployees
   * claim + seed it. targetX/Z (0,0) matches every hireEmployee call in this
   * describe block (defaults to (0,0)), so resolveArrival's single movement
   * pass resolves arrival immediately and taskTicksRemaining is seeded (#437).
   */
  function dispatchAndClaim(state: GameState, employeeId: number, actionId: number): void {
    state.pendingActions.push({
      id: actionId, type: 'general_work', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: employeeId,
      status: 'queued', holderId: null,
    });
    tickEmployees(state);
    resolveArrival(state);
  }

  it('decrements taskTicksRemaining by exactly 1 per call', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    dispatchAndClaim(state, employee.id, 1);

    const before = employee.taskTicksRemaining!;
    expect(before).toBeGreaterThan(0);

    tickTaskProgress(state, employee);

    expect(employee.taskTicksRemaining).toBe(before - 1);
  });

  it('grants XP incrementally each tick — not deferred to a single lump sum at completion', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng); // 'blasting' level 1, xp 0
    dispatchAndClaim(state, employee.id, 1);

    const qual = () => employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual().xp).toBe(0);

    tickTaskProgress(state, employee);
    const xpAfterOne = qual().xp;
    expect(xpAfterOne).toBeGreaterThan(0);

    tickTaskProgress(state, employee);
    const xpAfterTwo = qual().xp;
    expect(xpAfterTwo).toBeGreaterThan(xpAfterOne);
    // Constant per-tick step while the level has not changed — proves XP is
    // granted every tick of active work, not saved up for a single award.
    expect(xpAfterTwo - xpAfterOne).toBe(xpAfterOne);

    tickTaskProgress(state, employee);
    const xpAfterThree = qual().xp;
    expect(xpAfterThree).toBeGreaterThan(xpAfterTwo);
  });

  it('clears activeActionId and resets taskTicksRemaining to null on completion', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 5); // Master — shortest duration
    dispatchAndClaim(state, employee.id, 1);

    const totalTicks = employee.taskTicksRemaining!;
    expect(totalTicks).toBeGreaterThan(0);

    for (let i = 0; i < totalTicks; i++) {
      tickTaskProgress(state, employee);
    }

    expect(employee.taskTicksRemaining).toBeNull();
    expect(employee.activeActionId).toBeNull();
  });

  it('a freed employee becomes claimable by the next queued action after task completion', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 5);
    dispatchAndClaim(state, employee.id, 1);

    const totalTicks = employee.taskTicksRemaining!;
    for (let i = 0; i < totalTicks; i++) tickTaskProgress(state, employee);
    expect(employee.activeActionId).toBeNull();

    // Queue a second action, open to any qualified idle employee.
    state.pendingActions.push({
      id: 2, type: 'general_work', requiredSkill: 'blasting', requiredVehicleRole: null,
      targetX: 1, targetZ: 1, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null,
    });
    const result = tickEmployees(state);

    expect(result.claimed).toContain(2);
    expect(employee.activeActionId).toBe(2);
  });

  it('crossing an XP threshold purely from ticking triggers a level-up (no direct assign_skill/gainXp call)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng); // 'blasting' level 1
    // Test setup positions XP just short of the level-2 threshold — the
    // proficiency level itself is never set directly, only its XP.
    employee.qualifications.find(q => q.category === 'blasting')!.xp = XP_THRESHOLDS[2] - 2;

    dispatchAndClaim(state, employee.id, 1);
    const qual = () => employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual().proficiencyLevel).toBe(1);

    // Rookie grants 1 xp/tick (1 + floor(1 * 0.5)) — two ticks cross the threshold.
    tickTaskProgress(state, employee);
    tickTaskProgress(state, employee);

    expect(qual().proficiencyLevel).toBe(2);
    expect(qual().xp).toBeGreaterThanOrEqual(XP_THRESHOLDS[2]);
  });

  // ── Regression pin for issue #619 (XP-per-tick extraction) ───────────────
  // tickTaskProgress delegates its per-tick XP award to the pure
  // computeXpPerTick(proficiencyLevel) in EmployeeXpRules.ts. These
  // assertions pin the observable per-tick XP award at the minimum and
  // maximum proficiency levels through tickTaskProgress, so the extraction
  // stays behaviour preserving regardless of which code path computes it.
  it('grants the pinned per-tick XP award at proficiency level 1 (Rookie)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);
    dispatchAndClaim(state, employee.id, 1);

    const qual = () => employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual().xp).toBe(0);

    tickTaskProgress(state, employee);

    expect(qual().xp).toBe(1); // level 1 -> XP_PER_TICK_BASE + floor(1 * 0.5) = 1
  });

  it('grants the pinned per-tick XP award at proficiency level 5 (Master)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 5);
    dispatchAndClaim(state, employee.id, 1);

    const qual = () => employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual().xp).toBe(0);

    tickTaskProgress(state, employee);

    expect(qual().xp).toBe(3); // level 5 -> XP_PER_TICK_BASE + floor(5 * 0.5) = 3
  });
});

describe('tickTaskProgress — XP awards via computeTaskXpAwards rule function (issue #621)', () => {
  const SEED = 42;

  /** Dispatch a task of `type`/`requiredSkill` to `employeeId` and let tickEmployees claim + seed it. */
  function dispatchAndClaimTyped(
    state: GameState,
    employeeId: number,
    actionId: number,
    type: PendingAction['type'],
    requiredSkill: PendingAction['requiredSkill'],
  ): void {
    state.pendingActions.push({
      id: actionId, type, requiredSkill, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: employeeId,
      status: 'queued', holderId: null,
    });
    tickEmployees(state);
    resolveArrival(state);
  }

  it('a drill_hole task grants blasting XP equal to computeXpPerTick at the employee\'s current level', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng); // 'blasting' level 1
    dispatchAndClaimTyped(state, employee.id, 1, 'drill_hole', 'blasting');

    const qual = () => employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual().xp).toBe(0);

    const progress = tickTaskProgress(state, employee);

    expect(qual().xp).toBe(computeXpPerTick(1));
    expect(progress?.skill).toBe('blasting');
  });

  it('a drill_hole task at a higher proficiency level grants the scaled amount', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 4);
    dispatchAndClaimTyped(state, employee.id, 1, 'drill_hole', 'blasting');

    const qual = () => employee.qualifications.find(q => q.category === 'blasting')!;

    tickTaskProgress(state, employee);

    expect(qual().xp).toBe(computeXpPerTick(4));
  });

  it('a survey task grants geology XP equal to computeXpPerTick at the employee\'s current level', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng); // 'geology' level 1
    dispatchAndClaimTyped(state, employee.id, 2, 'survey', 'geology');

    const qual = () => employee.qualifications.find(q => q.category === 'geology')!;
    expect(qual().xp).toBe(0);

    const progress = tickTaskProgress(state, employee);

    expect(qual().xp).toBe(computeXpPerTick(1));
    expect(progress?.skill).toBe('geology');
  });

  it('a survey task at a higher proficiency level grants the scaled amount', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    assignSkill(state.employees, employee.id, 'geology', 3);
    dispatchAndClaimTyped(state, employee.id, 2, 'survey', 'geology');

    const qual = () => employee.qualifications.find(q => q.category === 'geology')!;

    tickTaskProgress(state, employee);

    expect(qual().xp).toBe(computeXpPerTick(3));
  });

  it('a drill_hole tick crossing the level-2 threshold returns leveledUp:true with correct oldLevel/newLevel', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    // Position XP just short of the level-2 threshold so this single tick's
    // award (computeXpPerTick(1) = 1) crosses it.
    employee.qualifications.find(q => q.category === 'blasting')!.xp = XP_THRESHOLDS[2] - 1;
    dispatchAndClaimTyped(state, employee.id, 1, 'drill_hole', 'blasting');

    const progress = tickTaskProgress(state, employee);

    expect(progress?.leveledUp).toBe(true);
    expect(progress?.oldLevel).toBe(1);
    expect(progress?.newLevel).toBe(2);
  });

  it('a survey tick crossing the level-2 threshold returns leveledUp:true with correct oldLevel/newLevel', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    employee.qualifications.find(q => q.category === 'geology')!.xp = XP_THRESHOLDS[2] - 1;
    dispatchAndClaimTyped(state, employee.id, 2, 'survey', 'geology');

    const progress = tickTaskProgress(state, employee);

    expect(progress?.leveledUp).toBe(true);
    expect(progress?.oldLevel).toBe(1);
    expect(progress?.newLevel).toBe(2);
  });

  it('a tick that does not cross a threshold returns leveledUp:false with no oldLevel/newLevel keys', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng); // fresh, xp 0, far from threshold
    dispatchAndClaimTyped(state, employee.id, 1, 'drill_hole', 'blasting');

    const progress = tickTaskProgress(state, employee);

    expect(progress?.leveledUp).toBe(false);
    expect(progress).not.toHaveProperty('oldLevel');
    expect(progress).not.toHaveProperty('newLevel');
  });

  // Real haul_debris/fragment_debris actions (HaulDispatch.ts:24-32) set
  // requiredSkill: null the same way, but they're claimed through a
  // haul/fragment-specific eligibility check (isHaulOrFragmentActionClaimable)
  // this synthetic fixture doesn't satisfy — 'general_work' is the same
  // null-skill shape (matches the tickEmployees describe block's own
  // makeAction default above) without that extra machinery.
  it("the result's skill field is null for a task whose action has requiredSkill: null, and grants no XP to any qualification", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    const qualsBefore = JSON.parse(JSON.stringify(employee.qualifications));

    dispatchAndClaimTyped(state, employee.id, 1, 'general_work', null);
    const progress = tickTaskProgress(state, employee);

    expect(progress?.skill).toBeNull();
    expect(employee.qualifications).toEqual(qualsBefore);
  });

  it('a second requiredSkill: null task also grants no XP and reports skill:null (not a one-off)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    const qualsBefore = JSON.parse(JSON.stringify(employee.qualifications));

    dispatchAndClaimTyped(state, employee.id, 1, 'general_work', null);
    const progress = tickTaskProgress(state, employee);

    expect(progress?.skill).toBeNull();
    expect(employee.qualifications).toEqual(qualsBefore);
  });
});

// ── #946: progressive dig_ramp_segment carving ────────────────────────────
//
// A segment used to carve all at once on completion (a visual "slab
// vanishes" jump). tickTaskProgress's widened (grid?: VoxelGrid) signature
// is meant to carve a proportional slice of the segment's own cells (in
// their existing nearest-to-entrance-first array order) on every tick that
// makes progress, tracked via the segment's own RampSegmentTracker.carvedCount.
// These tests are Red today because the body still has `void grid; // TODO`
// and never reads plannedRamps/carves anything.

describe('tickTaskProgress — progressive dig_ramp_segment carving (#946)', () => {
  const SEED = 42;

  function makeCells(n: number, baseX = 5, y = 3, z = 5): { x: number; y: number; z: number }[] {
    return Array.from({ length: n }, (_, i) => ({ x: baseX + i, y, z }));
  }

  function fillCells(grid: VoxelGrid, cells: { x: number; y: number; z: number }[]): void {
    for (const cell of cells) {
      grid.setVoxel(cell.x, cell.y, cell.z, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0, oreDensities: {}, fractureModifier: 1.0,
      });
    }
  }

  /**
   * Wires `emp` up as mid-way through a dig_ramp_segment action — sets
   * exactly the fields the ramp-carving branch of tickTaskProgress reads
   * (activeActionId/taskTicksRemaining/activeTaskTotalTicks/pendingActionType/
   * pendingActionPayload), plus a matching PendingAction and PlannedRamp
   * tracker in state, bypassing the full claim/arrival flow (dispatchPendingAction
   * requires a rock_digger vehicle for dig_ramp_segment — orthogonal to what
   * this carving logic itself needs to be exercised).
   */
  function wireDigRampSegment(
    state: GameState,
    emp: GameState['employees']['employees'][number],
    rampId: number,
    actionId: number,
    cells: { x: number; y: number; z: number }[],
    totalTicks: number,
  ): void {
    const region = cells.length > 0 ? {
      minX: Math.min(...cells.map(c => c.x)), maxX: Math.max(...cells.map(c => c.x)),
      minY: Math.min(...cells.map(c => c.y)), maxY: Math.max(...cells.map(c => c.y)),
      minZ: Math.min(...cells.map(c => c.z)), maxZ: Math.max(...cells.map(c => c.z)),
    } : null;

    state.plannedRamps.push({
      id: rampId,
      def: { originX: 0, originZ: 0, direction: 'south', length: 1, targetDepth: 1 },
      footprint: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      segments: [{ index: 0, actionId, cells, region, done: false, carvedCount: 0 }],
    });

    state.pendingActions.push({
      id: actionId, type: 'dig_ramp_segment', requiredSkill: null, requiredVehicleRole: null,
      targetX: cells[0]?.x ?? 0, targetZ: cells[0]?.z ?? 0, targetY: cells[0]?.y ?? 0,
      payload: { rampId, segmentIndex: 0, cells, region, segmentCost: 0 },
      targetEmployeeId: emp.id, status: 'assigned', holderId: emp.id,
    });

    emp.activeActionId = actionId;
    emp.taskTicksRemaining = totalTicks;
    emp.activeTaskTotalTicks = totalTicks;
    emp.activeTaskSkill = null;
    emp.pendingActionType = 'dig_ramp_segment';
    emp.pendingActionPayload = { rampId, segmentIndex: 0, cells, region, segmentCost: 0 };
  }

  it('carves cells progressively (nearest-entrance-first) as ticks advance, reaching carvedCount === cells.length on the completing tick', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    const grid = new VoxelGrid(20, 10, 20);
    const cells = makeCells(8);
    fillCells(grid, cells);

    const rampId = state.nextPlannedRampId++;
    const actionId = 1;
    const totalTicks = 4;
    wireDigRampSegment(state, employee, rampId, actionId, cells, totalTicks);

    const tracker = () => state.plannedRamps.find(r => r.id === rampId)!.segments[0]!;
    expect(tracker().carvedCount).toBe(0);

    let previousCarved = 0;
    for (let tick = 1; tick <= totalTicks; tick++) {
      tickTaskProgress(state, employee, undefined, grid);
      const carved = tracker().carvedCount ?? 0;
      expect(carved).toBeGreaterThanOrEqual(previousCarved);

      // Ordered nearest-to-entrance first: exactly the first `carved` cells
      // (in the segment's own array order) are cleared; the rest stay solid.
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!;
        if (i < carved) expect(grid.densityAt(cell.x, cell.y, cell.z)).toBe(0);
        else expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeGreaterThan(0);
      }
      previousCarved = carved;
    }

    expect(tracker().carvedCount).toBe(cells.length);
    expect(employee.taskTicksRemaining).toBeNull();
  });

  it('at least one tick before completion carves a strict subset — progress is not deferred to a single lump on completion', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    const grid = new VoxelGrid(20, 10, 20);
    const cells = makeCells(8);
    fillCells(grid, cells);

    const rampId = state.nextPlannedRampId++;
    wireDigRampSegment(state, employee, rampId, 1, cells, 4);
    const tracker = () => state.plannedRamps.find(r => r.id === rampId)!.segments[0]!;

    tickTaskProgress(state, employee, undefined, grid);

    const carvedAfterOneTick = tracker().carvedCount ?? 0;
    expect(carvedAfterOneTick).toBeGreaterThan(0);
    expect(carvedAfterOneTick).toBeLessThan(cells.length);
  });

  it('grid omitted: no crash, no carve attempted, and taskTicksRemaining still counts down normally', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    const cells = makeCells(4);
    const rampId = state.nextPlannedRampId++;
    wireDigRampSegment(state, employee, rampId, 1, cells, 4);

    expect(() => tickTaskProgress(state, employee)).not.toThrow();

    const tracker = state.plannedRamps.find(r => r.id === rampId)!.segments[0]!;
    expect(tracker.carvedCount).toBe(0); // no grid -> no carve attempted
    expect(employee.taskTicksRemaining).toBe(3); // ordinary countdown, unaffected
  });

  it('a non-dig_ramp_segment action does not look up plannedRamps or attempt a carve, even when a same-id tracker exists', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    const grid = new VoxelGrid(20, 10, 20);
    const cells = makeCells(4);
    fillCells(grid, cells);

    // A ramp tracker exists, but the employee's OWN active action is a plain
    // general_work task, not dig_ramp_segment.
    const rampId = state.nextPlannedRampId++;
    state.plannedRamps.push({
      id: rampId,
      def: { originX: 0, originZ: 0, direction: 'south', length: 1, targetDepth: 1 },
      footprint: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      segments: [{ index: 0, actionId: 1, cells, region: null, done: false, carvedCount: 0 }],
    });

    state.pendingActions.push({
      id: 1, type: 'general_work', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: employee.id,
      status: 'assigned', holderId: employee.id,
    });
    employee.activeActionId = 1;
    employee.taskTicksRemaining = 4;
    employee.activeTaskTotalTicks = 4;
    employee.pendingActionType = 'general_work';
    employee.pendingActionPayload = {};

    tickTaskProgress(state, employee, undefined, grid);

    const tracker = state.plannedRamps.find(r => r.id === rampId)!.segments[0]!;
    expect(tracker.carvedCount).toBe(0);
    for (const cell of cells) {
      expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeGreaterThan(0);
    }
  });

  it("a tracker not found for the payload's rampId/segmentIndex (e.g. the ramp was cancelled mid-dig) is a no-op — no throw", () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    const grid = new VoxelGrid(20, 10, 20);
    const cells = makeCells(4);
    fillCells(grid, cells);

    // No matching PlannedRamp/segment in state.plannedRamps at all —
    // simulates the ramp having been cancelled out from under the digger.
    state.pendingActions.push({
      id: 1, type: 'dig_ramp_segment', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: { rampId: 999, segmentIndex: 0, cells, region: null, segmentCost: 0 },
      targetEmployeeId: employee.id, status: 'assigned', holderId: employee.id,
    });
    employee.activeActionId = 1;
    employee.taskTicksRemaining = 4;
    employee.activeTaskTotalTicks = 4;
    employee.pendingActionType = 'dig_ramp_segment';
    employee.pendingActionPayload = { rampId: 999, segmentIndex: 0, cells, region: null, segmentCost: 0 };

    expect(() => tickTaskProgress(state, employee, undefined, grid)).not.toThrow();
    for (const cell of cells) {
      expect(grid.densityAt(cell.x, cell.y, cell.z)).toBeGreaterThan(0);
    }
    expect(employee.taskTicksRemaining).toBe(3);
  });
});
