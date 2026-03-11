import { describe, it, expect, beforeEach } from 'vitest';
import {
  type GameContext,
  newGameCommand,
  inspectCommand,
  terrainInfoCommand,
  surveyCommand,
} from '../../src/console/commands/world.js';

describe('Console — world commands', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = { state: null, grid: null };
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

    it('rejects out-of-bounds coordinates', () => {
      const result = inspectCommand(ctx, ['100,5,3'], {});
      expect(result.success).toBe(false);
      expect(result.output).toContain('Out of bounds');
    });

    it('errors with no game loaded', () => {
      const emptyCtx: GameContext = { state: null, grid: null };
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

    it('rejects out-of-bounds coordinates', () => {
      const result = surveyCommand(ctx, ['100,100'], {});
      expect(result.success).toBe(false);
      expect(result.output).toContain('Out of bounds');
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
});
