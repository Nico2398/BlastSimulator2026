// BlastSimulator2026 — Integration tests: Employee needs system (Phase 6)
// Covers hunger/fatigue/breakNeed gauges, morale effects, collapse, and building replenishment.
// Defines 10 real tests against the core EmployeeNeeds API and the needs console command.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand, needsCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';

import {
  tickNeedGauges,
  needsMoraleEffect,
  replenishNeed,
  checkCollapse,
  getNeedMultiplier,
} from '../../src/core/entities/EmployeeNeeds.js';
import type { Employee } from '../../src/core/entities/Employee.js';

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

/** Get the employee object from the game state. */
function getEmployee(ctx: GameContext, id: number): Employee {
  const emp = ctx.state!.employees.employees.find(e => e.id === id);
  if (!emp) throw new Error(`Employee #${id} not found`);
  return emp;
}

// ── Employee needs ───────────────────────────────────────────────────────────

describe('Employee needs', () => {
  let ctx: GameContext;
  let empId: number;

  beforeEach(() => {
    ctx = makeCtx();
    empId = hireOne(ctx);
  });

  // ── 1. tickNeedGauges drains gauges when working ─────────────────────────

  it('tickNeedGauges drains gauges when working', () => {
    const emp = getEmployee(ctx, empId);
    // Default morale is 60 → drain multiplier is 1.0 (normal range)
    expect(emp.morale).toBe(60);

    // Set all gauges to 100
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;

    tickNeedGauges(emp, true);

    // working drain rates at 1×: hunger=1, fatigue=2, breakNeed=0.8
    expect(emp.hunger).toBe(99);
    expect(emp.fatigue).toBe(98);
    expect(emp.breakNeed).toBeCloseTo(99.2, 1);
  });

  // ── 2. tickNeedGauges drains slower when idle ────────────────────────────

  it('tickNeedGauges drains slower when idle', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;

    // Record values after one working tick
    tickNeedGauges(emp, true);
    const workingHunger = emp.hunger;
    const workingFatigue = emp.fatigue;
    const workingBreak = emp.breakNeed;

    // Reset and do one idle tick
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;
    tickNeedGauges(emp, false);

    // idle drain rates at 1×: hunger=0.5, fatigue=0.5, breakNeed=0
    // Hunger and fatigue drain less when idle
    expect(emp.hunger).toBeGreaterThan(workingHunger);
    expect(emp.fatigue).toBeGreaterThan(workingFatigue);
    // breakNeed does not drain when idle
    expect(emp.breakNeed).toBe(100);
  });

  // ── 3. Gauges clamped to minimum 0 ───────────────────────────────────────

  it('gauges clamped to minimum 0', () => {
    const emp = getEmployee(ctx, empId);
    // Set hunger to a value that would go negative in one working tick
    emp.hunger = 0.5;

    tickNeedGauges(emp, true);

    expect(emp.hunger).toBe(0);
    // Ensure it never went negative
    expect(emp.hunger).toBeGreaterThanOrEqual(0);
  });

  // ── 4. needsMoraleEffect returns negative delta when needs low ───────────

  it('needsMoraleEffect returns negative delta when needs low', () => {
    const emp = getEmployee(ctx, empId);
    // All three gauges below suffering threshold (15) = critical tier
    // Each gauge contributes -3.0 → total delta = -9.0
    emp.hunger = 10;
    emp.fatigue = 10;
    emp.breakNeed = 10;

    const delta = needsMoraleEffect(emp);

    expect(delta).toBeLessThan(0);
    expect(delta).toBe(-9);
  });

  // ── 5. checkCollapse sets collapsing and clears action ─────────────────────

  it('checkCollapse sets collapsing and clears action', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;
    emp.activeActionId = 42;
    emp.collapsing = false;

    // Set hunger at or below collapse threshold (hunger ≤ 10)
    emp.hunger = 10;

    const result = checkCollapse(emp);

    expect(result).toBe('hunger');
    expect(emp.collapsing).toBe(true);
    expect(emp.activeActionId).toBeNull();
  });

  // ── 6. replenishNeed restores gauge value ─────────────────────────────────

  it('replenishNeed restores gauge value', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 50;

    // Tier-1 building with capacity: replenish rate = 12/tick
    const success = replenishNeed(emp, 'hunger', 1, 100);

    expect(success).toBe(true);
    expect(emp.hunger).toBe(62);
  });

  // ── 7. replenishNeed with zero capacity returns false ─────────────────────

  it('replenishNeed with zero capacity returns false', () => {
    const emp = getEmployee(ctx, empId);
    emp.fatigue = 50;
    const fatigueBefore = emp.fatigue;

    const success = replenishNeed(emp, 'fatigue', 1, 0);

    expect(success).toBe(false);
    expect(emp.fatigue).toBe(fatigueBefore);
  });

  // ── 8. checkCollapse returns null if already collapsing ───────────────────

  it('checkCollapse returns null if already collapsing', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 5; // Below collapse threshold, would normally trigger collapse
    emp.collapsing = true;

    const result = checkCollapse(emp);

    expect(result).toBeNull();
    // collapsing flag should remain true (not reset)
    expect(emp.collapsing).toBe(true);
  });

  // ── 9. needs command shows gauges for employees ──────────────────────────

  it('needs command shows gauges for employees', () => {
    const result = needsCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('Employee Needs');
    expect(result.output).toContain('hunger:');
    expect(result.output).toContain('fatigue:');
    expect(result.output).toContain('break:');
    expect(result.output).toContain(`[${empId}]`);
  });

  // ── 10. needs command handles no employees ───────────────────────────────

  it('needs command handles no employees', () => {
    // Create a fresh context with no employees
    const emptyCtx = makeCtx();

    const result = needsCommand(emptyCtx, [], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe('No employees.');
  });

  // ── Bonus: needsMoraleEffect with well-rested bonus ──────────────────────

  it('needsMoraleEffect returns positive delta when all gauges well-rested', () => {
    const emp = getEmployee(ctx, empId);
    // All three gauges above 80 → well-rested bonus of +1
    emp.hunger = 85;
    emp.fatigue = 85;
    emp.breakNeed = 85;

    const delta = needsMoraleEffect(emp);

    // well-rested bonus (+1) + comfortable (0 × 3) = +1
    expect(delta).toBe(1);
  });

  // ── Bonus: getNeedMultiplier returns 1.0 when gauges high ─────────────────

  it('getNeedMultiplier returns 1.0 when all gauges are above thresholds', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 100;
    emp.fatigue = 100;

    const mult = getNeedMultiplier(emp);

    expect(mult).toBe(1.0);
  });

  // ── Bonus: getNeedMultiplier penalty when hunger is critically low ────────

  it('getNeedMultiplier returns a penalty when hunger is critically low', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 5;  // below critical (10)
    emp.fatigue = 100; // no fatigue penalty

    const mult = getNeedMultiplier(emp);

    // hunger critical → 0.60, fatigue none → 1.0
    expect(mult).toBeCloseTo(0.60, 2);
  });

  // ── Bonus: getNeedMultiplier penalty when fatigue is critically low ───────

  it('getNeedMultiplier returns a penalty when fatigue is critically low', () => {
    const emp = getEmployee(ctx, empId);
    emp.hunger = 100;  // no hunger penalty
    emp.fatigue = 10;   // below critical (15)

    const mult = getNeedMultiplier(emp);

    // fatigue critical → 0.50, hunger none → 1.0
    expect(mult).toBeCloseTo(0.50, 2);
  });
});
