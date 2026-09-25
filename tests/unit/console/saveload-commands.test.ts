// BlastSimulator2026 — saveCommand/loadCommand unit tests (#408)
// Exercises the console quick-save round trip, including the grid
// regeneration `loadCommand` performs on load (the VoxelGrid is not part of
// the serialized GameState — see saveload.ts's header comment).

import { describe, it, expect, beforeEach } from 'vitest';
import { saveCommand, loadCommand } from '../../../src/console/commands/saveload.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';

function makeCtx(): MiningContext {
  return makeGameContext({ mineType: 'desert', seed: '1', size: '16' });
}

beforeEach(() => resetHoleIds());

describe('saveCommand', () => {
  it('requires a loaded game', () => {
    const ctx = makeEmptyGameContext();
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

// BlastSimulator2026 — terrain save identity + edit-record round trip (#1181)
//
// A save no longer embeds dense chunk data (#458/#473's v6/v7 format). It
// embeds the generator identity (`terrainGenDatum`) plus the edit record
// (#1180's `grid.edits`) — so a save/load round trip must reproduce a dig
// through *replay*, not through a stored dense voxel array, and the
// no-voxels fallback must regenerate at the level's original base size, not
// whatever size a site-expanded live grid currently reports.
describe('save/load — terrain generator identity + edit record (#1181)', () => {
  it('replays a dig through the edit record on load, not dense storage', () => {
    const ctx = makeCtx();
    const digX = 2, digZ = 2;
    const digY = computeVoxelColumnSurfaceY(ctx.grid!, digX, digZ);
    expect(digY, 'expected solid ground at the dig column').toBeGreaterThanOrEqual(0);
    expect(ctx.grid!.densityAt(digX, digY, digZ)).toBeGreaterThan(0);

    const dugComposition = ctx.grid!.compositionAt(digX, digY - 1, digZ); // the voxel below survives — sanity reference
    ctx.grid!.clearVoxel(digX, digY, digZ);
    expect(ctx.grid!.densityAt(digX, digY, digZ)).toBe(0);

    saveCommand(ctx, [], { slot: 'dig-replay' });

    ctx.grid = null;
    const result = loadCommand(ctx, [], { slot: 'dig-replay' });

    expect(result.success).toBe(true);
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.densityAt(digX, digY, digZ)).toBe(0);
    // Everything below the dig is untouched — generation alone reproduces it, unaffected by the edit record.
    expect(ctx.grid!.compositionAt(digX, digY - 1, digZ).rocks).toEqual(dugComposition.rocks);
  });

  it('the no-voxels fallback regenerates at the level base size, not the live (possibly site-expanded) size', () => {
    const ctx = makeCtx(); // 16x16x16, baseSizeX/baseSizeZ === 16
    expect(ctx.state!.world!.baseSizeX).toBe(16);
    expect(ctx.state!.world!.baseSizeZ).toBe(16);

    // Simulate a site that expanded past its original footprint (#473):
    // the live bounding box grows, but baseSizeX/baseSizeZ never change.
    ctx.state!.world!.sizeX = 24;
    ctx.state!.world!.sizeZ = 24;

    // Save with no grid attached, so saveCommand never re-embeds a voxels
    // payload — reproducing a pre-#1181-era "no voxels" save.
    ctx.grid = null;
    expect(ctx.state!.world!.voxels).toBeUndefined();
    const saveResult = saveCommand(ctx, [], { slot: 'no-voxels-fallback' });
    expect(saveResult.success).toBe(true);

    const result = loadCommand(ctx, [], { slot: 'no-voxels-fallback' });

    expect(result.success).toBe(true);
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(16);
    expect(ctx.grid!.sizeZ).toBe(16);
  });

  it('refuses to load a save whose terrain generator version does not match, leaving ctx.state/ctx.grid unchanged', () => {
    // Build a save whose embedded voxels payload carries a tampered generator version.
    const buildCtx = makeCtx();
    saveCommand(buildCtx, [], { slot: 'version-mismatch' });
    loadCommand(buildCtx, [], { slot: 'version-mismatch' }); // materializes ctx.state.world.voxels with a real gen
    expect(buildCtx.state!.world!.voxels).toBeDefined();
    buildCtx.state!.world!.voxels!.gen.version += 1;
    buildCtx.grid = null; // saveCommand only re-embeds voxels when ctx.grid is set — keep our tampered payload intact
    saveCommand(buildCtx, [], { slot: 'version-mismatch' });

    // Attempt to load that tampered save into a different, already-running context.
    const ctx = makeCtx();
    const stateBefore = ctx.state;
    const gridBefore = ctx.grid;

    const result = loadCommand(ctx, [], { slot: 'version-mismatch' });

    expect(result.success).toBe(false);
    expect(ctx.state).toBe(stateBefore);
    expect(ctx.grid).toBe(gridBefore);
  });
});
