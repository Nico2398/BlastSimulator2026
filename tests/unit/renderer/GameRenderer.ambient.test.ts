// BlastSimulator2026 — GameRenderer ambient layer (birds, smoke, water, vegetation)
// Split out of GameRenderer.test.ts: each test here builds a real landscape
// (seconds each), and vitest only parallelises across files.

import { describe, it, expect } from 'vitest';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { makeGameContext } from '../../helpers/gameContext.js';
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
    ctx.grid = new VoxelGrid(64, 64, 64);
    ctx.landscape = null;
    renderer.syncFromContext(ctx);
    const grassCountAfterSecond = sm.scene.children.filter((c) => c.name === 'vegetation-grass').length;

    expect(grassCountAfterFirst).toBe(1);
    expect(grassCountAfterSecond).toBe(1); // still exactly one — the stale mesh was disposed, not left behind
  });
});
