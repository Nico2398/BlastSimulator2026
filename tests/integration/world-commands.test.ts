import { describe, it, expect, beforeEach } from 'vitest';
import {
  type GameContext,
  newGameCommand,
  inspectCommand,
  terrainInfoCommand,
  surveyCommand,
  ensureLandscape,
} from '../../src/console/commands/world.js';
import { getBiome } from '../../src/core/world/BiomeCatalog.js';
import { STARTING_CASH, STARTING_SITE_STAFFED_COMPOSITION } from '../../src/core/config/balance.js';
import type { Employee } from '../../src/core/entities/Employee.js';
import type { Vehicle } from '../../src/core/entities/Vehicle.js';
import { makeEmptyGameContext, makeGameContext } from '../helpers/gameContext.js';
import { vehicleDriverId } from '../../src/core/entities/Vehicle.js';
import { computeVoxelColumnSurfaceY, computeColumnRangeY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';

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

    it('defaults sizeY to the cubic size when size_y is omitted', () => {
      newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '48' });
      expect(ctx.state!.world!.sizeX).toBe(48);
      expect(ctx.state!.world!.sizeY).toBe(48);
      expect(ctx.state!.world!.sizeZ).toBe(48);
      expect(ctx.grid!.sizeY).toBe(48);
    });

    it('breaks cubic when size_y is given explicitly (#458 T6.1/D13)', () => {
      const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '48', size_y: '20' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('48x20x48');
      expect(ctx.state!.world!.sizeX).toBe(48);
      expect(ctx.state!.world!.sizeY).toBe(20);
      expect(ctx.state!.world!.sizeZ).toBe(48);
      expect(ctx.grid!.sizeX).toBe(48);
      expect(ctx.grid!.sizeY).toBe(20);
      expect(ctx.grid!.sizeZ).toBe(48);
    });

    it('rejects unknown mine types', () => {
      const result = newGameCommand(ctx, [], { mine_type: 'moon' });
      expect(result.success).toBe(false);
      expect(result.output).toContain('Unknown mine type');
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
      expect(result.output).toContain('32x32x32');
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
        sizeX: 32, sizeY: 32, sizeZ: 32,
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
      const params = { seed: ctx.state!.seed, climateBias: biome.climateCenter, sizeX: 32, sizeY: 32, sizeZ: 32 };
      const first = ensureLandscape(ctx, params);
      const second = ensureLandscape(ctx, { ...params, seed: params.seed + 1 });
      expect(second!.groundLevelY).toBe(first!.groundLevelY);
    });
  });
});
