// BlastSimulator2026 — Integration tests: long-range prospection through the console (#2286).
// `survey prospection` queues a G2 survey of the whole map; `survey islands` prints what the results hold.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import type { GameContext } from '../../src/console/commands/world.js';
import type { SurveyResult } from '../../src/core/mining/SurveyCalc.js';
import { surveyMethodRefusal } from '../../src/core/mining/SurveyGate.js';
import { oreIslandsOf } from '../../src/core/world/TerrainConfigOf.js';
import { SURVEY_COSTS, SURVEY_COVERAGE_RADIUS } from '../../src/core/config/balance.js';
import { t } from '../../src/core/i18n/I18n.js';

interface Game { runner: ReturnType<typeof createRunner>['runner']; ctx: GameContext }

/** A staffed-for-surveying sandbox at the given grade (`undefined` start: the sandbox default of grade 0). */
function sandbox(options: { grade?: number; skill?: number | null; cash?: number } = {}): Game {
  const { runner, ctx } = createRunner();
  const grade = options.grade === undefined ? '' : ` grade:${options.grade}`;
  const started = runner.run(`sandbox start biome:green_foothills seed:42${grade}`);
  expect(started.success, started.output).toBe(true);
  ctx.state!.cash = options.cash ?? 1_000_000;
  if (options.skill !== null) {
    expect(employeeCommand(ctx, ['hire'], { role: 'surveyor' }).success).toBe(true);
    const id = ctx.state!.employees.employees.slice(-1)[0]!.id;
    const skill = employeeCommand(ctx, ['assign_skill', String(id)], { skill: 'geology', level: String(options.skill ?? 5) });
    expect(skill.success, skill.output).toBe(true);
  }
  return { runner, ctx };
}

function tickUntilProspected(game: Game, limit = 300): SurveyResult {
  for (let i = 0; i < limit; i++) {
    const done = game.ctx.state!.surveyResults.find(r => r.method === 'prospection');
    if (done) return done;
    game.runner.run('tick 1');
  }
  throw new Error('prospection never completed');
}

const run = (game: Game, line: string) => game.runner.run(line);
const pendingSurveys = (game: Game) => game.ctx.state!.pendingActions.filter(a => a.type === 'survey');

describe('survey prospection — queueing (#2286, C8)', () => {
  it('queues a prospection at G2 and says so', () => {
    const game = sandbox({ grade: 2 });
    const result = run(game, 'survey prospection');
    expect(result.success, result.output).toBe(true);
    expect(result.output).toContain('prospection');
    expect(pendingSurveys(game)).toHaveLength(1);
    expect(pendingSurveys(game)[0]!.payload).toMatchObject({ method: 'prospection' });
  });

  it('defaults the centre to the middle of the base world', () => {
    const game = sandbox({ grade: 2 });
    const world = game.ctx.state!.world!;
    run(game, 'survey prospection');
    expect(pendingSurveys(game)[0]!.payload).toMatchObject({
      centerX: Math.floor(world.baseSizeX / 2), centerZ: Math.floor(world.baseSizeZ / 2),
    });
  });

  it('takes an explicit x: and z:', () => {
    const game = sandbox({ grade: 2 });
    const result = run(game, 'survey prospection x:50 z:60');
    expect(result.success, result.output).toBe(true);
    expect(pendingSurveys(game)[0]!.payload).toMatchObject({ method: 'prospection', centerX: 50, centerZ: 60 });
  });

  it('charges the prospection cost', () => {
    const game = sandbox({ grade: 2, cash: 1_000_000 });
    const before = game.ctx.state!.cash;
    run(game, 'survey prospection');
    expect(game.ctx.state!.cash).toBe(before - SURVEY_COSTS.prospection);
  });

  it('claims no site expansion: the world box is unchanged although the radius spills far outside it', () => {
    const game = sandbox({ grade: 2 });
    const w = game.ctx.state!.world!;
    const before = { sizeX: w.sizeX, sizeZ: w.sizeZ, minX: w.minX, minZ: w.minZ };
    expect(SURVEY_COVERAGE_RADIUS.prospection).toBeGreaterThan(w.sizeX);
    const result = run(game, 'survey prospection');
    expect(result.success, result.output).toBe(true);
    const after = game.ctx.state!.world!;
    expect({ sizeX: after.sizeX, sizeZ: after.sizeZ, minX: after.minX, minZ: after.minZ }).toEqual(before);
  });

  it('is open on a non-progression site', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32').success).toBe(true);
    expect(ctx.state!.grade).toBeUndefined();
    ctx.state!.cash = 1_000_000;
    employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    const id = ctx.state!.employees.employees.slice(-1)[0]!.id;
    employeeCommand(ctx, ['assign_skill', String(id)], { skill: 'geology', level: '3' });
    const result = runner.run('survey prospection');
    expect(result.success, result.output).toBe(true);
  });
});

describe('survey prospection — refusals (#2286, C1, C8)', () => {
  it.each([0, 1])('below G2 (grade %i) it fails with the lock refusal and queues nothing', (grade) => {
    const game = sandbox({ grade });
    const cash = game.ctx.state!.cash;
    const result = run(game, 'survey prospection');
    expect(result.success).toBe(false);
    expect(result.output).toBe(surveyMethodRefusal(grade, 'prospection'));
    expect(pendingSurveys(game)).toHaveLength(0);
    expect(game.ctx.state!.cash).toBe(cash);
  });

  it('with no surveyor it fails as the other methods do', () => {
    const game = sandbox({ grade: 2, skill: null });
    const result = run(game, 'survey prospection');
    expect(result.success).toBe(false);
    expect(result.output).toBe(t('mining.survey.no_surveyor'));
    expect(pendingSurveys(game)).toHaveLength(0);
  });

  it('with cash one short it fails with the insufficient funds message', () => {
    const game = sandbox({ grade: 2, cash: SURVEY_COSTS.prospection - 1 });
    const result = run(game, 'survey prospection');
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(game.ctx.state!.cash).toBe(SURVEY_COSTS.prospection - 1);
  });

  it('with no game loaded it fails like every survey command', () => {
    const { runner } = createRunner();
    expect(runner.run('survey prospection').success).toBe(false);
  });
});

describe('survey prospection — completion (#2286, C7)', () => {
  it('stores a prospection result whose islands come from the world, no per-voxel estimate', () => {
    const game = sandbox({ grade: 2, skill: 5 });
    run(game, 'survey prospection');
    const result = tickUntilProspected(game);
    const world = oreIslandsOf(game.ctx.state!);
    expect(world.length).toBeGreaterThan(0);
    expect(result.estimates).toEqual({});
    expect(result.depthProfile).toBeUndefined();
    // A top-skill surveyor reads every island, exactly once, at its true centre, with its first ore.
    const inRange = world.filter(i => Math.hypot(i.x - result.centerX, i.z - result.centerZ) <= SURVEY_COVERAGE_RADIUS.prospection);
    expect(inRange.length).toBeGreaterThan(0);
    expect(result.islands).toHaveLength(inRange.length);
    for (const island of inRange) {
      expect(result.islands!.filter(i => i.x === island.x && i.z === island.z && i.oreId === island.oreIds[0])).toHaveLength(1);
    }
  });

  it('the stored islands are the same on a second identical game', () => {
    const a = sandbox({ grade: 2, skill: 3 });
    const b = sandbox({ grade: 2, skill: 3 });
    run(a, 'survey prospection');
    run(b, 'survey prospection');
    expect(tickUntilProspected(a).islands).toEqual(tickUntilProspected(b).islands);
  });

  it('a site with no island stores an empty list', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32').success).toBe(true);
    expect(oreIslandsOf(ctx.state!)).toEqual([]);
    ctx.state!.cash = 1_000_000;
    employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    const id = ctx.state!.employees.employees.slice(-1)[0]!.id;
    employeeCommand(ctx, ['assign_skill', String(id)], { skill: 'geology', level: '5' });
    runner.run('survey prospection');
    const game: Game = { runner, ctx };
    // Tick with the game's own runner until the prospection resolves.
    const result = tickUntilProspected(game);
    expect(result.islands).toEqual([]);
  });

  it('a blast-free tick stream never marks the result stale', () => {
    const game = sandbox({ grade: 2, skill: 5 });
    run(game, 'survey prospection');
    const result = tickUntilProspected(game);
    run(game, 'tick 20');
    expect(result.stale).toBeUndefined();
  });
});

describe('survey islands (#2286, C8)', () => {
  const result = (id: number, method: SurveyResult['method'], islands?: SurveyResult['islands']): SurveyResult => ({
    id, method, centerX: 32, centerZ: 32, completedTick: 0, surveyorId: 1, estimates: {}, confidence: 0.7,
    ...(islands ? { islands } : {}),
  });

  it('prints zero when nothing was prospected', () => {
    const game = sandbox({ grade: 2 });
    const out = run(game, 'survey islands');
    expect(out.success, out.output).toBe(true);
    expect(out.output.trim()).toBe('Detected islands: 0');
  });

  it('prints the count then one line per island, in the documented format', () => {
    const game = sandbox({ grade: 2 });
    game.ctx.state!.surveyResults.push(result(10, 'prospection', [
      { x: 301, z: 62, radius: 16, oreId: 'craktonite' },
      { x: -247, z: 71, radius: 24, oreId: 'absurdium' },
    ]));
    const out = run(game, 'survey islands');
    expect(out.success, out.output).toBe(true);
    const lines = out.output.split('\n').filter(l => l.trim() !== '');
    expect(lines[0]).toBe('Detected islands: 2');
    expect(lines.slice(1)).toEqual([
      '  (301, 62) craktonite radius 16m',
      '  (-247, 71) absurdium radius 24m',
    ]);
  });

  it('lists the islands of every prospection result and ignores other methods', () => {
    const game = sandbox({ grade: 2 });
    game.ctx.state!.surveyResults.push(
      result(10, 'prospection', [{ x: 301, z: 62, radius: 16, oreId: 'craktonite' }]),
      result(11, 'seismic'),
      result(12, 'prospection', [{ x: -247, z: 71, radius: 24, oreId: 'absurdium' }, { x: 18, z: -283, radius: 8, oreId: 'craktonite' }]),
    );
    const out = run(game, 'survey islands').output;
    const lines = out.split('\n').filter(l => l.trim() !== '');
    expect(lines[0]).toBe('Detected islands: 3');
    expect(lines.slice(1).sort()).toEqual([
      '  (-247, 71) absurdium radius 24m',
      '  (18, -283) craktonite radius 8m',
      '  (301, 62) craktonite radius 16m',
    ]);
  });

  it('prints zero for a prospection result that found nothing', () => {
    const game = sandbox({ grade: 2 });
    game.ctx.state!.surveyResults.push(result(10, 'prospection', []));
    expect(run(game, 'survey islands').output.trim()).toBe('Detected islands: 0');
  });

  it('after a real prospection, prints one line per stored island', () => {
    const game = sandbox({ grade: 2, skill: 5 });
    run(game, 'survey prospection');
    const stored = tickUntilProspected(game);
    const lines = run(game, 'survey islands').output.split('\n').filter(l => l.trim() !== '');
    expect(lines[0]).toBe(`Detected islands: ${stored.islands!.length}`);
    expect(lines).toHaveLength(stored.islands!.length + 1);
    for (const island of stored.islands!) {
      expect(lines).toContain(`  (${island.x}, ${island.z}) ${island.oreId} radius ${island.radius}m`);
    }
  });

  it('fails with no game loaded', () => {
    const { runner } = createRunner();
    expect(runner.run('survey islands').success).toBe(false);
  });
});
