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
import { EventEmitter } from '../../src/core/state/EventEmitter.js';

describe('Console — world commands', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = { state: null, grid: null, emitter: new EventEmitter() };
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

  describe('inspect', () => {
    beforeEach(() => {
      newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
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

    it('rejects a coordinate the site does not own, naming the span it does', () => {
      const result = inspectCommand(ctx, ['100,5,3'], {});
      expect(result.success).toBe(false);
      expect(result.output).toContain('Off site');
      // The span, not a size: the site starts wherever play has taken it (#473).
      expect(result.output).toContain('(0,0) to (31,31)');
    });

    it('errors with no game loaded', () => {
      const emptyCtx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
      const result = inspectCommand(emptyCtx, ['10,5,3'], {});
      expect(result.success).toBe(false);
    });
  });

  describe('survey', () => {
    beforeEach(() => {
      newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
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
  });

  describe('terrain_info', () => {
    it('shows grid dimensions and mine type', () => {
      newGameCommand(ctx, [], { mine_type: 'mountain', seed: '99', size: '32' });
      const result = terrainInfoCommand(ctx, [], {});
      expect(result.success).toBe(true);
      expect(result.output).toContain('32x32x32');
      expect(result.output).toContain('mountain');
    });
  });

  describe('ensureLandscape groundLevelY (#458 T5.2/A21)', () => {
    it('exposes groundOffset + centerHeight as the aerial-perspective height reference', () => {
      newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
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
      newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
      const biome = getBiome(ctx.state!.mineType)!;
      const params = { seed: ctx.state!.seed, climateBias: biome.climateCenter, sizeX: 32, sizeY: 32, sizeZ: 32 };
      const first = ensureLandscape(ctx, params);
      const second = ensureLandscape(ctx, { ...params, seed: params.seed + 1 });
      expect(second!.groundLevelY).toBe(first!.groundLevelY);
    });
  });
});
