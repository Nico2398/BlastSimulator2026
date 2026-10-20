// BlastSimulator2026 — Weather → blast wiring, through the real console
// runner and game loop. Proves state.weather (set via `weather set`)
// actually reaches executeBlast's wetHoleIds (BlastExecution.ts), not just
// that the `weather` command reports a state.

import { tickResolvingEvents } from './helpers.js';
import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import { t } from '../../src/core/i18n/I18n.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { forecast, createWeatherCycle } from '../../src/core/weather/WeatherCycle.js';
import { getAllBiomes } from '../../src/core/world/BiomeCatalog.js';
import { setHoleWater } from '../helpers/holeWater.js';
import { TICKS_PER_DAY, EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';

/**
 * Wages run every tick and the shift policy rests the crew between jobs, so a
 * long drive can drain the starting cash below a charge's price and park the
 * job on funds (#1673). Funding is not what these tests exercise.
 */
function keepFunded(ctx: GameContext): void {
  ctx.state!.cash = 500_000;
  ctx.state!.finances.cash = 500_000;
}

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
    keepFunded(ctx);
    tickResolvingEvents(cmd => runner.run(cmd));
  }
}

/**
 * Ticks until every charge ordered by the last `charge hole:*` has landed in
 * state.chargesByHole (#554), mirroring driveDrillPlanToCompletion above.
 */
function driveChargePlanToCompletion(runner: ConsoleRunner, ctx: GameContext, maxTicks = EXPLOSIVE_DELIVERY_TICKS + 300): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    keepFunded(ctx);
    tickResolvingEvents(cmd => runner.run(cmd));
  }
}

/**
 * Wetness is per-hole water state (#1350), not "is it raining right now", so a
 * blast in rain needs the rain to have fallen on the holes first. Resets all
 * water (earlier drift ticks may have rained), then either leaves the holes dry
 * (non-rain weather) or pins the weather for a few ticks so the holes fill.
 */
const RAINY = new Set(['light_rain', 'heavy_rain', 'storm']);
function applyWeather(runner: ConsoleRunner, ctx: GameContext, weather: string): void {
  ctx.state!.holeWater = {};
  ctx.state!.groundWetness = 0;
  if (RAINY.has(weather)) {
    for (let i = 0; i < 4; i++) {
      runner.run(`weather set ${weather}`);
      tickResolvingEvents(cmd => runner.run(cmd));
    }
  }
  runner.run(`weather set ${weather}`);
}

/**
 * Evacuates the pattern (plus a small margin) through the real `zone clear`
 * command and ticks until `zone status` reads clear, as a player does before
 * firing. Charging leaves the blaster mounted on the charging truck, parked on
 * the last hole it charged; whether a shift rest has walked them off by blast
 * time depends on where the crew spawned. Left there, they die on ground the
 * blast removes even when every charge fizzles, and the death cap then hides
 * the weather outcome these tests read.
 */
function clearPatternOfCrew(runner: ConsoleRunner, ctx: GameContext, maxTicks = 80): void {
  const xs = ctx.state!.drillHoles.map(h => h.x);
  const zs = ctx.state!.drillHoles.map(h => h.z);
  const m = 2;
  const ordered = runner.run(`zone clear x1:${Math.min(...xs) - m} z1:${Math.min(...zs) - m} x2:${Math.max(...xs) + m} z2:${Math.max(...zs) + m}`);
  expect(ordered.success, ordered.output).toBe(true);
  const isClear = (): boolean => runner.run('zone status').output.includes('— CLEAR');
  for (let i = 0; i < maxTicks && !isClear(); i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    keepFunded(ctx);
    tickResolvingEvents(cmd => runner.run(cmd));
  }
  expect(isClear(), runner.run('zone status').output).toBe(true);
}

// Weather ticks with the game (#1403), so a weather set before the long drill
// and charge drives has drifted by blast time. Pin it right before the blast.
function drillChargeBlast(runner: ConsoleRunner, ctx: GameContext, explosiveId: string, weather = 'sunny') {
  runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12');
  driveDrillPlanToCompletion(runner, ctx);
  runner.run(`charge hole:* explosive:${explosiveId} amount:8 stemming:2`);
  driveChargePlanToCompletion(runner, ctx);
  clearPatternOfCrew(runner, ctx);
  applyWeather(runner, ctx, weather);
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
    applyWeather(tubed.runner, tubed.ctx, 'heavy_rain');
    const tubedBlast = tubed.runner.run('blast');
    expect(tubedBlast.success).toBe(true);

    const dry = createRunner();
    dry.runner.run('new_game seed:42 staffed:true');
    const dryBlast = drillChargeBlast(dry.runner, dry.ctx, 'boomite');
    expect(dryBlast.success).toBe(true);

    // A tubed hole never takes on water (#1350), so the holes stay dry through
    // the rain: same outcome as a dry blast.
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
    applyWeather(game.runner, game.ctx, weather ?? 'sunny');
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
    applyWeather(game.runner, game.ctx, weather ?? 'sunny');
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

describe('fizzle share caps the blast rating (#1675)', () => {
  it('a fully fizzled boomite blast in rain reports ratingCap fizzled_failure and rating bad', () => {
    const wet = createRunner();
    wet.runner.run('new_game seed:42 staffed:true');
    wet.runner.run('weather set heavy_rain');
    expect(drillChargeBlast(wet.runner, wet.ctx, 'boomite', 'heavy_rain').success).toBe(true);
    const report = wet.ctx.state!.lastBlastReport!;
    expect(report.fizzledHoleIds).toEqual(report.wetHoleIds);
    expect(report.ratingCap).toBe('fizzled_failure');
    expect(report.rating).toBe('bad');
  });

  it('a krackle blast in wet holes is not capped and nothing fizzles', () => {
    const wet = createRunner();
    wet.runner.run('new_game seed:42 staffed:true');
    wet.runner.run('weather set heavy_rain');
    expect(drillChargeBlast(wet.runner, wet.ctx, 'krackle', 'heavy_rain').success).toBe(true);
    const report = wet.ctx.state!.lastBlastReport!;
    expect(report.wetHoleIds?.length).toBeGreaterThan(0);
    expect(report.fizzledHoleIds).toEqual([]);
    expect(report.ratingCap).not.toBe('wet_holes');
    expect(report.ratingCap).not.toBe('fizzled_failure');
    expect(report.ratingCap).not.toBe('fizzled_partial');
  });

  it('the console blast output names the fizzled cap', () => {
    const wet = createRunner();
    wet.runner.run('new_game seed:42 staffed:true');
    wet.runner.run('weather set heavy_rain');
    const result = drillChargeBlast(wet.runner, wet.ctx, 'boomite', 'heavy_rain');
    expect(result.output).toContain(t('mining.blast.rating_cap_fizzled_failure', { base: wet.ctx.state!.lastBlastReport!.baseRating?.toUpperCase() ?? '' }));
  });
});

describe('weather follows the level biome (#1688)', () => {
  it.each(getAllBiomes().map(b => b.id))('%s: forecast(cycle, N, biome) equals the live cycle after N days of ticks', (biome) => {
    const { runner, ctx } = createRunner();
    expect(runner.run(`new_game seed:42 mine_type:${biome}`).success).toBe(true);
    ctx.state!.events.eventFreqMultiplier = 0;
    expect(ctx.state!.mineType).toBe(biome);
    expect(ctx.state!.weather).toEqual(createWeatherCycle(42, undefined, biome));
    const N = 6;
    const before = structuredClone(ctx.state!.weather);
    const predicted = forecast(ctx.state!.weather, N, ctx.state!.mineType);
    expect(ctx.state!.weather).toEqual(before);
    expect(runner.run(`tick ${N * TICKS_PER_DAY}`).success).toBe(true);
    expect(ctx.state!.weather.current).toBe(predicted[N - 1]);
  });

  it('a desert game and a tropical game on the same seed diverge in weather', () => {
    const run = (biome: string) => {
      const { runner, ctx } = createRunner();
      runner.run(`new_game seed:42 mine_type:${biome}`);
      ctx.state!.events.eventFreqMultiplier = 0;
      runner.run('tick 600');
      return ctx.state!.weather.history.join(',');
    };
    expect(run('desert_badlands')).not.toBe(run('tropical_karst'));
  });
});

describe('a wet water-sensitive shot is held, not fired on its own (#1957)', () => {
  /** Charged, crew-cleared pattern in sunny weather; optionally tubed. Holes start dry. */
  function chargedSite(explosiveId: string, tube = false) {
    const game = createRunner();
    game.runner.run('new_game seed:42 staffed:true');
    game.runner.run('weather set sunny');
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
    clearPatternOfCrew(game.runner, game.ctx);
    // The whole danger zone (pattern + margin), not just the pattern: park crew and fleet in the far corner.
    for (const e of game.ctx.state!.employees.employees) { e.x = 60; e.z = 60; e.destinationX = null; e.destinationZ = null; }
    for (const v of game.ctx.state!.vehicles.vehicles) { v.x = 60; v.z = 60; }
    game.runner.run('weather set sunny');
    game.ctx.state!.holeWater = {};
    keepFunded(game.ctx);
    return game;
  }
  const holeIds = (game: ReturnType<typeof chargedSite>) => Object.keys(game.ctx.state!.chargesByHole).sort();
  const wetAll = (game: ReturnType<typeof chargedSite>) => setHoleWater(game.ctx.state!, holeIds(game), 0.9);

  it('blast detonate on a clear zone with wet sensitive charges succeeds with the held line and does not fire', () => {
    const game = chargedSite('boomite');
    const ids = holeIds(game);
    wetAll(game);
    const res = game.runner.run('blast detonate');
    expect(res.success, res.output).toBe(true);
    expect(res.output).toContain(String(ids.length));
    for (const id of ids) expect(res.output).toContain(id);
    expect(res.output).not.toBe('mining.blast.detonation_held');
    expect(game.ctx.state!.pendingDetonation).not.toBeNull();
    expect(game.ctx.state!.lastBlastReport).toBeFalsy();
  });

  it('tick stops the batch with the held line instead of firing: no report, no spend, still armed', () => {
    const game = chargedSite('boomite');
    const ids = holeIds(game);
    wetAll(game);
    game.runner.run('blast detonate');
    const res = game.runner.run('tick 5');
    expect(res.success, res.output).toBe(true);
    expect(res.output).not.toContain(t('mining.blast.detonation_auto_fired'));
    expect(res.output).not.toBe('tick.detonation_held');
    expect(res.output).toContain(String(ids.length));
    for (const id of ids) expect(res.output).toContain(id);
    expect(game.ctx.state!.lastBlastReport).toBeFalsy();
    expect(game.ctx.state!.pendingDetonation).not.toBeNull();
  });

  it('the tick batch stops early at the hold (fewer ticks advanced than asked)', () => {
    const game = chargedSite('boomite');
    wetAll(game);
    game.runner.run('blast detonate');
    const before = game.ctx.state!.tickCount;
    game.runner.run('tick 20');
    expect(game.ctx.state!.tickCount - before).toBeLessThan(20);
  });

  it('blast after the hold fires, and the wet sensitive holes fizzle', () => {
    const game = chargedSite('boomite');
    const ids = holeIds(game);
    wetAll(game);
    game.runner.run('blast detonate');
    game.runner.run('tick 3');
    const res = game.runner.run('blast');
    expect(res.success, res.output).toBe(true);
    expect(game.ctx.state!.pendingDetonation).toBeNull();
    expect(game.ctx.state!.lastBlastReport!.fizzledHoleIds).toEqual(ids);
  });

  it('draining the holes while held releases the hold: the shot fires on its own, nothing fizzles', () => {
    const game = chargedSite('boomite');
    wetAll(game);
    game.runner.run('blast detonate');
    game.runner.run('tick 2');
    game.ctx.state!.holeWater = {};
    game.runner.run('weather set sunny');
    const res = game.runner.run('tick 5');
    expect(res.output).toContain(t('mining.blast.detonation_auto_fired'));
    expect(game.ctx.state!.lastBlastReport!.fizzledHoleIds ?? []).toEqual([]);
  });

  it('cancelling a held shot clears it and fires nothing', () => {
    const game = chargedSite('boomite');
    wetAll(game);
    game.runner.run('blast detonate');
    expect(game.runner.run('blast cancel').success).toBe(true);
    expect(game.ctx.state!.pendingDetonation).toBeNull();
    const res = game.runner.run('tick 3');
    expect(res.output).not.toContain(t('mining.blast.detonation_auto_fired'));
    expect(game.ctx.state!.lastBlastReport).toBeFalsy();
  });

  it('water-resistant krackle in wet holes fires on its own as before', () => {
    const game = chargedSite('krackle');
    wetAll(game);
    const res = game.runner.run('blast detonate');
    expect(res.success, res.output).toBe(true);
    expect(game.ctx.state!.lastBlastReport!.fizzledHoleIds ?? []).toEqual([]);
    expect(game.ctx.state!.pendingDetonation).toBeNull();
  });

  it('tubed and dry boomite fires on its own through blast detonate, no fizzle', () => {
    const game = chargedSite('boomite', true);
    const res = game.runner.run('blast detonate');
    expect(res.success, res.output).toBe(true);
    expect(game.ctx.state!.pendingDetonation).toBeNull();
    expect(game.ctx.state!.lastBlastReport).toBeTruthy();
    expect(game.ctx.state!.lastBlastReport!.fizzledHoleIds ?? []).toEqual([]);
  });

  it('dry untubed boomite on a clear zone still fires at once', () => {
    const game = chargedSite('boomite');
    const res = game.runner.run('blast detonate');
    expect(res.success, res.output).toBe(true);
    expect(game.ctx.state!.lastBlastReport).toBeTruthy();
  });

  it('blast status names the hold while held', () => {
    const game = chargedSite('boomite');
    wetAll(game);
    game.runner.run('blast detonate');
    const res = game.runner.run('blast status');
    expect(res.success).toBe(true);
    expect(res.output.length).toBeGreaterThan(0);
    for (const id of holeIds(game)) expect(res.output).toContain(id);
  });
});
