// BlastSimulator2026 — Integration tests: Employee skills and XP (Phase 5)
// Covers skill assignment, XP gain, level-up, and task duration modifiers.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { gainXp } from '../../src/core/entities/EmployeeGainXp.js';
import { calculateTaskDuration } from '../../src/core/entities/EmployeeTaskDuration.js';
import type { SkillCategory } from '../../src/core/entities/Employee.js';

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

  it('assigns a skill to an employee and persists on the record', () => {
    // TODO: implement
  });

  it('replacing a skill for the same category updates the proficiency level', () => {
    // TODO: implement
  });

  it('gainXp adds XP to an existing qualification', () => {
    // TODO: implement
  });

  it('gainXp levels up when cumulative XP crosses the threshold', () => {
    // TODO: implement
  });

  it('gainXp returns null for non-existent employee', () => {
    // TODO: implement
  });

  it('gainXp returns null for non-existent skill category', () => {
    // TODO: implement
  });

  it('calculateTaskDuration returns shorter duration for higher skill level', () => {
    // TODO: implement
  });

  it('assigning all valid skill categories succeeds without error', () => {
    // TODO: implement
  });

  it('employee level-up emits an event via the emitter', () => {
    // TODO: implement
  });

  it('skill proficiency level cannot exceed 5', () => {
    // TODO: implement
  });
});
