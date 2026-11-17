// BlastSimulator2026 — Integration tests: the meteorite detector through the console (#2291).
// `survey meteorite_detector` queues a reading at a point; `survey readings` prints what the results hold.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import type { GameContext } from '../../src/console/commands/world.js';
import type { SurveyResult } from '../../src/core/mining/SurveyCalc.js';
import { surveyMethodRefusal } from '../../src/core/mining/SurveyGate.js';
import { detectorHalfAngle } from '../../src/core/mining/SurveyDetector.js';
import { meteoriteCraterOf } from '../../src/core/world/TerrainConfigOf.js';
import { SURVEY_COSTS } from '../../src/core/config/balance.js';
import { gradeName } from '../../src/core/economy/MineGrade.js';
import { t } from '../../src/core/i18n/I18n.js';

interface Game { runner: ReturnType<typeof createRunner>['runner']; ctx: GameContext }

const DEG = Math.PI / 180;

/** A staffed-for-surveying sandbox at the given grade (`undefined` start: the sandbox default of grade 0). */
function sandbox(options: { grade?: number; skill?: number | null; cash?: number; seed?: number } = {}): Game {
  const { runner, ctx } = createRunner();
  const grade = options.grade === undefined ? '' : ` grade:${options.grade}`;
  const started = runner.run(`sandbox start biome:green_foothills seed:${options.seed ?? 42}${grade}`);
  expect(started.success, started.output).toBe(true);
  if (options.skill !== null) {
    expect(employeeCommand(ctx, ['hire'], { role: 'surveyor' }).success).toBe(true);
    const id = ctx.state!.employees.employees.slice(-1)[0]!.id;
    const skill = employeeCommand(ctx, ['assign_skill', String(id)], { skill: 'geology', level: String(options.skill ?? 5) });
    expect(skill.success, skill.output).toBe(true);
  }
  ctx.state!.cash = options.cash ?? 1_000_000; // after the hire, which is paid from cash
  return { runner, ctx };
}

const detectorResults = (game: Game): SurveyResult[] => game.ctx.state!.surveyResults.filter(r => r.method === 'meteorite_detector');

function tickUntilReadings(game: Game, count = 1, limit = 800): SurveyResult[] {
  for (let i = 0; i < limit; i++) {
    const done = detectorResults(game);
    if (done.length >= count) return done;
    game.runner.run('tick 1');
  }
  throw new Error(`${count} detector survey(s) never completed`);
}

const run = (game: Game, line: string) => game.runner.run(line);
const pendingSurveys = (game: Game) => game.ctx.state!.pendingActions.filter(a => a.type === 'survey');

/** The crater centre, the way a debug session reads it. */
function craterOf(game: Game): { x: number; z: number } {
  const out = run(game, 'meteorite_crater').output;
  const m = /\((-?\d+), (-?\d+)\)/.exec(out);
  expect(m, out).not.toBeNull();
  return { x: Number(m![1]), z: Number(m![2]) };
}

function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

describe('survey meteorite_detector — queueing (#2291, C5)', () => {
  it('queues a reading at G3 and says so', () => {
    const game = sandbox({ grade: 3 });
    const result = run(game, 'survey meteorite_detector x:30 z:30');
    expect(result.success, result.output).toBe(true);
    expect(result.output).toContain('meteorite_detector');
    expect(pendingSurveys(game)).toHaveLength(1);
    expect(pendingSurveys(game)[0]!.payload).toMatchObject({ method: 'meteorite_detector', centerX: 30, centerZ: 30 });
  });

  it('defaults the point to the middle of the base world, like prospection', () => {
    const game = sandbox({ grade: 3 });
    const world = game.ctx.state!.world!;
    const result = run(game, 'survey meteorite_detector');
    expect(result.success, result.output).toBe(true);
    expect(pendingSurveys(game)[0]!.payload).toMatchObject({
      centerX: Math.floor(world.baseSizeX / 2), centerZ: Math.floor(world.baseSizeZ / 2),
    });
  });

  it('takes a point far outside the site', () => {
    const game = sandbox({ grade: 3 });
    const result = run(game, 'survey meteorite_detector x:-250 z:400');
    expect(result.success, result.output).toBe(true);
    expect(pendingSurveys(game)[0]!.payload).toMatchObject({ centerX: -250, centerZ: 400 });
  });

  it('charges the detector cost', () => {
    const game = sandbox({ grade: 3, cash: 1_000_000 });
    run(game, 'survey meteorite_detector x:30 z:30');
    expect(game.ctx.state!.cash).toBe(1_000_000 - SURVEY_COSTS.meteorite_detector);
  });

  it('claims no site expansion: the world box is unchanged although the point lies far outside it', () => {
    const game = sandbox({ grade: 3 });
    const w = game.ctx.state!.world!;
    const before = { sizeX: w.sizeX, sizeZ: w.sizeZ, minX: w.minX, minZ: w.minZ };
    const result = run(game, 'survey meteorite_detector x:300 z:-300');
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
    const result = runner.run('survey meteorite_detector x:10 z:10');
    expect(result.success, result.output).toBe(true);
  });
});

describe('survey meteorite_detector — refusals (#2291, C1, C5)', () => {
  it.each([0, 1, 2])('below G3 (grade %i) it fails with the lock text naming G3 and queues nothing', (grade) => {
    const game = sandbox({ grade });
    const cash = game.ctx.state!.cash;
    const result = run(game, 'survey meteorite_detector x:30 z:30');
    expect(result.success).toBe(false);
    expect(result.output).toBe(surveyMethodRefusal(grade, 'meteorite_detector'));
    expect(result.output).toContain(gradeName(3));
    expect(pendingSurveys(game)).toHaveLength(0);
    expect(game.ctx.state!.cash).toBe(cash);
  });

  it('with no surveyor it fails as the other methods do', () => {
    const game = sandbox({ grade: 3, skill: null });
    const result = run(game, 'survey meteorite_detector x:30 z:30');
    expect(result.success).toBe(false);
    expect(result.output).toBe(t('mining.survey.no_surveyor'));
    expect(pendingSurveys(game)).toHaveLength(0);
  });

  it('with cash one short it fails with the insufficient funds message', () => {
    const game = sandbox({ grade: 3, cash: SURVEY_COSTS.meteorite_detector - 1 });
    const result = run(game, 'survey meteorite_detector x:30 z:30');
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(game.ctx.state!.cash).toBe(SURVEY_COSTS.meteorite_detector - 1);
  });

  it('with a non-numeric point it fails and queues nothing', () => {
    const game = sandbox({ grade: 3 });
    const result = run(game, 'survey meteorite_detector x:abc z:30');
    expect(result.success).toBe(false);
    expect(pendingSurveys(game)).toHaveLength(0);
  });

  it('with no game loaded it fails like every survey command', () => {
    const { runner } = createRunner();
    expect(runner.run('survey meteorite_detector x:30 z:30').success).toBe(false);
  });
});

describe('survey meteorite_detector — completion (#2291, C2, C4)', () => {
  it('stores a result whose reading comes from the world crater, no per-voxel estimate', () => {
    const game = sandbox({ grade: 3, skill: 5 });
    run(game, 'survey meteorite_detector x:30 z:30');
    const [result] = tickUntilReadings(game);
    expect(result!.method).toBe('meteorite_detector');
    expect(result!.centerX).toBe(30);
    expect(result!.centerZ).toBe(30);
    expect(result!.estimates).toEqual({});
    const reading = result!.reading!;
    expect(reading).toBeDefined();

    const crater = craterOf(game);
    expect(angleGap(reading.bearing, Math.atan2(crater.z - 30, crater.x - 30))).toBeLessThanOrEqual(reading.halfAngle + 1e-9);
    const d = Math.hypot(crater.x - 30, crater.z - 30);
    expect(reading.minDistance).toBeLessThanOrEqual(d);
    expect(reading.maxDistance).toBeGreaterThanOrEqual(d);
    expect(reading.minDistance).toBeGreaterThanOrEqual(0);
  });

  it('uses the same crater the engine exposes', () => {
    const game = sandbox({ grade: 3, skill: 5 });
    const crater = meteoriteCraterOf(game.ctx.state!)!;
    expect(crater).toEqual(craterOf(game));
  });

  it('the cone width follows the surveyor skill', () => {
    const wide = sandbox({ grade: 3, skill: 1 });
    run(wide, 'survey meteorite_detector x:30 z:30');
    const narrow = sandbox({ grade: 3, skill: 5 });
    run(narrow, 'survey meteorite_detector x:30 z:30');
    const w = tickUntilReadings(wide)[0]!.reading!;
    const n = tickUntilReadings(narrow)[0]!.reading!;
    expect(w.halfAngle).toBeCloseTo(detectorHalfAngle(1), 9);
    expect(n.halfAngle).toBeCloseTo(detectorHalfAngle(5), 9);
    expect(n.halfAngle).toBeLessThan(w.halfAngle);
  });

  it('never carries the crater centre or radius', () => {
    const game = sandbox({ grade: 3, skill: 3 });
    run(game, 'survey meteorite_detector x:30 z:30');
    const [result] = tickUntilReadings(game);
    expect(Object.keys(result!.reading!).sort()).toEqual(['bearing', 'halfAngle', 'maxDistance', 'minDistance']);
    expect(result!.islands).toBeUndefined();
  });

  it('the stored reading is the same on a second identical game', () => {
    const a = sandbox({ grade: 3, skill: 3 });
    const b = sandbox({ grade: 3, skill: 3 });
    run(a, 'survey meteorite_detector x:30 z:30');
    run(b, 'survey meteorite_detector x:30 z:30');
    expect(tickUntilReadings(a)[0]!.reading).toEqual(tickUntilReadings(b)[0]!.reading);
  });

  it('two readings from two spots both hold the crater and have their own origin', () => {
    const game = sandbox({ grade: 3, skill: 3 });
    run(game, 'survey meteorite_detector x:20 z:20');
    run(game, 'survey meteorite_detector x:50 z:10');
    const results = tickUntilReadings(game, 2);
    expect(results).toHaveLength(2);
    const crater = craterOf(game);
    for (const r of results) {
      const reading = r.reading!;
      expect(angleGap(reading.bearing, Math.atan2(crater.z - r.centerZ, crater.x - r.centerX))).toBeLessThanOrEqual(reading.halfAngle + 1e-9);
      const d = Math.hypot(crater.x - r.centerX, crater.z - r.centerZ);
      expect(reading.minDistance).toBeLessThanOrEqual(d);
      expect(reading.maxDistance).toBeGreaterThanOrEqual(d);
    }
    expect(new Set(results.map(r => `${r.centerX},${r.centerZ}`)).size).toBe(2);
  });

  it('holds on other worlds: each seed points at its own crater', () => {
    for (const seed of [7, 1]) {
      const game = sandbox({ grade: 3, skill: 5, seed });
      run(game, 'survey meteorite_detector x:30 z:30');
      const reading = tickUntilReadings(game)[0]!.reading!;
      const crater = craterOf(game);
      expect(angleGap(reading.bearing, Math.atan2(crater.z - 30, crater.x - 30)), `seed ${seed}`).toBeLessThanOrEqual(reading.halfAngle + 1e-9);
    }
  });

  it('a world with no crater stores the result with no reading', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32').success).toBe(true);
    expect(runner.run('meteorite_crater').output).toContain('none');
    ctx.state!.cash = 1_000_000;
    employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    const id = ctx.state!.employees.employees.slice(-1)[0]!.id;
    employeeCommand(ctx, ['assign_skill', String(id)], { skill: 'geology', level: '5' });
    expect(runner.run('survey meteorite_detector x:10 z:10').success).toBe(true);
    const game: Game = { runner, ctx };
    const [result] = tickUntilReadings(game);
    expect(result).toBeDefined();
    expect(result!.reading).toBeUndefined();
    expect(result!.estimates).toEqual({});
  });

  it('a blast-free tick stream never marks the result stale', () => {
    const game = sandbox({ grade: 3, skill: 5 });
    run(game, 'survey meteorite_detector x:30 z:30');
    const [result] = tickUntilReadings(game);
    run(game, 'tick 20');
    expect(result!.stale).toBeUndefined();
  });
});

describe('survey readings (#2291, C5)', () => {
  const result = (id: number, method: SurveyResult['method'], x: number, z: number, reading?: SurveyResult['reading']): SurveyResult => ({
    id, method, centerX: x, centerZ: z, completedTick: 0, surveyorId: 1, estimates: {}, confidence: 0.7,
    ...(reading ? { reading } : {}),
  });
  const bandLines = (out: string, band: string): string[] => out.split('\n').filter(l => l.includes(band));

  it('succeeds and lists no band when nothing was read', () => {
    const game = sandbox({ grade: 3 });
    const out = run(game, 'survey readings');
    expect(out.success, out.output).toBe(true);
    expect(out.output).not.toMatch(/\d+-\d+ m/);
  });

  it('prints one line per reading with its bearing in degrees and its band as "min-max m"', () => {
    const game = sandbox({ grade: 3 });
    game.ctx.state!.surveyResults.push(
      result(10, 'meteorite_detector', 30, 40, { bearing: 37 * DEG, halfAngle: 12 * DEG, minDistance: 410, maxDistance: 560 }),
      result(11, 'meteorite_detector', 150, -20, { bearing: 112 * DEG, halfAngle: 6 * DEG, minDistance: 250, maxDistance: 400 }),
    );
    const out = run(game, 'survey readings');
    expect(out.success, out.output).toBe(true);
    const first = bandLines(out.output, '410-560 m');
    const second = bandLines(out.output, '250-400 m');
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).toContain('37');
    expect(second[0]).toContain('112');
  });

  it('ignores results of other methods and results with no reading', () => {
    const game = sandbox({ grade: 3 });
    game.ctx.state!.surveyResults.push(
      result(10, 'seismic', 30, 40),
      result(11, 'meteorite_detector', 5, 5),
      result(12, 'meteorite_detector', 60, 70, { bearing: 37 * DEG, halfAngle: 12 * DEG, minDistance: 410, maxDistance: 560 }),
    );
    const out = run(game, 'survey readings').output;
    expect(out.match(/\d+-\d+ m/g)).toHaveLength(1);
    expect(bandLines(out, '410-560 m')).toHaveLength(1);
  });

  it('after a real reading, prints its line and never the crater position', () => {
    const game = sandbox({ grade: 3, skill: 5 });
    run(game, 'survey meteorite_detector x:30 z:30');
    const stored = tickUntilReadings(game)[0]!.reading!;
    const out = run(game, 'survey readings').output;
    const bands = out.match(/\d+-\d+ m/g) ?? [];
    expect(bands).toHaveLength(1);
    expect(out).toContain(`${Math.round(stored.minDistance)}-${Math.round(stored.maxDistance)} m`);
    expect(out).not.toMatch(/\(-?\d+, -?\d+\)/);
    expect(out.toLowerCase()).not.toContain('radius');
  });

  it('fails with no game loaded', () => {
    const { runner } = createRunner();
    expect(runner.run('survey readings').success).toBe(false);
  });
});

describe('the crater stays a debug fact (#2291, C5)', () => {
  it('only the debug command prints the crater position', () => {
    const game = sandbox({ grade: 3, skill: 5 });
    run(game, 'survey meteorite_detector x:30 z:30');
    tickUntilReadings(game);
    const crater = craterOf(game);
    for (const line of ['survey readings', 'survey mode', 'survey show', 'state']) {
      const out = run(game, line).output;
      expect(out, line).not.toContain(`(${crater.x}, ${crater.z})`);
    }
  });
});
