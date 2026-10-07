// BlastSimulator2026 — Weather → blast wiring, through the real console
// runner and game loop. Proves state.weather (set via `weather set`)
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

// Weather ticks with the game (#1403), so a weather set before the long drill
// and charge drives has drifted by blast time. Pin it right before the blast.
function drillChargeBlast(runner: ConsoleRunner, ctx: GameContext, explosiveId: string, weather = 'sunny') {
  runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12');
  driveDrillPlanToCompletion(runner, ctx);
  runner.run(`charge hole:* explosive:${explosiveId} amount:8 stemming:2`);
  driveChargePlanToCompletion(runner, ctx);
  runner.run(`weather set ${weather}`);
  return runner.run('blast');
}

describe('weather affects blast execution (wetHoleIds wiring)', () => {
  it('a water-sensitive explosive (boomite) clears fewer voxels blasted in heavy rain than the same plan in default (sunny) weather, with no tubing installed', () => {
    const dry = createRunner();
    dry.runner.run('new_game seed:42 staffed:true');
    const dryBlast = drillChargeBlast(dry.runner, dry.ctx, 'boomite');
    expect(dryBlast.success).toBe(true);

    const wet = createRunner();
    wet.runner.run('new_game seed:42 staffed:true');
    wet.runner.run('weather set heavy_rain');
    const wetBlast = drillChargeBlast(wet.runner, wet.ctx, 'boomite', 'heavy_rain');
    expect(wetBlast.success).toBe(true);

    const dryReport = dry.ctx.state!.lastBlastReport!;
    const wetReport = wet.ctx.state!.lastBlastReport!;
    expect(wetReport.clearedVoxels).toBeLessThan(dryReport.clearedVoxels);
    expect(wetReport.totalRockVolume).toBeLessThan(dryReport.totalRockVolume);
  });

  it('a water-resistant explosive (krackle) clears the same whether blasted in heavy rain or sunny weather', () => {
    const dry = createRunner();
    dry.runner.run('new_game seed:42 staffed:true');
    const dryBlast = drillChargeBlast(dry.runner, dry.ctx, 'krackle');
    expect(dryBlast.success).toBe(true);

    const wet = createRunner();
    wet.runner.run('new_game seed:42 staffed:true');
    wet.runner.run('weather set heavy_rain');
    const wetBlast = drillChargeBlast(wet.runner, wet.ctx, 'krackle', 'heavy_rain');
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
    tubed.runner.run('weather set heavy_rain');
    const tubedBlast = tubed.runner.run('blast');
    expect(tubedBlast.success).toBe(true);

    const dry = createRunner();
    dry.runner.run('new_game seed:42 staffed:true');
    const dryBlast = drillChargeBlast(dry.runner, dry.ctx, 'boomite');
    expect(dryBlast.success).toBe(true);

    // Tubing fully protects a hole (wetHoles() excludes tubed holes outright,
    // WetHoles.ts) — same outcome as a dry blast despite the rain.
    expect(tubed.ctx.state!.lastBlastReport!.clearedVoxels)
      .toBe(dry.ctx.state!.lastBlastReport!.clearedVoxels);
  });
});

describe('console blast output reports wet holes (#1348)', () => {
  it('rain + untubed boomite prints the wet-holes line with wet and fizzled counts', () => {
    const wet = createRunner();
    wet.runner.run('new_game seed:42 staffed:true');
    wet.runner.run('weather set heavy_rain');
    const result = drillChargeBlast(wet.runner, wet.ctx, 'boomite', 'heavy_rain');
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/Wet holes: 6 \(6 fizzled\)/);
  });

  it('a dry blast prints no wet-holes line', () => {
    const dry = createRunner();
    dry.runner.run('new_game seed:42 staffed:true');
    const result = drillChargeBlast(dry.runner, dry.ctx, 'boomite');
    expect(result.success).toBe(true);
    expect(result.output).not.toMatch(/Wet holes/);
  });
});

describe('software previews model wet holes like the real blast (#1347)', () => {
  function previewCounts(output: string): { fractured: number; cracked: number } {
    const m = /(\d+) fractured, (\d+) cracked/.exec(output);
    if (!m) throw new Error(`unexpected preview output: ${output}`);
    return { fractured: Number(m[1]), cracked: Number(m[2]) };
  }

  function stagePlan(weather: string | null) {
    const game = createRunner();
    game.runner.run('new_game seed:42 staffed:true');
    if (weather) game.runner.run(`weather set ${weather}`);
    game.runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12');
    driveDrillPlanToCompletion(game.runner, game.ctx);
    game.runner.run('charge hole:* explosive:boomite amount:8 stemming:2');
    driveChargePlanToCompletion(game.runner, game.ctx);
    game.runner.run(`weather set ${weather ?? 'sunny'}`);
    game.ctx.state!.softwareTier = 3;
    return game;
  }

  it('preview fragments during rain shows fewer fractured voxels than the same plan dry', () => {
    const dry = stagePlan(null);
    const wet = stagePlan('heavy_rain');
    const dryCounts = previewCounts(dry.runner.run('preview fragments').output);
    const wetCounts = previewCounts(wet.runner.run('preview fragments').output);
    expect(wetCounts.fractured).toBeLessThan(dryCounts.fractured);
  });

  it('preview fragments during rain equals the result of the subsequent blast', () => {
    const wet = stagePlan('heavy_rain');
    const preview = previewCounts(wet.runner.run('preview fragments').output);
    expect(wet.runner.run('blast').success).toBe(true);
    const report = wet.ctx.state!.lastBlastReport!;
    expect(preview.fractured).toBe(report.clearedVoxels);
    expect(preview.cracked).toBe(report.crackedVoxels);
  });
});

describe('blast report lists wet and fizzled holes (#1348)', () => {
  function tubedBlast(weather: string | null, explosiveId: string, tube: boolean) {
    const game = createRunner();
    game.runner.run('new_game seed:42 staffed:true');
    if (weather) game.runner.run(`weather set ${weather}`);
    game.runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12');
    driveDrillPlanToCompletion(game.runner, game.ctx);
    if (tube) {
      expect(game.runner.run(`buy amount:${game.ctx.state!.drillHoles.length}`).success).toBe(true);
      for (const hole of game.ctx.state!.drillHoles) {
        expect(game.runner.run(`install_tubing hole:${hole.id}`).success).toBe(true);
      }
    }
    game.runner.run(`charge hole:* explosive:${explosiveId} amount:8 stemming:2`);
    driveChargePlanToCompletion(game.runner, game.ctx);
    const chargedIds = Object.keys(game.ctx.state!.chargesByHole).sort();
    game.runner.run(`weather set ${weather ?? 'sunny'}`);
    expect(game.runner.run('blast').success).toBe(true);
    return { report: game.ctx.state!.lastBlastReport!, chargedIds };
  }

  it('rain + untubed boomite: every charged hole is wet and fizzled', () => {
    const { report, chargedIds } = tubedBlast('heavy_rain', 'boomite', false);
    expect(chargedIds.length).toBe(6);
    expect(report.wetHoleIds).toEqual(chargedIds);
    expect(report.fizzledHoleIds).toEqual(chargedIds);
  });

  it('rain + tubed boomite: no wet or fizzled holes reported', () => {
    const { report } = tubedBlast('heavy_rain', 'boomite', true);
    expect(report.wetHoleIds ?? []).toEqual([]);
    expect(report.fizzledHoleIds ?? []).toEqual([]);
  });

  it('sunny + boomite: no wet or fizzled holes reported', () => {
    const { report } = tubedBlast(null, 'boomite', false);
    expect(report.wetHoleIds ?? []).toEqual([]);
    expect(report.fizzledHoleIds ?? []).toEqual([]);
  });

  it('rain + krackle (emulsion): holes are wet but none fizzle', () => {
    const { report, chargedIds } = tubedBlast('heavy_rain', 'krackle', false);
    expect(report.wetHoleIds).toEqual(chargedIds);
    expect(report.fizzledHoleIds).toEqual([]);
  });
});
