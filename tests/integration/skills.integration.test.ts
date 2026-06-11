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

    // Blaster base salary = 700
    expect(emp().salary).toBe(700);
    expect(calculateSalary(emp())).toBe(700);

    // Add geology level 3 → bonus 220
    assignSkill(ctx.state!.employees, empId, 'geology', 3);
    expect(calculateSalary(emp())).toBe(700 + 220);
    expect(emp().salary).toBe(700 + 220);

    // Add management level 2 → bonus 120
    assignSkill(ctx.state!.employees, empId, 'management', 2);
    expect(calculateSalary(emp())).toBe(700 + 220 + 120);
    expect(emp().salary).toBe(700 + 220 + 120);
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
