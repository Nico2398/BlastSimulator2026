// BlastSimulator2026 — saveCommand/loadCommand unit tests (#408)
// Exercises the console quick-save round trip, including the grid
// regeneration `loadCommand` performs on load (the VoxelGrid is not part of
// the serialized GameState — see saveload.ts's header comment).

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import { saveCommand, loadCommand } from '../../../src/console/commands/saveload.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';

function makeCtx(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    emitter: new EventEmitter(),
    landscape: null,
    playableArea: null,
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '16' });
  return ctx;
}

beforeEach(() => resetHoleIds());

describe('saveCommand', () => {
  it('requires a loaded game', () => {
    const ctx: MiningContext = {
      state: null, grid: null,
      emitter: new EventEmitter(),
      landscape: null,
      playableArea: null,
    };
    const result = saveCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });

  it('saves to the default slot when no slot is given', () => {
    const ctx = makeCtx();
    const result = saveCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('quicksave');
  });

  it('saves to a named slot via the slot: named arg', () => {
    const ctx = makeCtx();
    const result = saveCommand(ctx, [], { slot: 'alpha' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('alpha');
  });

  it('saves to a named slot via the positional arg', () => {
    const ctx = makeCtx();
    const result = saveCommand(ctx, ['bravo'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('bravo');
  });
});

describe('loadCommand', () => {
  it('fails with "No save found" for an empty slot', () => {
    const ctx = makeCtx();
    const result = loadCommand(ctx, [], { slot: 'never-saved' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No save found');
  });

  it('restores saved state (cash) into ctx.state', () => {
    const ctx = makeCtx();
    ctx.state!.cash = 123_456;
    saveCommand(ctx, [], { slot: 'roundtrip' });

    ctx.state!.cash = 0; // mutate after save to prove load restores it
    const result = loadCommand(ctx, [], { slot: 'roundtrip' });

    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(123_456);
  });

  it('regenerates ctx.grid as a fresh instance matching the saved world size', () => {
    const ctx = makeCtx();
    const gridIdBeforeSave = ctx.grid!.id;
    saveCommand(ctx, [], { slot: 'gridcheck' });

    ctx.grid = null;
    const result = loadCommand(ctx, [], { slot: 'gridcheck' });

    expect(result.success).toBe(true);
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.id).not.toBe(gridIdBeforeSave);
    expect(ctx.grid!.sizeX).toBe(16);
    expect(ctx.grid!.sizeY).toBe(16);
    expect(ctx.grid!.sizeZ).toBe(16);
  });

  it('rebuilds the navGrid on the loaded state', () => {
    const ctx = makeCtx();
    saveCommand(ctx, [], { slot: 'navcheck' });
    ctx.state!.navGrid = null;

    loadCommand(ctx, [], { slot: 'navcheck' });

    expect(ctx.state!.navGrid).not.toBeNull();
  });

  it('fails with "unknown mine type" when the saved state has an invalid mineType', () => {
    const ctx = makeCtx();
    // Corrupt the in-memory state before re-saving over the same slot, since
    // the quick-save slots are only reachable through saveCommand/loadCommand.
    (ctx.state as unknown as { mineType: string }).mineType = 'nonexistent_mine_type';
    saveCommand(ctx, [], { slot: 'badtype' });

    const result = loadCommand(ctx, [], { slot: 'badtype' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('unknown mine type');
  });

  it('defaults to the "quicksave" slot when none is given', () => {
    const ctx = makeCtx();
    saveCommand(ctx, [], {});
    ctx.state!.cash = -1;
    const result = loadCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).not.toBe(-1);
  });
});
