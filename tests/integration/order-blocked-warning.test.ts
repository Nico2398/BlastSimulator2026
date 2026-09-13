// BlastSimulator2026 — Integration tests: player-facing blocked-order warning (#1061)
//
// Orders that queue real work (level_ground, dig_ramp_segment, drill_hole,
// charge_hole, place_building, haul_debris/fragment_debris) dispatch with
// skipQualificationCheck: true and sit 'queued' regardless of whether anyone
// can perform them right now (#1029, deliberate). This suite drives a
// level_ground order end to end through the console and proves the new
// light diagnostic channel (PendingAction.blockedReason) tracks whether the
// order is currently doable, without ever cancelling/refusing the order
// itself — mirrors level-ground.test.ts's console-driving style
// (createRunner/runCommand, tick N).

import { describe, it, expect } from 'vitest';
import { createRunner, runCommand, type RunnerWithContext } from '../../src/console/createRunner.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import type { PendingAction } from '../../src/core/state/GameState.js';
import { BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD } from '../../src/core/config/balance.js';

const ROCK = { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 };
const BASE_HEIGHT = 15;

function carveFlatRect(grid: VoxelGrid, minX: number, maxX: number, minZ: number, maxZ: number, height: number): void {
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      for (let y = 0; y < grid.sizeY; y++) {
        if (y <= height) grid.setVoxel(x, y, z, ROCK);
        else grid.clearVoxel(x, y, z);
      }
    }
  }
}

function lowerColumn(grid: VoxelGrid, x: number, z: number, fromHeight: number, drop: number): void {
  for (let y = fromHeight; y > fromHeight - drop; y--) grid.clearVoxel(x, y, z);
}

/** A 2x2 rect, uneven enough that a level_ground order is genuinely real work (not an instant no-op). */
function carveSlopedRect(grid: VoxelGrid): void {
  carveFlatRect(grid, 15, 16, 15, 16, BASE_HEIGHT);
  lowerColumn(grid, 15, 15, BASE_HEIGHT, BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD + 1);
}

function makeBareRunner(cash = 300_000): RunnerWithContext {
  const engine = createRunner();
  expect(runCommand(engine, `new_game seed:42 size:32 cash:${cash}`).success).toBe(true);
  return engine;
}

describe('order-blocked player warning — level_ground round trip (#1061)', () => {
  it('a level_ground order with no employees and no vehicles queues, then classifies as blocked (no_vehicle_in_fleet) — never cancelled', () => {
    const engine = makeBareRunner();
    carveSlopedRect(engine.ctx.grid!);

    const orderResult = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(orderResult.success).toBe(true);

    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground');
    expect(action).toBeDefined();

    for (let i = 0; i < 50; i++) {
      runCommand(engine, 'tick 1');
      // The order must remain queued throughout — never cancelled/refused
      // just because nobody can do it yet.
      const stillThere = engine.ctx.state!.pendingActions.find(a => a.id === action!.id);
      expect(stillThere).toBeDefined();
      expect(stillThere!.status).toBe('queued');
    }

    const blocked = engine.ctx.state!.pendingActions.find(a => a.id === action!.id)!;
    expect(blocked.blockedReason).toBe('no_vehicle_in_fleet');
    expect(blocked.status).toBe('queued');
  });

  it('buying the vehicle and licensing a driver clears blockedReason and lets the order progress off queued', () => {
    const engine = makeBareRunner();
    carveSlopedRect(engine.ctx.grid!);

    const orderResult = runCommand(engine, 'level_ground minX:15 maxX:16 minZ:15 maxZ:16');
    expect(orderResult.success).toBe(true);
    const action = engine.ctx.state!.pendingActions.find(a => a.type === 'level_ground')!;

    // Confirm it is genuinely blocked before resolving anything, so the
    // assertions below prove a real transition rather than a no-op.
    for (let i = 0; i < 20; i++) runCommand(engine, 'tick 1');
    expect(engine.ctx.state!.pendingActions.find(a => a.id === action.id)!.blockedReason).toBe('no_vehicle_in_fleet');

    expect(runCommand(engine, 'vehicle buy rock_digger').success).toBe(true);
    expect(runCommand(engine, 'employee hire role:driver').success).toBe(true);
    const driver = engine.ctx.state!.employees.employees[engine.ctx.state!.employees.employees.length - 1]!;
    expect(runCommand(engine, `employee assign_skill ${driver.id} skill:driving.excavator level:1`).success).toBe(true);

    let resolved: PendingAction | undefined;
    for (let i = 0; i < 300; i++) {
      runCommand(engine, 'tick 1');
      const current = engine.ctx.state!.pendingActions.find(a => a.id === action.id);
      if (!current || current.status !== 'queued') {
        resolved = current;
        break;
      }
    }

    // Either the order progressed off 'queued' (claimed/assigned/in_progress)
    // while still present, or it completed outright and left pendingActions —
    // both prove the block resolved; a still-queued record would not.
    if (resolved) {
      expect(resolved.status).not.toBe('queued');
      expect(resolved.blockedReason == null).toBe(true);
    } else {
      expect(engine.ctx.state!.pendingActions.some(a => a.id === action.id)).toBe(false);
    }
  });
});
