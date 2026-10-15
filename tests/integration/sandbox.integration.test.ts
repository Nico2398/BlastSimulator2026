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
import { computeVoxelColumnSurfaceY } from '../../src/core/world/VoxelGrid.js';
import { SANDBOX_PIT_MASK, SANDBOX_FLAT_PAD_SIZE, SURVEY_DEPTH_BELOW_SURFACE } from '../../src/core/config/balance.js';
import { createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../src/core/mining/BlastExecution.js';
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

/** Ore in the 8x8 footprint a 3x3 spacing-4 grid drills, to 6 m below the surface. */
function footprintOre(grid: VoxelGrid, x0: number, z0: number): number {
  let total = 0;
  for (let x = x0; x < x0 + 9; x += 2) {
    for (let z = z0; z < z0 + 9; z += 2) {
      const top = computeVoxelColumnSurfaceY(grid, x, z);
      if (top === null) continue;
      for (let d = 0; d < 6; d++) {
        for (const v of Object.values(grid.getVoxel(x, top - d, z)?.oreDensities ?? {})) total += v;
      }
    }
  }
  return total;
}

/** Drill starts richest in ore first, at least 10 m apart (ore forms deposits, not blanket cover — #1682). */
function richDrillStarts(grid: VoxelGrid, count: number): Array<[number, number]> {
  const scored: Array<{ x: number; z: number; ore: number }> = [];
  for (let x = 8; x <= grid.sizeX - 17; x += 2) {
    for (let z = 8; z <= grid.sizeZ - 17; z += 2) scored.push({ x, z, ore: footprintOre(grid, x, z) });
  }
  scored.sort((a, b) => b.ore - a.ore);
  const picked: Array<[number, number]> = [];
  for (const c of scored) {
    if (picked.length >= count) break;
    if (picked.every(([px, pz]) => Math.abs(px - c.x) >= 10 || Math.abs(pz - c.z) >= 10)) picked.push([c.x, c.z]);
  }
  return picked;
}

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

    const starts = richDrillStarts(ctx.grid!, 6);
    let shot = 0;
    while (!over() && !sold() && shot < starts.length) {
      const [x, z] = starts[shot]!;
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

// #1677: the opening-site survey finds ore in the two biomes whose ore used to be locked out.
describe.each(['tropical_karst', 'volcanic_flats'] as const)('sandbox %s start survey finds ore (#1677)', (biome) => {
  it.each(['aerial', 'core_sample'] as const)('%s survey at the start reports ore', (method) => {
    const { runner, ctx } = createRunner();
    expect(runner.run(`sandbox start biome:${biome} difficulty:normal seed:42 staffed:true`).success).toBe(true);
    runner.run('time resume');
    const state = ctx.state!;
    // The free kit has no surveyor: hire one and grant geology, as a player would via the roster.
    expect(runner.run('employee hire role:surveyor').success).toBe(true);
    const surveyor = state.employees.employees.slice(-1)[0]!;
    expect(runner.run(`employee assign_skill ${surveyor.id} skill:geology level:3`).success).toBe(true);

    // Aerial centres on the surveyor so the survey needs no travel. A core sample reads one
    // column only (radius 0), so a player coring blind may hit barren rock: aim it at the
    // richest column within 20 m, as a player reading the aerial overlay would. 20 m, not 10:
    // the surveyor spawns beside the rally flag, and on tropical_karst seed 42 the richest
    // column within 10 m of it averages ~0.08, which the survey's noise and 0.05 rounding
    // can report as barren — a short walk to real ore is what a player would do.
    let cx = Math.round(surveyor.x);
    let cz = Math.round(surveyor.z);
    if (method === 'core_sample') {
      const grid = ctx.grid!;
      // Window-mean ore density of a column: what the report's estimate is built from.
      const oreMass = (x: number, z: number): number => {
        const top = computeVoxelColumnSurfaceY(grid, x, z);
        if (top === null) return 0;
        let sum = 0;
        for (let y = top; y > top - SURVEY_DEPTH_BELOW_SURFACE.core_sample; y--) {
          if (grid.densityAt(x, y, z) <= 0) continue;
          for (const d of Object.values(grid.oresAt(x, y, z) ?? {})) sum += d;
        }
        return sum / SURVEY_DEPTH_BELOW_SURFACE.core_sample;
      };
      let best: { x: number; z: number; mass: number } | null = null;
      for (let x = cx - 20; x <= cx + 20; x++) for (let z = cz - 20; z <= cz + 20; z++) {
        if (!grid.containsColumn(x, z)) continue;
        const mass = oreMass(x, z);
        if (mass > 0 && (!best || mass > best.mass)) best = { x, z, mass };
      }
      expect(best, 'ore within 20 m of the surveyor').not.toBeNull();
      cx = best!.x;
      cz = best!.z;
    }
    const result = runner.run(`survey ${method} x:${cx} z:${cz}`);
    expect(result.success, result.output).toBe(true);

    for (let i = 0; i < 400 && state.surveyResults.length === 0; i++) runner.run('tick 1');
    expect(state.surveyResults.length).toBeGreaterThan(0);

    const survey = state.surveyResults[0]!;
    expect(survey.method).toBe(method);
    const densities = Object.values(survey.estimates).flatMap(col => Object.values(col));
    expect(densities.some(d => d > 0), 'the report contains ore').toBe(true);
  }, 60_000);
});

// #1680: sandbox sites are generated with a stronger pit mask; it must survive save/load.
describe('sandbox pit mask persistence and flat ground (#1680)', () => {
  function start(args: string) {
    const made = createRunner();
    expect(made.runner.run(args).success).toBe(true);
    return made;
  }

  function surfaces(grid: VoxelGrid): Array<number | null> {
    const out: Array<number | null> = [];
    for (let x = 0; x < grid.sizeX; x++) for (let z = 0; z < grid.sizeZ; z++) out.push(computeVoxelColumnSurfaceY(grid, x, z));
    return out;
  }

  it('records the sandbox mask on the world', () => {
    const { ctx } = start('sandbox start biome:alpine_granite difficulty:normal seed:42');
    expect(ctx.state!.world!.pitMask).toEqual(SANDBOX_PIT_MASK);
  });

  it('new_game leaves world.pitMask unset (default mask)', () => {
    const { ctx } = start('new_game mine_type:alpine_granite seed:42');
    expect(ctx.state!.world!.pitMask).toBeUndefined();
  });

  it('embeds the mask in a save and keeps world.pitMask through serialize/deserialize', () => {
    const { ctx } = start('sandbox start biome:alpine_granite difficulty:normal seed:42');
    const state = deserialize(serialize(stateForSave(ctx, ctx.state!)));
    expect(state.world!.pitMask).toEqual(SANDBOX_PIT_MASK);
    expect(state.world!.voxels!.gen.pitMask).toEqual(SANDBOX_PIT_MASK);
  });

  it('save then load regenerates the same terrain', () => {
    const live = start('sandbox start biome:alpine_granite difficulty:normal seed:42');
    const loaded = createRunner().ctx;
    const state = deserialize(serialize(stateForSave(live.ctx, live.ctx.state!)));
    expect(loadGridForState(loaded, state)).toBeNull();
    expect(loaded.state!.world!.pitMask).toEqual(SANDBOX_PIT_MASK);
    expect(surfaces(loaded.grid!)).toEqual(surfaces(live.ctx.grid!));
    expect(solidCount(loaded.grid!)).toBe(solidCount(live.ctx.grid!));
  });

  it('a save with no embedded voxels regenerates the same terrain through world.pitMask', () => {
    const live = start('sandbox start biome:alpine_granite difficulty:normal seed:42');
    const loaded = createRunner().ctx;
    const state = deserialize(serialize(live.ctx.state!));
    expect(state.world!.voxels).toBeUndefined();
    expect(state.world!.pitMask).toEqual(SANDBOX_PIT_MASK);
    expect(loadGridForState(loaded, state)).toBeNull();
    // Pristine regeneration cannot replay the levelling of the starting
    // buildings' footprints (edits live only in the voxel payload this save
    // lacks), so a handful of columns under them differ - not the terrain.
    const a = surfaces(loaded.grid!);
    const b = surfaces(live.ctx.grid!);
    const differing = a.filter((v, i) => v !== b[i]).length;
    expect(differing).toBeLessThan(a.length * 0.02);
    expect(stateForSave(loaded, loaded.state!).world!.voxels!.gen.pitMask).toEqual(SANDBOX_PIT_MASK);
  });

  it('a save without world.pitMask loads with the default mask (older saves)', () => {
    const live = start('sandbox start biome:alpine_granite difficulty:normal seed:42');
    const state = deserialize(serialize(live.ctx.state!));
    delete state.world!.pitMask;
    const loaded = createRunner().ctx;
    expect(loadGridForState(loaded, state)).toBeNull();
    expect(surfaces(loaded.grid!)).not.toEqual(surfaces(live.ctx.grid!));
    expect(loaded.state!.world!.pitMask).toBeUndefined();
  });

  it('a 3x3 shatternite shot on the flattest pad of alpine seed 42 is not a catastrophic flyrock event', () => {
    const { ctx } = start('sandbox start biome:alpine_granite difficulty:normal seed:42');
    const grid = ctx.grid!;
    const size = SANDBOX_FLAT_PAD_SIZE;

    let best = { x0: 0, z0: 0, spread: Infinity };
    for (let x0 = 0; x0 + size <= grid.sizeX; x0 += 3) {
      for (let z0 = 0; z0 + size <= grid.sizeZ; z0 += 3) {
        let lo = Infinity, hi = -Infinity;
        for (let x = x0; x < x0 + size; x++) for (let z = z0; z < z0 + size; z++) {
          const y = computeVoxelColumnSurfaceY(grid, x, z)!;
          lo = Math.min(lo, y); hi = Math.max(hi, y);
        }
        if (hi - lo < best.spread) best = { x0, z0, spread: hi - lo };
      }
    }
    expect(best.spread, 'no flat pad found on the sandbox site').toBeLessThanOrEqual(2);

    const counter = { nextHoleId: 1 };
    const holes = createGridPlan(counter, { x: best.x0 + 1, z: best.z0 + 1 }, 3, 3, 3, 6, 0.15);
    const depths: Record<string, number> = {};
    for (const h of holes) depths[h.id] = h.depth;
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'shatternite', 5, 2);
    const result = executeBlast(assembleBlastPlan(holes, charges), grid, []);
    expect(result, 'blast plan was rejected').not.toBeNull();
    expect(result!.rating).not.toBe('catastrophic');
  });
});
