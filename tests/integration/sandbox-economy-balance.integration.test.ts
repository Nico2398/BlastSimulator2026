// Sandbox economy balance (#1681): income follows production and play.
//
// Relationships, not exact cash: the production market's ore value, offer
// volume and richness bound hold together, and a scripted competent desert
// sandbox at Normal (opening kit only) stays solvent with growing cash.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { getAllBiomes } from '../../src/core/world/BiomeCatalog.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast, type BlastResult } from '../../src/core/mining/BlastExecution.js';
import { resolveMarketId, resolveContractOres } from '../../src/core/campaign/Level.js';
import { oreValuePerKg, type MarketId } from '../../src/core/economy/Market.js';
import { createContractState, generateContracts } from '../../src/core/economy/Contract.js';
import { Random } from '../../src/core/math/Random.js';
import {
  CONTRACT_REFRESH_INTERVAL,
  ORE_DENSITY_KG_M3,
  SANDBOX_FLAT_PAD_SIZE,
  SANDBOX_MAX_RICHNESS_RATIO,
  SANDBOX_REFERENCE_CREW_COST_PER_TICK,
  SANDBOX_REFERENCE_SHOT_CYCLE_TICKS,
  TICKS_PER_DAY,
} from '../../src/core/config/balance.js';
import { FORBIDDEN_COMMAND, playContracts, playTick, clearBlastZone, type Run } from '../helpers/playthrough.js';

const DESERT = 'desert_badlands';
const ABSORB_DAYS = 5;
const BOARD_SEEDS = 20;

function startSandbox(biome: string, seed: number, difficulty = 'normal', extra = ''): { run: Run; ctx: GameContext } {
  const { runner, ctx } = createRunner();
  const res = runner.run(`sandbox start biome:${biome} difficulty:${difficulty} seed:${seed} ${extra}`.trim());
  expect(res.success, res.output).toBe(true);
  return { run: (c) => runner.run(c), ctx };
}

/** Flattest 9x9 pad of the grid whose top `depthM` metres hold ore, as the sandbox's own flat-pad pass guarantees flat ones. */
function flattestPad(grid: VoxelGrid, depthM: number): { x0: number; z0: number } {
  const size = SANDBOX_FLAT_PAD_SIZE;
  let best = { x0: 0, z0: 0, spread: Infinity };
  for (let x0 = 0; x0 + size <= grid.sizeX; x0 += 3) {
    for (let z0 = 0; z0 + size <= grid.sizeZ; z0 += 3) {
      let lo = Infinity, hi = -Infinity, oreCells = 0;
      for (let x = x0; x < x0 + size; x++) for (let z = z0; z < z0 + size; z++) {
        const y = computeVoxelColumnSurfaceY(grid, x, z)!;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
        for (let d = 0; d < depthM; d++) if (grid.oresAt(x, y - d, z)) oreCells++;
      }
      if (oreCells > 0 && hi - lo < best.spread) best = { x0, z0, spread: hi - lo };
    }
  }
  return best;
}

/** The ordinary 3x3 bench shot (6 m holes, 4 m spacing, 2 m stemming, krackle 6 kg unless a tougher biome needs more) fired through executeBlast on the sandbox's market. */
function fireReferenceShot(ctx: GameContext, holeDepth = 6, explosive = 'krackle', chargeKg = 6): BlastResult {
  const grid = ctx.grid!;
  const pad = flattestPad(grid, holeDepth);
  const holes = createGridPlan({ nextHoleId: 1 }, { x: pad.x0 + 1, z: pad.z0 + 1 }, 3, 3, 4, holeDepth, 0.15);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, explosive, chargeKg, 2);
  const result = executeBlast(
    assembleBlastPlan(holes, charges), grid, [], undefined, undefined, undefined, undefined,
    resolveMarketId(ctx.state!),
  );
  expect(result, 'reference shot rejected').not.toBeNull();
  return result!;
}

function oreKgByType(result: BlastResult): Record<string, number> {
  const kg: Record<string, number> = {};
  for (const f of result.fragments) {
    for (const [ore, d] of Object.entries(f.oreDensities)) kg[ore] = (kg[ore] ?? 0) + f.volume * d * ORE_DENSITY_KG_M3;
  }
  return kg;
}

const sum = (xs: Iterable<number>) => { let s = 0; for (const x of xs) s += x; return s; };

describe('sandbox economy: the market the sandbox opens on', () => {
  it('sandbox start selects the production market on the contract board', () => {
    const { ctx } = startSandbox(DESERT, 42);
    expect(ctx.state!.contracts.market).toBe('production');
    expect(resolveMarketId(ctx.state!)).toBe('production');
  });

  it('new_game keeps the legacy market', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42').success).toBe(true);
    expect(ctx.state!.contracts.market).toBeUndefined();
    expect(resolveMarketId(ctx.state!)).toBe('legacy');
  });

  it('the live board is generated on the production profile (big offers, not 50-500 kg)', () => {
    const { run, ctx } = startSandbox(DESERT, 42);
    run('time resume');
    for (let i = 0; i < CONTRACT_REFRESH_INTERVAL * 6; i++) run('tick 1');
    const offers = [...ctx.state!.contracts.available];
    expect(offers.length).toBeGreaterThan(0);
    expect(Math.max(...offers.map(c => c.quantityKg))).toBeGreaterThan(500);
  });
});

describe('sandbox economy: value consistency', () => {
  // Both shots sit on the flattest pad that holds ore in the blast depth.
  it.each([[DESERT, 42, 'krackle', 6], ['tropical_karst', 42, 'dynatomics', 8]] as const)('blast report ore value equals sum of kg x market price (%s seed %i, %s)', (biome, seed, explosive, chargeKg) => {
    const { ctx } = startSandbox(biome, seed);
    const result = fireReferenceShot(ctx, 6, explosive, chargeKg);
    const kg = oreKgByType(result);
    const expected = sum(Object.entries(kg).map(([ore, k]) => k * oreValuePerKg(ore, 'production')));
    expect(result.totalOreValue).toBeGreaterThan(0);
    expect(result.totalOreValue / expected).toBeGreaterThan(0.95);
    expect(result.totalOreValue / expected).toBeLessThan(1.05);
  });
});

describe('sandbox economy: contract board offer volume against a shot', () => {
  const { ctx } = startSandbox(DESERT, 42);
  const result = fireReferenceShot(ctx);
  const oreKg = oreKgByType(result);
  const totalOreKg = sum(Object.values(oreKg));
  const spoilKg = sum(result.fragments.map(f => f.mass)) - totalOreKg;
  const ores = resolveContractOres(ctx.state!);

  /** Offers appearing over ABSORB_DAYS of refreshes, per seeded board. */
  function offersOver(seed: number, market: MarketId | undefined = ctx.state!.contracts.market) {
    const board = createContractState();
    if (market) board.market = market;
    const rng = new Random(seed);
    const refreshes = Math.ceil((ABSORB_DAYS * TICKS_PER_DAY) / CONTRACT_REFRESH_INTERVAL);
    const seen = [];
    for (let i = 0; i < refreshes; i++) {
      generateContracts(board, rng, i * CONTRACT_REFRESH_INTERVAL, 1, ores);
      seen.push(...board.available.slice(-3));
    }
    return seen;
  }
  const boards = Array.from({ length: BOARD_SEEDS }, (_, i) => offersOver(1000 + i));

  it('the reference shot yields a few hundred tonnes of ore', () => {
    expect(totalOreKg).toBeGreaterThan(100_000);
  });

  // The shot's 340 t is ground truth, but the opening kit hauls ~30 kg of ore a tick into a 25 t warehouse
  // (balance.ts PRODUCTION_ORE_SALE_QTY_KG), so offers are sized to what it can fill; the relationship
  // asserted is against the legacy board, which could not match even that (no 5-day absorption of the shot is asserted).
  it('ore-sale offer volume for the shot\'s own ores over 5 game days is at least 3x the legacy board\'s (offers are sized to the kit\'s hauling, not the shot\'s 340 t)', () => {
    const forShot = (b: ReturnType<typeof offersOver>) => sum(b.filter(c => c.type === 'ore_sale' && oreKg[c.materialId] !== undefined).map(c => c.quantityKg));
    const production = sum(boards.map(forShot));
    const legacy = sum(Array.from({ length: BOARD_SEEDS }, (_, i) => forShot(offersOver(1000 + i, 'legacy'))));
    expect(production).toBeGreaterThanOrEqual(3 * legacy);
  });

  it('rubble disposal offers take a meaningful share (>=30%) of the shot\'s spoil on average', () => {
    const rubble = boards.map(b => sum(b.filter(c => c.type === 'rubble_disposal').map(c => c.quantityKg)));
    expect(spoilKg).toBeGreaterThan(0);
    expect(sum(rubble) / boards.length).toBeGreaterThanOrEqual(0.3 * spoilKg);
  });
});

describe('sandbox economy: richness is bounded across biome and depth', () => {
  const BAND_M = 5;
  const MAX_DEPTH_M = 55;

  /** Mean market value ($/m3) per depth band below the surface, over a lattice of columns. */
  function valuePerM3Bands(biome: string): number[] {
    const { ctx } = startSandbox(biome, 42);
    const grid = ctx.grid!;
    const bands = new Array<number>(MAX_DEPTH_M / BAND_M).fill(0);
    let columns = 0;
    for (let x = 8; x < grid.sizeX - 8; x += 6) {
      for (let z = 8; z < grid.sizeZ - 8; z += 6) {
        const top = computeVoxelColumnSurfaceY(grid, x, z);
        if (top === null) continue;
        columns++;
        for (let d = 0; d < MAX_DEPTH_M; d++) {
          const ores = grid.oresAt(x, top - d, z);
          if (!ores) continue;
          let v = 0;
          for (const [ore, dens] of Object.entries(ores)) v += dens * ORE_DENSITY_KG_M3 * oreValuePerKg(ore, 'production');
          bands[Math.floor(d / BAND_M)]! += v;
        }
      }
    }
    return bands.map(b => b / (columns * BAND_M));
  }

  const perBiome = new Map(getAllBiomes().map(b => [b.id, valuePerM3Bands(b.id)]));
  const desertSurface = perBiome.get(DESERT)![0]!;

  it('desert surface rock has a positive value', () => {
    expect(desertSurface).toBeGreaterThan(0);
  });

  it(`no biome or depth in 0-${MAX_DEPTH_M} m pays more than SANDBOX_MAX_RICHNESS_RATIO x desert surface rock per m3`, () => {
    for (const [biome, bands] of perBiome) {
      for (let i = 0; i < bands.length; i++) {
        expect(bands[i]! / desertSurface, `${biome} ${i * BAND_M}-${(i + 1) * BAND_M} m`).toBeLessThanOrEqual(SANDBOX_MAX_RICHNESS_RATIO);
      }
    }
  });

  it('the richest biome/depth still pays more than desert surface rock (progression exists)', () => {
    const richest = Math.max(...[...perBiome.values()].flat());
    expect(richest).toBeGreaterThan(desertSurface);
  });
});

describe('sandbox economy: reference shot vs crew cost', () => {
  it('ore of the ordinary desert 3x3 shot sells for 1.5-3x the crew cost over its drill-charge-fire-haul cycle', () => {
    expect(SANDBOX_REFERENCE_CREW_COST_PER_TICK).toBeGreaterThan(0);
    expect(SANDBOX_REFERENCE_SHOT_CYCLE_TICKS).toBeGreaterThan(0);
    const { ctx } = startSandbox(DESERT, 42);
    const result = fireReferenceShot(ctx);
    const ratio = result.totalOreValue / (SANDBOX_REFERENCE_CREW_COST_PER_TICK * SANDBOX_REFERENCE_SHOT_CYCLE_TICKS);
    expect(ratio).toBeGreaterThanOrEqual(1.5);
    expect(ratio).toBeLessThanOrEqual(3);
  });
});

describe('sandbox economy: a competent desert sandbox stays solvent', () => {
  const HORIZON = 2000;
  /** Bound on how long an ordered charge may wait behind debris hauling (#1742). */
  const CHARGE_WAIT_TICKS = 300;
  const MIDPOINT = 1000;
  // Seed 42's ore deposit sits near (40,33) (#1682): the first shot opens it, a ramp from the west
  // joins the crater floor to the haul network (#1719) and the bunkhouse keeps the crew's morale up.
  const FIRST_SHOT = '36,30';
  const SECOND_SHOT = '16,22';
  const RAMP = 'start:12,34 end:34,34 depth:6';
  const BUNKHOUSE = 'living_quarters at:6,14 tier:1';
  /** Contracts filled before the second shot is ordered (income proven). */
  const CONTRACTS_BEFORE_SECOND_SHOT = 3;

  it('Normal, opening kit only, fires two blasts and grows cash from tick 1000 to tick 2000', () => {
    const { run, ctx } = startSandbox(DESERT, 42, 'normal');
    run('time resume');
    const state = ctx.state!;

    const commands: string[] = [];
    const logged: Run = (c) => { commands.push(c); return run(c); };

    const startTick = state.tickCount;
    let cashAtMid: number | null = null;
    const elapsed = () => state.tickCount - startTick;
    const over = () => state.levelEnded || elapsed() >= HORIZON;
    const play = () => { playContracts(logged, state); playTick(logged, state); if (cashAtMid === null && elapsed() >= MIDPOINT) cashAtMid = state.cash; };
    const playUntil = (max: number, done: () => boolean) => { for (let i = 0; i < max && !over() && !done(); i++) play(); };
    const filled = () => state.contracts.completedHistory.filter(c => c.completed).length;

    // Shot 1: 3x3, drilled, charged and fired by the opening crew.
    expect(logged(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${FIRST_SHOT}`).success).toBe(true);
    playUntil(800, () => state.plannedDrillHoles.length === 0);
    logged('charge hole:* explosive:krackle amount:6 stemming:2');
    playUntil(800, () => Object.keys(state.plannedChargesByHole).length === 0);
    clearBlastZone(logged, state);
    expect(logged('blast').success).toBe(true);
    // The crater floor joins the haul network; the crew sleeps in a bunkhouse (without one the morale spiral ends in a revolt).
    expect(logged(`build_ramp ${RAMP}`).success).toBe(true);
    expect(logged(`build ${BUNKHOUSE}`).success).toBe(true);

    // Sell what the haul brings. Once income is proven, the second shot is drilled and charged by the
    // opening crew alone: the only blaster keeps hauling debris, yet its charge orders outrank hauling (#1742).
    playUntil(HORIZON, () => filled() >= CONTRACTS_BEFORE_SECOND_SHOT);
    if (!over()) {
      expect(logged(`drill_plan grid rows:2 cols:2 spacing:4 depth:6 start:${SECOND_SHOT}`).success).toBe(true);
      playUntil(800, () => state.plannedDrillHoles.length === 0);
      logged('charge hole:* explosive:krackle amount:6 stemming:2');
      playUntil(CHARGE_WAIT_TICKS, () => Object.keys(state.plannedChargesByHole).length === 0);
      expect(Object.keys(state.plannedChargesByHole), `second pattern still uncharged ${CHARGE_WAIT_TICKS} ticks after ordering`).toEqual([]);
      clearBlastZone(logged, state);
      logged('blast');
    }
    // Keep selling until the horizon.
    playUntil(HORIZON, () => false);

    expect(state.levelEnded, `ended ${String(state.levelEndReason)}`).toBe(false);
    expect(state.damage.blastCount).toBeGreaterThanOrEqual(2);
    expect(state.contracts.completedHistory.some(c => c.type === 'ore_sale' && c.completed), 'an ore contract was filled').toBe(true);
    expect(cashAtMid, 'the run reached the midpoint').not.toBeNull();
    expect(state.cash, `cash at tick 1000 ${cashAtMid} vs tick ${HORIZON} ${state.cash}`).toBeGreaterThan(cashAtMid!);
    expect(commands.filter(c => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 600_000);
});
