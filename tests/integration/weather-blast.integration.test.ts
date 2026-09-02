// BlastSimulator2026 — Weather → blast wiring, through the real console
// runner and game loop. Proves ctx.weatherCycle (set via `weather set`)
// actually reaches executeBlast's wetHoleIds (BlastExecution.ts), not just
// that the `weather` command reports a state.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';

/**
 * Ticks until every hole ordered by the last drill_plan grid has landed in
 * state.drillHoles (#553). Tops up employee need gauges each tick — this
 * file's staffed site is a single drill_rig/driller, and a multi-hole plan
 * can run long enough for fatigue to cross a collapse
 * threshold mid-drive, an unrelated needs mechanic these tests aren't
 * exercising.
 */
function driveDrillPlanToCompletion(runner: ConsoleRunner, ctx: GameContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    runner.run('tick 1');
  }
}

/**
 * Ticks until every charge ordered by the last `charge hole:*` has landed in
 * state.chargesByHole (#554), mirroring driveDrillPlanToCompletion above.
 */
function driveChargePlanToCompletion(runner: ConsoleRunner, ctx: GameContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    runner.run('tick 1');
  }
}

function drillChargeSequenceBlast(runner: ConsoleRunner, ctx: GameContext, explosiveId: string) {
  runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12');
  driveDrillPlanToCompletion(runner, ctx);
  runner.run(`charge hole:* explosive:${explosiveId} amount:8 stemming:2`);
  driveChargePlanToCompletion(runner, ctx);
  runner.run('sequence auto delay_step:25');
  return runner.run('blast');
}

describe('weather affects blast execution (wetHoleIds wiring)', () => {
  it('a water-sensitive explosive (boomite) clears fewer voxels blasted in heavy rain than the same plan in default (sunny) weather, with no tubing installed', () => {
    const dry = createRunner();
    dry.runner.run('new_game seed:42 staffed:true');
    const dryBlast = drillChargeSequenceBlast(dry.runner, dry.ctx, 'boomite');
    expect(dryBlast.success).toBe(true);

    const wet = createRunner();
    wet.runner.run('new_game seed:42 staffed:true');
    wet.runner.run('weather set heavy_rain');
    const wetBlast = drillChargeSequenceBlast(wet.runner, wet.ctx, 'boomite');
    expect(wetBlast.success).toBe(true);

    const dryReport = dry.ctx.state!.lastBlastReport!;
    const wetReport = wet.ctx.state!.lastBlastReport!;
    expect(wetReport.clearedVoxels).toBeLessThan(dryReport.clearedVoxels);
    expect(wetReport.totalRockVolume).toBeLessThan(dryReport.totalRockVolume);
  });

  it('a water-resistant explosive (krackle) clears the same whether blasted in heavy rain or sunny weather', () => {
    const dry = createRunner();
    dry.runner.run('new_game seed:42 staffed:true');
    const dryBlast = drillChargeSequenceBlast(dry.runner, dry.ctx, 'krackle');
    expect(dryBlast.success).toBe(true);

    const wet = createRunner();
    wet.runner.run('new_game seed:42 staffed:true');
    wet.runner.run('weather set heavy_rain');
    const wetBlast = drillChargeSequenceBlast(wet.runner, wet.ctx, 'krackle');
    expect(wetBlast.success).toBe(true);

    expect(wet.ctx.state!.lastBlastReport!.clearedVoxels)
      .toBe(dry.ctx.state!.lastBlastReport!.clearedVoxels);
  });

  it('installed tubing protects a water-sensitive explosive from heavy rain', () => {
    const tubed = createRunner();
    tubed.runner.run('new_game seed:42 staffed:true');
    tubed.runner.run('weather set heavy_rain');
    tubed.runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12');
    driveDrillPlanToCompletion(tubed.runner, tubed.ctx);
    const buyResult = tubed.runner.run(`buy amount:${tubed.ctx.state!.drillHoles.length}`);
    expect(buyResult.success).toBe(true);
    for (const hole of tubed.ctx.state!.drillHoles) {
      const installResult = tubed.runner.run(`install_tubing hole:${hole.id}`);
      expect(installResult.success).toBe(true);
    }
    tubed.runner.run('charge hole:* explosive:boomite amount:8 stemming:2');
    driveChargePlanToCompletion(tubed.runner, tubed.ctx);
    tubed.runner.run('sequence auto delay_step:25');
    const tubedBlast = tubed.runner.run('blast');
    expect(tubedBlast.success).toBe(true);

    const dry = createRunner();
    dry.runner.run('new_game seed:42 staffed:true');
    const dryBlast = drillChargeSequenceBlast(dry.runner, dry.ctx, 'boomite');
    expect(dryBlast.success).toBe(true);

    // Tubing fully protects a hole (wetHoles() excludes tubed holes outright,
    // WetHoles.ts) — same outcome as a dry blast despite the rain.
    expect(tubed.ctx.state!.lastBlastReport!.clearedVoxels)
      .toBe(dry.ctx.state!.lastBlastReport!.clearedVoxels);
  });
});
