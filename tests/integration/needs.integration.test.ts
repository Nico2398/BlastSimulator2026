// BlastSimulator2026 — Integration tests: Employee needs system (Phase 6)
// Covers hunger/fatigue/breakNeed gauges, morale effects, collapse, and building replenishment.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import {
  tickNeeds,
  getNeedMultiplier,
  tickNeedMorale,
  getMoraleDelta,
  type NeedKey,
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

  it('tickNeeds drains hunger and fatigue while working', () => {
    // TODO: implement
  });

  it('tickNeeds drains more slowly while idle', () => {
    // TODO: implement
  });

  it('getNeedMultiplier returns 1.0 when all gauges are above thresholds', () => {
    // TODO: implement
  });

  it('getNeedMultiplier returns a penalty when hunger is critically low', () => {
    // TODO: implement
  });

  it('getNeedMultiplier returns a penalty when fatigue is critically low', () => {
    // TODO: implement
  });

  it('tickNeedMorale reduces morale when breakNeed is low', () => {
    // TODO: implement
  });

  it('employee collapses when any gauge reaches 0 and is no longer productive', () => {
    // TODO: implement
  });

  it('canteen replenishes hunger gauge when employee visits', () => {
    // TODO: implement
  });

  it('bunkhouse replenishes fatigue gauge when employee rests', () => {
    // TODO: implement
  });

  it('break room replenishes breakNeed gauge when employee takes a break', () => {
    // TODO: implement
  });
});
