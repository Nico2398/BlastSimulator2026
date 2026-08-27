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
