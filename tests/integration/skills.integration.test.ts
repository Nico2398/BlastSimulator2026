// BlastSimulator2026 — Integration tests: Employee skills and training
// Covers assign_skill command, training lifecycle, XP gain, salary,
// firing mechanics, and task-duration computation.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import {
  createEmployeeState,
  hireEmployee,
  assignSkill,
  startTraining,
  tickTraining,
  calculateSalary,
  gainXp,
  fireEmployee,
} from '../../src/core/entities/Employee.js';
import { createBuildingState, placeBuilding } from '../../src/core/entities/Building.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { tickEmployees } from '../../src/core/engine/GameLoop.js';
import { computeTaskDuration } from '../../src/core/entities/EmployeeTaskDuration.js';
import { Random } from '../../src/core/math/Random.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/** Hire one employee and return their numeric ID (always 1 on a fresh state). */
function hireOne(ctx: GameContext, role = 'blaster'): number {
  const result = employeeCommand(ctx, ['hire'], { role });
  if (!result.success) throw new Error(`Setup: hire failed — ${result.output}`);
  return ctx.state!.employees.employees[0]!.id;
}

// ── Employee skills ──────────────────────────────────────────────────────────

describe('Employee skills', () => {
  let ctx: GameContext;
  let empId: number;

  beforeEach(() => {
    ctx = makeCtx();
    empId = hireOne(ctx);
  });

  // ── Console-command tests (1–5) ──────────────────────────────────────────

  it('assign_skill persists qualification', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'geology', level: '3' },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe(
      `Employee #${empId} assigned skill: geology (level 3).`,
    );

    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    const qual = emp.qualifications.find(q => q.category === 'geology');
    expect(qual).toBeDefined();
    expect(qual!.proficiencyLevel).toBe(3);
    expect(qual!.xp).toBe(0);
  });

  it('assign_skill replaces existing category', () => {
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'geology', level: '2' });
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'geology', level: '5' });

    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    const quals = emp.qualifications.filter(q => q.category === 'geology');
    expect(quals).toHaveLength(1);
    expect(quals[0]!.proficiencyLevel).toBe(5);
  });

  it('accepts all 6 skill categories', () => {
    const categories = [
      'driving.truck',
      'driving.excavator',
      'driving.drill_rig',
      'blasting',
      'management',
      'geology',
    ] as const;

    for (const cat of categories) {
      const result = employeeCommand(
        ctx,
        ['assign_skill', String(empId)],
        { skill: cat, level: '2' },
      );
      expect(result.success, `category "${cat}" should be accepted`).toBe(true);
    }

    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    expect(emp.qualifications).toHaveLength(6);
  });

  it('rejects invalid level 0', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'management', level: '0' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage:');
  });

  it('rejects invalid level 6', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'management', level: '6' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage:');
  });

  // ── Core-API tests (6–10) ────────────────────────────────────────────────

  it('startTraining sets training state', () => {
    // Place a building to serve as training facility
    const bState = createBuildingState();
    const buildResult = placeBuilding(bState, 'blasting_academy', 5, 5, 32, 32, 1);
    expect(buildResult.success).toBe(true);
    const buildingId = buildResult.building!.id;

    const result = startTraining(
      ctx.state!.employees,
      empId,
      buildingId,
      'blasting',
      10,
      500,
    );

    expect(result.success).toBe(true);
    expect(result.fee).toBe(500);

    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    expect(emp.trainingState).not.toBeNull();
    expect(emp.trainingState!.buildingId).toBe(buildingId);
    expect(emp.trainingState!.skill).toBe('blasting');
    expect(emp.trainingState!.ticksRemaining).toBe(10);
    expect(emp.trainingState!.fee).toBe(500);
  });

  it('tickTraining completes after ticksRemaining reaches 0', () => {
    // Start training with 3 ticks
    const startResult = startTraining(
      ctx.state!.employees,
      empId,
      1,
      'driving.truck',
      3,
      300,
    );
    expect(startResult.success).toBe(true);

    const getEmp = () => ctx.state!.employees.employees.find(e => e.id === empId)!;

    // Tick 1 → 2 remaining
    tickTraining(ctx.state!.employees);
    expect(getEmp().trainingState!.ticksRemaining).toBe(2);
    expect(getEmp().qualifications.find(q => q.category === 'driving.truck')).toBeUndefined();

    // Tick 2 → 1 remaining
    tickTraining(ctx.state!.employees);
    expect(getEmp().trainingState!.ticksRemaining).toBe(1);

    // Tick 3 → 0 → complete → qualification added
    tickTraining(ctx.state!.employees);
    expect(getEmp().trainingState).toBeNull();

    const qual = getEmp().qualifications.find(q => q.category === 'driving.truck');
    expect(qual).toBeDefined();
    expect(qual!.proficiencyLevel).toBe(1);
    expect(qual!.xp).toBe(0);
  });

  it('gainXp accumulates and triggers level-up', () => {
    // Assign a skill first so the qualification record exists
    assignSkill(ctx.state!.employees, empId, 'blasting', 1);

    // 50 XP → below level-2 threshold (100) → no level-up
    const result1 = gainXp(ctx.state!.employees, empId, 'blasting', 50, ctx.emitter);
    expect(result1).not.toBeNull();
    expect(result1!.leveledUp).toBe(false);
    expect(result1!.oldLevel).toBe(1);
    expect(result1!.newLevel).toBe(1);

    let emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    let qual = emp.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.xp).toBe(50);
    expect(qual.proficiencyLevel).toBe(1);

    // 60 more XP → crosses 100 → level-up to 2
    const result2 = gainXp(ctx.state!.employees, empId, 'blasting', 60, ctx.emitter);
    expect(result2).not.toBeNull();
    expect(result2!.leveledUp).toBe(true);
    expect(result2!.oldLevel).toBe(1);
    expect(result2!.newLevel).toBe(2);

    emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    qual = emp.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.xp).toBe(110);
    expect(qual.proficiencyLevel).toBe(2);
  });

  it('calculateSalary reflects qualifications', () => {
    const emp = () => ctx.state!.employees.employees.find(e => e.id === empId)!;

    // Measured rather than hardcoded: a blaster is hired holding 'blasting' at
    // Rookie level, so the starting salary already carries that level's bonus.
    const atHire = calculateSalary(emp());
    expect(emp().salary).toBe(atHire);

    // Add geology level 3 → bonus 220
    assignSkill(ctx.state!.employees, empId, 'geology', 3);
    expect(calculateSalary(emp())).toBe(atHire + 220);
    expect(emp().salary).toBe(atHire + 220);

    // Add management level 2 → bonus 120
    assignSkill(ctx.state!.employees, empId, 'management', 2);
    expect(calculateSalary(emp())).toBe(atHire + 220 + 120);
    expect(emp().salary).toBe(atHire + 220 + 120);
  });

  it('a hired blaster arrives holding its role qualification at Rookie level', () => {
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    expect(emp.qualifications).toHaveLength(1);
    expect(emp.qualifications[0]!.category).toBe('blasting');
    expect(emp.qualifications[0]!.proficiencyLevel).toBe(1);
  });

  it('fire employee succeeds for non-unionized', () => {
    // Use core API to build an isolated employee state
    const empState = createEmployeeState();
    const rng = new Random(42);
    const hireResult = hireEmployee(empState, 'driller', rng, 10, 10);
    const newEmpId = hireResult.employee.id;
    // Force non-unionized for deterministic test
    hireResult.employee.unionized = false;

    expect(empState.employees).toHaveLength(1);

    const fireResult = fireEmployee(empState, newEmpId);
    expect(fireResult.success).toBe(true);
    expect(fireResult.error).toBeUndefined();
    expect(empState.employees).toHaveLength(0);
  });

  // ── Training through the console ─────────────────────────────────────────

  it('employee train enrols, charges the fee, and completes on ticks', () => {
    const state = ctx.state!;
    placeBuilding(state.buildings, 'driving_center', 5, 5, 32, 32, 1);
    const cashBefore = state.cash;

    const result = employeeCommand(ctx, ['train', String(empId)], { skill: 'driving.excavator' });
    expect(result.success, result.output).toBe(true);
    expect(state.cash).toBeLessThan(cashBefore);

    const emp = () => state.employees.employees.find(e => e.id === empId)!;
    expect(emp().trainingState).not.toBeNull();

    // Run the course out through the real tick command, not tickTraining directly:
    // the wiring between the two is the thing that was missing.
    tickCommand(ctx, [String(emp().trainingState!.ticksRemaining)], {});

    expect(emp().trainingState).toBeNull();
    expect(emp().qualifications.some(q => q.category === 'driving.excavator')).toBe(true);
  });

  it('employee train moves the employee to the training building (#410)', () => {
    const state = ctx.state!;
    placeBuilding(state.buildings, 'driving_center', 5, 5, 32, 32, 1);
    const emp = () => state.employees.employees.find(e => e.id === empId)!;
    const before = { x: emp().x, z: emp().z };
    const building = state.buildings.buildings.find(b => b.type === 'driving_center')!;

    const result = employeeCommand(ctx, ['train', String(empId)], { skill: 'driving.excavator' });
    expect(result.success, result.output).toBe(true);

    // The employee walks to the school, not left wherever they were hired.
    // Lands one tile outside the footprint (not the raw origin corner, which
    // sits on the building's own opaque base-box and renders occluded, #410).
    expect(emp().x).toBe(building.x - 1);
    expect(emp().z).toBe(building.z);
    expect(emp().x !== before.x || emp().z !== before.z).toBe(true);
  });

  it('employee train raises proficiency in a skill already held', () => {
    const state = ctx.state!;
    placeBuilding(state.buildings, 'blasting_academy', 5, 5, 32, 32, 1);
    const emp = () => state.employees.employees.find(e => e.id === empId)!;
    const before = emp().qualifications.find(q => q.category === 'blasting')!.proficiencyLevel;

    expect(employeeCommand(ctx, ['train', String(empId)], { skill: 'blasting' }).success).toBe(true);
    tickCommand(ctx, [String(emp().trainingState!.ticksRemaining)], {});

    expect(emp().qualifications.find(q => q.category === 'blasting')!.proficiencyLevel).toBe(before + 1);
  });

  it('employee train refuses when no school for that skill is built', () => {
    const result = employeeCommand(ctx, ['train', String(empId)], { skill: 'geology' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('geology_lab');
  });

  it('employee train refuses when the site cannot afford the course', () => {
    const state = ctx.state!;
    placeBuilding(state.buildings, 'geology_lab', 5, 5, 32, 32, 1);
    state.cash = 1;

    const result = employeeCommand(ctx, ['train', String(empId)], { skill: 'geology' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(state.employees.employees.find(e => e.id === empId)!.trainingState).toBeNull();
  });

  it('employee train rejects an unknown skill', () => {
    const result = employeeCommand(ctx, ['train', String(empId)], { skill: 'underwater_basketry' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage:');
  });

  it('an employee in training is not dispatched to work', () => {
    const state = ctx.state!;
    placeBuilding(state.buildings, 'blasting_academy', 5, 5, 32, 32, 1);
    employeeCommand(ctx, ['train', String(empId)], { skill: 'blasting' });

    state.pendingActions.push({
      id: 1, type: 'charge_hole', requiredSkill: 'blasting',
      requiredVehicleRole: null, targetEmployeeId: null,
      targetX: 1, targetZ: 1, targetY: 0, payload: {},
    } as unknown as (typeof state.pendingActions)[number]);

    tickEmployees(state);

    expect(state.employees.employees.find(e => e.id === empId)!.activeActionId).toBeNull();
    expect(state.pendingActions).toHaveLength(1);
  });

  // ── Task-duration computation (bonus) ────────────────────────────────────

  it('computeTaskDuration returns shorter duration for higher skill level', () => {
    const base = 100;

    // All multipliers = 1 → pure proficiency effect
    const d1 = computeTaskDuration(base, 1, 1, 1, 1);
    const d2 = computeTaskDuration(base, 2, 1, 1, 1);
    const d3 = computeTaskDuration(base, 3, 1, 1, 1);
    const d4 = computeTaskDuration(base, 4, 1, 1, 1);
    const d5 = computeTaskDuration(base, 5, 1, 1, 1);

    expect(d1).toBe(100); // 1.00 × 100
    expect(d2).toBe(85);  // 0.85 × 100
    expect(d3).toBe(70);  // 0.70 × 100
    expect(d4).toBe(56);  // 0.55 × 100 (floating-point ceil)
    expect(d5).toBe(40);  // 0.40 × 100

    // Verify monotonic decreasing
    expect(d5).toBeLessThan(d4);
    expect(d4).toBeLessThan(d3);
    expect(d3).toBeLessThan(d2);
    expect(d2).toBeLessThan(d1);
  });
});

// ── Tick-driven task/XP pipeline (dispatch + tick command) — issue #406 ──────
//
// Exercises TaskDispatch → tickEmployees (duration seeding) → tickTaskProgress
// (per-tick XP + completion) as driven by the real console `employee dispatch`
// and `tick` commands — the same path a scenario or player-facing flow uses.
// No living_quarters is built in this section, so the Bunkhouse Tier 2+ shift
// cycle never engages and task duration stays deterministic.

describe('Tick-driven task/XP pipeline (dispatch + tick command, issue #406)', () => {
  it('dispatching to a required skill decrements taskTicksRemaining tick by tick, grants XP, and frees the employee on completion', () => {
    const ctx = makeCtx();
    const empId = hireOne(ctx, 'blaster'); // arrives with 'blasting' level 1

    const dispatchResult = employeeCommand(
      ctx, ['dispatch', String(empId)], { x: '5', z: '5', skill: 'blasting' },
    );
    expect(dispatchResult.success, dispatchResult.output).toBe(true);

    const emp = () => ctx.state!.employees.employees.find(e => e.id === empId)!;

    // One tick lets tickEmployees claim + seed the task.
    tickCommand(ctx, ['1'], {});
    expect(emp().activeActionId).not.toBeNull();
    expect(emp().taskTicksRemaining).not.toBeNull();

    const seeded = emp().taskTicksRemaining!;
    expect(seeded).toBeGreaterThan(0);

    const observedRemaining: number[] = [emp().taskTicksRemaining!];
    for (let i = 0; i < seeded + 2 && emp().taskTicksRemaining !== null; i++) {
      tickCommand(ctx, ['1'], {});
      observedRemaining.push(emp().taskTicksRemaining ?? 0);
    }

    // Strictly decreasing while active — proves a per-tick countdown, not an
    // instant jump straight to completion.
    const activeValues = observedRemaining.filter(v => v > 0);
    for (let i = 1; i < activeValues.length; i++) {
      expect(activeValues[i]).toBeLessThan(activeValues[i - 1]!);
    }

    expect(emp().taskTicksRemaining).toBeNull();
    expect(emp().activeActionId).toBeNull();

    const qual = emp().qualifications.find(q => q.category === 'blasting')!;
    expect(qual.xp).toBeGreaterThan(0);
  });

  it('a higher-proficiency employee completes the identical dispatched task in fewer ticks', () => {
    const ctxRookie = makeCtx();
    const rookieId = hireOne(ctxRookie, 'blaster');
    employeeCommand(ctxRookie, ['dispatch', String(rookieId)], { x: '5', z: '5', skill: 'blasting' });
    tickCommand(ctxRookie, ['1'], {});
    const rookieSeeded = ctxRookie.state!.employees.employees.find(e => e.id === rookieId)!.taskTicksRemaining!;

    const ctxMaster = makeCtx();
    const masterId = hireOne(ctxMaster, 'blaster');
    employeeCommand(ctxMaster, ['assign_skill', String(masterId)], { skill: 'blasting', level: '5' });
    employeeCommand(ctxMaster, ['dispatch', String(masterId)], { x: '5', z: '5', skill: 'blasting' });
    tickCommand(ctxMaster, ['1'], {});
    const masterSeeded = ctxMaster.state!.employees.employees.find(e => e.id === masterId)!.taskTicksRemaining!;

    expect(rookieSeeded).toBeGreaterThan(0);
    expect(masterSeeded).toBeGreaterThan(0);
    expect(masterSeeded).toBeLessThan(rookieSeeded);
  });

  it('dispatch without a skill: param still queues general_work with requiredSkill: null and gets claimed (regression)', () => {
    const ctx = makeCtx();
    const empId = hireOne(ctx, 'driller');

    const result = employeeCommand(ctx, ['dispatch', String(empId)], { x: '3', z: '3' });
    expect(result.success, result.output).toBe(true);

    const action = ctx.state!.pendingActions.find(a => a.targetEmployeeId === empId);
    expect(action).toBeDefined();
    expect(action!.requiredSkill).toBeNull();
    expect(action!.type).toBe('general_work');

    tickCommand(ctx, ['1'], {});
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    expect(emp.activeActionId).not.toBeNull();
  });

  it('dispatching to a skill nobody on the roster holds is rejected immediately, rather than silently queuing forever', () => {
    // dispatch now routes through dispatchPendingAction (TaskDispatch.ts),
    // which rejects a roster-wide-unqualified dispatch at dispatch time —
    // the tick loop's unqualified_task_error path (EventEngine.ts) still
    // exists for actions that can't be routed here (e.g. dispatched before
    // the roster's only qualified employee is fired), but a dispatch this
    // command builds is no longer one of them (#406 follow-up).
    const ctx = makeCtx();
    const empId = hireOne(ctx, 'driver'); // arrives with 'driving.truck' only — nobody holds 'geology'

    const dispatchResult = employeeCommand(
      ctx, ['dispatch', String(empId)], { x: '1', z: '1', skill: 'geology' },
    );
    expect(dispatchResult.success).toBe(false);
    expect(dispatchResult.output).toContain('geology');

    // Nothing was queued — a tick can't claim, complete, or flag it.
    expect(ctx.state!.pendingActions).toHaveLength(0);
    tickCommand(ctx, ['1'], {});
    expect(ctx.state!.events.pendingEvent?.eventId).not.toBe('unqualified_task_error');
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    expect(emp.activeActionId).toBeNull();
  });
});
