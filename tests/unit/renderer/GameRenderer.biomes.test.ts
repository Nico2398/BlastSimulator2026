// BlastSimulator2026 — GameRenderer per-biome ambient extras (dust devils, fireflies)
// Split out of GameRenderer.test.ts: each test here builds a real landscape
// (seconds each), and vitest only parallelises across files.

import { describe, it, expect } from 'vitest';
import { GameRenderer } from '../../../src/renderer/GameRenderer.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import { makeMockSceneManager } from '../../helpers/rendererFixtures.js';

describe('GameRenderer — per-biome ambient extras (#458 T7.3)', () => {
  async function makeLandscapeCtx(mineType: string): Promise<MiningContext> {
    return makeGameContext({ mineType, seed: '42', size: '64' });
  }

  it('builds dust devils, not fireflies, on an arid biome', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('desert_badlands'));

    expect(sm.scene.children.filter((c) => c.name === 'dust-devil').length).toBeGreaterThan(0);
    expect(sm.scene.children.find((c) => c.name === 'dust-devil-debris')).toBeDefined();
    expect(sm.scene.children.find((c) => c.name === 'fireflies')).toBeUndefined();
  });

  it('builds fireflies, not dust devils, on the humid tropical biome', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('tropical_karst'));

    expect(sm.scene.children.find((c) => c.name === 'fireflies')).toBeDefined();
    expect(sm.scene.children.find((c) => c.name === 'dust-devil')).toBeUndefined();
  });

  it('builds neither extra on a biome outside both sets', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('green_foothills'));

    expect(sm.scene.children.find((c) => c.name === 'dust-devil')).toBeUndefined();
    expect(sm.scene.children.find((c) => c.name === 'fireflies')).toBeUndefined();
  });

  it('update() runs dust devils and fireflies without throwing across many frames', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('red_canyon'));

    expect(() => {
      for (let i = 0; i < 30; i++) renderer.update(0.1);
    }).not.toThrow();
  });

  it('swapping from an arid to a non-arid biome disposes the stale dust devils instead of leaving them behind', async () => {
    const sm = makeMockSceneManager();
    const renderer = new GameRenderer(sm as any);
    renderer.syncFromContext(await makeLandscapeCtx('desert_badlands'));
    expect(sm.scene.children.filter((c) => c.name === 'dust-devil').length).toBeGreaterThan(0);

    renderer.syncFromContext(await makeLandscapeCtx('green_foothills'));
    expect(sm.scene.children.find((c) => c.name === 'dust-devil')).toBeUndefined();
    expect(sm.scene.children.find((c) => c.name === 'dust-devil-debris')).toBeUndefined();
  });
});
