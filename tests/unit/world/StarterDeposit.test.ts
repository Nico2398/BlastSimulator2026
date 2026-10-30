// Sandbox starter deposit (#2116): world-gen places one close, shallow, flat-footed, sellable
// ore pocket on every sandbox site (ore deposits on) and nowhere else.

import { describe, it, expect } from 'vitest';
import { resolveStarterDeposit, isInStartingEdgeMargin, type StarterDeposit } from '../../../src/core/world/StarterDeposit.js';
import { buildTerrainContext, generateTerrain, surfaceDensityAt, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { sampleSurfaceHeightY } from '../../../src/core/world/WorldGen.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';
import { getAllLevels } from '../../../src/core/campaign/Level.js';
import {
  SANDBOX_FLAT_PAD_MAX_SPREAD,
  STARTER_DEPOSIT_MAX_DISTANCE_M,
  STARTER_DEPOSIT_MIN_DISTANCE_M,
  STARTER_DEPOSIT_POCKET_RADIUS_M,
  STARTER_DEPOSIT_EDGE_MARGIN_M,
} from '../../../src/core/config/balance.js';
import { sandboxTerrainConfig } from '../../helpers/sandboxSite.js';

const BIOMES = ['desert_badlands', 'green_foothills', 'red_canyon', 'alpine_granite', 'tropical_karst', 'volcanic_flats'] as const;
const SEEDS = [1, 2, 3, 4, 5, 12345, 42] as const;
/** Half the 9x9 shot footprint centred on the deposit. */
const HALF = 4;
/** The 3x3 holes of the reference shot, relative to the deposit centre. */
const HOLE_OFFSETS = [-4, 0, 4] as const;
const SELLABLE = ['dirtite', 'rustite'];

const cases = BIOMES.flatMap(biome => SEEDS.map(seed => [biome, seed] as const));

function deposit(config: TerrainConfig): StarterDeposit {
  const d = buildTerrainContext(config).starterDeposit;
  expect(d, 'sandbox site has a starter deposit').not.toBeNull();
  return d!;
}

function surfaceY(grid: VoxelGrid, x: number, z: number): number {
  return computeVoxelColumnSurfaceY(grid, x, z)!;
}

/** Whether `oreId` ore is present at `depth` metres below the column's surface. */
function holdsOre(grid: VoxelGrid, x: number, z: number, depth: number, oreId: string): boolean {
  const ores = grid.oresAt(x, surfaceY(grid, x, z) - depth, z);
  return (ores?.[oreId] ?? 0) > 0;
}

describe('resolveStarterDeposit (#2116)', () => {
  it('returns a deposit for a sandbox site config', () => {
    const d = resolveStarterDeposit(sandboxTerrainConfig('desert_badlands', 42));
    expect(d).not.toBeNull();
    expect(typeof d!.oreId).toBe('string');
    expect(Number.isInteger(d!.x)).toBe(true);
    expect(Number.isInteger(d!.z)).toBe(true);
  });

  it('is null when oreDeposits is absent', () => {
    const { oreDeposits: _omit, ...without } = sandboxTerrainConfig('desert_badlands', 42);
    expect(resolveStarterDeposit(without)).toBeNull();
  });

  it('is null when oreDeposits is false', () => {
    expect(resolveStarterDeposit({ ...sandboxTerrainConfig('green_foothills', 7), oreDeposits: false })).toBeNull();
  });

  it('agrees with the terrain context', () => {
    const config = sandboxTerrainConfig('red_canyon', 3);
    expect(buildTerrainContext(config).starterDeposit).toEqual(resolveStarterDeposit(config));
  });

  it('is a pure function of the config', () => {
    const config = sandboxTerrainConfig('alpine_granite', 5);
    expect(resolveStarterDeposit(config)).toEqual(resolveStarterDeposit({ ...config }));
  });

  it('differs between seeds on the same biome (placement is seeded, not a constant)', () => {
    const spots = new Set(SEEDS.map(seed => {
      const d = resolveStarterDeposit(sandboxTerrainConfig('green_foothills', seed))!;
      return `${d.x},${d.z}`;
    }));
    expect(spots.size).toBeGreaterThan(1);
  });
});

describe('TerrainContext.starterDeposit (#2116)', () => {
  it.each(cases)('C1 %s seed %i: a starter deposit exists', (biome, seed) => {
    const d = deposit(sandboxTerrainConfig(biome, seed));
    expect(d.radius).toBe(STARTER_DEPOSIT_POCKET_RADIUS_M);
  });

  it('C1 covers every biome of the catalogue', () => {
    expect(getAllBiomes().map(b => b.id).sort()).toEqual([...BIOMES].sort());
  });

  it('C1 a config without oreDeposits builds a context with no starter deposit', () => {
    const { oreDeposits: _omit, ...without } = sandboxTerrainConfig('tropical_karst', 1);
    expect(buildTerrainContext(without).starterDeposit).toBeNull();
    expect(buildTerrainContext({ ...without, oreDeposits: false }).starterDeposit).toBeNull();
  });

  it.each(cases)('C3 %s seed %i: centre lies 10..25 m from the site centre', (biome, seed) => {
    const config = sandboxTerrainConfig(biome, seed);
    const d = deposit(config);
    const dist = Math.hypot(d.x - config.sizeX / 2, d.z - config.sizeZ / 2);
    expect(dist).toBeGreaterThanOrEqual(STARTER_DEPOSIT_MIN_DISTANCE_M);
    expect(dist).toBeLessThanOrEqual(STARTER_DEPOSIT_MAX_DISTANCE_M);
  });

  it.each(cases)('C6 %s seed %i: the ore is sellable (dirtite or rustite)', (biome, seed) => {
    expect(SELLABLE).toContain(deposit(sandboxTerrainConfig(biome, seed)).oreId);
  });

  it.each(cases)('pocket %s seed %i: sits wholly inside the playable grid, clear of the starting edge margin', (biome, seed) => {
    const config = sandboxTerrainConfig(biome, seed);
    const d = deposit(config);
    for (const [dx, dz] of [[-HALF, -HALF], [HALF, -HALF], [-HALF, HALF], [HALF, HALF], [0, 0]] as const) {
      expect(isInStartingEdgeMargin(d.x + dx, d.z + dz, config.sizeX, config.sizeZ), `footprint cell ${dx},${dz}`).toBe(false);
      expect(d.x + dx).toBeGreaterThanOrEqual(0);
      expect(d.x + dx).toBeLessThan(config.sizeX);
      expect(d.z + dz).toBeGreaterThanOrEqual(0);
      expect(d.z + dz).toBeLessThan(config.sizeZ);
    }
  });
});

describe('generated starter deposit voxels (#2116)', () => {
  it.each(cases)('C4 %s seed %i: ground under the 9x9 footprint is flat within the pad spread cap', (biome, seed) => {
    const config = sandboxTerrainConfig(biome, seed);
    const d = deposit(config);
    const grid = generateTerrain(config);
    let lo = Infinity, hi = -Infinity;
    for (let x = d.x - HALF; x <= d.x + HALF; x++) for (let z = d.z - HALF; z <= d.z + HALF; z++) {
      const y = surfaceY(grid, x, z);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    expect(hi - lo).toBeLessThanOrEqual(SANDBOX_FLAT_PAD_MAX_SPREAD);
  });

  it.each(cases)('C5 %s seed %i: every footprint column holds ore within 2 m of the surface, hole columns hold it through 5 m', (biome, seed) => {
    const config = sandboxTerrainConfig(biome, seed);
    const d = deposit(config);
    const grid = generateTerrain(config);
    for (let x = d.x - HALF; x <= d.x + HALF; x++) for (let z = d.z - HALF; z <= d.z + HALF; z++) {
      const near = [0, 1, 2].some(depth => holdsOre(grid, x, z, depth, d.oreId));
      expect(near, `column ${x},${z} has no ${d.oreId} within 2 m of the surface`).toBe(true);
    }
    for (const dx of HOLE_OFFSETS) for (const dz of HOLE_OFFSETS) {
      for (let depth = 0; depth < 5; depth++) {
        expect(holdsOre(grid, d.x + dx, d.z + dz, depth, d.oreId), `hole column ${d.x + dx},${d.z + dz} depth ${depth}`).toBe(true);
      }
    }
  });

  it.each(cases)('C9 %s seed %i: the ore is plain voxel ore (oresAt reports it)', (biome, seed) => {
    const config = sandboxTerrainConfig(biome, seed);
    const d = deposit(config);
    const grid = generateTerrain(config);
    const ores = grid.oresAt(d.x, surfaceY(grid, d.x, d.z), d.z);
    expect(ores).toBeDefined();
    expect(Object.keys(ores!)).toContain(d.oreId);
  });

  it.each([['desert_badlands', 42], ['alpine_granite', 3], ['tropical_karst', 12345]] as const)('C2 %s seed %i: two grids from the same config hold identical rock and ore in the pocket', (biome, seed) => {
    const config = sandboxTerrainConfig(biome, seed);
    const a = deposit(config);
    const b = deposit({ ...config });
    expect(a).toEqual(b);
    const gridA = generateTerrain(config);
    const gridB = generateTerrain({ ...config });
    const r = STARTER_DEPOSIT_POCKET_RADIUS_M + 1;
    for (let x = a.x - r; x <= a.x + r; x++) for (let z = a.z - r; z <= a.z + r; z++) {
      const top = surfaceY(gridA, x, z);
      expect(surfaceY(gridB, x, z)).toBe(top);
      for (let y = top - 8; y <= top; y++) {
        expect(gridB.densityAt(x, y, z), `density ${x},${y},${z}`).toBe(gridA.densityAt(x, y, z));
        expect(JSON.stringify(gridB.oresAt(x, y, z)), `ores ${x},${y},${z}`).toBe(JSON.stringify(gridA.oresAt(x, y, z)));
        expect(JSON.stringify(gridB.compositionAt(x, y, z)), `rock ${x},${y},${z}`).toBe(JSON.stringify(gridA.compositionAt(x, y, z)));
      }
    }
  });

  it('a hard-rock biome still gets the soft pocket (ore reaches the surface on alpine_granite)', () => {
    const config = sandboxTerrainConfig('alpine_granite', 42);
    const d = deposit(config);
    const grid = generateTerrain(config);
    expect(holdsOre(grid, d.x, d.z, 0, d.oreId)).toBe(true);
  });
});

describe('terrain outside the pocket is unchanged (#2116 C11)', () => {
  it.each([['desert_badlands', 42], ['red_canyon', 2], ['volcanic_flats', 5]] as const)('%s seed %i: ore beyond the pocket is what the unmodified sampler gives', (biome, seed) => {
    const config = sandboxTerrainConfig(biome, seed);
    const ctx = buildTerrainContext(config);
    const d = ctx.starterDeposit!;
    const grid = generateTerrain(config);
    let checked = 0;
    for (let x = 0; x < config.sizeX; x += 3) for (let z = 0; z < config.sizeZ; z += 3) {
      if (Math.hypot(x - d.x, z - d.z) <= STARTER_DEPOSIT_POCKET_RADIUS_M + 1) continue;
      const h = sampleSurfaceHeightY(ctx.worldGen, x, z);
      const top = Math.round(h);
      const boundaries = ctx.strata.boundariesAt(x, z);
      for (let y = top - 6; y <= top; y++) {
        if (surfaceDensityAt(y, h) <= 0) continue;
        const depth = Math.max(0, top - y);
        const composition = ctx.strata.compositionAt(x, y, z, depth, boundaries);
        const expected = ctx.oreVeins.densitiesAt(x, y, z, depth, composition, ctx.biome.oreRichness);
        expect(JSON.stringify(grid.oresAt(x, y, z) ?? {}), `ores ${x},${y},${z}`).toBe(JSON.stringify(expected));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('isInStartingEdgeMargin is true in the ring just inside the starting rectangle and false elsewhere', () => {
    const m = STARTER_DEPOSIT_EDGE_MARGIN_M;
    expect(isInStartingEdgeMargin(0, 10, 64, 64)).toBe(true);
    expect(isInStartingEdgeMargin(m - 1, 10, 64, 64)).toBe(true);
    expect(isInStartingEdgeMargin(64 - m, 10, 64, 64)).toBe(true);
    expect(isInStartingEdgeMargin(m, m, 64, 64)).toBe(false);
    expect(isInStartingEdgeMargin(64 - m - 1, 64 - m - 1, 64, 64)).toBe(false);
    expect(isInStartingEdgeMargin(-1, 10, 64, 64)).toBe(false);
    expect(isInStartingEdgeMargin(10, 64, 64, 64)).toBe(false);
  });
});

describe('campaign levels carry no starter deposit (#2116 C10)', () => {
  const campaign = getAllLevels().filter(l => !l.oreDeposits);

  it('there are campaign levels without oreDeposits', () => {
    expect(campaign.length).toBeGreaterThanOrEqual(4);
  });

  it.each(campaign.map(l => [l.id, l] as const))('%s: no starter deposit', (_id, level) => {
    const config: TerrainConfig = {
      seed: level.terrainSeed, climateBias: level.climateBias, sizeX: level.gridX, datum: level.datum, sizeZ: level.gridZ,
      mixedRockHardness: level.mixedRockHardness,
      ...(level.oreGradeScale !== undefined ? { oreGradeScale: level.oreGradeScale } : {}),
    };
    expect(buildTerrainContext(config).starterDeposit).toBeNull();
    expect(resolveStarterDeposit(config)).toBeNull();
  });
});
