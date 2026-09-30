// BlastSimulator2026 — saveCommand/loadCommand unit tests (#408)
// Exercises the console quick-save round trip, including the grid
// regeneration `loadCommand` performs on load (the VoxelGrid is not part of
// the serialized GameState — see saveload.ts's header comment).

import { describe, it, expect, beforeEach } from 'vitest';
import { saveCommand, loadCommand } from '../../../src/console/commands/saveload.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { computeVoxelColumnSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import { requireValidGenDimension, MAX_TERRAIN_GEN_DIMENSION } from '../../../src/core/world/TerrainGen.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';
import { stateForSave, loadGridForState } from '../../../src/console/commands/world.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import type { SerializedVoxels } from '../../../src/core/state/VoxelGridCodec.js';

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
    expect(digY).not.toBeNull();
    expect(digY, 'expected solid ground at the dig column').toBeGreaterThanOrEqual(0);
    expect(ctx.grid!.densityAt(digX, digY!, digZ)).toBeGreaterThan(0);

    const dugComposition = ctx.grid!.compositionAt(digX, digY! - 1, digZ); // the voxel below survives — sanity reference
    ctx.grid!.clearVoxel(digX, digY!, digZ);
    expect(ctx.grid!.densityAt(digX, digY!, digZ)).toBe(0);

    saveCommand(ctx, [], { slot: 'dig-replay' });

    ctx.grid = null;
    const result = loadCommand(ctx, [], { slot: 'dig-replay' });

    expect(result.success).toBe(true);
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.densityAt(digX, digY!, digZ)).toBe(0);
    // Everything below the dig is untouched — generation alone reproduces it, unaffected by the edit record.
    expect(ctx.grid!.compositionAt(digX, digY! - 1, digZ).rocks).toEqual(dugComposition.rocks);
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

  /**
   * Load a save of a fresh game whose embedded terrain payload `tamper` has
   * corrupted into `ctx`, through `loadGridForState` — exactly what
   * `loadCommand` runs on a slot's contents. Returns the refusal, or null.
   */
  function loadTampered(ctx: MiningContext, tamper: (voxels: SerializedVoxels) => void): string | null {
    const source = makeCtx();
    const saved = JSON.parse(serialize(stateForSave(source, source.state!))) as { world: { voxels: SerializedVoxels } };
    tamper(saved.world.voxels);
    return loadGridForState(ctx, deserialize(JSON.stringify(saved)));
  }

  /** Assert `refusal` is a refusal and left `ctx` exactly as it was. */
  function expectRefusedUnchanged(ctx: MiningContext, load: () => string | null): string {
    const stateBefore = ctx.state;
    const gridBefore = ctx.grid;
    const playableAreaBefore = ctx.playableArea;
    const refusal = load();
    expect(refusal).not.toBeNull();
    expect(ctx.state).toBe(stateBefore);
    expect(ctx.grid).toBe(gridBefore);
    expect(ctx.playableArea).toBe(playableAreaBefore);
    return refusal!;
  }

  it('refuses to load a save whose terrain generator version does not match, leaving ctx.state/ctx.grid unchanged', () => {
    const ctx = makeCtx();
    expectRefusedUnchanged(ctx, () => loadTampered(ctx, v => { v.gen.version += 1; }));
  });

  // #1181 review: decodeVoxelGrid now runs (and can throw) *before* ctx.state
  // is touched, so a malformed voxels payload — as opposed to a genuine
  // version mismatch — must fail cleanly with the distinct
  // world.terrain_save_corrupt copy, leaving ctx entirely untouched.
  it('refuses to load a save whose voxels payload is malformed (gen.datum absurd), leaving ctx.state/ctx.grid/ctx.playableArea unchanged', () => {
    const ctx = makeCtx();
    expectRefusedUnchanged(ctx, () => loadTampered(ctx, v => { v.gen.datum = 1e9; }));
  });

  it('refuses to load a save whose voxels payload has a malformed "added" edit segment (no composition), leaving ctx unchanged', () => {
    const ctx = makeCtx();
    expectRefusedUnchanged(ctx, () => loadTampered(ctx, v => {
      v.editColumns.push({ x: 2, z: 2, segments: [{ yLo: 3, yHi: 3, kind: 'added' }] });
    }));
  });

  it('a malformed-payload failure carries the distinct corrupt-save message, not the version-mismatch message', () => {
    const versionCtx = makeCtx();
    const versionRefusal = expectRefusedUnchanged(versionCtx, () => loadTampered(versionCtx, v => { v.gen.version += 1; }));
    const corruptCtx = makeCtx();
    const corruptRefusal = expectRefusedUnchanged(corruptCtx, () => loadTampered(corruptCtx, v => { v.gen.datum = 1e9; }));

    // The two refusal messages are distinct — the corrupt-save copy never
    // mentions a generator version, unlike the version-mismatch copy.
    expect(corruptRefusal).not.toEqual(versionRefusal);
    expect(corruptRefusal).toContain('corrupt');
    expect(versionRefusal).not.toContain('corrupt');
  });
});

// BlastSimulator2026 — loadGridForState's no-voxels fallback vs. a corrupted
// world.baseSizeX/datum/baseSizeZ (#1218)
//
// Before this fix, the no-voxels fallback (`regenerateGridParams`, world.ts)
// read `state.world.baseSizeX`/`datum`/`baseSizeZ` straight off untrusted
// parsed save JSON with no bounds check, then fed them into
// `generateTerrain`/`buildGameNavGrid` — an absurd value (e.g. `1e9`) drove
// `NavGrid.buildNavGrid`'s `width * height` column loop unbounded, hanging
// the process indefinitely rather than throwing. `requireValidGenDimension`
// (TerrainGen.ts) now guards each field before it can reach generation, the
// same guard `VoxelGridCodec.decodeVoxelGrid`'s embedded-voxels path already
// had (#1181) — this is the sibling no-voxels path's regression coverage.
//
// Each rejection must be synchronous — `requireValidGenDimension` throws
// before `generateTerrain`/`buildGameNavGrid` ever runs — so these tests
// never need a hang timeout of their own: without the fix in place, the
// process itself would not return in time for vitest's own per-test timeout
// to save it, exactly reproducing the pre-#1218 hang.
describe('save snapshots — terrain is encoded at save time and never kept on the live state', () => {
  const editedColumns = (state: ReturnType<typeof stateForSave>): string[] =>
    (state.world?.voxels?.editColumns ?? []).map(c => `${c.x},${c.z}`);

  it('saving leaves the live state without a terrain payload', () => {
    const ctx = makeCtx();
    saveCommand(ctx, [], { slot: 'no-payload-on-live' });
    expect(ctx.state!.world!.voxels).toBeUndefined();
  });

  it('each snapshot encodes the terrain as it is at that moment — a dig after one save is in the next', () => {
    const ctx = makeCtx();
    const before = stateForSave(ctx, ctx.state!);
    const top = computeVoxelColumnSurfaceY(ctx.grid!, 3, 4)!;
    ctx.grid!.clearVoxel(3, top, 4);
    const after = stateForSave(ctx, ctx.state!);

    expect(editedColumns(before)).not.toContain('3,4');
    expect(editedColumns(after)).toContain('3,4');
    expect(ctx.state!.world!.voxels).toBeUndefined();
  });

  it('loading leaves no terrain payload on the live state, so a later save cannot carry a stale one', () => {
    const ctx = makeCtx();
    const top = computeVoxelColumnSurfaceY(ctx.grid!, 5, 5)!;
    ctx.grid!.clearVoxel(5, top, 5);
    saveCommand(ctx, [], { slot: 'strip-on-load' });
    loadCommand(ctx, [], { slot: 'strip-on-load' });
    expect(ctx.state!.world!.voxels).toBeUndefined();

    const top2 = computeVoxelColumnSurfaceY(ctx.grid!, 6, 6)!;
    ctx.grid!.clearVoxel(6, top2, 6);
    expect(editedColumns(stateForSave(ctx, ctx.state!))).toEqual(expect.arrayContaining(['5,5', '6,6']));
    // The serialized live state (what an unsnapshotted save would write) holds no terrain at all.
    expect(JSON.parse(serialize(ctx.state!)).world.voxels).toBeUndefined();
  });

  it('a column dug below y = 0 comes back from a console save/load exactly', () => {
    const ctx = makeCtx();
    const top = computeVoxelColumnSurfaceY(ctx.grid!, 7, 7)!;
    for (let y = top; y >= -6; y--) ctx.grid!.clearVoxel(7, y, 7);
    saveCommand(ctx, [], { slot: 'below-zero' });

    ctx.grid = null;
    expect(loadCommand(ctx, [], { slot: 'below-zero' }).success).toBe(true);

    expect(computeVoxelColumnSurfaceY(ctx.grid!, 7, 7)).toBe(-7);
    expect(ctx.grid!.densityAt(7, -3, 7)).toBe(0);
    expect(ctx.grid!.densityAt(7, -7, 7)).toBe(1);
  });
});

describe("loadGridForState — no-voxels fallback rejects a corrupted world size field (#1218)", () => {
  /** Save a no-voxels state whose `world[field]` has been corrupted to `value`, under `slot`. */
  function saveWithCorruptedWorldField(field: 'baseSizeX' | 'datum' | 'baseSizeZ', value: number, slot: string): void {
    const buildCtx = makeCtx();
    (buildCtx.state!.world as unknown as Record<string, number>)[field] = value;
    buildCtx.grid = null; // no-voxels save — reproduces a pre-#1181-era save with no embedded voxels payload
    expect(buildCtx.state!.world!.voxels).toBeUndefined();
    const saveResult = saveCommand(buildCtx, [], { slot });
    expect(saveResult.success).toBe(true);
  }

  /** Load `slot` into a fresh ctx and assert a clean refusal that leaves ctx untouched. */
  function expectRefusedAndUnchanged(slot: string): void {
    const ctx = makeCtx();
    const stateBefore = ctx.state;
    const gridBefore = ctx.grid;
    const landscapeBefore = ctx.landscape;
    const playableAreaBefore = ctx.playableArea;

    const result = loadCommand(ctx, [], { slot });

    expect(result.success).toBe(false);
    expect(result.output).toContain('corrupt');
    expect(ctx.state).toBe(stateBefore);
    expect(ctx.grid).toBe(gridBefore);
    expect(ctx.landscape).toBe(landscapeBefore);
    expect(ctx.playableArea).toBe(playableAreaBefore);
  }

  it('refuses a no-voxels save with an absurdly large baseSizeX (1e9), leaving ctx unchanged', () => {
    saveWithCorruptedWorldField('baseSizeX', 1e9, 'huge-baseSizeX');
    expectRefusedAndUnchanged('huge-baseSizeX');
  });

  it('refuses a no-voxels save with an absurdly large datum (1e9), leaving ctx unchanged', () => {
    saveWithCorruptedWorldField('datum', 1e9, 'huge-datum');
    expectRefusedAndUnchanged('huge-datum');
  });

  it('refuses a no-voxels save with an absurdly large baseSizeZ (1e9), leaving ctx unchanged', () => {
    saveWithCorruptedWorldField('baseSizeZ', 1e9, 'huge-baseSizeZ');
    expectRefusedAndUnchanged('huge-baseSizeZ');
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['non-integer', 3.5],
    ['NaN', NaN],
  ] as const)('refuses a no-voxels save with baseSizeX = %s (%p), leaving ctx unchanged', (label, value) => {
    const slot = `edge-baseSizeX-${label}`;
    saveWithCorruptedWorldField('baseSizeX', value, slot);
    expectRefusedAndUnchanged(slot);
  });

  // Regression guard against over-rejection: the validator `regenerateGridParams`
  // calls must still accept a value exactly at the ceiling. Exercising this
  // through the full `loadCommand` pipeline (as the rejection tests above do)
  // isn't practical here — `regenerateGrid` would build a real
  // MAX_TERRAIN_GEN_DIMENSION x MAX_TERRAIN_GEN_DIMENSION (4096x4096) NavGrid,
  // which does not complete in unit-test time (confirmed: >60s at this size,
  // vs. milliseconds at the 16x16x16 sizes the rest of this file uses) — the
  // same reason `VoxelGridCodec.test.ts`'s sibling suite for the
  // embedded-voxels path tests `requireValidGenDimension`'s rejections
  // directly rather than driving `decodeVoxelGrid`'s full pipeline at
  // MAX_TERRAIN_GEN_DIMENSION. So this exercises the shared validator itself,
  // at its exact ceiling.
  it('accepts a value exactly at MAX_TERRAIN_GEN_DIMENSION (regression guard against over-rejection)', () => {
    expect(requireValidGenDimension(MAX_TERRAIN_GEN_DIMENSION, 'world.baseSizeX')).toBe(MAX_TERRAIN_GEN_DIMENSION);
  });
});
