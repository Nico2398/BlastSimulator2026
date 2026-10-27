// Sandbox economy balance (#1681): income follows production and play.
//
// Relationships, not exact cash: the production market's ore value, offer
// volume and richness bound hold together, and a scripted competent desert
// sandbox at Normal (opening kit only) stays solvent with growing cash.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { t } from '../../src/core/i18n/I18n.js';
import {
  CONTRACT_REFRESH_INTERVAL,
  ORE_DENSITY_KG_M3,
  RUBBLE_CHEAP_STOCK_SHARE_MAX,
  RUBBLE_PAID_STOCK_SHARE_MAX,
  SANDBOX_FLAT_PAD_SIZE,
  SANDBOX_MAX_RICHNESS_RATIO,
  SANDBOX_STARTING_CASH,
  SANDBOX_REFERENCE_CREW_COST_PER_TICK,
  SANDBOX_REFERENCE_SHOT_CYCLE_TICKS,
  TICKS_PER_DAY, EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';
import { FORBIDDEN_COMMAND, playContracts, playTick, clearBlastZone, stockWarehouse, type Run } from '../helpers/playthrough.js';

const DESERT = 'desert_badlands';
const ABSORB_DAYS = 5;
const BOARD_SEEDS = 20;
/**
 * The contract / demand-weighted hauling tests (#1789, #1817, #1828) need a deep stock of ore to
 * exercise the board and the haul ranking, so they keep the site's full ore grade; the sandbox
 * default SANDBOX_ORE_GRADE_SCALE (#1944) is pitched for a thin opening and is pinned by the tests below.
 */
const FULL_ORE_GRADE = 'ore_grade:1';

function startSandbox(biome: string, seed: number, kit = 'digger', extra = ''): { run: Run; ctx: GameContext } {
  const { runner, ctx } = createRunner();
  const res = runner.run(`sandbox start biome:${biome} kit:${kit} seed:${seed} ${extra}`.trim());
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

/** The ordinary 3x3 bench shot (5 m holes, 4 m spacing, 2 m stemming, krackle 4 kg: the probe opening SHOT, #1944, unless a tougher biome needs more) fired through executeBlast on the sandbox's market. */
function fireReferenceShot(ctx: GameContext, holeDepth = 5, explosive = 'krackle', chargeKg = 4): BlastResult {
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
    // oreKgByType counts every fragment; the report splits it into broken-out and sealed (#2003).
    const reported = result.totalOreValue + (result.sealedOreValue ?? 0);
    expect(result.totalOreValue).toBeGreaterThan(0);
    expect(reported / expected).toBeGreaterThan(0.95);
    expect(reported / expected).toBeLessThan(1.05);
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
  function offersOver(seed: number, market: MarketId | undefined = ctx.state!.contracts.market, rubbleStockKg = Infinity) {
    const board = createContractState();
    if (market) board.market = market;
    const rng = new Random(seed);
    const refreshes = Math.ceil((ABSORB_DAYS * TICKS_PER_DAY) / CONTRACT_REFRESH_INTERVAL);
    const seen = [];
    for (let i = 0; i < refreshes; i++) {
      generateContracts(board, rng, i * CONTRACT_REFRESH_INTERVAL, 1, ores, rubbleStockKg);
      seen.push(...board.available.slice(-3));
    }
    return seen;
  }
  const boards = Array.from({ length: BOARD_SEEDS }, (_, i) => offersOver(1000 + i));

  // Re-measured at SANDBOX_ORE_GRADE_SCALE 0.08 (#1944): the 3x3 depth-5 shot holds 17.5 t of ore (was 340 t at scale 1).
  it('the reference shot yields about twenty tonnes of ore', () => {
    expect(totalOreKg).toBeGreaterThan(10_000);
  });

  // The shot's ore mass is ground truth, but the opening kit hauls ~30 kg of ore a tick into a 25 t warehouse
  // (balance.ts PRODUCTION_ORE_SALE_QTY_KG), so offers are sized to what it can fill; the relationship
  // asserted is against the legacy board, which could not match even that (no 5-day absorption of the shot is asserted).
  it('ore-sale offer volume for the shot\'s own ores over 5 game days is at least 3x the legacy board\'s (offers are sized to the kit\'s hauling, not the shot\'s own mass)', () => {
    const forShot = (b: ReturnType<typeof offersOver>) => sum(b.filter(c => c.type === 'ore_sale' && oreKg[c.materialId] !== undefined).map(c => c.quantityKg));
    const production = sum(boards.map(forShot));
    const legacy = sum(Array.from({ length: BOARD_SEEDS }, (_, i) => forShot(offersOver(1000 + i, 'legacy'))));
    expect(production).toBeGreaterThanOrEqual(3 * legacy);
  });

  // #1929: the progression sandbox's board is tiered (grade 0 = local buyer only). The untiered pin above
  // measures the production profile; the tiered board offers 100-1000 kg lots BY DESIGN, so its kg volume
  // differs from both the untiered and the legacy board. Pinned here as kg volume and value per offer.
  it('tiered grade-0 ore-sale board: smaller lots than the untiered board, richer value per kg than legacy (#1929)', () => {
    const tiered = (seed: number) => {
      const board = createContractState();
      board.market = ctx.state!.contracts.market ?? 'production';
      const rng = new Random(seed);
      const seen: typeof board.available = [];
      const refreshes = Math.ceil((ABSORB_DAYS * TICKS_PER_DAY) / CONTRACT_REFRESH_INTERVAL);
      for (let i = 0; i < refreshes; i++) {
        generateContracts(board, rng, i * CONTRACT_REFRESH_INTERVAL, 1, ores, Infinity, 0);
        seen.push(...board.available.slice(-3));
      }
      return seen.filter(c => c.type === 'ore_sale' && oreKg[c.materialId] !== undefined);
    };
    const legacyOf = (seed: number) => offersOver(seed, 'legacy').filter(c => c.type === 'ore_sale' && oreKg[c.materialId] !== undefined);
    const seeds = Array.from({ length: BOARD_SEEDS }, (_, i) => 1000 + i);
    const tieredOffers = seeds.flatMap(tiered);
    const legacyOffers = seeds.flatMap(legacyOf);
    const untieredKg = sum(boards.map(b => sum(b.filter(c => c.type === 'ore_sale' && oreKg[c.materialId] !== undefined).map(c => c.quantityKg))));
    const tieredKg = sum(tieredOffers.map(c => c.quantityKg));
    const legacyKg = sum(legacyOffers.map(c => c.quantityKg));
    expect(tieredOffers.length).toBeGreaterThan(0);
    // Volume: 100-1000 kg lots sit below the untiered 250-2000 kg lots but above the legacy lots.
    expect(tieredKg).toBeLessThan(untieredKg);
    expect(tieredKg).toBeGreaterThanOrEqual(legacyKg);
    // Value per offer: the local buyer's price factor (1.15-1.3) keeps a tiered offer at least as valuable as a legacy one.
    const valuePerOffer = (offers: typeof tieredOffers) => sum(offers.map(c => c.quantityKg * c.pricePerKg)) / offers.length;
    expect(valuePerOffer(tieredOffers)).toBeGreaterThanOrEqual(valuePerOffer(legacyOffers));
  });

  // #1892: rubble offers are sized to the barren rock the site holds, so each one can be filled. Cheap
  // clearances take at most RUBBLE_CHEAP_STOCK_SHARE_MAX of the stock, paid ones at most RUBBLE_PAID_STOCK_SHARE_MAX.
  it('rubble disposal offers never exceed the barren rock the site holds, and both kinds appear', () => {
    expect(spoilKg).toBeGreaterThan(0);
    const stocked = Array.from({ length: BOARD_SEEDS }, (_, i) => offersOver(1000 + i, undefined, spoilKg));
    const rubble = stocked.flat().filter(c => c.type === 'rubble_disposal');
    expect(rubble.length).toBeGreaterThan(0);
    for (const c of rubble) {
      expect(c.quantityKg).toBeLessThanOrEqual(spoilKg * (c.playerPays ? RUBBLE_PAID_STOCK_SHARE_MAX : RUBBLE_CHEAP_STOCK_SHARE_MAX));
      expect(c.penaltyAmount).toBe(0);
    }
    expect(rubble.some(c => c.playerPays)).toBe(true);
    expect(rubble.some(c => !c.playerPays)).toBe(true);
  });

  it('a site holding no barren rock is offered no rubble', () => {
    const empty = Array.from({ length: BOARD_SEEDS }, (_, i) => offersOver(1000 + i, undefined, 0)).flat();
    expect(empty.filter(c => c.type === 'rubble_disposal')).toHaveLength(0);
    expect(empty.length).toBeGreaterThan(0);
  });
});

describe('sandbox economy: tier-aware grade-0 board (#1929)', () => {
  const { ctx } = startSandbox(DESERT, 42);
  const ores = resolveContractOres(ctx.state!);

  function gradeZeroOffers(seed: number) {
    const board = createContractState();
    board.market = ctx.state!.contracts.market ?? 'production';
    const rng = new Random(seed);
    const seen = [];
    for (let i = 0; i < 12; i++) {
      generateContracts(board, rng, i * CONTRACT_REFRESH_INTERVAL, 1, ores, Infinity, 0);
      seen.push(...board.available.slice(-3));
    }
    return seen;
  }

  it('every grade-0 ore sale and supply offer comes from the local buyer, ore sales 100-1000 kg', () => {
    const offers = Array.from({ length: BOARD_SEEDS }, (_, i) => gradeZeroOffers(1000 + i)).flat()
      .filter(c => c.type !== 'rubble_disposal');
    expect(offers.length).toBeGreaterThan(0);
    for (const c of offers) {
      expect(c.buyerTier).toBe('local');
      if (c.type === 'ore_sale') {
        expect(c.quantityKg).toBeGreaterThanOrEqual(100);
        expect(c.quantityKg).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('console contract list on a sandbox names the buyer', () => {
    const { run } = startSandbox(DESERT, 42);
    const out = run('contract list').output;
    expect(out).toContain(t('economy.buyer.local'));
  });

  it('console contract list on a campaign game does not name a buyer', () => {
    const { runner } = createRunner();
    expect(runner.run('new_game seed:42').success).toBe(true);
    const out = runner.run('contract list').output;
    for (const id of ['local', 'regional', 'national', 'global']) expect(out).not.toContain(t(`economy.buyer.${id}`));
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

  it('SANDBOX_MAX_RICHNESS_RATIO is still 10 (#1933: depth grade must not loosen the bound)', () => {
    expect(SANDBOX_MAX_RICHNESS_RATIO).toBe(10);
  });

  // #1933: grade rises with depth, so value per m3 climbs band over band (0-10, 10-20, 20-35, 35-55 m).
  // Once a biome holds ore in any band, every later band must hold ore too and pay strictly more: a
  // zero band after ore, or a flat/falling band, fails. Only a leading run of ore-free bands is skipped.
  it('value per m3 rises strictly band over band (0-10, 10-20, 20-35, 35-55 m) wherever ore exists', () => {
    const edges = [0, 10, 20, 35, 55];
    const label = (i: number) => `${edges[i]}-${edges[i + 1]} m`;
    let compared = 0;
    const leadingBarren: string[] = [];
    for (const [biome, bands] of perBiome) {
      const means = edges.slice(0, -1).map((from, i) => {
        const slice = bands.slice(from / BAND_M, edges[i + 1]! / BAND_M);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
      });
      const first = means.findIndex(v => v > 0);
      if (first < 0) continue;
      if (first > 0) leadingBarren.push(`${biome}: ${label(0)}..${label(first - 1)}`);
      for (let k = first + 1; k < means.length; k++) {
        expect(means[k]!, `${biome} band ${label(k)} vs ${label(k - 1)}`).toBeGreaterThan(means[k - 1]!);
        compared++;
      }
    }
    // Every biome pays from the surface down, so no band may be skipped.
    expect(leadingBarren, 'biomes whose shallow bands hold no ore').toEqual([]);
    expect(compared).toBeGreaterThan(0);
  });

  it('the richest band still pays at most SANDBOX_MAX_RICHNESS_RATIO x desert surface rock', () => {
    const richest = Math.max(...[...perBiome.values()].flat());
    expect(richest / desertSurface).toBeLessThanOrEqual(SANDBOX_MAX_RICHNESS_RATIO);
  });

  it('the richest biome/depth still pays more than desert surface rock (progression exists)', () => {
    const richest = Math.max(...[...perBiome.values()].flat());
    expect(richest).toBeGreaterThan(desertSurface);
  });
});

/**
 * Play-loop scaffold shared by the scripted-opening tests: a started, running sandbox plus a command
 * log, an elapsed-tick clock, and `playUntil` stepping contracts and ticks up to `horizon`.
 * `afterTick` runs once per played step (for per-step bookkeeping).
 */
function startPlayLoop(kit: string, horizon: number, afterTick: (elapsed: number) => void = () => {}, extra = '', seed = 42) {
  const { run, ctx } = startSandbox(DESERT, seed, kit, extra);
  run('time resume');
  const state = ctx.state!;
  const commands: string[] = [];
  const logged: Run = (c) => { commands.push(c); return run(c); };
  const startTick = state.tickCount;
  const elapsed = () => state.tickCount - startTick;
  const over = () => state.levelEnded || elapsed() >= horizon;
  const play = () => { playContracts(logged, state); playTick(logged, state); afterTick(elapsed()); };
  const playUntil = (max: number, done: () => boolean) => { for (let i = 0; i < max && !over() && !done(); i++) play(); };
  return { state, commands, logged, elapsed, over, playUntil };
}

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
  const BUNKHOUSE = 'living_quarters at:6,18 tier:1';
  /** Contracts filled before the second shot is ordered (income proven). */
  const CONTRACTS_BEFORE_SECOND_SHOT = 3;

  it('Normal, opening kit only, fires two blasts and grows cash from tick 1000 to tick 2000', () => {
    let cashAtMid: number | null = null;
    const { state, commands, logged, over, playUntil } = startPlayLoop('digger', HORIZON, (elapsed) => {
      if (cashAtMid === null && elapsed >= MIDPOINT) cashAtMid = state.cash;
    });
    const filled = () => state.contracts.completedHistory.filter(c => c.completed).length;

    // Shot 1: 3x3, drilled, charged and fired by the opening crew.
    expect(logged(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${FIRST_SHOT}`).success).toBe(true);
    playUntil(800, () => state.plannedDrillHoles.length === 0);
    // A player pays for and builds the warehouse (#1963): no free placeBuilding.
    expect(stockWarehouse(logged, state, 'krackle', 54).success).toBe(true);
    logged('charge hole:* explosive:krackle amount:6 stemming:2');
    playUntil(EXPLOSIVE_DELIVERY_TICKS + 800, () => Object.keys(state.plannedChargesByHole).length === 0);
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
      // A player pays for and builds the warehouse (#1963): no free placeBuilding.
      expect(stockWarehouse(logged, state, 'krackle', 24).success).toBe(true);
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

describe('sandbox economy: the standard opening on every starting kit (#1891)', () => {
  const HORIZON = 2000;
  const BUILD = 'living_quarters at:30,48 tier:1';
  const SHOT_START = '36,30';
  // 6 kg a hole (54 kg) sits over the 40 kg grade-0 permit on purpose: the digger kit has no fragmenter, and the permit-sized
  // 4 kg / 4.4 kg shots leave about half the fragments oversized, so it could not haul enough to pay its crew (#1944 plan doc).
  /** The ramp the digger kit's rock digger carves into the first crater (#1874); same line as the solvent-sandbox test. */
  const DIGGER_RAMP = 'start:12,34 end:34,34 depth:6';
  /**
   * The full kit's cash at tick 2000 on the scripted opening: today's run, #1747.
   * Re-measured for the calibrated sandbox (#1944: scale 0.08, 3x3 depth 5, 6 kg, shot at 36,30): 792,241.1 (seed 42, desert_badlands),
   * with a free explosive warehouse. Re-measured again once the warehouse is paid for and built by the crew through
   * stockWarehouse (#1963, $20,000 and its build time before the order): 740,314.4. Re-measured once trace ore under the
   * barren threshold, bound for the spoil heap, stopped counting as ore in barren-yields-to-ore (#2089): 735,908.7.
   * Floor is that measurement, rounded down.
   */
  const FULL_KIT_CASH_AT_HORIZON_FLOOR = 735_908;

  interface OpeningTrace {
    endedAtTick: number | null;
    endReason: string;
    cashAtFirstBlast: number | null;
    cashAtHorizon: number;
    /** First tick where cash was <= 0 while no ore sale had completed yet. */
    brokeBeforeSaleAtTick: number | null;
    commands: string[];
    buildOk: boolean;
    /** Whether the optional ramp command succeeded; null when none was ordered. */
    rampOk: boolean | null;
  }

  /** The scripted standard opening: living quarters (tier 1), one 3x3 shot on the deposit, then sell to the horizon. */
  function playOpening(kit: string, ramp?: string): OpeningTrace {
    let rampOk: boolean | null = null;
    const trace: OpeningTrace = {
      endedAtTick: null, endReason: '', cashAtFirstBlast: null, cashAtHorizon: 0,
      brokeBeforeSaleAtTick: null, commands: [], buildOk: false, rampOk: null,
    };
    const saleDone = () => state.contracts.completedHistory.some(c => c.type === 'ore_sale' && c.completed);
    const { state, commands, logged, over, playUntil } = startPlayLoop(kit, HORIZON, (elapsed) => {
      if (trace.brokeBeforeSaleAtTick === null && !saleDone() && state.cash <= 0) trace.brokeBeforeSaleAtTick = elapsed;
      if (trace.endedAtTick === null && state.levelEnded) {
        trace.endedAtTick = elapsed;
        trace.endReason = String(state.levelEndReason);
      }
    });
    trace.commands = commands;

    trace.buildOk = logged(`build ${BUILD}`).success;
    expect(trace.buildOk, 'living quarters placed').toBe(true);
    expect(logged(`drill_plan grid rows:3 cols:3 spacing:4 depth:5 start:${SHOT_START}`).success).toBe(true);
    playUntil(800, () => state.plannedDrillHoles.length === 0);
    // A player pays for and builds the warehouse (#1963): no free placeBuilding.
    expect(stockWarehouse(logged, state, 'krackle', 54).success).toBe(true);
    logged('charge hole:* explosive:krackle amount:6 stemming:2');
    playUntil(EXPLOSIVE_DELIVERY_TICKS + 800, () => Object.keys(state.plannedChargesByHole).length === 0);
    clearBlastZone(logged, state);
    if (!over()) {
      trace.cashAtFirstBlast = state.cash;
      expect(logged('blast').success).toBe(true);
      if (ramp) rampOk = logged(`build_ramp ${ramp}`).success;
    }
    playUntil(HORIZON, () => false);
    trace.cashAtHorizon = state.cash;
    trace.rampOk = rampOk;
    return trace;
  }

  it('the full kit starts with strictly more cash than the digger kit', () => {
    expect(SANDBOX_STARTING_CASH.full).toBeGreaterThan(SANDBOX_STARTING_CASH.digger);
    expect(SANDBOX_STARTING_CASH.digger).toBe(330_000);
    expect(SANDBOX_STARTING_CASH.full).toBe(370_000);
  });

  // At the calibrated ore scale (#1944) the digger kit has too little reachable ore to pay its crew without the
  // ramp its rock digger carves (#1874): half the 18 t shot sits below the rim. So the digger opening includes the ramp.
  it.each(['digger', 'full'] as const)('%s kit: survives to tick 2000 solvent, and ends richer than at the first blast', (kit) => {
    const t = playOpening(kit, kit === 'digger' ? DIGGER_RAMP : undefined);
    expect(t.endedAtTick, `level ended at tick ${t.endedAtTick}: ${t.endReason}`).toBeNull();
    expect(t.brokeBeforeSaleAtTick, 'cash hit zero before the first ore sale completed').toBeNull();
    expect(t.cashAtFirstBlast, 'a blast was fired').not.toBeNull();
    expect(t.cashAtHorizon, `cash at first blast ${t.cashAtFirstBlast} vs tick ${HORIZON} ${t.cashAtHorizon}`).toBeGreaterThan(t.cashAtFirstBlast!);
    expect(t.commands.filter(c => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 600_000);

  it('digger: the kit digger carves the ramp, and the opening stays solvent and ends richer than at the first blast (#1874)', () => {
    const t = playOpening('digger', DIGGER_RAMP);
    expect(t.rampOk, 'build_ramp accepted with the kit digger').toBe(true);
    expect(t.endedAtTick, `level ended at tick ${t.endedAtTick}: ${t.endReason}`).toBeNull();
    expect(t.brokeBeforeSaleAtTick, 'cash hit zero before the first ore sale completed').toBeNull();
    expect(t.cashAtFirstBlast).not.toBeNull();
    expect(t.cashAtHorizon).toBeGreaterThan(t.cashAtFirstBlast!);
    expect(t.commands.filter(c => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 600_000);

  it('digger: the opening kit holds a rock digger and an excavator-licensed driver at game start (#1874)', () => {
    const { ctx } = startSandbox(DESERT, 42, 'digger');
    const state = ctx.state!;
    const digger = state.vehicles.vehicles.find(v => v.type === 'rock_digger');
    expect(digger, 'a rock digger in the kit').toBeDefined();
    const driver = state.employees.employees.find(e => e.qualifications.some(q => q.category === 'driving.excavator'));
    expect(driver, 'an excavator-licensed employee').toBeDefined();
  });

  it('full: the same opening ends at least at the pinned cash (today\'s run, #1747)', () => {
    const t = playOpening('full');
    expect(t.endedAtTick, `level ended at tick ${t.endedAtTick}: ${t.endReason}`).toBeNull();
    expect(t.cashAtHorizon).toBeGreaterThanOrEqual(FULL_KIT_CASH_AT_HORIZON_FLOOR);
    expect(t.commands.filter(c => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 600_000);
});

describe('sandbox economy: a supply contract can be filled (#1789)', () => {
  const HORIZON = 5000;
  const BUILD = 'living_quarters at:30,48 tier:1';
  const SHOT_START = '36,32';

  it('full: the first dirtite supply offer is accepted, completes without penalty, and sales go on', () => {
    const { state, commands, logged, over, playUntil } = startPlayLoop('full', HORIZON, () => {}, FULL_ORE_GRADE);
    const supplyId = { current: null as number | null };
    const settled = () => supplyId.current !== null && state.contracts.completedHistory.some((c) => c.id === supplyId.current);
    /** Like a player: accept the first dirtite supply offer the moment it is on the board. */
    const step = () => {
      if (supplyId.current === null) {
        const offer = state.contracts.available.find((c) => c.type === 'supply' && c.materialId === 'dirtite');
        if (offer && logged(`contract accept ${offer.id}`).success) supplyId.current = offer.id;
      }
    };

    expect(logged(`build ${BUILD}`).success).toBe(true);
    expect(logged(`drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:${SHOT_START}`).success).toBe(true);
    playUntil(800, () => state.plannedDrillHoles.length === 0);
    // A player pays for and builds the warehouse (#1963): no free placeBuilding.
    expect(stockWarehouse(logged, state, 'krackle', 72).success).toBe(true);
    logged('charge hole:* explosive:krackle amount:8 stemming:2');
    playUntil(EXPLOSIVE_DELIVERY_TICKS + 800, () => Object.keys(state.plannedChargesByHole).length === 0);
    clearBlastZone(logged, state);
    expect(logged('blast').success).toBe(true);

    while (!over() && !settled()) {
      step();
      playUntil(1, () => false);
    }

    expect(supplyId.current, 'a dirtite supply offer appeared and was accepted').not.toBeNull();
    const done = state.contracts.completedHistory.find((c) => c.id === supplyId.current);
    expect(done, 'the supply contract settled before the horizon').toBeDefined();
    expect(done!.completed, `supply contract expired with ${done!.deliveredKg}/${done!.quantityKg} kg`).toBe(true);
    expect(done!.expired).toBe(false);
    expect(done!.penaltyCharged ?? 0).toBe(0);
    expect(state.levelEnded, `ended ${String(state.levelEndReason)}`).toBe(false);
    expect(state.contracts.completedHistory.some((c) => c.type === 'ore_sale' && c.completed), 'ore sales continued').toBe(true);
    expect(commands.filter((c) => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 900_000);
});

describe('sandbox economy: the second ore reaches the warehouse (#1817)', () => {
  const HORIZON = 3500;
  const BUILD = 'living_quarters at:30,48 tier:1';
  const SHOT_START = '36,32';
  /** The 25 t tier-1 warehouse reads as filled from here (the repro saw 23.9 t at ~t1500, before demand-weighted hauling). */
  const WAREHOUSE_FILLED_KG = 20_000;
  const RUSTITE_STOCK_FLOOR_KG = 2_000;

  it('full: rustite reaches stock and sells by t3500 (whether or not the warehouse fills), dirtite keeps selling', () => {
    let filledAt: number | null = null;
    let rustitePeakAfterFill = 0;
    let rustitePeak = 0;
    let totalPeak = 0;
    const stockKg = (ore?: string) => ore === undefined
      ? Object.values(state.collectedOre).reduce((a, b) => a + b, 0)
      : state.collectedOre[ore] ?? 0;
    const { state, commands, logged, over, playUntil } = startPlayLoop('full', HORIZON, (elapsed) => {
      totalPeak = Math.max(totalPeak, stockKg());
      rustitePeak = Math.max(rustitePeak, stockKg('rustite'));
      if (filledAt === null && stockKg() >= WAREHOUSE_FILLED_KG) filledAt = elapsed;
      if (filledAt !== null) rustitePeakAfterFill = Math.max(rustitePeakAfterFill, stockKg('rustite'));
    }, FULL_ORE_GRADE);

    expect(logged(`build ${BUILD}`).success).toBe(true);
    expect(logged(`drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:${SHOT_START}`).success).toBe(true);
    playUntil(800, () => state.plannedDrillHoles.length === 0);
    // A player pays for and builds the warehouse (#1963): no free placeBuilding.
    expect(stockWarehouse(logged, state, 'krackle', 72).success).toBe(true);
    logged('charge hole:* explosive:krackle amount:8 stemming:2');
    playUntil(EXPLOSIVE_DELIVERY_TICKS + 800, () => Object.keys(state.plannedChargesByHole).length === 0);
    clearBlastZone(logged, state);
    expect(logged('blast').success).toBe(true);
    playUntil(HORIZON, () => false);

    const sales = (ore: string) => state.contracts.completedHistory.filter((c) => c.type === 'ore_sale' && c.completed && c.materialId === ore);
    expect(over() && state.levelEnded, `ended ${String(state.levelEndReason)}`).toBeFalsy();
    // Before #1817 the warehouse filled with dirtite (>= 20 t) and rustite never got in. Demand-weighted hauling keeps rustite flowing,
    // so the warehouse may never fill; if it does, rustite must still have stock afterwards.
    expect(rustitePeak, `rustite stock peaked at ${rustitePeak} kg (total peak ${totalPeak} kg)`).toBeGreaterThan(RUSTITE_STOCK_FLOOR_KG);
    if (filledAt !== null) {
      expect(rustitePeakAfterFill, `rustite stock peaked at ${rustitePeakAfterFill} kg after the warehouse filled at t${filledAt}`).toBeGreaterThan(RUSTITE_STOCK_FLOOR_KG);
    }
    expect(sales('rustite').length, 'rustite ore sales completed by t3500').toBeGreaterThanOrEqual(5);
    expect(sales('dirtite').length, 'dirtite sales continued').toBeGreaterThanOrEqual(5);
    expect(commands.filter((c) => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 900_000);
});

describe('sandbox economy: grade-weighted ore demand hauls high-grade rustite (#1828)', () => {
  const HORIZON = 3550;
  const BUILD = 'living_quarters at:30,48 tier:1';
  const SHOT_START = '36,32';
  /** The player takes any rustite offer this small as it appears (the #1828 repro), stock or no stock. */
  const MAX_OFFER_KG = 2_000;
  /** Rustite share of a fragment from which it counts as high-grade. */
  const HIGH_GRADE = 0.5;
  /**
   * At least half of the accepted rustite contracts complete rather than expire. Measured 20 of 31 (0.65) at t2502 on one board stream,
   * 16 of 30 (0.53) on main with a single extra draw ahead of the board's RNG and 18 of 34 (0.53) once #1892 reshaped the board's draws
   * (rubble offers re-rolled as ore sales): the finite rustite supply binds, so board drift alone moves the share by +-0.1.
   * Before #1817 it was 3 of 38 (0.08), far under this floor; the grade weighting itself moves it by +-2 contracts.
   */
  const MIN_COMPLETED_SHARE = 0.5;
  /**
   * Rustite kg in reachable high-grade fragments still on the ground at the horizon. Fragments whose haul/fragment order is
   * `debris_out_of_reach` (152 t at the horizon, all boulders and ledge rock no hauler can climb to) are not counted: no
   * ranking can move them, so they only ever measured the blast geometry. Measured 0.5 t reachable.
   */
  const HIGH_GRADE_GROUND_CEILING_KG = 10_000;
  /** A fragment resting this close to a column that was ever out of reach counts as part of the stranded rock. */
  const STRANDED_REACH_CELLS = 2;

  it('full: accepted rustite contracts mostly complete, rustite and dirtite sell, high-grade rustite leaves the ground', () => {
    const acceptedRustite = new Set<number>();
    const rustiteActive = () => state.contracts.active.some((c) => c.type === 'ore_sale' && c.materialId === 'rustite');
    let armed = false; // offers are taken only once the shot is fired: rock must exist before a deadline runs against it
    const acceptSmallRustite = (run: Run) => {
      if (!armed || rustiteActive()) return;
      const offer = state.contracts.available.find((c) => c.type === 'ore_sale' && c.materialId === 'rustite' && c.quantityKg <= MAX_OFFER_KG);
      if (offer && run(`contract accept ${offer.id}`).success) acceptedRustite.add(offer.id);
    };
    // Last tick rustite sat in the warehouse: once the reachable rustite is all hauled and sold nothing can fill a later offer,
    // so contracts accepted after it expire for want of ore, whatever the haul ranking does.
    let lastRustiteStockTick = 0;
    // Columns where an order was debris_out_of_reach at any tick. The core's crater-access ramp (#2082) opens that
    // rock mid-run (and fragmenting it mints new ids), so it is no longer unreachable at the horizon, but it only
    // became haulable late and was never part of the ranking this test measures.
    const strandedColumns = new Set<string>();
    const { state, commands, logged, over, playUntil } = startPlayLoop('full', HORIZON, () => {
      if ((state.collectedOre['rustite'] ?? 0) > 1) lastRustiteStockTick = state.tickCount;
      for (const a of state.pendingActions) {
        if (a.blockedReason === 'debris_out_of_reach') strandedColumns.add(`${Math.round(a.targetX)},${Math.round(a.targetZ)}`);
      }
      acceptSmallRustite(logged);
    }, FULL_ORE_GRADE);

    expect(logged(`build ${BUILD}`).success).toBe(true);
    expect(logged(`drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:${SHOT_START}`).success).toBe(true);
    playUntil(800, () => state.plannedDrillHoles.length === 0);
    // A player pays for and builds the warehouse (#1963): no free placeBuilding.
    expect(stockWarehouse(logged, state, 'krackle', 72).success).toBe(true);
    logged('charge hole:* explosive:krackle amount:8 stemming:2');
    playUntil(EXPLOSIVE_DELIVERY_TICKS + 800, () => Object.keys(state.plannedChargesByHole).length === 0);
    clearBlastZone(logged, state);
    expect(logged('blast').success).toBe(true);
    armed = true;
    playUntil(HORIZON, () => false);

    expect(over() && state.levelEnded, `ended ${String(state.levelEndReason)}`).toBeFalsy();
    const rustiteContracts = state.contracts.completedHistory.filter((c) => c.type === 'ore_sale' && c.materialId === 'rustite' && acceptedRustite.has(c.id)
      && c.acceptedAtTick <= lastRustiteStockTick);
    const completed = rustiteContracts.filter((c) => c.completed).length;
    const expired = rustiteContracts.filter((c) => c.expired && !c.completed).length;
    expect(rustiteContracts.length, `rustite offers accepted while rustite was in stock (last stock t${lastRustiteStockTick}; ${acceptedRustite.size} accepted in all)`).toBeGreaterThanOrEqual(10);
    // Before the fix 35 of 38 accepted rustite contracts expired (18 of 41 completed once stock-covered ones are counted).
    expect(completed / Math.max(1, completed + expired), `${completed} completed vs ${expired} expired of ${rustiteContracts.length} accepted by t${lastRustiteStockTick}`).toBeGreaterThanOrEqual(MIN_COMPLETED_SHARE);

    const sales = (ore: string) => state.contracts.completedHistory.filter((c) => c.type === 'ore_sale' && c.completed && c.materialId === ore).length;
    expect(sales('rustite'), 'rustite ore sales').toBeGreaterThan(5);
    expect(sales('dirtite'), 'dirtite sales continued').toBeGreaterThanOrEqual(5);

    const unreachable = new Set<number>();
    for (const t of state.logistics.fragments) {
      const cx = Math.round(t.fragment.position.x);
      const cz = Math.round(t.fragment.position.z);
      for (let dx = -STRANDED_REACH_CELLS; dx <= STRANDED_REACH_CELLS; dx++) {
        for (let dz = -STRANDED_REACH_CELLS; dz <= STRANDED_REACH_CELLS; dz++) {
          if (strandedColumns.has(`${cx + dx},${cz + dz}`)) unreachable.add(t.fragment.id);
        }
      }
    }
    let highGradeRustiteKg = 0;
    for (const t of state.logistics.fragments) {
      const share = t.fragment.oreDensities['rustite'] ?? 0;
      if (t.state === 'on_ground' && share >= HIGH_GRADE && !unreachable.has(t.fragment.id)) highGradeRustiteKg += t.fragment.mass * share;
    }
    expect(highGradeRustiteKg, `reachable high-grade rustite still on the ground: ${Math.round(highGradeRustiteKg / 1000)} t`).toBeLessThan(HIGH_GRADE_GROUND_CEILING_KG);
    expect(commands.filter((c) => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 900_000);
});

describe('sandbox economy: the kit-only opening, no explosive warehouse (#1963)', () => {
  /**
   * Ticks played after the sequence starts. The cash low points of the kit-only opening sit at t1024-t1144 on the
   * ten runs measured on main 02137db after #1944 (issue #1963), so 1,500 ticks covers the risk window with the
   * first sales (t944-t1074) and the recovery behind them. The horizon is this run's choice, bounded for ten runs.
   * The sweep pins solvency (the level never ends) and a completed ore sale by then, not a cash level.
   */
  const HORIZON = 1500;
  const BUILD = 'living_quarters at:30,48 tier:1';
  /** The #1944 reference shot on the deposit: 3x3 x 5 m, Krackle 4 kg (36 kg), inside the grade-0 permit (40 kg, 9 holes). Measured at 36,32. */
  const SHOT_START = '36,32';
  /** Ramp of the sequence measured in issue #1963 (main 02137db). */
  const RAMP = 'start:40,12 end:40,31 depth:5';
  const KITS = ['digger', 'full'] as const;
  /** The five seeds of the measurement table in the issue (desert_badlands). */
  const SEEDS = [42, 7, 13, 21, 2] as const;
  const cases = KITS.flatMap((kit) => SEEDS.map((seed) => [kit, seed] as const));

  it.each(cases)('%s kit, seed %i: completes an ore sale and never ends the level by the horizon', (kit, seed) => {
    const { state, commands, logged, elapsed, playUntil } = startPlayLoop(kit, HORIZON, () => {}, '', seed);
    const label = () => `${kit} seed ${seed}: levelEndReason=${String(state.levelEndReason)} cash=${Math.round(state.cash)} t${elapsed()}`;

    const build = logged(`build ${BUILD}`);
    expect(build.success, `build: ${build.output}`).toBe(true);
    const drill = logged(`drill_plan grid rows:3 cols:3 spacing:4 depth:5 start:${SHOT_START}`);
    expect(drill.success, `drill_plan: ${drill.output}`).toBe(true);
    playUntil(800, () => state.plannedDrillHoles.length === 0);
    // The kit owns no explosive warehouse and this test builds none: the order waits EXPLOSIVE_DELIVERY_TICKS (#1895).
    const charge = logged('charge hole:* explosive:krackle amount:4 stemming:2');
    expect(charge.success, `charge (${label()}): ${charge.output}`).toBe(true);
    playUntil(EXPLOSIVE_DELIVERY_TICKS + 800, () => Object.keys(state.plannedChargesByHole).length === 0);
    clearBlastZone(logged, state);
    const blast = logged('blast');
    expect(blast.success, `blast (${label()}): ${blast.output}`).toBe(true);
    const ramp = logged(`build_ramp ${RAMP}`);
    expect(ramp.success, `build_ramp (${label()}): ${ramp.output}`).toBe(true);
    playUntil(HORIZON, () => false);

    expect(state.contracts.completedHistory.some((c) => c.type === 'ore_sale' && c.completed), `no ore sale completed (${label()})`).toBe(true);
    expect(state.levelEnded, `level ended (${label()})`).toBe(false);
    expect(elapsed(), `horizon not reached (${label()})`).toBeGreaterThanOrEqual(HORIZON);
    expect(commands.some((c) => c.startsWith('build explosive_warehouse')), 'no explosive warehouse ordered').toBe(false);
    expect(state.buildings.buildings.some((b) => b.type === 'explosive_warehouse'), `an explosive warehouse exists (${label()})`).toBe(false);
    expect(commands.filter((c) => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 600_000);

  it('no test in this file places a building with the free-placement helper (the free warehouse is gone)', () => {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    // Spelled in two halves so this guard's own source does not contain the word it forbids.
    expect(code).not.toContain(['place', 'Building'].join(''));
  });
});
