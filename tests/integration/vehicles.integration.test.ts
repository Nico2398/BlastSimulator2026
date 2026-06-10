// BlastSimulator2026 — Integration tests: Vehicle fleet (Phase 5)
// Covers purchase, assignment, driving, hauling, drilling, digging, and demolition.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/** Hire one employee and return their numeric ID (always 1 on a fresh state). */
function hireOne(ctx: GameContext, role = 'driver'): number {
  const result = employeeCommand(ctx, ['hire'], { role });
  if (!result.success) throw new Error(`Setup: hire failed — ${result.output}`);
  return ctx.state!.employees.employees[0]!.id;
}

// ── Vehicle fleet ────────────────────────────────────────────────────────────

describe('Vehicle fleet', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('purchases a vehicle and deducts cost from cash', () => {
    // TODO: implement
  });

  it('rejects purchase when cash is insufficient', () => {
    // TODO: implement
  });

  it('assigns a driver to a purchased vehicle', () => {
    // TODO: implement
  });

  it('rejects driver assignment when employee lacks required skill', () => {
    // TODO: implement
  });

  it('moves a vehicle to a target grid cell', () => {
    // TODO: implement
  });

  it('vehicle reports correct operational state transitions (idle → moving → working)', () => {
    // TODO: implement
  });

  it('debris hauler increases hauling capacity when upgraded to tier 2', () => {
    // TODO: implement
  });

  it('drill rig completes a drilling action and produces a valid drill hole', () => {
    // TODO: implement
  });

  it('rock digger clears voxels in its working area', () => {
    // TODO: implement
  });

  it('lists all vehicles with their current state and driver', () => {
    // TODO: implement
  });
});
