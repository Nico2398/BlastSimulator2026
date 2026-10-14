// Sandbox mode — through the real console runner and game loop
//
// #504: `sandbox start` collapsed to biome/difficulty/seed. Grid extents are
// fixed (64x64, datum SANDBOX_DATUM) and starting cash comes from the named
// difficulty.

import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { parseSandboxArgs } from '../../src/console/commands/sandbox.js';
import { SANDBOX_DEFAULTS, SANDBOX_DIFFICULTIES } from '../../src/core/campaign/Sandbox.js';
import { BANKRUPTCY_GRACE_TICKS, DEFAULT_GRID_SIZE, SANDBOX_DATUM, STARTING_SITE_STAFFED_COMPOSITION } from '../../src/core/config/balance.js';
import { addIncome } from '../../src/core/economy/Finance.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import type { Employee } from '../../src/core/entities/Employee.js';
import type { Vehicle } from '../../src/core/entities/Vehicle.js';
import { vehicleDriverId } from '../../src/core/entities/Vehicle.js';
import { stateForSave, loadGridForState } from '../../src/console/commands/world.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { getBiome } from '../../src/core/world/BiomeCatalog.js';
import { resolveGeneratedBiome } from '../../src/core/world/TerrainGen.js';
import { resolveContractOres } from '../../src/core/campaign/Level.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { FORBIDDEN_COMMAND, playContracts, playTick, tickUntil, clearBlastZone, type Run } from '../helpers/playthrough.js';

/**
 * Solid-voxel count inside a fixed height window around the sandbox datum — a
 * cheap fingerprint of a generated map. Rock continues to every depth, so a
 * whole-column count has no end; the window is fixed rather than derived from
 * the terrain so a carve inside it lowers the count.
 */
function solidCount(grid: VoxelGrid): number {
  let n = 0;
  grid.forEachSolidInRegion(
    { x: grid.minX, y: SANDBOX_DATUM - 32, z: grid.minZ },
    { x: grid.maxX - 1, y: SANDBOX_DATUM + 64, z: grid.maxZ - 1 },
    () => { n++; },
  );
  return n;
}

describe('sandbox mode', () => {
  let runner: ConsoleRunner;
  let ctx: GameContext;

  beforeEach(() => {
    const made = createRunner();
    runner = made.runner;
    ctx = made.ctx;
  });

  it('starts a site from nothing — no new_game needed first', () => {
    const result = runner.run('sandbox start biome:alpine_granite difficulty:hard seed:777');
    expect(result.success).toBe(true);
    expect(ctx.state).toBeTruthy();
    expect(ctx.grid).toBeTruthy();
    expect(ctx.state!.world).toMatchObject({
      sizeX: DEFAULT_GRID_SIZE, datum: SANDBOX_DATUM, sizeZ: DEFAULT_GRID_SIZE,
    });
  });

  it.each(['easy', 'normal', 'hard'] as const)(
    'difficulty:%s produces the documented starting cash',
    (difficulty) => {
      runner.run(`sandbox start biome:desert_badlands difficulty:${difficulty} seed:1`);
      expect(ctx.state!.cash).toBe(SANDBOX_DIFFICULTIES[difficulty].startingCash);
    },
  );

  it('rejects an unknown difficulty, naming the valid ids', () => {
    const result = runner.run('sandbox start difficulty:legendary');
    expect(result.success).toBe(false);
    expect(result.output).toContain('easy');
    expect(result.output).toContain('normal');
    expect(result.output).toContain('hard');
  });

  it('rejects difficulty:constructor rather than resolving it to Object.prototype.constructor (#504 prototype pollution)', () => {
    const result = runner.run('sandbox start biome:desert_badlands difficulty:constructor seed:1');
    expect(result.success).toBe(false);
    expect(result.output).toContain('easy');
    expect(result.output).toContain('normal');
    expect(result.output).toContain('hard');
  });

  it('rejects an unknown biome instead of silently substituting one', () => {
    const result = runner.run('sandbox start biome:atlantis');
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown biome');
  });

  it('seed:random produces a playable site', () => {
    const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:random');
    expect(result.success).toBe(true);
    expect(ctx.grid).toBeTruthy();
    expect(solidCount(ctx.grid!)).toBeGreaterThan(0);
  });

  it('rebuilds an identical map from the same seed and biome', () => {
    const args = 'sandbox start biome:green_foothills difficulty:normal seed:2024';
    runner.run(args);
    const first = solidCount(ctx.grid!);

    const second = createRunner();
    second.runner.run(args);
    expect(solidCount(second.ctx.grid!)).toBe(first);
    expect(second.ctx.grid!.sizeX).toBe(ctx.grid!.sizeX);
  });

  it('produces a different map for a different seed', () => {
    runner.run('sandbox start biome:green_foothills difficulty:normal seed:1');
    const a = solidCount(ctx.grid!);

    const other = createRunner();
    other.runner.run('sandbox start biome:green_foothills difficulty:normal seed:99999');
    expect(solidCount(other.ctx.grid!)).not.toBe(a);
  });

  it('starts a playable alpine_granite hard-difficulty site', () => {
    const result = runner.run('sandbox start biome:alpine_granite difficulty:hard seed:777');
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(SANDBOX_DIFFICULTIES.hard.startingCash);
    expect(ctx.state!.world).toMatchObject({
      sizeX: DEFAULT_GRID_SIZE, datum: SANDBOX_DATUM, sizeZ: DEFAULT_GRID_SIZE,
    });
  });

  it('grid extent stays fixed at 64x64 (datum SANDBOX_DATUM) regardless of a removed arg like size:', () => {
    const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:5 size:48');
    expect(result.success).toBe(true);
    expect(ctx.state!.world).toMatchObject({
      sizeX: DEFAULT_GRID_SIZE, datum: SANDBOX_DATUM, sizeZ: DEFAULT_GRID_SIZE,
    });
  });

  it('is playable: a blast on a sandbox site removes rock', () => {
    // Staffed (#553): drill_plan grid now queues one drill_hole PendingAction
    // per hole instead of writing them straight into state.drillHoles — a
    // 'blasting'-qualified employee and a drill_rig vehicle are needed for
    // any hole to actually land, same composition drill-plan-queueing.test.ts
    // uses for `new_game ... staffed:true`.
    // Staffed explicitly: this test pins the global composition, not the level kit.
    runner.run('sandbox start biome:desert_badlands difficulty:easy seed:42 staffed:true');
    const before = solidCount(ctx.grid!);

    runner.run('drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:20,20');
    for (let i = 0; i < 400 && ctx.state!.plannedDrillHoles.length > 0; i++) {
      // Tops up needs each tick — a solo multi-hole drive can otherwise run
      // long enough to trip an unrelated needs collapse mid-task (out of
      // scope for this test).
      for (const emp of ctx.state!.employees.employees) {
        emp.fatigue = 100;
      }
      runner.run('tick 1');
    }
    runner.run('charge hole:* explosive:boomite amount:5 stemming:2');
    // #554: charging is real work too — drain the ordered charges the same
    // way the drill plan above was drained before blasting.
    for (let i = 0; i < 400 && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.fatigue = 100;
      }
      runner.run('tick 1');
    }
    const blast = runner.run('blast');

    expect(blast.success).toBe(true);
    expect(solidCount(ctx.grid!)).toBeLessThan(before);
  });

  it('generates contracts so the economy is live from the first tick', () => {
    runner.run('sandbox start biome:desert_badlands difficulty:normal seed:5');
    expect(ctx.state!.contracts.available.length).toBeGreaterThan(0);
  });

  describe('staffed option', () => {
    /** Greedily matches each composition employee slot to a distinct hired employee. */
    function assertEmployeesMatchComposition(employees: Employee[]): void {
      expect(employees.length).toBe(STARTING_SITE_STAFFED_COMPOSITION.employees.length);
      const remaining = [...employees];
      for (const slot of STARTING_SITE_STAFFED_COMPOSITION.employees) {
        const idx = remaining.findIndex(e =>
          e.role === slot.role &&
          slot.qualifications.every(q =>
            e.qualifications.some(eq => eq.category === q.category && eq.proficiencyLevel === q.proficiencyLevel),
          ),
        );
        expect(idx, `no unmatched employee for slot ${JSON.stringify(slot)}`).toBeGreaterThanOrEqual(0);
        remaining.splice(idx, 1);
      }
    }

    /** Greedily matches each composition vehicle slot to a distinct purchased, idle, unmanned vehicle. */
    function assertVehiclesMatchComposition(vehicles: Vehicle[]): void {
      expect(vehicles.length).toBe(STARTING_SITE_STAFFED_COMPOSITION.vehicles.length);
      const remaining = [...vehicles];
      for (const slot of STARTING_SITE_STAFFED_COMPOSITION.vehicles) {
        const idx = remaining.findIndex(v =>
          v.type === slot.role && v.tier === slot.tier && vehicleDriverId(v) === null,
        );
        expect(idx, `no unmatched vehicle for slot ${JSON.stringify(slot)}`).toBeGreaterThanOrEqual(0);
        remaining.splice(idx, 1);
      }
    }

    it.each(['easy', 'normal', 'hard'] as const)(
      'defaults to the %s level kit: crew, fleet and buildings placed, cash untouched (#1671)',
      (difficulty) => {
        const result = runner.run(`sandbox start biome:desert_badlands difficulty:${difficulty} seed:42`);
        expect(result.success).toBe(true);
        const site = SANDBOX_DIFFICULTIES[difficulty].startingSite;
        const st = ctx.state!;
        expect(site.employees.length).toBeGreaterThan(0);
        expect(st.employees.employees.length).toBe(site.employees.length);
        expect(st.vehicles.vehicles.length).toBe(site.vehicles.length);
        expect(st.buildings.buildings.length).toBe(site.buildings.length);
        for (const slot of site.buildings) {
          expect(st.buildings.buildings.some(b => b.type === slot.type && b.tier === slot.tier && b.active), `${slot.type} placed`).toBe(true);
        }
        for (const slot of site.vehicles) {
          expect(st.vehicles.vehicles.some(v => v.type === slot.role && v.tier === slot.tier), `${slot.role} owned`).toBe(true);
        }
        expect(st.cash).toBe(SANDBOX_DIFFICULTIES[difficulty].startingCash);
      },
    );

    it('default start places a freight warehouse and a spoil heap on the grid', () => {
      runner.run('sandbox start biome:desert_badlands difficulty:hard seed:42');
      const types = ctx.state!.buildings.buildings.map(b => b.type);
      expect(types).toContain('freight_warehouse');
      expect(types).toContain('spoil_heap');
    });

    it('staffed:false opens a bare site: no crew, fleet or buildings (#1671)', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:false');
      expect(result.success).toBe(true);
      expect(ctx.state!.employees.employees.length).toBe(0);
      expect(ctx.state!.vehicles.vehicles.length).toBe(0);
      expect(ctx.state!.buildings.buildings.length).toBe(0);
      expect(ctx.state!.cash).toBe(SANDBOX_DIFFICULTIES.normal.startingCash);
    });

    it('staffed:true places the global composition and no buildings, whatever the difficulty (#1671)', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:hard seed:42 staffed:true');
      expect(result.success).toBe(true);
      assertEmployeesMatchComposition(ctx.state!.employees.employees);
      assertVehiclesMatchComposition(ctx.state!.vehicles.vehicles);
      expect(ctx.state!.buildings.buildings.length).toBe(0);
    });

    it('staffed:true hires and equips the STARTING_SITE_STAFFED_COMPOSITION roster and fleet', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:true');
      expect(result.success).toBe(true);
      assertEmployeesMatchComposition(ctx.state!.employees.employees);
      assertVehiclesMatchComposition(ctx.state!.vehicles.vehicles);
    });

    it('staffed:true opens with a tier-1 charging truck and an employee holding blasting and driving.truck (#1648)', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:true');
      expect(result.success).toBe(true);
      const st = ctx.state!;
      expect(st.vehicles.vehicles.filter(v => v.type === 'charging_truck' && v.tier === 1)).toHaveLength(1);
      expect(st.employees.employees.some(e => {
        const cats = e.qualifications.map(q => q.category);
        return cats.includes('blasting') && cats.includes('driving.truck');
      })).toBe(true);
    });

    it('staffed:false has no charging truck and no crew (#1648)', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:false');
      expect(result.success).toBe(true);
      expect(ctx.state!.vehicles.vehicles.some(v => v.type === 'charging_truck')).toBe(false);
      expect(ctx.state!.employees.employees.length).toBe(0);
    });

    it('staffed:true leaves starting cash unaffected — same as an unstaffed run with identical params', () => {
      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:true');
      expect(result.success).toBe(true);
      expect(ctx.state!.cash).toBe(SANDBOX_DIFFICULTIES.normal.startingCash);
    });

    it('rejects staffed:banana, leaving any existing game state untouched', () => {
      runner.run('sandbox start biome:desert_badlands difficulty:normal seed:7');
      const before = ctx.state;

      const result = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42 staffed:banana');

      expect(result.success).toBe(false);
      expect(result.output).toContain('Invalid staffed value');
      expect(ctx.state).toBe(before);
    });
  });
});

// #1671: each difficulty reaches its first sale from the free kit alone.
const CYCLE_TICK_CAP = 4000;
const CYCLE_BUY_OR_HIRE = /^(employee hire|vehicle buy|vehicle purchase|build |hire |purchase )/;

describe.each(['easy', 'normal', 'hard'] as const)('sandbox first blast to first sale on %s (#1671)', (difficulty) => {
  it('drills, charges, fires, hauls and fills an ore contract with no buying or hiring, and stays solvent', () => {
    const { runner, ctx } = createRunner();
    const commands: string[] = [];
    const run: Run = (cmd) => { commands.push(cmd); return runner.run(cmd); };

    expect(run(`sandbox start biome:desert_badlands seed:42 difficulty:${difficulty}`).success).toBe(true);
    run('time resume');
    const state = ctx.state!;
    expect(state.employees.employees.length, 'the level opens staffed').toBeGreaterThan(0);
    const rig = state.vehicles.vehicles.find(v => v.type === 'drill_rig');
    expect(rig, 'the level opens with a drill rig').toBeDefined();

    const start = state.tickCount;
    const over = () => state.levelEnded || state.tickCount - start >= CYCLE_TICK_CAP;
    const sold = () => state.contracts.completedHistory.some(c => c.type === 'ore_sale' && c.completed);

    let shot = 0;
    while (!over() && !sold() && shot < 6) {
      const x = Math.round(rig!.x) + 14;
      const z = Math.round(rig!.z) + 13 + shot * 10;
      shot++;
      if (!run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${x},${z}`).success) continue;
      tickUntil(run, state, 800, () => over() || state.plannedDrillHoles.length === 0);
      run('charge hole:* explosive:boomite amount:5 stemming:2');
      tickUntil(run, state, 800, () => over() || Object.keys(state.plannedChargesByHole).length === 0);
      run('sequence auto');
      clearBlastZone(run, state);
      expect(run('blast').success).toBe(true);
      for (let i = 0; i < 400 && !over() && !sold(); i++) {
        playContracts(run, state);
        playTick(run, state);
      }
    }

    expect(state.levelEndReason, `ended ${String(state.levelEndReason)}`).not.toBe('bankruptcy');
    expect(sold(), 'an ore contract was filled').toBe(true);
    expect(state.cash).toBeGreaterThan(0);
    expect(commands.filter(c => CYCLE_BUY_OR_HIRE.test(c))).toEqual([]);
    expect(commands.filter(c => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 600_000);
});

describe('parseSandboxArgs', () => {
  it('leaves unmentioned keys alone so defaults survive', () => {
    expect(parseSandboxArgs({ biome: 'alpine_granite' })).toEqual({ biome: 'alpine_granite' });
  });

  it('returns an empty partial for an empty named-args object', () => {
    expect(parseSandboxArgs({})).toEqual({});
  });

  it('reads seed:random as a fresh seed in range', () => {
    const parsed = parseSandboxArgs({ seed: 'random' });
    expect(parsed.seed).toBeGreaterThanOrEqual(0);
    expect(parsed.seed).toBeLessThanOrEqual(999999);
  });

  it('ignores a non-numeric seed value rather than yielding NaN', () => {
    expect(parseSandboxArgs({ seed: 'huge' })).toEqual({});
  });

  it('parses the full biome/difficulty/seed set the UI would emit', () => {
    const parsed = parseSandboxArgs({ biome: 'volcanic_flats', difficulty: 'hard', seed: '4242' });
    expect(parsed).toEqual({ biome: 'volcanic_flats', difficulty: 'hard', seed: 4242 });
    expect(Object.keys(SANDBOX_DEFAULTS)).toEqual(expect.arrayContaining(Object.keys(parsed)));
  });

  it('no longer recognizes removed keys like size/depth/cash/mixed_rock', () => {
    const parsed = parseSandboxArgs({ size: '48', depth: '24', cash: '250000', mixed_rock: 'true' });
    expect(parsed).toEqual({});
  });
});

describe('sandbox mode vs the campaign profile (#1312)', () => {
  it('leaves a progressed profile deep-equal untouched', () => {
    const { runner, ctx } = createRunner();
    ctx.campaignProfile.campaign.levels['dusty_hollow']!.completed = true;
    ctx.campaignProfile.campaign.levels['dusty_hollow']!.cumulativeProfit = 90000;
    ctx.campaignProfile.campaign.levels['grumpstone_ridge']!.unlocked = true;
    ctx.campaignProfile.bestStars['dusty_hollow'] = 2;
    const before = JSON.parse(JSON.stringify(ctx.campaignProfile));

    expect(runner.run('sandbox start biome:desert_badlands difficulty:normal seed:5').success).toBe(true);
    runner.run('tick 3');

    expect(ctx.campaignProfile).toEqual(before);
  });

  it('leaves a fresh profile untouched', () => {
    const { runner, ctx } = createRunner();
    const before = JSON.parse(JSON.stringify(ctx.campaignProfile));
    runner.run('sandbox start biome:desert_badlands difficulty:easy seed:5');
    expect(ctx.campaignProfile).toEqual(before);
  });

  it('gives the sandbox state a throwaway campaign that is not the profile object', () => {
    const { runner, ctx } = createRunner();
    runner.run('sandbox start biome:desert_badlands difficulty:easy seed:5');
    expect(ctx.state!.campaign).not.toBe(ctx.campaignProfile.campaign);
    expect(ctx.state!.campaign.activeLevelId).not.toBe('dusty_hollow');
  });

  it('mutating the sandbox campaign does not leak into the profile', () => {
    const { runner, ctx } = createRunner();
    runner.run('sandbox start biome:desert_badlands difficulty:easy seed:5');
    ctx.state!.campaign.levels['grumpstone_ridge']!.unlocked = true;
    expect(ctx.campaignProfile.campaign.levels['grumpstone_ridge']!.unlocked).toBe(false);
  });
});

describe('sandbox is endless free play (#1321)', () => {
  it('never wins on profit: net profit far above the old $100k target ends nothing', () => {
    const { runner, ctx } = createRunner();
    runner.run('sandbox start biome:desert_badlands difficulty:normal seed:5');
    addIncome(ctx.state!.finances, 500000, 'sales', 'test windfall', ctx.state!.tickCount);
    runner.run('tick 3');
    expect(ctx.state!.levelEndReason).toBeNull();
    expect(ctx.state!.levelEnded).toBe(false);
  });

  it('bankruptcy still ends a sandbox run', () => {
    const { runner, ctx } = createRunner();
    runner.run('sandbox start biome:desert_badlands difficulty:normal seed:5');
    ctx.state!.cash = 0;
    ctx.state!.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;
    runner.run('tick 1');
    expect(ctx.state!.levelEndReason).toBe('bankruptcy');
    expect(ctx.state!.levelEnded).toBe(true);
  });

  it('running sandbox start twice with identical args restarts the same configuration', () => {
    const { runner, ctx } = createRunner();
    const args = 'sandbox start biome:green_foothills difficulty:hard seed:2024';
    runner.run(args);
    const first = { seed: ctx.state!.seed, cash: ctx.state!.cash, solid: solidCount(ctx.grid!) };
    runner.run('tick 5');
    runner.run(args);
    expect({ seed: ctx.state!.seed, cash: ctx.state!.cash, solid: solidCount(ctx.grid!) }).toEqual(first);
    expect(ctx.state!.tickCount).toBe(0);
    expect(ctx.state!.levelEndReason).toBeNull();
  });
});

// #1668: a sandbox site generates the biome the player picked, on every seed.
describe('sandbox generated biome equals the picked biome (#1668)', () => {
  const DESERT_ROCKS = ['cruite', 'sandite', 'molite'];
  const VOLCANIC_ROCKS = ['gnarlite', 'obstiite', 'titanite'];
  const DESERT_ORES = ['dirtite', 'rustite', 'blingite'];
  const WRONG_ORES = ['sparkium', 'craktonite'];

  /** Distinct dominant rock ids in a window of the grid, sampled on a coarse lattice. */
  function rocksIn(grid: VoxelGrid): Set<string> {
    const out = new Set<string>();
    for (let x = 0; x < grid.sizeX; x += 4) {
      for (let z = 0; z < grid.sizeZ; z += 4) {
        for (let y = SANDBOX_DATUM - 24; y <= SANDBOX_DATUM + 16; y += 2) {
          const id = grid.dominantRockAt(x, y, z);
          if (id) out.add(id);
        }
      }
    }
    return out;
  }

  /** Dominant rock of every sampled voxel, for cell-by-cell comparison of two grids. */
  function rockFingerprint(grid: VoxelGrid): string {
    const cells: string[] = [];
    for (let x = 0; x < grid.sizeX; x += 4) {
      for (let z = 0; z < grid.sizeZ; z += 4) {
        for (let y = SANDBOX_DATUM - 24; y <= SANDBOX_DATUM + 16; y += 2) cells.push(grid.dominantRockAt(x, y, z));
      }
    }
    return cells.join(',');
  }

  function start(args: string) {
    const made = createRunner();
    const result = made.runner.run(args);
    expect(result.success).toBe(true);
    return made;
  }

  it('desert_badlands seed 29 yields only desert rocks', () => {
    const { ctx } = start('sandbox start biome:desert_badlands difficulty:normal seed:29');
    const rocks = rocksIn(ctx.grid!);
    expect(rocks.size).toBeGreaterThan(0);
    for (const volcanic of VOLCANIC_ROCKS) expect(rocks.has(volcanic), `${volcanic} present`).toBe(false);
    expect([...rocks].some(r => DESERT_ROCKS.includes(r))).toBe(true);
    for (const r of rocks) expect(DESERT_ROCKS, `unexpected rock ${r}`).toContain(r);
  });

  it('desert_badlands seed 29 offers only desert ores on the contract board', () => {
    const { ctx } = start('sandbox start biome:desert_badlands difficulty:normal seed:29');
    const allowed = resolveContractOres(ctx.state!);
    for (const ore of WRONG_ORES) expect(allowed).not.toContain(ore);
    for (const ore of allowed) expect(DESERT_ORES).toContain(ore);
    const offered = ctx.state!.contracts.available.map(c => c.materialId).filter(id => id !== '');
    expect(offered.length).toBeGreaterThan(0);
    for (const ore of offered) expect(DESERT_ORES).toContain(ore);
  });

  it('starting the same site twice rebuilds identical voxels', () => {
    const a = start('sandbox start biome:desert_badlands difficulty:normal seed:29');
    const b = start('sandbox start biome:desert_badlands difficulty:normal seed:29');
    expect(solidCount(b.ctx.grid!)).toBe(solidCount(a.ctx.grid!));
    expect(rockFingerprint(b.ctx.grid!)).toBe(rockFingerprint(a.ctx.grid!));
  });

  it('persists the shifted climate bias on the world and embeds the same bias in a save', () => {
    const { ctx } = start('sandbox start biome:desert_badlands difficulty:normal seed:29');
    const centre = getBiome('desert_badlands')!.climateCenter;
    const bias = ctx.state!.world!.climateBias;
    expect(bias).toBeDefined();
    expect([...bias!]).not.toEqual([...centre]);
    const saved = stateForSave(ctx, ctx.state!);
    expect(saved.world!.voxels!.gen.climateBias).toEqual(bias);
  });

  it('does not store a climate bias for a seed that already lands on the picked biome', () => {
    const centre = getBiome('desert_badlands')!.climateCenter;
    let seed = 1;
    while (resolveGeneratedBiome(seed, DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE, centre).id !== 'desert_badlands') {
      seed++;
      if (seed > 500) throw new Error('no seed lands on desert_badlands with the biome centre');
    }
    // Precondition: the centre bias alone already resolves to the picked biome.
    expect(resolveGeneratedBiome(seed, DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE, centre).id).toBe('desert_badlands');
    const { ctx } = start(`sandbox start biome:desert_badlands difficulty:normal seed:${seed}`);
    expect(ctx.state!.world!.climateBias).toBeUndefined();
  });

  it('save then load keeps world.climateBias and regenerates the same terrain', () => {
    const live = start('sandbox start biome:desert_badlands difficulty:normal seed:29');
    const bias = live.ctx.state!.world!.climateBias;
    const loaded = createRunner().ctx;
    const state = deserialize(serialize(stateForSave(live.ctx, live.ctx.state!)));
    expect(loadGridForState(loaded, state)).toBeNull();
    expect(loaded.state!.world!.climateBias).toEqual(bias);
    expect(rockFingerprint(loaded.grid!)).toBe(rockFingerprint(live.ctx.grid!));
    expect(solidCount(loaded.grid!)).toBe(solidCount(live.ctx.grid!));
  });

  it('a save with no embedded voxels regenerates through the saved climate bias', () => {
    const live = start('sandbox start biome:desert_badlands difficulty:normal seed:29');
    const loaded = createRunner().ctx;
    const state = deserialize(serialize(live.ctx.state!)); // no world.voxels: the fallback path
    expect(state.world!.voxels).toBeUndefined();
    expect(loadGridForState(loaded, state)).toBeNull();
    expect(rockFingerprint(loaded.grid!)).toBe(rockFingerprint(live.ctx.grid!));
    for (const volcanic of VOLCANIC_ROCKS) expect(rocksIn(loaded.grid!).has(volcanic)).toBe(false);
  });

  it('a save without world.climateBias loads using the biome centre', () => {
    const live = start('sandbox start biome:desert_badlands difficulty:normal seed:29');
    const state = deserialize(serialize(live.ctx.state!));
    delete state.world!.climateBias;
    const loaded = createRunner().ctx;
    expect(loadGridForState(loaded, state)).toBeNull();

    // The un-shifted centre bias is the pre-#1668 behaviour: seed 29 drifts to volcanic rock.
    expect(VOLCANIC_ROCKS.some(r => rocksIn(loaded.grid!).has(r))).toBe(true);
    const centre = getBiome('desert_badlands')!.climateCenter;
    const gen = stateForSave(loaded, loaded.state!).world!.voxels!.gen;
    expect(gen.climateBias).toEqual([...centre]);
  });

  it('new_game biome:desert_badlands seed:29 is unchanged: centre bias, no stored climateBias', () => {
    const { ctx } = start('new_game mine_type:desert_badlands seed:29');
    expect(ctx.state!.world!.climateBias).toBeUndefined();
    const gen = stateForSave(ctx, ctx.state!).world!.voxels!.gen;
    expect(gen.climateBias).toEqual([...getBiome('desert_badlands')!.climateCenter]);
  });
});
