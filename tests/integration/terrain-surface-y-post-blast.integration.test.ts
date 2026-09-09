// BlastSimulator2026 — getTerrainSurfaceY reflects a post-blast grid, not a
// stale pre-blast one (#1007).
//
// A blast mutates ctx.grid in place (BlastExecution.ts clears voxels
// directly on the live grid object), and getTerrainSurfaceY/
// getSmoothTerrainSurfaceY are pure re-scans with no cache of their own. The
// regression this guards: entity placement code that samples the surface
// once before a blast and never re-samples afterward would float entities
// at the old, now-collapsed, ground height. Driving a real blast through
// the console (rather than hand-building a grid) proves the fix against the
// actual mutation path buildings/vehicles/employees see in play.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { getTerrainSurfaceY } from '../../src/renderer/GameRendererTerrain.js';
import { getSmoothTerrainSurfaceY } from '../../src/core/world/VoxelGrid.js';

/** Mirrors weather-blast.integration.test.ts's drill-to-completion helper. */
function driveDrillPlanToCompletion(runner: ConsoleRunner, ctx: GameContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    runner.run('tick 1');
  }
}

/** Mirrors weather-blast.integration.test.ts's charge-to-completion helper. */
function driveChargePlanToCompletion(runner: ConsoleRunner, ctx: GameContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    runner.run('tick 1');
  }
}

describe('getTerrainSurfaceY reflects the post-blast grid (#1007)', () => {
  it('returns a different, freshly-computed height at a blasted column after the blast than it did before', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42 staffed:true');
    const grid = ctx.grid!;

    // Column at the drill grid's own first hole — solid ground pre-blast,
    // and confirmed (empirically, against this exact seed/plan) to sit
    // squarely inside the blast's cleared radius, unlike a column further
    // from a hole that a blast can legitimately leave untouched.
    const x = 12;
    const z = 12;
    const before = getTerrainSurfaceY(grid, x, z);
    expect(before).toBeGreaterThan(0);

    runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12');
    driveDrillPlanToCompletion(runner, ctx);
    runner.run('charge hole:* explosive:boomite amount:8 stemming:2');
    driveChargePlanToCompletion(runner, ctx);
    runner.run('sequence auto delay_step:25');
    const blastResult = runner.run('blast');
    expect(blastResult.success).toBe(true);
    expect(ctx.state!.lastBlastReport!.clearedVoxels).toBeGreaterThan(0);

    const after = getTerrainSurfaceY(grid, x, z);

    // The blast lowered (or at minimum reshaped) the column — never the
    // stale pre-blast value.
    expect(after).not.toBe(before);
    // And it must match a fresh direct scan of the (same, mutated) grid
    // object right now — proving getTerrainSurfaceY re-reads live grid state
    // rather than caching anything from before the blast.
    expect(after).toBe(getSmoothTerrainSurfaceY(grid, x, z));
  });
});
