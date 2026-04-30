// BlastSimulator2026 — Integration tests for employee and set_policy commands (task 3.15)

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { setPolicyCommand } from '../../src/console/commands/policy.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';

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

// ── employee assign_skill ───────────────────────────────────────────────────

describe('Console — employee assign_skill', () => {
  let ctx: GameContext;
  let empId: number;

  beforeEach(() => {
    ctx = makeCtx();
    empId = hireOne(ctx);
  });

  it('assigns a skill to an existing employee and reports success', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'blasting', level: '3' },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe(`Employee #${empId} assigned skill: blasting (level 3).`);
  });

  it('persists the qualification on the employee record', () => {
    employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'geology', level: '2' },
    );

    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    const qual = emp.qualifications.find(q => q.category === 'geology');
    expect(qual).toBeDefined();
    expect(qual!.proficiencyLevel).toBe(2);
  });

  it('replaces an existing qualification for the same category', () => {
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'driving.truck', level: '1' });
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'driving.truck', level: '4' });

    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    const quals = emp.qualifications.filter(q => q.category === 'driving.truck');
    expect(quals).toHaveLength(1);
    expect(quals[0]!.proficiencyLevel).toBe(4);
  });

  it('reports employee not found when the ID does not exist', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', '999'],
      { skill: 'blasting', level: '1' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe('Employee #999 not found.');
  });

  it('rejects the call when skill argument is missing', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { level: '2' }, // no skill
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('rejects the call when level argument is missing', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'blasting' }, // no level
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('rejects a level below the valid range (0)', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'management', level: '0' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('rejects a level above the valid range (6)', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'management', level: '6' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('rejects a non-numeric level', () => {
    const result = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'blasting', level: 'high' },
    );

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: employee assign_skill <id> skill:<category> level:1-5',
    );
  });

  it('accepts all valid skill categories without error', () => {
    const categories = [
      'driving.truck',
      'driving.excavator',
      'driving.drill_rig',
      'blasting',
      'management',
      'geology',
    ] as const;

    for (const category of categories) {
      const result = employeeCommand(
        ctx,
        ['assign_skill', String(empId)],
        { skill: category, level: '1' },
      );
      expect(result.success, `category "${category}" should be accepted`).toBe(true);
    }
  });
});

// ── set_policy command ──────────────────────────────────────────────────────

describe('Console — set_policy', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('updates policy to shift_8h mode with default thresholds', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h' });

    expect(result.success).toBe(true);
    // Default thresholds from balance.ts: hunger=40 fatigue=25 social=20
    expect(result.output).toBe('Policy updated: mode=shift_8h hunger=40 fatigue=25 social=20');
  });

  it('updates policy to shift_12h mode', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'shift_12h' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('mode=shift_12h');
  });

  it('updates policy to continuous mode', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'continuous' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('mode=continuous');
  });

  it('updates policy to custom mode', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'custom' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('mode=custom');
  });

  it('applies a hunger threshold override', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', hunger: '55' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('hunger=55');
    expect(ctx.state!.sitePolicy.hungerRestThreshold).toBe(55);
  });

  it('applies fatigue and social threshold overrides simultaneously', () => {
    const result = setPolicyCommand(ctx, [], {
      mode: 'continuous',
      fatigue: '30',
      social: '15',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('fatigue=30');
    expect(result.output).toContain('social=15');
    expect(ctx.state!.sitePolicy.fatigueRestThreshold).toBe(30);
    expect(ctx.state!.sitePolicy.socialBreakThreshold).toBe(15);
  });

  it('persists the chosen shift mode on the state', () => {
    setPolicyCommand(ctx, [], { mode: 'shift_12h' });

    expect(ctx.state!.sitePolicy.shiftMode).toBe('shift_12h');
  });

  it('rejects an invalid shift mode with a usage message', () => {
    const result = setPolicyCommand(ctx, [], { mode: 'night_shift' });

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: set_policy mode:(shift_8h|shift_12h|continuous|custom) [hunger:N] [fatigue:N] [social:N]',
    );
  });

  it('rejects a missing mode with the same usage message', () => {
    const result = setPolicyCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe(
      'Usage: set_policy mode:(shift_8h|shift_12h|continuous|custom) [hunger:N] [fatigue:N] [social:N]',
    );
  });

  it('errors when no game is loaded', () => {
    const emptyCtx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
    const result = setPolicyCommand(emptyCtx, [], { mode: 'shift_8h' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

// ── hire regression ─────────────────────────────────────────────────────────

describe('Console — employee hire (regression)', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('still hires a driller successfully', () => {
    const result = employeeCommand(ctx, ['hire'], { role: 'driller' });

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/Hired .+ \(driller\)\. Cost: \$\d+/);
  });

  it('still hires a blaster and adds them to the employee list', () => {
    employeeCommand(ctx, ['hire'], { role: 'blaster' });

    expect(ctx.state!.employees.employees).toHaveLength(1);
    expect(ctx.state!.employees.employees[0]!.role).toBe('blaster');
  });

  it('still rejects an invalid role', () => {
    const result = employeeCommand(ctx, ['hire'], { role: 'ninja' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage: employee hire role:');
  });
});
