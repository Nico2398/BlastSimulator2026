// BlastSimulator2026 — GameRenderer ambient layer (birds, smoke, water, vegetation)
// Split out of GameRenderer.test.ts: each test here builds a real landscape
// (seconds each), and vitest only parallelises across files.

import { describe, it, expect, vi } from 'vitest';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import * as THREE from 'three';
import { meshClaimsCell } from '../../../src/renderer/terrain/PlayableCoverage.js';
import { dropClaimedAmbient } from '../../../src/renderer/GameRendererSceneSetup.js';
import { makeMockSceneManager } from '../../helpers/rendererFixtures.js';

describe('GameRenderer — birds, smoke, water, vegetation (#458 T7.2/D12/A26)', () => {
  // makeCtx()'s hand-built VoxelGrid has no `state.world`, which
  // rebuildLandscapeMesh requires — these need the real console pipeline
  // (newGameCommand) to get a real biome + StructureSet (villages/rivers/
  // trees) landscape actually builds from.
  async function makeLandscapeCtx(mineType = 'green_foothills'): Promise<MiningContext> {
    return makeGameContext({ mineType, seed: '42', size: '64' });
  }

  it('syncFromContext builds vegetation (and, seed/biome permitting, water) from the real StructureSet', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx());

    // Grass is unconditional (the rim band always has some candidates on a
    // 64-wide grid); trees/water/smoke depend on what this seed's
    // StructureSet actually placed, so only grass is asserted unconditionally.
    const grass = sm.scene.children.find((c) => c.name === 'vegetation-grass');
    expect(grass).toBeDefined();
  });

  it('update() runs birds/smoke/water without throwing across many frames', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx());

    expect(() => {
      for (let i = 0; i < 30; i++) renderer.update(0.1);
    }).not.toThrow();
  });

  it('notifyBlastScatter reaches BirdFlocks without throwing, before and after a game is loaded', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    expect(() => renderer.notifyBlastScatter(10, 10)).not.toThrow(); // no game loaded yet

    renderer.syncFromContext(await makeLandscapeCtx());
    expect(() => renderer.notifyBlastScatter(32, 32)).not.toThrow();
  });

  it('rebuilding the landscape (level swap) disposes the previous ambient meshes instead of accumulating them', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeLandscapeCtx();
    renderer.syncFromContext(ctx);
    const grassCountAfterFirst = sm.scene.children.filter((c) => c.name === 'vegetation-grass').length;

    // Same seed, different grid object — takes the "grid changed, same seed"
    // branch that calls rebuildLandscapeMesh() a second time without going
    // through loadGame()'s clearAll() first (mirrors a campaign level swap).
    const { VoxelGrid } = await import('../../../src/core/world/VoxelGrid.js');
    ctx.grid = new VoxelGrid(64, 64);
    ctx.landscape = null;
    renderer.syncFromContext(ctx);
    const grassCountAfterSecond = sm.scene.children.filter((c) => c.name === 'vegetation-grass').length;

    expect(grassCountAfterFirst).toBe(1);
    expect(grassCountAfterSecond).toBe(1); // still exactly one — the stale mesh was disposed, not left behind
  });
});

describe('GameRenderer — ambient props never stand on claimed ground (#1664)', () => {
  /** Every visible (non-zero-scale) vegetation/scenery instance position. */
  function visibleProps(scene: THREE.Scene): Array<{ x: number; z: number }> {
    const out: Array<{ x: number; z: number }> = [];
    const m = new THREE.Matrix4();
    for (const c of scene.children) {
      if (!(c instanceof THREE.InstancedMesh) || !(c.name.startsWith('vegetation-') || c.name === 'scenery-rocks')) continue;
      for (let i = 0; i < c.count; i++) {
        c.getMatrixAt(i, m);
        if (new THREE.Vector3().setFromMatrixScale(m).x === 0) continue;
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        out.push({ x: p.x, z: p.z });
      }
    }
    return out;
  }

  async function ctxWithClaim() {
    const ctx = await makeGameContext({ mineType: 'green_foothills', seed: '42', size: '64' });
    const grid = ctx.grid!;
    // Claim a strip of rim ground before the ambient layer is built.
    grid.addChunk(grid.maxX / 16, 0);
    grid.addChunk(grid.maxX / 16, 1);
    return ctx;
  }

  it('buildAmbient on a grid with an already-claimed chunk leaves no visible prop on meshed ground', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await ctxWithClaim();
    renderer.syncFromContext(ctx);

    const props = visibleProps(sm.scene);
    expect(props.length).toBeGreaterThan(0);
    expect(props.filter(p => meshClaimsCell(ctx.grid!, Math.floor(p.x), Math.floor(p.z)))).toEqual([]);
  });

  it('a claim made after load hides the props on it through the terrain remesh path', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    const ctx = await makeGameContext({ mineType: 'green_foothills', seed: '42', size: '64' });
    renderer.syncFromContext(ctx);
    const grid = ctx.grid!;
    const before = visibleProps(sm.scene).length;

    grid.addChunk(grid.maxX / 16, 0);
    grid.addChunk(grid.maxX / 16, 1);
    renderer.remeshTerrainRegion(ctx, { minX: grid.maxX - 16, minY: 0, minZ: 0, maxX: grid.maxX + 16, maxY: 4, maxZ: 32 });

    const after = visibleProps(sm.scene);
    expect(after.length).toBeLessThan(before);
    expect(after.filter(p => meshClaimsCell(grid, Math.floor(p.x), Math.floor(p.z)))).toEqual([]);
  });

  it('dropClaimedAmbient asks vegetation and scenery to hide exactly the meshClaimsCell ground', async () => {
    const ctx = await makeGameContext({ size: 32 });
    const grid = ctx.grid!;
    const vegetation = { dropClaimed: vi.fn(() => 0) };
    const scenery = { dropClaimed: vi.fn(() => 0) };
    dropClaimedAmbient({ vegetation, scenery } as any, grid);

    for (const spy of [vegetation.dropClaimed, scenery.dropClaimed]) {
      expect(spy).toHaveBeenCalledTimes(1);
      const predicate = (spy.mock.calls[0] as unknown as [(x: number, z: number) => boolean])[0];
      expect(predicate(4.5, 4.5)).toBe(meshClaimsCell(grid, 4.5, 4.5));
      expect(predicate(4.5, 4.5)).toBe(true);
      expect(predicate(grid.maxX + 40, grid.maxZ + 40)).toBe(false);
    }
  });

  it('dropClaimedAmbient tolerates missing modules', async () => {
    const ctx = await makeGameContext({ size: 32 });
    expect(() => dropClaimedAmbient({ vegetation: null, scenery: null }, ctx.grid!)).not.toThrow();
  });
});
