// BlastSimulator2026 — Tests for GameRendererTerrain.getTerrainSurfaceY (#1007)
//
// Buildings, vehicles, and employees used to be placed at the integer
// voxel-top height (computeVoxelColumnSurfaceY(grid,x,z)+1), but the
// terrain itself renders via marching cubes at the fractional "surface
// crossing" height (computeVoxelColumnSurfaceHeight / getSmoothTerrainSurfaceY
// in src/core/world/VoxelGrid.ts, already used by the #1006 landscape-seam
// code). The mismatch floats entities up to ~1m above the rendered ground.
//
// getTerrainSurfaceY must delegate to getSmoothTerrainSurfaceY so entity
// placement matches what TerrainMesh actually draws at that column.

import { describe, it, expect, vi } from 'vitest';
import { VoxelGrid, computeVoxelColumnSurfaceY, getSmoothTerrainSurfaceY } from '../../../src/core/world/VoxelGrid.js';
import { getTerrainSurfaceY, landscapeEdgeHeightSampler, remeshTerrainRegion, type TerrainDeps } from '../../../src/renderer/GameRendererTerrain.js';
import { makeGameContext } from '../../helpers/gameContext.js';

describe('getTerrainSurfaceY (#1007)', () => {
  it('returns the fractional marching-cubes crossing height, strictly below the old integer voxel-top height, for a clean solid-to-air column', () => {
    const grid = new VoxelGrid(16, 16);
    grid.fillVoxel(3, 4, 3, 0, undefined, 1); // topmost solid at y=4, y=5 stays air (density 0)

    const columnTop = computeVoxelColumnSurfaceY(grid, 3, 3);
    expect(columnTop).not.toBeNull();
    const oldIntegerHeight = columnTop! + 1; // 5
    const surfaceY = getTerrainSurfaceY(grid, 3, 3);

    // t = (0.5 - 1.0) / (0.0 - 1.0) = 0.5 -> crossing at y=4.5.
    expect(surfaceY).toBeCloseTo(4.5, 6);
    expect(surfaceY).toBeLessThan(oldIntegerHeight);
  });

  it('interpolates a non-half fractional crossing when the voxel above the topmost solid one is partially filled', () => {
    const grid = new VoxelGrid(16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(3, 4, 3, compId, undefined, 1.0);
    grid.fillVoxel(3, 5, 3, compId, undefined, 0.3);

    // t = (0.5 - 1.0) / (0.3 - 1.0) = 5/7 -> crossing at y = 4 + 5/7.
    expect(getTerrainSurfaceY(grid, 3, 3)).toBeCloseTo(4 + 5 / 7, 6);
  });

  it('delegates exactly to getSmoothTerrainSurfaceY (same value for the same column)', () => {
    const grid = new VoxelGrid(16, 16);
    grid.fillVoxel(3, 4, 3, 0, undefined, 1);
    expect(getTerrainSurfaceY(grid, 3, 3)).toBe(getSmoothTerrainSurfaceY(grid, 3, 3));
  });

  it('clamps an out-of-bounds (x, z) to the nearest edge column instead of throwing or returning NaN', () => {
    const grid = new VoxelGrid(16, 16);
    grid.addChunk(-1, 0);
    grid.fillVoxel(-16, 2, 0, 0, undefined, 1);

    const surfaceY = getTerrainSurfaceY(grid, -99, 0);

    expect(Number.isNaN(surfaceY)).toBe(false);
    expect(surfaceY).toBeCloseTo(2.5, 6);
  });

  it('returns 0 for a column with no solid voxel at all (fully dug out) — regression guard', () => {
    const grid = new VoxelGrid(16, 16);
    expect(getTerrainSurfaceY(grid, 3, 3)).toBe(0);
  });

  it('returns 0 for a null grid', () => {
    expect(getTerrainSurfaceY(null, 5, 5)).toBe(0);
  });
});

describe('landscapeEdgeHeightSampler ensureLandscape base size (#1188)', () => {
  it('builds the landscape from the level\'s base size, not a live/post-expansion size', () => {
    const ctx = makeGameContext({ size: 32 });
    const world = ctx.state!.world!;
    const baseSizeX = world.baseSizeX;
    const baseSizeZ = world.baseSizeZ;

    // Simulate a post-expansion state: the live bounding box grows, the
    // level's original base size does not.
    world.sizeX = baseSizeX + 64;
    world.sizeZ = baseSizeZ + 64;

    const sampler = landscapeEdgeHeightSampler(ctx);
    expect(sampler).not.toBeNull();
    expect(ctx.landscape).not.toBeNull();
    expect(ctx.landscape!.playableRect.maxX).toBe(baseSizeX);
    expect(ctx.landscape!.playableRect.maxZ).toBe(baseSizeZ);
  });
});

describe('remeshTerrainRegion onSiteClaimed (#1664)', () => {
  const REGION = { minX: 0, minY: 0, minZ: 0, maxX: 4, maxY: 4, maxZ: 4 };

  function makeDeps(extra: Partial<TerrainDeps> = {}) {
    const calls: string[] = [];
    const deps = {
      terrain: null,
      terrainMeshRevision: 0,
      lastCutBounds: '',
      landscape: null,
      landscapeHandle: null,
      landscapeStreamer: null,
      borderWall: null,
      refreshPanLeash: () => { calls.push('leash'); },
      ...extra,
    } as unknown as TerrainDeps;
    return { deps, calls };
  }

  it('fires with the grid once the claim moved the site bounds, right after the pan leash refresh', () => {
    const ctx = makeGameContext({ size: 32 });
    const onSiteClaimed = vi.fn();
    const { deps, calls } = makeDeps();
    deps.onSiteClaimed = (g) => { calls.push('claimed'); onSiteClaimed(g); };

    remeshTerrainRegion(deps, ctx, REGION); // first sight of the bounds
    onSiteClaimed.mockClear();
    calls.length = 0;

    ctx.grid!.addChunk(ctx.grid!.maxX / 16, 0);
    remeshTerrainRegion(deps, ctx, REGION);

    expect(onSiteClaimed).toHaveBeenCalledTimes(1);
    expect(onSiteClaimed).toHaveBeenCalledWith(ctx.grid);
    expect(calls).toEqual(['leash', 'claimed']);
  });

  it('does not fire for a dig inside already-owned ground', () => {
    const ctx = makeGameContext({ size: 32 });
    const onSiteClaimed = vi.fn();
    const { deps } = makeDeps({ onSiteClaimed });

    remeshTerrainRegion(deps, ctx, REGION);
    onSiteClaimed.mockClear();
    remeshTerrainRegion(deps, ctx, REGION);
    remeshTerrainRegion(deps, ctx, REGION);

    expect(onSiteClaimed).not.toHaveBeenCalled();
  });

  it('is optional: a claim with no callback still refreshes the leash', () => {
    const ctx = makeGameContext({ size: 32 });
    const { deps, calls } = makeDeps();
    remeshTerrainRegion(deps, ctx, REGION);
    ctx.grid!.addChunk(ctx.grid!.maxX / 16, 0);
    calls.length = 0;
    expect(() => remeshTerrainRegion(deps, ctx, REGION)).not.toThrow();
    expect(calls).toEqual(['leash']);
  });

  it('is not called when the context has no grid', () => {
    const ctx = makeGameContext({ size: 32 });
    const onSiteClaimed = vi.fn();
    const { deps } = makeDeps({ onSiteClaimed });
    remeshTerrainRegion(deps, ctx, REGION);
    onSiteClaimed.mockClear();
    ctx.grid = null as never;
    remeshTerrainRegion(deps, ctx, REGION);
    expect(onSiteClaimed).not.toHaveBeenCalled();
  });
});
