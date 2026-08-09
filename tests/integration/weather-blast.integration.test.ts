// BlastSimulator2026 — Weather → blast wiring, through the real console
// runner and game loop. Proves ctx.weatherCycle (set via `weather set`)
// actually reaches executeBlast's wetHoleIds (BlastExecution.ts), not just
// that the `weather` command reports a state.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';

function drillChargeSequenceBlast(runner: ConsoleRunner, explosiveId: string) {
  runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12');
  runner.run(`charge hole:* explosive:${explosiveId} amount:8 stemming:2`);
  runner.run('sequence auto delay_step:25');
  return runner.run('blast');
}

describe('weather affects blast execution (wetHoleIds wiring)', () => {
  it('a water-sensitive explosive (boomite) clears fewer voxels blasted in heavy rain than the same plan in default (sunny) weather, with no tubing installed', () => {
    const dry = createRunner();
    dry.runner.run('new_game seed:42');
    const dryBlast = drillChargeSequenceBlast(dry.runner, 'boomite');
    expect(dryBlast.success).toBe(true);

    const wet = createRunner();
    wet.runner.run('new_game seed:42');
    wet.runner.run('weather set heavy_rain');
    const wetBlast = drillChargeSequenceBlast(wet.runner, 'boomite');
    expect(wetBlast.success).toBe(true);

    const dryReport = dry.ctx.state!.lastBlastReport!;
    const wetReport = wet.ctx.state!.lastBlastReport!;
    expect(wetReport.clearedVoxels).toBeLessThan(dryReport.clearedVoxels);
    expect(wetReport.totalRockVolume).toBeLessThan(dryReport.totalRockVolume);
  });

  it('a water-resistant explosive (krackle) clears the same whether blasted in heavy rain or sunny weather', () => {
    const dry = createRunner();
    dry.runner.run('new_game seed:42');
    const dryBlast = drillChargeSequenceBlast(dry.runner, 'krackle');
    expect(dryBlast.success).toBe(true);

    const wet = createRunner();
    wet.runner.run('new_game seed:42');
    wet.runner.run('weather set heavy_rain');
    const wetBlast = drillChargeSequenceBlast(wet.runner, 'krackle');
    expect(wetBlast.success).toBe(true);

    expect(wet.ctx.state!.lastBlastReport!.clearedVoxels)
      .toBe(dry.ctx.state!.lastBlastReport!.clearedVoxels);
  });

  it('installed tubing protects a water-sensitive explosive from heavy rain', () => {
    const tubed = createRunner();
    tubed.runner.run('new_game seed:42');
    tubed.runner.run('weather set heavy_rain');
    tubed.runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12');
    const buyResult = tubed.runner.run(`buy amount:${tubed.ctx.state!.drillHoles.length}`);
    expect(buyResult.success).toBe(true);
    for (const hole of tubed.ctx.state!.drillHoles) {
      const installResult = tubed.runner.run(`install_tubing hole:${hole.id}`);
      expect(installResult.success).toBe(true);
    }
    tubed.runner.run('charge hole:* explosive:boomite amount:8 stemming:2');
    tubed.runner.run('sequence auto delay_step:25');
    const tubedBlast = tubed.runner.run('blast');
    expect(tubedBlast.success).toBe(true);

    const dry = createRunner();
    dry.runner.run('new_game seed:42');
    const dryBlast = drillChargeSequenceBlast(dry.runner, 'boomite');
    expect(dryBlast.success).toBe(true);

    // Tubing fully protects a hole (wetHoles() excludes tubed holes outright,
    // WetHoles.ts) — same outcome as a dry blast despite the rain.
    expect(tubed.ctx.state!.lastBlastReport!.clearedVoxels)
      .toBe(dry.ctx.state!.lastBlastReport!.clearedVoxels);
  });
});
