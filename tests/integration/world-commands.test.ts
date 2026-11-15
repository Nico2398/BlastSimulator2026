import { describe, it, expect, beforeEach } from 'vitest';
import {
  type GameContext,
  newGameCommand,
  inspectCommand,
  terrainInfoCommand,
  surveyCommand,
  ensureLandscape,
  oreIslandsCommand,
  terrainConfigOf,
} from '../../src/console/commands/world.js';
import { getBiome } from '../../src/core/world/BiomeCatalog.js';
import { STARTING_CASH, STARTING_SITE_STAFFED_COMPOSITION, DEFAULT_GRID_SIZE } from '../../src/core/config/balance.js';
import type { Employee } from '../../src/core/entities/Employee.js';
import type { Vehicle } from '../../src/core/entities/Vehicle.js';
import { makeEmptyGameContext, makeGameContext } from '../helpers/gameContext.js';
import { vehicleDriverId } from '../../src/core/entities/Vehicle.js';
import { computeVoxelColumnSurfaceY, computeColumnRangeY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { MAX_TERRAIN_GEN_DIMENSION, buildTerrainContext } from '../../src/core/world/TerrainGen.js';
import { createRunner } from '../../src/console/createRunner.js';
import { t } from '../../src/core/i18n/I18n.js';
import { ORE_ISLAND_ORE_IDS } from '../../src/core/config/balance.js';

/**
 * Dig a pit at column (x, z) down from its current surface through
 * `floorY` inclusive, leaving air throughout that band and untouched
 * (natural, still-solid) rock at `floorY - 1` and below (#1187). Mirrors
 * how a real dig/blast leaves a below-0 pit floor for the unbounded-column
 * readers under test here to report.
 */
function digPitBelowZero(grid: VoxelGrid, x: number, z: number, floorY: number): void {
  const surface = computeVoxelColumnSurfaceY(grid, x, z);
  const top = surface ?? 0;
  for (let y = top; y >= floorY; y--) {
    grid.clearVoxel(x, y, z);
  }
}

describe('Console — world commands', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeEmptyGameContext();
  });

  describe('new_game', () => {
    it('creates a game with a generated terrain', () => {
      const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('desert');
      expect(ctx.state).not.toBeNull();
      expect(ctx.grid).not.toBeNull();
    });

    it('uses desert preset and the given seed', () => {
      newGameCommand(ctx, [], { mine_type: 'desert', seed: '42' });
      expect(ctx.state!.mineType).toBe('desert');
      expect(ctx.state!.seed).toBe(42);
    });

    it('derives datum from size via defaultDatumForSize (Math.floor(size * 0.55)) — no size_y named arg any more (#1191)', () => {
      newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '48' });
      expect(ctx.state!.world!.sizeX).toBe(48);
      expect(ctx.state!.world!.sizeZ).toBe(48);
      expect(ctx.state!.world!.datum).toBe(Math.floor(48 * 0.55));
      expect(ctx.state!.world!.datum).toBe(26);
    });

    it('ignores a size_y named arg passed to new_game — it neither errors nor changes datum (#1191)', () => {
      const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '48', size_y: '20' });
      expect(result.success).toBe(true);
      expect(ctx.state!.world!.sizeX).toBe(48);
      expect(ctx.state!.world!.sizeZ).toBe(48);
      expect(ctx.state!.world!.datum).toBe(Math.floor(48 * 0.55));
      expect(ctx.state!.world!.datum).not.toBe(20);
      expect(ctx.grid!.sizeX).toBe(48);
      expect(ctx.grid!.sizeZ).toBe(48);
    });

    it('rejects unknown mine types', () => {
      const result = newGameCommand(ctx, [], { mine_type: 'moon' });
      expect(result.success).toBe(false);
      expect(result.output).toContain('Unknown mine type');
    });

    // #1226 — new_game's `size` named arg reached `regenerateGrid` →
    // `generateTerrain` → the VoxelGrid constructor with no upper bound,
    // whose chunk-allocation loop is proportional to size²: an absurd
    // player-typed value hangs/OOMs the process instead of failing cleanly.
    // Same defect shape as #1218 (the save-load path), fixed there via
    // `requireValidGenDimension`; this is the console-input sibling.
    //
    // The two over-the-ceiling cases below have no fix in place yet, so
    // unfixed code actually runs real (or unboundedly expensive) generation
    // work here rather than failing fast — bounded with a tight per-test
    // timeout so the Red phase fails/times out quickly instead of hanging
    // the whole suite for minutes.
    describe('size validation (#1226)', () => {
      it('rejects an absurdly large size (1000000000) promptly, leaving ctx untouched', () => {
        const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '1000000000' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('Invalid size');
        expect(ctx.state).toBeNull();
        expect(ctx.grid).toBeNull();
      }, 3000);

      it(`rejects a size one over the ceiling (MAX_TERRAIN_GEN_DIMENSION + 1 = ${MAX_TERRAIN_GEN_DIMENSION + 1}), leaving ctx untouched`, () => {
        const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: String(MAX_TERRAIN_GEN_DIMENSION + 1) });
        expect(result.success).toBe(false);
        expect(result.output).toContain('Invalid size');
        expect(ctx.state).toBeNull();
        expect(ctx.grid).toBeNull();
      }, 3000);

      it('rejects size:0, leaving ctx untouched', () => {
        const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '0' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('Invalid size');
        expect(ctx.state).toBeNull();
        expect(ctx.grid).toBeNull();
      });

      it('rejects a negative size (-5), leaving ctx untouched', () => {
        const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '-5' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('Invalid size');
        expect(ctx.state).toBeNull();
        expect(ctx.grid).toBeNull();
      });

      it('rejects a non-numeric size ("abc", parses to NaN) rather than propagating NaN downstream', () => {
        const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: 'abc' });
        expect(result.success).toBe(false);
        expect(result.output).toContain('Invalid size');
        expect(ctx.state).toBeNull();
        expect(ctx.grid).toBeNull();
      });

      it('still succeeds for a legitimate in-range size (32) — no regression from validation', () => {
        const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
        expect(result.success).toBe(true);
        expect(ctx.state!.world!.sizeX).toBe(32);
        expect(ctx.state!.world!.sizeZ).toBe(32);
        expect(ctx.grid!.sizeX).toBe(32);
        expect(ctx.grid!.sizeZ).toBe(32);
      });

      it('defaults to DEFAULT_GRID_SIZE and succeeds when no size named arg is given', () => {
        const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42' });
        expect(result.success).toBe(true);
        expect(ctx.state!.world!.sizeX).toBe(DEFAULT_GRID_SIZE);
        expect(ctx.state!.world!.sizeZ).toBe(DEFAULT_GRID_SIZE);
      });

      it('ignores an out-of-range size_y — it remains a dead arg, not read by newGameCommand at all', () => {
        const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32', size_y: '1000000000' });
        expect(result.success).toBe(true);
        expect(ctx.state!.world!.sizeX).toBe(32);
        expect(ctx.state!.world!.sizeZ).toBe(32);
        expect(ctx.grid!.sizeX).toBe(32);
        expect(ctx.grid!.sizeZ).toBe(32);
      });
    });
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

    it('defaults to an empty roster and fleet when staffed is omitted', () => {
      const result = newGameCommand(ctx, [], { seed: '42' });
      expect(result.success).toBe(true);
      expect(ctx.state!.employees.employees.length).toBe(0);
      expect(ctx.state!.vehicles.vehicles.length).toBe(0);
    });

    it('staffed:false behaves identically to the default (empty roster and fleet)', () => {
      const result = newGameCommand(ctx, [], { seed: '42', staffed: 'false' });
      expect(result.success).toBe(true);
      expect(ctx.state!.employees.employees.length).toBe(0);
      expect(ctx.state!.vehicles.vehicles.length).toBe(0);
    });

    it('staffed:true hires and equips the STARTING_SITE_STAFFED_COMPOSITION roster and fleet', () => {
      const result = newGameCommand(ctx, [], { seed: '42', staffed: 'true' });
      expect(result.success).toBe(true);
      assertEmployeesMatchComposition(ctx.state!.employees.employees);
      assertVehiclesMatchComposition(ctx.state!.vehicles.vehicles);
    });

    it('staffed:true leaves starting cash unaffected', () => {
      const result = newGameCommand(ctx, [], { seed: '42', staffed: 'true' });
      expect(result.success).toBe(true);
      expect(ctx.state!.cash).toBe(STARTING_CASH);
    });

    it('rejects staffed:banana, leaving any existing game state untouched', () => {
      ctx = makeGameContext({ seed: '7' });
      const before = ctx.state;

      const result = newGameCommand(ctx, [], { seed: '42', staffed: 'banana' });

      expect(result.success).toBe(false);
      expect(result.output).toContain('Invalid staffed value');
      expect(ctx.state).toBe(before);
    });
  });

  describe('inspect', () => {
    beforeEach(() => {
      ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
    });

    it('returns rock type and density for a solid voxel', () => {
      const result = inspectCommand(ctx, ['10,5,3'], {});
      expect(result.success).toBe(true);
      expect(result.output).toContain('10,5,3');
      // Should show rock info (not "Air")
      expect(result.output).not.toContain('Air');
    });

    it('returns Air for above-surface voxel', () => {
      const result = inspectCommand(ctx, ['10,31,10'], {});
      expect(result.success).toBe(true);
      expect(result.output).toContain('Air');
    });

    it('rejects a coordinate the site does not own, naming the span it does — with no height/sizeY mention (#1187)', () => {
      const result = inspectCommand(ctx, ['100,5,3'], {});
      expect(result.success).toBe(false);
      expect(result.output).toContain('Off site');
      // The span, not a size: the site starts wherever play has taken it (#473).
      // #1187: the off-site refusal is a pure column-span message now — no
      // height/sizeY clause, since a column has no vertical bound any more.
      expect(result.output).toContain('(0,0) to (31,31).');
      expect(result.output.toLowerCase()).not.toContain('height');
    });

    it('errors with no game loaded', () => {
      const emptyCtx = makeEmptyGameContext();
      const result = inspectCommand(emptyCtx, ['10,5,3'], {});
      expect(result.success).toBe(false);
    });

    it('reports air below 0 inside a pit dug there (#1187)', () => {
      digPitBelowZero(ctx.grid!, 15, 15, -5);
      const result = inspectCommand(ctx, ['15,-5,15'], {});
      expect(result.success).toBe(true);
      expect(result.output).toContain('Air');
    });

    it('reports rock below a pit\'s dug floor, on the untouched natural ground beneath it (#1187)', () => {
      digPitBelowZero(ctx.grid!, 15, 15, -5);
      const result = inspectCommand(ctx, ['15,-6,15'], {});
      expect(result.success).toBe(true);
      expect(result.output).not.toContain('Air');
    });

    it('reports air, not a refusal, for a y far above the old sizeY-bounded top on an owned column (#1187)', () => {
      const result = inspectCommand(ctx, ['15,1000,15'], {});
      expect(result.success).toBe(true);
      expect(result.output).not.toContain('Off site');
      expect(result.output).toContain('Air');
    });
  });

  describe('survey', () => {
    beforeEach(() => {
      ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
    });

    it('returns human-readable rock and ore information', () => {
      const result = surveyCommand(ctx, ['15,15'], {});
      expect(result.success).toBe(true);
      expect(result.output).toContain('Survey at (15,15)');
      // Should mention a rock type
      expect(result.output).toMatch(/cruite|sandite|molite/i);
    });

    it('rejects a coordinate the site does not own, naming the span it does', () => {
      const result = surveyCommand(ctx, ['100,100'], {});
      expect(result.success).toBe(false);
      expect(result.output).toContain('Off site');
      expect(result.output).toContain('(0,0) to (31,31)');
    });

    it('reports the real negative surface for a column dug entirely below 0 (#1187)', () => {
      // Clear the whole column from its natural surface down through -5,
      // leaving nothing solid at y >= -5 — the only ground left is the
      // untouched natural rock beneath the dug floor.
      digPitBelowZero(ctx.grid!, 15, 15, -5);
      // Oracle: the exact value `computeVoxelColumnSurfaceY` (which the
      // implementation is expected to delegate to) resolves for this column
      // now, rather than a hardcoded number that would drift with terrain
      // generation details.
      const expectedSurfaceY = computeVoxelColumnSurfaceY(ctx.grid!, 15, 15);
      expect(expectedSurfaceY).not.toBeNull();
      expect(expectedSurfaceY!).toBeLessThan(0);

      const result = surveyCommand(ctx, ['15,15'], {});
      expect(result.success).toBe(true);
      expect(result.output).not.toContain('No solid ground');
      expect(result.output).toContain(`depth ${expectedSurfaceY}`);
    });
  });

  describe('terrain_info', () => {
    it('shows grid dimensions and mine type', () => {
      ctx = makeGameContext({ mineType: 'mountain', seed: '99', size: '32' });
      const result = terrainInfoCommand(ctx, [], {});
      expect(result.success).toBe(true);
      expect(result.output).toContain('32x32');
      expect(result.output).toContain('mountain');
    });

    it('reports a Vertical extent line whose minY reflects ground dug below 0 (#1187)', () => {
      ctx = makeGameContext({ mineType: 'mountain', seed: '99', size: '32' });
      digPitBelowZero(ctx.grid!, 10, 10, -5);

      // Oracle: the exact range `computeColumnRangeY` (which the
      // implementation is expected to delegate to) resolves for the site's
      // full column span, rather than a hardcoded number that would drift
      // with terrain generation details.
      const grid = ctx.grid!;
      const expectedRange = computeColumnRangeY(grid, grid.minX, grid.maxX - 1, grid.minZ, grid.maxZ - 1);
      expect(expectedRange).not.toBeNull();
      expect(expectedRange!.minY).toBeLessThan(0);

      const result = terrainInfoCommand(ctx, [], {});
      expect(result.success).toBe(true);
      expect(result.output).toContain('Vertical extent:');
      const match = result.output.match(/Vertical extent:\s*(-?\d+)\s+to\s+(-?\d+)/);
      expect(match, `expected a "Vertical extent: minY to maxY" line in:\n${result.output}`).not.toBeNull();
      expect(Number(match![1])).toBe(expectedRange!.minY);
      expect(Number(match![2])).toBe(expectedRange!.maxY);
    });
  });

  describe('ensureLandscape groundLevelY (#458 T5.2/A21)', () => {
    it('exposes groundOffset + centerHeight as the aerial-perspective height reference', () => {
      ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
      const biome = getBiome(ctx.state!.mineType)!;
      const handle = ensureLandscape(ctx, {
        seed: ctx.state!.seed, climateBias: biome.climateCenter,
        sizeX: 32, datum: Math.floor(32 * 0.55), sizeZ: 32,
      });
      expect(handle).not.toBeNull();
      // Sits within the voxel grid's Y range — a raw off-grid value here would
      // mean the pass hazes valleys and peaks alike (#458 T5.2 accept criterion).
      expect(handle!.groundLevelY).toBeGreaterThan(0);
      expect(handle!.groundLevelY).toBeLessThan(32);
    });

    it('is cached — a second call with different params still returns the first handle', () => {
      ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
      const biome = getBiome(ctx.state!.mineType)!;
      const params = { seed: ctx.state!.seed, climateBias: biome.climateCenter, sizeX: 32, datum: Math.floor(32 * 0.55), sizeZ: 32 };
      const first = ensureLandscape(ctx, params);
      const second = ensureLandscape(ctx, { ...params, seed: params.seed + 1 });
      expect(second!.groundLevelY).toBe(first!.groundLevelY);
    });
  });
});

describe('Console — ore_islands (#2284)', () => {
  function startSandbox(seed: number): GameContext {
    const { runner, ctx } = createRunner();
    const result = runner.run(`sandbox start biome:green_foothills seed:${seed}`);
    expect(result.success, result.output).toBe(true);
    return ctx;
  }

  it('C6 fails with the no-game message when no game is loaded', () => {
    const result = oreIslandsCommand(makeEmptyGameContext(), [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(t('console.no_game_loaded'));
  });

  it('C6 is registered on the runner as ore_islands and fails without a game', () => {
    const { runner } = createRunner();
    const result = runner.run('ore_islands');
    expect(result.success).toBe(false);
    expect(result.output).toBe(t('console.no_game_loaded'));
  });

  it('C6 lists every island of a progression site: its ores, one line each at least', () => {
    for (const seed of [42, 1]) {
      const ctx = startSandbox(seed);
      const config = terrainConfigOf(ctx.state!)!;
      const islands = buildTerrainContext(config).oreIslands!.list();
      expect(islands.length).toBeGreaterThanOrEqual(3);

      const result = oreIslandsCommand(ctx, [], {});
      expect(result.success, result.output).toBe(true);
      const lines = result.output.split('\n').filter(l => l.trim() !== '');
      expect(lines.length).toBeGreaterThanOrEqual(islands.length);
      for (const island of islands) {
        for (const id of island.oreIds) expect(result.output).toContain(id);
      }
    }
  });

  it('C6 reports each island centre and its distance from spawn', () => {
    const ctx = startSandbox(42);
    const islands = buildTerrainContext(terrainConfigOf(ctx.state!)!).oreIslands!.list();
    const out = oreIslandsCommand(ctx, [], {}).output;
    // Every island's centre and distance appear as a whole number, however the line rounds it.
    for (const island of islands) {
      for (const value of [island.x, island.z, island.distance]) {
        const near = [Math.floor(value), Math.round(value), Math.ceil(value)].map(String);
        expect(near.some(n => out.includes(n)), `${value} in output`).toBe(true);
      }
    }
  });

  it('C6 through the runner, lists the same islands as the command', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:green_foothills seed:42').success).toBe(true);
    const viaRunner = runner.run('ore_islands');
    expect(viaRunner.success).toBe(true);
    expect(viaRunner.output).toBe(oreIslandsCommand(ctx, [], {}).output);
    expect(ORE_ISLAND_ORE_IDS.some(id => viaRunner.output.includes(id))).toBe(true);
  });

  it('C5 a game without ore deposits has no islands: success with a "none" line', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: '42' });
    expect(ctx.state!.world!.oreDeposits).toBeUndefined();
    const result = oreIslandsCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output.toLowerCase()).toContain('none');
    for (const id of ORE_ISLAND_ORE_IDS) expect(result.output).not.toContain(id);
  });
});
