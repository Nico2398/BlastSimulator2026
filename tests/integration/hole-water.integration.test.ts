// BlastSimulator2026 — Hole water through the real console runner and tick loop (#1350).
// Each drill hole carries a water state: rain fills untubed holes, wet porous
// ground seeps in, water fades slowly, tubing makes a hole watertight without
// removing water already in it, and `drain_hole` pays to empty one.

import { describe, it, expect, afterEach } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { SAVE_VERSION } from '../../src/core/state/GameState.js';
import { setLocale } from '../../src/core/i18n/I18n.js';
import { wetHoles } from '../../src/core/mining/WetHoles.js';
import {
  HOLE_DRAIN_COST_PER_HOLE,
  HOLE_DRAIN_POROSITY_LIMIT,
  HOLE_WET_THRESHOLD,
} from '../../src/core/config/balance.js';
import { firstEmptyLayerAboveGround } from '../../src/core/world/VoxelGrid.js';
import { getRock } from '../../src/core/world/RockCatalog.js';
import { createGame } from '../../src/core/state/GameState.js';
import { runTick } from '../../src/core/engine/TickPipeline.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { Random } from '../../src/core/math/Random.js';
import { TUBING_COST } from '../../src/core/mining/Tubing.js';

const GRID = 'drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:12,12';
const TIGHT = 0.03;
const POROUS = 0.35;

afterEach(() => setLocale('en'));

function drive(runner: ConsoleRunner, ctx: GameContext, done: () => boolean, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && !done(); i++) {
    for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
    runner.run('tick 1');
  }
}

function drilledGame() {
  const game = createRunner();
  game.runner.run('new_game seed:42 staffed:true');
  game.ctx.state!.events.eventFreqMultiplier = 0; // a pending event would halt `tick`; weather is under test
  game.runner.run(GRID);
  drive(game.runner, game.ctx, () => game.ctx.state!.plannedDrillHoles.length === 0);
  expect(game.ctx.state!.drillHoles.length).toBe(6);
  // Earlier drift ticks may have rained on the fresh holes: start from dry.
  game.ctx.state!.holeWater = {};
  game.ctx.state!.groundWetness = 0;
  return game;
}

/** Pin `weather` and tick `n` times (weather set gives a fresh duration, but re-pin each tick to be safe). */
function weatherTicks(game: ReturnType<typeof drilledGame>, weather: string, n: number): void {
  for (let i = 0; i < n; i++) {
    for (const emp of game.ctx.state!.employees.employees) emp.fatigue = 100;
    game.runner.run(`weather set ${weather}`);
    game.runner.run('tick 1');
  }
}

function holeIds(game: ReturnType<typeof drilledGame>): string[] {
  return game.ctx.state!.drillHoles.map(h => h.id);
}

/** Wet every hole directly and give them the stated porosity (what the rock would do over a storm). */
function floodHoles(game: ReturnType<typeof drilledGame>, porosity: number, ids = holeIds(game)): void {
  for (const id of ids) game.ctx.state!.holeWater[id] = { level: 0.9, porosity };
}

describe('hole water over time (#1350)', () => {
  it('holes stay dry in sunny weather', () => {
    const game = drilledGame();
    weatherTicks(game, 'sunny', 15);
    expect(wetHoles(game.ctx.state!)).toEqual([]);
  });

  it('a storm wets every untubed hole within a few ticks', () => {
    const game = drilledGame();
    weatherTicks(game, 'storm', 3);
    expect(wetHoles(game.ctx.state!).sort()).toEqual(holeIds(game).sort());
  });

  it('light rain wets a hole more slowly than a storm', () => {
    const light = drilledGame();
    const storm = drilledGame();
    weatherTicks(light, 'light_rain', 2);
    weatherTicks(storm, 'storm', 2);
    const id = holeIds(light)[0]!;
    expect(light.ctx.state!.holeWater[id]!.level).toBeLessThan(storm.ctx.state!.holeWater[id]!.level);
  });

  it('holes drilled before a storm are still wet right after it ends, unless tubed', () => {
    const game = drilledGame();
    const ids = holeIds(game);
    const tubed = ids.slice(0, 2);
    expect(game.runner.run(`buy amount:${tubed.length}`).success).toBe(true);
    for (const id of tubed) expect(game.runner.run(`install_tubing hole:${id}`).success).toBe(true);

    weatherTicks(game, 'storm', 4);
    weatherTicks(game, 'sunny', 1); // the rain has stopped

    const wet = new Set(wetHoles(game.ctx.state!));
    for (const id of tubed) expect(wet.has(id)).toBe(false);
    for (const id of ids.filter(i => !tubed.includes(i))) expect(wet.has(id)).toBe(true);
  });

  it('waiting out the rain is not instant: water lingers, then fades to dry', () => {
    const game = drilledGame();
    weatherTicks(game, 'storm', 4);
    weatherTicks(game, 'sunny', 1);
    expect(wetHoles(game.ctx.state!).length).toBe(6);
    weatherTicks(game, 'sunny', 150);
    expect(wetHoles(game.ctx.state!)).toEqual([]);
  });

  it('tubing installed on an already-wet hole keeps its water (no fill, no fade)', () => {
    const game = drilledGame();
    const id = holeIds(game)[0]!;
    weatherTicks(game, 'storm', 3);
    const level = game.ctx.state!.holeWater[id]!.level;
    expect(level).toBeGreaterThan(HOLE_WET_THRESHOLD);
    game.runner.run('buy amount:1');
    expect(game.runner.run(`install_tubing hole:${id}`).success).toBe(true);
    weatherTicks(game, 'storm', 5);
    weatherTicks(game, 'sunny', 60);
    expect(game.ctx.state!.holeWater[id]!.level).toBe(level);
    expect(wetHoles(game.ctx.state!)).toContain(id);
  });

  it('tubing can be bought and installed with no rain at all', () => {
    const game = drilledGame();
    game.runner.run('weather set sunny');
    const id = holeIds(game)[0]!;
    const cash = game.ctx.state!.cash;
    expect(game.runner.run('buy amount:1').success).toBe(true);
    expect(game.runner.run(`install_tubing hole:${id}`).success).toBe(true);
    expect(game.ctx.state!.cash).toBe(cash - TUBING_COST);
    expect(game.ctx.state!.tubingState.installedHoles.has(id)).toBe(true);
  });

  it('a tubed hole stays dry through a storm while its untubed neighbour floods', () => {
    const game = drilledGame();
    const [a, b] = holeIds(game) as [string, string];
    game.runner.run('buy amount:1');
    game.runner.run(`install_tubing hole:${a}`);
    weatherTicks(game, 'storm', 8);
    const wet = wetHoles(game.ctx.state!);
    expect(wet).toContain(b);
    expect(wet).not.toContain(a);
  });

  it('ground wetness builds in rain and persists after the hole entries are gone', () => {
    const game = drilledGame();
    weatherTicks(game, 'storm', 6);
    expect(game.ctx.state!.groundWetness).toBeGreaterThan(0);
  });
});

describe('drain_hole console command (#1350)', () => {
  it('drains a wet hole: level 0, cash down by the drain cost, expense logged', () => {
    const game = drilledGame();
    const id = holeIds(game)[0]!;
    floodHoles(game, TIGHT, [id]);
    const state = game.ctx.state!;
    const cash = state.cash;
    const txs = state.finances.transactions.length;

    const res = game.runner.run(`drain_hole hole:${id}`);

    expect(res.success).toBe(true);
    expect(state.holeWater[id]!.level).toBe(0);
    expect(state.cash).toBe(cash - HOLE_DRAIN_COST_PER_HOLE);
    expect(state.finances.transactions.length).toBe(txs + 1);
    const last = state.finances.transactions[state.finances.transactions.length - 1]!;
    expect(last.type).toBe('expense');
    expect(last.amount).toBe(HOLE_DRAIN_COST_PER_HOLE);
  });

  it('refuses a dry hole with a localized reason and no charge', () => {
    const game = drilledGame();
    const id = holeIds(game)[0]!;
    const cash = game.ctx.state!.cash;

    const en = game.runner.run(`drain_hole hole:${id}`);
    expect(en.success).toBe(false);
    expect(en.output.length).toBeGreaterThan(0);
    expect(en.output).not.toMatch(/mining\.drain\./);
    expect(game.ctx.state!.cash).toBe(cash);

    setLocale('fr');
    const fr = game.runner.run(`drain_hole hole:${id}`);
    expect(fr.success).toBe(false);
    expect(fr.output).not.toMatch(/mining\.drain\./);
    expect(fr.output).not.toBe(en.output);
  });

  it('refuses an untubed hole in porous rock, with no cash change', () => {
    const game = drilledGame();
    const id = holeIds(game)[0]!;
    floodHoles(game, HOLE_DRAIN_POROSITY_LIMIT + 0.1, [id]);
    const cash = game.ctx.state!.cash;

    const res = game.runner.run(`drain_hole hole:${id}`);

    expect(res.success).toBe(false);
    expect(res.output).not.toMatch(/mining\.drain\./);
    expect(game.ctx.state!.cash).toBe(cash);
    expect(game.ctx.state!.holeWater[id]!.level).toBe(0.9);
  });

  it('drains a tubed porous hole', () => {
    const game = drilledGame();
    const id = holeIds(game)[0]!;
    floodHoles(game, POROUS, [id]);
    game.runner.run('buy amount:1');
    game.runner.run(`install_tubing hole:${id}`);

    const res = game.runner.run(`drain_hole hole:${id}`);

    expect(res.success).toBe(true);
    expect(game.ctx.state!.holeWater[id]!.level).toBe(0);
  });

  it('hole:* drains every wet drainable hole and charges per drained hole', () => {
    const game = drilledGame();
    floodHoles(game, TIGHT);
    const cash = game.ctx.state!.cash;

    const res = game.runner.run('drain_hole hole:*');

    expect(res.success).toBe(true);
    expect(wetHoles(game.ctx.state!)).toEqual([]);
    expect(game.ctx.state!.cash).toBe(cash - 6 * HOLE_DRAIN_COST_PER_HOLE);
  });

  it('hole:* with some holes blocked is a partial success and reports the blocked ones', () => {
    const game = drilledGame();
    const ids = holeIds(game);
    floodHoles(game, TIGHT, ids.slice(0, 4));
    floodHoles(game, POROUS, ids.slice(4)); // porous and untubed: blocked
    const cash = game.ctx.state!.cash;

    const res = game.runner.run('drain_hole hole:*');

    expect(res.success).toBe(true);
    expect(game.ctx.state!.cash).toBe(cash - 4 * HOLE_DRAIN_COST_PER_HOLE);
    const stillWet = wetHoles(game.ctx.state!).sort();
    expect(stillWet).toEqual(ids.slice(4).sort());
    for (const id of ids.slice(4)) expect(res.output).toContain(id);
  });

  it('hole:* with nothing wet is refused and charges nothing', () => {
    const game = drilledGame();
    const cash = game.ctx.state!.cash;
    const res = game.runner.run('drain_hole hole:*');
    expect(res.success).toBe(false);
    expect(game.ctx.state!.cash).toBe(cash);
  });

  it('refuses when cash is short and leaves state unchanged', () => {
    const game = drilledGame();
    const id = holeIds(game)[0]!;
    floodHoles(game, TIGHT, [id]);
    game.ctx.state!.cash = HOLE_DRAIN_COST_PER_HOLE - 1;
    const txs = game.ctx.state!.finances.transactions.length;

    const res = game.runner.run(`drain_hole hole:${id}`);

    expect(res.success).toBe(false);
    expect(game.ctx.state!.cash).toBe(HOLE_DRAIN_COST_PER_HOLE - 1);
    expect(game.ctx.state!.holeWater[id]!.level).toBe(0.9);
    expect(game.ctx.state!.finances.transactions.length).toBe(txs);
  });

  it('refuses an unknown hole', () => {
    const game = drilledGame();
    const cash = game.ctx.state!.cash;
    const res = game.runner.run('drain_hole hole:nope');
    expect(res.success).toBe(false);
    expect(game.ctx.state!.cash).toBe(cash);
  });

  it('refuses a call without a hole argument', () => {
    const game = drilledGame();
    expect(game.runner.run('drain_hole').success).toBe(false);
  });

  it('a drained untubed tight hole refloods in the rain', () => {
    const game = drilledGame();
    const id = holeIds(game)[0]!;
    floodHoles(game, TIGHT, [id]);
    expect(game.runner.run(`drain_hole hole:${id}`).success).toBe(true);
    expect(wetHoles(game.ctx.state!)).not.toContain(id);

    weatherTicks(game, 'storm', 3);

    expect(wetHoles(game.ctx.state!)).toContain(id);
  });
});

describe('hole water lifecycle (#1350)', () => {
  it('drill_plan remove drops that hole water entry only', () => {
    const game = drilledGame();
    const [a, b] = holeIds(game) as [string, string];
    floodHoles(game, TIGHT);
    expect(game.runner.run(`drill_plan remove hole:${a}`).success).toBe(true);
    expect(game.ctx.state!.holeWater[a]).toBeUndefined();
    expect(game.ctx.state!.holeWater[b]).toBeDefined();
  });

  it('drill_plan clear drops every hole water entry but keeps ground wetness', () => {
    const game = drilledGame();
    floodHoles(game, TIGHT);
    game.ctx.state!.groundWetness = 0.8;
    expect(game.runner.run('drill_plan clear').success).toBe(true);
    expect(game.ctx.state!.holeWater).toEqual({});
    expect(game.ctx.state!.groundWetness).toBe(0.8);
  });

  it('firing the blast drops hole water entries and keeps ground wetness', () => {
    const game = drilledGame();
    game.runner.run('charge hole:* explosive:krackle amount:8 stemming:2');
    drive(game.runner, game.ctx, () => Object.keys(game.ctx.state!.plannedChargesByHole).length === 0);
    floodHoles(game, TIGHT);
    game.ctx.state!.groundWetness = 0.6;

    expect(game.runner.run('blast').success).toBe(true);

    expect(game.ctx.state!.holeWater).toEqual({});
    expect(game.ctx.state!.groundWetness).toBeGreaterThan(0);
  });
});

describe('hole water in the blast (#1350)', () => {
  function chargedGame(explosive: string) {
    const game = drilledGame();
    game.runner.run(`charge hole:* explosive:${explosive} amount:8 stemming:2`);
    drive(game.runner, game.ctx, () => Object.keys(game.ctx.state!.plannedChargesByHole).length === 0);
    // Weather drifts while the crew charges: start the blast from dry holes.
    game.ctx.state!.holeWater = {};
    game.ctx.state!.groundWetness = 0;
    return game;
  }

  it('a wet water-sensitive hole fizzles; the report and the preview use the same wet set', () => {
    const game = chargedGame('boomite');
    game.ctx.state!.softwareTier = 3;
    floodHoles(game, TIGHT);
    const ids = Object.keys(game.ctx.state!.chargesByHole).sort();

    const preview = /(\d+) fractured/.exec(game.runner.run('preview fragments').output);
    expect(game.runner.run('blast').success).toBe(true);

    const report = game.ctx.state!.lastBlastReport!;
    expect(report.wetHoleIds).toEqual(ids);
    expect(report.fizzledHoleIds).toEqual(ids);
    expect(Number(preview![1])).toBe(report.clearedVoxels);
  });

  it('wet holes cost a water-sensitive blast rock compared with dry holes; krackle is unaffected', () => {
    const dryBoom = chargedGame('boomite');
    const wetBoom = chargedGame('boomite');
    floodHoles(wetBoom, TIGHT);
    dryBoom.runner.run('blast');
    wetBoom.runner.run('blast');
    expect(wetBoom.ctx.state!.lastBlastReport!.clearedVoxels)
      .toBeLessThan(dryBoom.ctx.state!.lastBlastReport!.clearedVoxels);

    const dryKrack = chargedGame('krackle');
    const wetKrack = chargedGame('krackle');
    floodHoles(wetKrack, TIGHT);
    dryKrack.runner.run('blast');
    wetKrack.runner.run('blast');
    expect(wetKrack.ctx.state!.lastBlastReport!.clearedVoxels)
      .toBe(dryKrack.ctx.state!.lastBlastReport!.clearedVoxels);
  });

  it('draining the wet holes before firing restores the dry result', () => {
    const dry = chargedGame('boomite');
    const drained = chargedGame('boomite');
    floodHoles(drained, TIGHT);
    expect(drained.runner.run('drain_hole hole:*').success).toBe(true);
    dry.runner.run('blast');
    drained.runner.run('blast');
    expect(drained.ctx.state!.lastBlastReport!.clearedVoxels)
      .toBe(dry.ctx.state!.lastBlastReport!.clearedVoxels);
  });
});

describe('hole water persistence (#1350)', () => {
  it('SAVE_VERSION is 34', () => {
    expect(SAVE_VERSION).toBe(34);
  });

  it('save/load round-trips holeWater and groundWetness', () => {
    const game = drilledGame();
    const [a, b] = holeIds(game) as [string, string];
    game.ctx.state!.holeWater[a] = { level: 0.42, porosity: 0.12 };
    game.ctx.state!.holeWater[b] = { level: 0.8, porosity: 0.3 };
    game.ctx.state!.groundWetness = 0.55;

    const loaded = deserialize(serialize(game.ctx.state!));

    expect(loaded.holeWater).toEqual(game.ctx.state!.holeWater);
    expect(loaded.groundWetness).toBe(0.55);
    expect(wetHoles(loaded)).toEqual(wetHoles(game.ctx.state!));
  });

  it('a v31 save without hole water migrates to empty water and dry ground', () => {
    const game = drilledGame();
    const parsed = JSON.parse(serialize(game.ctx.state!)) as Record<string, unknown>;
    parsed['version'] = 31;
    delete parsed['holeWater'];
    delete parsed['groundWetness'];

    const loaded = deserialize(JSON.stringify(parsed));

    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.holeWater).toEqual({});
    expect(loaded.groundWetness).toBe(0);
    expect(wetHoles(loaded)).toEqual([]);
  });

  it('a fresh game has no hole water and dry ground', () => {
    const { runner, ctx } = createRunner();
    runner.run('new_game seed:42');
    expect(ctx.state!.holeWater).toEqual({});
    expect(ctx.state!.groundWetness).toBe(0);
  });
});

describe('hole water porosity from the rock under the hole (#1350)', () => {
  /** Replace every solid voxel in the hole's column with pure `rockId`. */
  function setRockUnderHole(game: ReturnType<typeof drilledGame>, holeId: string, rockId: string): void {
    const grid = game.ctx.grid!;
    const hole = game.ctx.state!.drillHoles.find(h => h.id === holeId)!;
    const x = Math.floor(hole.x);
    const z = Math.floor(hole.z);
    const top = firstEmptyLayerAboveGround(grid, x, z);
    for (let y = top - hole.depth; y < top; y++) {
      const v = grid.getVoxel(x, y, z);
      if (!v || v.density === 0) continue;
      grid.setVoxel(x, y, z, { ...v, composition: { rocks: [{ rockId, coefficient: 1 }] } });
    }
  }

  const POROUS_ROCK = 'cruite';
  const TIGHT_ROCK = 'absurdite';

  it('the chosen rocks straddle the drain porosity limit', () => {
    expect(getRock(POROUS_ROCK)!.porosity).toBeGreaterThanOrEqual(HOLE_DRAIN_POROSITY_LIMIT);
    expect(getRock(TIGHT_ROCK)!.porosity).toBeLessThan(HOLE_DRAIN_POROSITY_LIMIT);
  });

  it('holes read the porosity of their rock, stay wet longer when porous, and tubed ones stay put', () => {
    const game = drilledGame();
    const [porous, tight, tubedPorous] = holeIds(game) as [string, string, string];
    setRockUnderHole(game, porous, POROUS_ROCK);
    setRockUnderHole(game, tubedPorous, POROUS_ROCK);
    setRockUnderHole(game, tight, TIGHT_ROCK);

    weatherTicks(game, 'storm', 4);
    const state = game.ctx.state!;
    expect(state.holeWater[porous]!.porosity).toBe(getRock(POROUS_ROCK)!.porosity);
    expect(state.holeWater[tight]!.porosity).toBe(getRock(TIGHT_ROCK)!.porosity);

    game.runner.run('buy amount:1');
    expect(game.runner.run(`install_tubing hole:${tubedPorous}`).success).toBe(true);
    const tubedLevel = state.holeWater[tubedPorous]!.level;

    weatherTicks(game, 'sunny', 6);

    expect(state.holeWater[porous]!.level).toBeGreaterThan(state.holeWater[tight]!.level);
    expect(state.holeWater[tubedPorous]!.level).toBe(tubedLevel);
  });

  it('without a grid the porosity falls back to 0', () => {
    const state = createGame({ seed: 7 });
    state.events.eventFreqMultiplier = 0;
    state.drillHoles.push({ id: 'h1', x: 12, z: 12, depth: 8, diameter: 0.089 });
    runTick(state, null, new Random(7), new EventEmitter(), { checkInvariants: false });
    expect(state.holeWater['h1']!.porosity).toBe(0);
  });
});
